import type { Profile, ProfileFieldSchema, ProfileSchema, ProfileSummary, ProviderConfig, VaultDocument } from '../common/types';
import { ProfileVault } from './vault';

const OMIT = (field: Profile['fields'][number]): ProfileFieldSchema => ({
  key: field.key, label: field.label, description: field.description, type: field.type,
});

function validateProfile(profile: Profile): void {
  if (!profile.id || !profile.name.trim()) throw new Error('Profile 必須有 ID 與名稱');
  const seen = new Set<string>();
  for (const field of profile.fields) {
    if (!/^[a-z][a-z0-9_.-]*$/i.test(field.key)) throw new Error(`欄位 key 無效：${field.key}`);
    if (seen.has(field.key)) throw new Error(`欄位 key 重複：${field.key}`);
    seen.add(field.key);
    if (!field.label.trim() || !['text','secret','boolean','date'].includes(field.type)) throw new Error('欄位資訊無效');
  }
}

export class ProfileService {
  constructor(private readonly vault: ProfileVault) {}
  getVault(): ProfileVault { return this.vault; }
  list(): ProfileSummary[] { return this.vault.read().profiles.map(p => ({ id:p.id, name:p.name, fieldCount:p.fields.length })); }
  get(id: string): Profile { const found = this.vault.read().profiles.find(p => p.id === id); if (!found) throw new Error('找不到 Profile'); return found; }
  getSchema(id: string): ProfileSchema { const profile = this.get(id); return { id:profile.id, name: profile.name, fields: profile.fields.filter(f => f.value !== '').map(OMIT) }; }
  getActiveId(): string | null { return this.vault.read().activeProfileId; }
  getActiveProfile(): Profile { const id = this.getActiveId(); if (!id) throw new Error('請先建立或選擇 Profile'); return this.get(id); }
  resolve(id: string, keys: string[]): Record<string,string> {
    const profile = this.get(id);
    const allowed = new Set(keys);
    return Object.fromEntries(profile.fields.filter(f => allowed.has(f.key)).map(f => [f.key, f.value]));
  }
  async save(profile: Profile): Promise<void> {
    validateProfile(profile);
    await this.vault.update(doc => {
      const index = doc.profiles.findIndex(p => p.id === profile.id);
      if (index >= 0) doc.profiles[index] = profile;
      else doc.profiles.push(profile);
      doc.activeProfileId ??= profile.id;
    });
  }
  async remove(id: string): Promise<void> {
    await this.vault.update(doc => {
      doc.profiles = doc.profiles.filter(p => p.id !== id);
      if (doc.activeProfileId === id) doc.activeProfileId = doc.profiles[0]?.id ?? null;
    });
  }
  async select(id: string): Promise<void> {
    await this.vault.update(doc => {
      if (!doc.profiles.some(p => p.id === id)) throw new Error('找不到 Profile');
      doc.activeProfileId = id;
    });
  }
  getProviderSummary(): { accountId: string; hasToken: boolean } {
    const doc = this.vault.read();
    const config = doc.providers.find(p => p.id === doc.activeProviderId);
    return { accountId:config?.accountId ?? '', hasToken: Boolean(config?.token) };
  }
  getProvider(): ProviderConfig {
    const doc = this.vault.read();
    const config = doc.providers.find(p => p.id === doc.activeProviderId);
    if (!config?.accountId || !config.token) throw new Error('請先設定 Cloudflare Account ID 和 API Token');
    return config;
  }
  async saveProvider(accountId: string, token?: string): Promise<void> {
    await this.vault.update(doc => {
      const id = 'cloudflare-clef-omni';
      const previous = doc.providers.find(p => p.id === id);
      const cleanId = accountId.trim();
      if (!cleanId) throw new Error('請提供 Cloudflare Account ID');
      const nextToken = token?.trim() || previous?.token || '';
      if (!nextToken) throw new Error('請提供 Cloudflare API Token');
      const next: ProviderConfig = { id, kind:'cloudflare-clef-omni', accountId:cleanId, token:nextToken };
      doc.providers = doc.providers.filter(p => p.id !== id).concat(next);
      doc.activeProviderId = id;
    });
  }
}
