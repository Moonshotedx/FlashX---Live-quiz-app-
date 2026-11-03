import { randomInt } from 'node:crypto';

// No 0/O/1/I/L so codes are easy to read aloud and type.
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateJoinCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) out += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  return out;
}

export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

