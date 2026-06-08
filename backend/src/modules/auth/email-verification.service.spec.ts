import { ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import {
  EmailVerificationCode,
  EmailVerificationPurpose,
} from './email-verification-code.entity';
import { EmailVerificationService } from './email-verification.service';
import { MailService } from './mail.service';
import { UsersService } from '../users/users.service';

describe('EmailVerificationService', () => {
  const queryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const codes = {
    create: jest.fn((input: Partial<EmailVerificationCode>) => input as EmailVerificationCode),
    findOne: jest.fn(),
    save: jest.fn(async (input: Partial<EmailVerificationCode>) => ({
      id: input.id ?? 'code-1',
      createdAt: input.createdAt ?? new Date(),
      consumedAt: input.consumedAt ?? null,
      ...input,
    })),
    count: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
  } as unknown as jest.Mocked<Repository<EmailVerificationCode>>;
  const users = {
    findByEmail: jest.fn(),
  } as unknown as jest.Mocked<UsersService>;
  const mail = {
    sendRegisterVerificationCode: jest.fn(),
  } as unknown as jest.Mocked<MailService>;
  const service = new EmailVerificationService(codes, users, mail);

  beforeEach(() => {
    jest.clearAllMocks();
    users.findByEmail.mockResolvedValue(null);
    codes.findOne.mockResolvedValue(null);
    codes.count.mockResolvedValue(0);
    queryBuilder.getOne.mockResolvedValue(null);
  });

  it('stores a hashed code and sends it to the normalized email address', async () => {
    const result = await service.sendRegisterCode(' User@Example.COM ');

    expect(result).toEqual({
      sent: true,
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });
    expect(codes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        purpose: EmailVerificationPurpose.Register,
        attempts: 0,
        expiresAt: expect.any(Date),
      }),
    );

    const savedCode = codes.create.mock.calls[0][0].codeHash;
    const sentCode = mail.sendRegisterVerificationCode.mock.calls[0][1];
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(savedCode).not.toBe(sentCode);
    expect(await compare(sentCode, savedCode as string)).toBe(true);
    expect(mail.sendRegisterVerificationCode).toHaveBeenCalledWith('user@example.com', sentCode);
  });

  it('rejects sending a register code for an existing user', async () => {
    users.findByEmail.mockResolvedValue({ id: 'user-1' } as never);

    await expect(service.sendRegisterCode('user@example.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mail.sendRegisterVerificationCode).not.toHaveBeenCalled();
  });

  it('rejects repeated sends during the cooldown window', async () => {
    codes.findOne.mockResolvedValue({
      email: 'user@example.com',
      purpose: EmailVerificationPurpose.Register,
      consumedAt: null,
      createdAt: new Date(),
    } as EmailVerificationCode);

    await expect(service.sendRegisterCode('user@example.com')).rejects.toMatchObject({
      status: 429,
    });
    expect(mail.sendRegisterVerificationCode).not.toHaveBeenCalled();
    expect(codes.count).not.toHaveBeenCalled();
  });

  it('rejects register code sends after the hourly email cap', async () => {
    codes.count.mockResolvedValueOnce(3);

    await expect(service.sendRegisterCode('user@example.com')).rejects.toMatchObject({
      status: 429,
    });

    expect(codes.count).toHaveBeenCalledTimes(1);
    expect(mail.sendRegisterVerificationCode).not.toHaveBeenCalled();
  });

  it('rejects register code sends after the daily email cap', async () => {
    codes.count.mockResolvedValueOnce(2).mockResolvedValueOnce(10);

    await expect(service.sendRegisterCode('user@example.com')).rejects.toMatchObject({
      status: 429,
    });

    expect(codes.count).toHaveBeenCalledTimes(2);
    expect(mail.sendRegisterVerificationCode).not.toHaveBeenCalled();
  });

  it('rejects register code sends after the global daily cap', async () => {
    codes.count.mockResolvedValueOnce(2).mockResolvedValueOnce(9).mockResolvedValueOnce(80);

    await expect(service.sendRegisterCode('user@example.com')).rejects.toMatchObject({
      status: 429,
    });

    expect(codes.count).toHaveBeenCalledTimes(3);
    expect(mail.sendRegisterVerificationCode).not.toHaveBeenCalled();
  });

  it('deletes the stored code if email delivery fails', async () => {
    mail.sendRegisterVerificationCode.mockRejectedValue(
      new ServiceUnavailableException('SMTP failed'),
    );

    await expect(service.sendRegisterCode('user@example.com')).rejects.toBeInstanceOf(
      HttpException,
    );

    expect(codes.delete).toHaveBeenCalledWith('code-1');
  });

  it('consumes a valid register code', async () => {
    const record = verificationRecord({ codeHash: await hash('123456', 10) });
    queryBuilder.getOne.mockResolvedValue(record);

    await service.verifyAndConsumeRegisterCode('User@Example.COM', '123456');

    expect(queryBuilder.where).toHaveBeenCalledWith('verification.email = :email', {
      email: 'user@example.com',
    });
    expect(record.consumedAt).toBeInstanceOf(Date);
    expect(codes.save).toHaveBeenCalledWith(record);
  });

  it('increments attempts and rejects an invalid register code', async () => {
    const record = verificationRecord({ codeHash: await hash('123456', 10), attempts: 2 });
    queryBuilder.getOne.mockResolvedValue(record);

    await expect(service.verifyAndConsumeRegisterCode('user@example.com', '999999')).rejects
      .toMatchObject({ status: 400 });

    expect(record.attempts).toBe(3);
    expect(record.consumedAt).toBeNull();
    expect(codes.save).toHaveBeenCalledWith(record);
  });

  it('rejects expired or exhausted register codes without consuming them', async () => {
    const expired = verificationRecord({ expiresAt: new Date(Date.now() - 1000) });
    queryBuilder.getOne.mockResolvedValueOnce(expired);

    await expect(service.verifyAndConsumeRegisterCode('user@example.com', '123456')).rejects
      .toMatchObject({ status: 400 });

    const exhausted = verificationRecord({ attempts: 5 });
    queryBuilder.getOne.mockResolvedValueOnce(exhausted);

    await expect(service.verifyAndConsumeRegisterCode('user@example.com', '123456')).rejects
      .toMatchObject({ status: 400 });

    expect(codes.save).not.toHaveBeenCalled();
  });
});

function verificationRecord(
  overrides: Partial<EmailVerificationCode> = {},
): EmailVerificationCode {
  return {
    id: 'code-1',
    email: 'user@example.com',
    purpose: EmailVerificationPurpose.Register,
    codeHash: 'hash',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  };
}
