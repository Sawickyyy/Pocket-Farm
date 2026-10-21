// Eksport / import zapisu jako tekst: "PFARM1." + base64url(JSON) + "." + suma kontrolna.

import type { GameState } from '../sim/types';
import { SaveError, loadFromUnknown } from './migrations';

const PREFIX = 'PFARM1.';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** FNV-1a 32-bit – wykrywa uszkodzenia przy kopiowaniu tekstu. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function encodeSave(state: GameState): string {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(state)));
  return `${PREFIX}${body}.${checksum(body)}`;
}

export function decodeSave(text: string, now: number): GameState {
  const clean = text.replace(/\s+/g, '');
  if (!clean.startsWith(PREFIX)) throw new SaveError('To nie jest kod zapisu Pocket Farm.');
  const [body, sum] = clean.slice(PREFIX.length).split('.');
  if (!body || !sum || checksum(body) !== sum) throw new SaveError('Kod zapisu jest niekompletny lub uszkodzony.');
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    throw new SaveError('Nie udało się odczytać kodu zapisu.');
  }
  return loadFromUnknown(data, now);
}
