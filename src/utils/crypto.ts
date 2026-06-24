// 来源: lib/utils/encryption_util.dart
// 用 Web Crypto API 替代 encrypt 包

const ALGORITHM = { name: 'AES-GCM', length: 256 };
const KEY_USAGE: KeyUsage[] = ['encrypt', 'decrypt'];

async function getKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const salt = enc.encode('handy-salt'); // 固定 salt
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    material, ALGORITHM, false, KEY_USAGE
  );
}

export async function encrypt(plaintext: string, password: string): Promise<string> {
  const key = await getKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, encoded
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(ciphertext: string, password: string): Promise<string> {
  const key = await getKey(password);
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, data
  );
  return new TextDecoder().decode(decrypted);
}
