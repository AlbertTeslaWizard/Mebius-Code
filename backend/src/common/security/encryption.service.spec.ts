import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  it('encrypts and decrypts values without storing plaintext', () => {
    const config = {
      get: (key: string) =>
        key === 'MEBIUS_CODE_MASTER_KEY' ? 'test-master-key-for-mebius-code' : undefined,
    } as ConfigService;
    const service = new EncryptionService(config);

    const encrypted = service.encrypt('sk-test-secret');

    expect(encrypted).not.toContain('sk-test-secret');
    expect(service.decrypt(encrypted)).toBe('sk-test-secret');
  });
});

