import { LocalPairingService } from './local-pairing.service';

describe('LocalPairingService', () => {
  it('creates one-time six-digit pairing codes', async () => {
    const service = new LocalPairingService();
    const created = await service.create('owner-1');

    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.expiresInSeconds).toBe(300);
    await expect(service.consume(created.code)).resolves.toBe('owner-1');
    await expect(service.consume(created.code)).rejects.toThrow('Invalid or expired pairing code.');
  });
});
