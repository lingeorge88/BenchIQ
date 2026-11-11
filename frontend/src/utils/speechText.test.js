import { toSpeechText, splitSentences } from './speechText';

describe('toSpeechText', () => {
  test('strips emphasis, headings, inline code and links', () => {
    expect(toSpeechText('## Step **one**: run `prime` on [the panel](http://x.io) _now_'))
      .toBe('Step one: run prime on the panel now');
  });

  test('removes code fences, tables, images, URLs, citations and emoji', () => {
    const md = [
      'Check the probe. [Source 1] 🔬',
      '```',
      'rm -rf /',
      '```',
      '| a | b |',
      '|---|---|',
      '![img](pic.png) See https://example.com/docs for more.',
    ].join('\n');
    expect(toSpeechText(md)).toBe('Check the probe. See for more.');
  });

  test('removes blockquotes and list markers', () => {
    expect(toSpeechText('> Note\n- first item\n2. second item'))
      .toBe('Note. first item. second item.');
  });

  test('makes analyzer names readable', () => {
    expect(toSpeechText('AU5812, AU680, DXI800 and DxI 800'))
      .toBe('A U fifty-eight twelve, A U six eighty, D X I eight hundred and D X I eight hundred');
  });

  test('handles empty input', () => {
    expect(toSpeechText('')).toBe('');
    expect(toSpeechText(null)).toBe('');
  });
});

describe('splitSentences', () => {
  test('extracts complete sentences and keeps the partial remainder', () => {
    const { sentences, rest } = splitSentences('The reagent probe needs cleaning. Then run the cal');
    expect(sentences).toEqual(['The reagent probe needs cleaning.']);
    expect(rest).toBe(' Then run the cal');
  });

  test('does not split on a trailing period until final (could be a decimal)', () => {
    expect(splitSentences('Set the volume to version 3.').sentences).toEqual([]);
    expect(splitSentences('Set the volume to version 3.', true).sentences)
      .toEqual(['Set the volume to version 3.']);
  });

  test('merges short fragments into the next sentence', () => {
    const { sentences } = splitSentences('Yes. Sure! Restart the analyzer before calibrating. ');
    expect(sentences).toEqual(['Yes. Sure! Restart the analyzer before calibrating.']);
  });

  test('splits on newlines and question marks', () => {
    const { sentences } = splitSentences('Is the cuvette lamp warmed up?\nCheck the photometer readings first\nok');
    expect(sentences).toEqual(['Is the cuvette lamp warmed up?', 'Check the photometer readings first']);
  });

  test('holds back text inside an unterminated code fence', () => {
    const { sentences, rest } = splitSentences('Run this command now please.\n```\nfoo. bar. ');
    expect(sentences).toEqual(['Run this command now please.']);
    expect(rest.trim()).toBe('```\nfoo. bar.');
  });

  test('final flushes the remainder', () => {
    expect(splitSentences('short', true)).toEqual({ sentences: ['short'], rest: '' });
  });
});
