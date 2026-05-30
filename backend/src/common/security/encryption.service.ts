import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const masterKey =
      this.config.get<string>('MEBIUS_CODE_MASTER_KEY') ?? 'mebius-code-development-key';
    this.key = createHash('sha256').update(masterKey).digest();
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [ivText, tagText, encryptedText] = payload.split(':');
    if (!ivText || !tagText || !encryptedText) {
      throw new Error('Invalid encrypted payload format.');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}

