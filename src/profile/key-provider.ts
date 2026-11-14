/** Pluggable key-protection boundary. The repository never sees plaintext keys. */
import type { KdfConfig, SealedBlob } from './crypto';
import { createKdfConfig, open, passwordKey, seal } from './crypto';

export type KeyEnvelope = {
  kind: 'password-pbkdf2';
  parameters: KdfConfig;
  wrappedKey: SealedBlob;
};

export interface KeyProvider {
  readonly kind: KeyEnvelope['kind'];
  protect(dataKey: Uint8Array, credential: string, options?: {iterations?: number}): Promise<KeyEnvelope>;
  recover(envelope: KeyEnvelope, credential: string): Promise<Uint8Array>;
}

const CONTEXT = 'decision-formfill:wrapped-dek:v1';

export class PasswordKeyProvider implements KeyProvider {
  readonly kind = 'password-pbkdf2' as const;

  async protect(dataKey: Uint8Array, password: string, options?: {iterations?: number}): Promise<KeyEnvelope> {
    const parameters = createKdfConfig(options?.iterations);
    const key = await passwordKey(password, parameters);
    return { kind:this.kind, parameters, wrappedKey:await seal(key, dataKey, CONTEXT) };
  }

  async recover(envelope: KeyEnvelope, password: string): Promise<Uint8Array> {
    if (envelope.kind !== this.kind) throw new Error('不支援此金鑰保護方案');
    const key = await passwordKey(password, envelope.parameters);
    return open(key, envelope.wrappedKey, CONTEXT);
  }
}
