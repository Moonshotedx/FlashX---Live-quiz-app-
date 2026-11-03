import { PROFANITY_WORDS } from './profanity-words';

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('');
}

/** True when a display name contains a word from the editable list in lib/profanity-words.ts. */
export function isProfane(name: string): boolean {
  const norm = normalize(name);
  const squashed = norm.replace(/[^a-z]/g, '');
  const tokens = norm.split(/[^a-z]+/).filter(Boolean);
  return PROFANITY_WORDS.some((entry) => {
    const wholeWord = entry.startsWith('=') || entry.length <= 3;
    const w = entry.replace(/^=/, '');
    return wholeWord ? tokens.includes(w) : squashed.includes(w);
  });
}
