import { Injectable, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

interface PairingCodeRecord {
  id: string;
  ownerId: string;
  codeHash: string;
  expiresAt: number;
  consumed: boolean;
}

@Injectable()
export class LocalPairingService {
  private readonly codes = new Map<string, PairingCodeRecord>();

  async create(ownerId: string): Promise<{
    code: string;
    expiresInSeconds: number;
  }> {
    this.cleanup();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const id = randomUUID();
    this.codes.set(id, {
      id,
      ownerId,
      codeHash: await hash(code, 8),
      expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
      consumed: false,
    });

    return { code, expiresInSeconds: PAIRING_CODE_TTL_MS / 1000 };
  }

  async consume(code: string): Promise<string> {
    this.cleanup();
    const normalized = code.trim();
    for (const record of this.codes.values()) {
      if (record.consumed || record.expiresAt <= Date.now()) {
        continue;
      }
      if (await compare(normalized, record.codeHash)) {
        record.consumed = true;
        return record.ownerId;
      }
    }
    throw new UnauthorizedException('Invalid or expired pairing code.');
  }

  private cleanup(): void {
    const now = Date.now();
    for (const record of this.codes.values()) {
      if (record.consumed || record.expiresAt <= now) {
        this.codes.delete(record.id);
      }
    }
  }
}
