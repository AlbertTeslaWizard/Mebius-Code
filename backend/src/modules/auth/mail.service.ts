import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  async sendRegisterVerificationCode(to: string, code: string): Promise<void> {
    const appName = this.config.get<string>('MAIL_APP_NAME') ?? 'Mebius Code';
    const from = this.config.get<string>('MAIL_FROM');
    if (!from) {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }
    const transporter = this.getTransporter();

    try {
      await transporter.sendMail({
        from,
        to,
        subject: `${appName} email verification code`,
        text: `Your ${appName} verification code is ${code}. It expires in 10 minutes.`,
        html: [
          `<p>Your <strong>${appName}</strong> verification code is:</p>`,
          `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>`,
          '<p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>',
        ].join(''),
      });
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException('Failed to send verification email.');
    }
  }

  private getTransporter(): Transporter {
    if ((this.config.get<string>('MAIL_ENABLED') ?? 'false') !== 'true') {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }

    if (!this.transporter) {
      const host = this.config.get<string>('SMTP_HOST');
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASS');
      if (!host || !user || !pass) {
        throw new ServiceUnavailableException('Email delivery is not configured.');
      }

      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      const secure = (this.config.get<string>('SMTP_SECURE') ?? 'false') === 'true';
      this.transporter = createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
    }

    return this.transporter;
  }
}
