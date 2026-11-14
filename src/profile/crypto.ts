/** Password envelope encryption, implemented with built-in Web Crypto only. */
export interface SealedBlob { iv: string; ciphertext: string }
export interface KdfConfig {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
}
export const DEFAULT_KDF_ITERATIONS = 310_000; // Benchmark on Firefox Android before release.
const encoder = new TextEncoder();

export function base64(bytes: Uint8Array): string {
  let output = '';
  // Avoid argument-limit failures when encrypting a larger vault.
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    output += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(output);
}

export function unbase64(text: string): Uint8Array {
  const input = atob(text);
  return Uint8Array.from(input, ch => ch.charCodeAt(0));
}

export function randomBytes(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}

export function createKdfConfig(iterations = DEFAULT_KDF_ITERATIONS): KdfConfig {
  return { algorithm: 'PBKDF2-SHA256', iterations, salt: base64(randomBytes(16)) };
}

export async function passwordKey(password: string, kdf: KdfConfig): Promise<CryptoKey> {
  if (kdf.algorithm !== 'PBKDF2-SHA256' || kdf.iterations < 1000 || kdf.iterations > 10_000_000) {
    throw new Error('不支援的密碼衍生參數');
  }
  const passwordMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: unbase64(kdf.salt) },
    passwordMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, plain: Uint8Array, aad: string): Promise<SealedBlob> {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, plain);
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) };
}

export async function open(key: CryptoKey, blob: SealedBlob, aad: string): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(blob.iv), additionalData: encoder.encode(aad) }, key, unbase64(blob.ciphertext));
  return new Uint8Array(decrypted);
}

export function toBytes(data: unknown): Uint8Array { return encoder.encode(JSON.stringify(data)); }
export function fromBytes<T>(bytes: Uint8Array): T { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
