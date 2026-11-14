import type { ProfileRepository, EncryptedVault } from './repository';
import type { VaultDocument } from '../common/types';
import { fromBytes, importDataKey, open, randomBytes, seal, toBytes } from './crypto';
import { PasswordKeyProvider, type KeyProvider } from './key-provider';

const DATA_CONTEXT = 'decision-formfill:vault-data:v1';
const EMPTY_DOCUMENT: VaultDocument = {
  schemaVersion: 1, profiles: [], activeProfileId: null, providers: [], activeProviderId: null,
};

/** The unlocked document and key are kept only in this background-page instance. */
export class ProfileVault {
  private doc: VaultDocument | null = null;
  private dek: CryptoKey | null = null;
  private envelope: EncryptedVault | null = null;
  private lastAccess = 0;
  private readonly idleLimit = 15 * 60_000;

  constructor(private readonly repository: ProfileRepository,
    private readonly keyProviders: KeyProvider[] = [new PasswordKeyProvider()]) {}

  async exists(): Promise<boolean> { return (await this.repository.read()) !== null; }

  isUnlocked(): boolean {
    if (this.doc && Date.now() - this.lastAccess > this.idleLimit) this.lock();
    return this.doc !== null && this.dek !== null;
  }

  private touch(): void { this.lastAccess = Date.now(); }

  lock(): void {
    // JavaScript cannot promise to wipe GC-managed memory; drop references.
    this.doc = null;
    this.dek = null;
    this.envelope = null;
    this.lastAccess = 0;
  }

  async create(password: string, kdfIterations?: number): Promise<void> {
    if (await this.exists()) throw new Error('已建立資料庫，不能覆蓋');
    if (password.length < 10) throw new Error('請使用至少 10 個字元的密碼');
    const provider = this.keyProviders[0];
    const raw = randomBytes(32);
    const key = await provider.protect(raw, password, {iterations:kdfIterations});
    this.dek = await importDataKey(raw);
    raw.fill(0);
    const doc = structuredClone(EMPTY_DOCUMENT);
    const data = await seal(this.dek, toBytes(doc), DATA_CONTEXT);
    const envelope: EncryptedVault = { version: 1, key, data };
    await this.repository.write(envelope);
    this.doc = doc;
    this.envelope = envelope;
    this.touch();
  }

  async exportEncrypted(): Promise<EncryptedVault> {
    const envelope = await this.repository.read();
    if (!envelope) throw new Error('尚未建立加密資料庫');
    return structuredClone(envelope);
  }

  async importEncrypted(envelope: EncryptedVault, password: string): Promise<void> {
    if (!envelope || envelope.version !== 1 || !envelope.key || !envelope.data) {
      throw new Error('備份檔案格式不正確');
    }
    // Verify the candidate backup with its password before replacing existing data.
    const provider = this.keyProviders.find(p => p.kind === envelope.key.kind);
    if (!provider) throw new Error('不支援的金鑰保護方案');
    let key: CryptoKey;
    try {
      const raw = await provider.recover(envelope.key, password);
      key = await importDataKey(raw);
      raw.fill(0);
      const doc = fromBytes<VaultDocument>(await open(key, envelope.data, DATA_CONTEXT));
      if (doc.schemaVersion !== 1 || !Array.isArray(doc.profiles) || !Array.isArray(doc.providers)) {
        throw new Error('備份資料無效');
      }
    } catch { throw new Error('備份密碼錯誤或備份資料已損壞'); }
    await this.repository.write(envelope);
    this.lock();
    await this.unlock(password);
  }

  async unlock(password: string): Promise<void> {
    this.lock();
    const envelope = await this.repository.read();
    if (!envelope) throw new Error('尚未建立加密資料庫');
    try {
      const provider = this.keyProviders.find(p => p.kind === envelope.key.kind);
      if (!provider) throw new Error('不支援此金鑰保護方案');
      const raw = await provider.recover(envelope.key, password);
      const dek = await importDataKey(raw);
      raw.fill(0);
      const doc = fromBytes<VaultDocument>(await open(dek, envelope.data, DATA_CONTEXT));
      if (doc.schemaVersion !== 1 || !Array.isArray(doc.profiles) || !Array.isArray(doc.providers)) {
        throw new Error('資料結構無效');
      }
      this.dek = dek;
      this.doc = doc;
      this.envelope = envelope;
      this.touch();
    } catch {
      this.lock();
      throw new Error('密碼不正確或加密資料已損壞');
    }
  }

  read(): VaultDocument {
    if (!this.isUnlocked()) throw new Error('Profile 已鎖定，請先解鎖');
    this.touch();
    return structuredClone(this.doc!);
  }

  /** Persist before exposing modified state, so partial write failures cannot leave stale state. */
  async update(change: (draft: VaultDocument) => void): Promise<void> {
    if (!this.isUnlocked() || !this.dek || !this.envelope) throw new Error('Profile 已鎖定');
    const next = structuredClone(this.doc!);
    change(next);
    const data = await seal(this.dek, toBytes(next), DATA_CONTEXT);
    const updated: EncryptedVault = { ...this.envelope, data };
    await this.repository.write(updated);
    this.doc = next;
    this.envelope = updated;
    this.touch();
  }
}
