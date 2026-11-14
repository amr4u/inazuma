import type { SealedBlob } from './crypto';
import type { KeyEnvelope } from './key-provider';

export interface EncryptedVault {
  version: 1;
  key: KeyEnvelope;
  data: SealedBlob;
}

export interface ProfileRepository {
  read(): Promise<EncryptedVault | null>;
  write(data: EncryptedVault): Promise<void>;
}

export class BrowserProfileRepository implements ProfileRepository {
  private static readonly KEY = 'decision-formfill:encrypted-vault:v1';

  async read(): Promise<EncryptedVault | null> {
    const stored = (await browser.storage.local.get(BrowserProfileRepository.KEY))[BrowserProfileRepository.KEY];
    if (stored == null) return null;
    if (stored.version !== 1 || !stored.key || !stored.data) {
      throw new Error('無法識別加密資料版本');
    }
    return stored as EncryptedVault;
  }

  async write(data: EncryptedVault): Promise<void> {
    await browser.storage.local.set({ [BrowserProfileRepository.KEY]: data });
  }
}

export class MemoryProfileRepository implements ProfileRepository {
  stored: EncryptedVault | null = null;
  async read(): Promise<EncryptedVault | null> { return this.stored; }
  async write(data: EncryptedVault): Promise<void> { this.stored = data; }
}
