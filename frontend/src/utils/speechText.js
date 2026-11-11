// Helpers for turning streamed markdown into speakable sentences.

const MIN_SENTENCE_LENGTH = 20;

const ANALYZER_NAMES = [
  [/\bAU\s?5812\b/gi, 'A U fifty-eight twelve'],
  [/\bAU\s?680\b/gi, 'A U six eighty'],
  [/\bDx[I1]\s?800\b/gi, 'D X I eight hundred'],
];

/** Convert a markdown snippet into plain text suitable for TTS. */
export function toSpeechText(md) {
  if (!md) return '';
  let s = String(md);

  s = s.replace(/```[\s\S]*?(?:```|$)/g, ' '); // fenced code (also unterminated)
  s = s
    .split('\n')
    .filter(line => !line.includes('|')) // table rows
    .join('\n');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // images
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links -> text
  s = s.replace(/\[(?:sources?|refs?|citations?|\d+)[^\]]*\]/gi, ' '); // [Source 1], [2]
  s = s.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' '); // bare URLs
  s = s.replace(/`([^`]*)`/g, '$1').replace(/`/g, ''); // inline code
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, ''); // headings
  s = s.replace(/^\s*>+\s?/gm, ''); // blockquotes
  s = s.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, ''); // list markers
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2'); // strong
  s = s.replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/gm, '$1$2'); // emphasis
  s = s.replace(/\*+/g, ''); // stray asterisks
  s = s.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, ''); // emoji

  for (const [re, spoken] of ANALYZER_NAMES) s = s.replace(re, spoken);

  const lines = s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length > 1) {
    // Separate list items / lines so they don't run together when spoken.
    return lines.map(l => (/[.?!:;,]$/.test(l) ? l : `${l}.`)).join(' ');
  }
  return lines[0] || '';
}

/**
 * Extract complete sentences from a (possibly partial) streamed buffer.
 * Boundaries: `.?!` followed by whitespace (or end, when `final`), and newlines.
 * Fragments shorter than `minLength` are merged into the following sentence.
 * While a code fence is open, text after it is held back.
 * Returns `{ sentences, rest }`; with `final` everything is flushed and rest is ''.
 */
export function splitSentences(text, final = false, minLength = MIN_SENTENCE_LENGTH) {
  let scan = text || '';
  let held = '';
  if (!final) {
    const fences = scan.match(/```/g);
    if (fences && fences.length % 2 === 1) {
      const open = scan.lastIndexOf('```');
      held = scan.slice(open);
      scan = scan.slice(0, open);
    }
  }

  const re = final ? /[.?!]+(?=\s|$)|\n+/g : /[.?!]+(?=\s)|\n+/g;
  const sentences = [];
  let start = 0;
  let pending = '';
  let m;
  while ((m = re.exec(scan))) {
    const end = m.index + m[0].length;
    pending += scan.slice(start, end);
    start = end;
    if (pending.trim().length >= minLength) {
      sentences.push(pending.trim());
      pending = '';
    }
  }

  let rest = pending + scan.slice(start) + held;
  if (final) {
    if (rest.trim()) sentences.push(rest.trim());
    rest = '';
  }
  return { sentences, rest };
}
