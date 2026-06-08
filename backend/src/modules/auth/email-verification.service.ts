import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { randomInt } from 'crypto';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import {
  EmailVerificationCode,
  EmailVerificationPurpose,
} from './email-verification-code.entity';
import { MailService } from './mail.service';

const CODE_LENGTH = 6;
const CODE_TTL_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_EMAIL_CODES_PER_HOUR = 3;
const MAX_EMAIL_CODES_PER_DAY = 10;
const MAX_GLOBAL_CODES_PER_DAY = 80;
const HOUR_IN_MS = 60 * 60 * 1000;
const DAY_IN_MS = 24 * HOUR_IN_MS;

@Injectable()
export class EmailVerificationService {
  constructor(
    @InjectRepository(EmailVerificationCode)
    private readonly codes: Repository<EmailVerificationCode>,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  async sendRegisterCode(inputEmail: string): Promise<{
    sent: true;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  }> {
    const email = this.normalizeEmail(inputEmail);
    const existingUser = await this.users.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('Email is already registered.');
    }

    const latest = await this.codes.findOne({
      where: { email, purpose: EmailVerificationPurpose.Register },
      order: { createdAt: 'DESC' },
    });
    if (latest && !latest.consumedAt && this.isInsideCooldown(latest.createdAt)) {
      throw new HttpException(
        'Please wait before requesting another verification code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.enforceSendRateLimits(email);

    const code = this.generateCode();
    const record = await this.codes.save(
      this.codes.create({
        email,
        purpose: EmailVerificationPurpose.Register,
        codeHash: await hash(code, 10),
        expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
        attempts: 0,
      }),
    );

    try {
      await this.mail.sendRegisterVerificationCode(email, code);
    } catch (error) {
      await this.codes.delete(record.id);
      throw error;
    }

    return {
      sent: true,
      expiresInSeconds: CODE_TTL_SECONDS,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyAndConsumeRegisterCode(inputEmail: string, code: string): Promise<void> {
    const email = this.normalizeEmail(inputEmail);
    const record = await this.codes
      .createQueryBuilder('verification')
      .addSelect('verification.codeHash')
      .where('verification.email = :email', { email })
      .andWhere('verification.purpose = :purpose', {
        purpose: EmailVerificationPurpose.Register,
      })
      .andWhere('verification.consumed_at IS NULL')
      .orderBy('verification.created_at', 'DESC')
      .getOne();

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw this.invalidCodeError();
    }
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw this.invalidCodeError();
    }

    const matches = await compare(code, record.codeHash);
    if (!matches) {
      record.attempts += 1;
      await this.codes.save(record);
      throw this.invalidCodeError();
    }

    record.consumedAt = new Date();
    await this.codes.save(record);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private generateCode(): string {
    return randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0');
  }

  private isInsideCooldown(createdAt: Date): boolean {
    return createdAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 > Date.now();
  }

  private async enforceSendRateLimits(email: string): Promise<void> {
    const now = Date.now();
    const emailHourlyCount = await this.countSendsSince(email, new Date(now - HOUR_IN_MS));
    if (emailHourlyCount >= MAX_EMAIL_CODES_PER_HOUR) {
      throw this.rateLimitError();
    }

    const emailDailyCount = await this.countSendsSince(email, new Date(now - DAY_IN_MS));
    if (emailDailyCount >= MAX_EMAIL_CODES_PER_DAY) {
      throw this.rateLimitError();
    }

    const globalDailyCount = await this.countSendsSince(undefined, new Date(now - DAY_IN_MS));
    if (globalDailyCount >= MAX_GLOBAL_CODES_PER_DAY) {
      throw this.rateLimitError();
    }
  }

  private async countSendsSince(email: string | undefined, since: Date): Promise<number> {
    return this.codes.count({
      where: {
        ...(email ? { email } : {}),
        purpose: EmailVerificationPurpose.Register,
        createdAt: MoreThanOrEqual(since),
      },
    });
  }

  private rateLimitError(): HttpException {
    return new HttpException(
      'Too many verification emails. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private invalidCodeError(): BadRequestException {
    return new BadRequestException('Invalid or expired verification code.');
  }
}
