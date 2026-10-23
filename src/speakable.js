/** Turns one bubble line into speech text: markup, URLs and emoji out, length capped. */

const NOISE = /[\p{Extended_Pictographic}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const MARKS = /[*_`~#>|]+/g;
const URLS = /https?:\/\/\S+/g;

export const SPEAK_MAX = 600;

export function speakable(text) {
  const cleaned = String(text ?? '')
    .replace(URLS, ' ')
    .replace(NOISE, ' ')
    .replace(MARKS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > SPEAK_MAX ? `${cleaned.slice(0, SPEAK_MAX)}……` : cleaned;
}
