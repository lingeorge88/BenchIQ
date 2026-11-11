import { downsample, concatFrames, encodeWav } from './wav';

test('downsample 48k -> 16k keeps a third of the samples', () => {
  const input = new Float32Array(4800).fill(0.5);
  const out = downsample(input, 48000, 16000);
  expect(out.length).toBe(1600);
  expect(out[0]).toBeCloseTo(0.5);
});

test('concatFrames joins frames in order', () => {
  const out = concatFrames([new Float32Array([1, 2]), new Float32Array([3])]);
  expect(Array.from(out)).toEqual([1, 2, 3]);
});

test('encodeWav writes a 16 kHz mono PCM header', async () => {
  const blob = encodeWav(new Float32Array([0, 1, -1]), 16000);
  expect(blob.type).toBe('audio/wav');
  expect(blob.size).toBe(44 + 3 * 2);
  const view = new DataView(await new Response(blob).arrayBuffer());
  const tag = (o) => String.fromCharCode(...[0, 1, 2, 3].map(i => view.getUint8(o + i)));
  expect(tag(0)).toBe('RIFF');
  expect(tag(8)).toBe('WAVE');
  expect(view.getUint16(22, true)).toBe(1); // mono
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getInt16(46, true)).toBe(0x7fff); // +1.0 clipped to max
});
