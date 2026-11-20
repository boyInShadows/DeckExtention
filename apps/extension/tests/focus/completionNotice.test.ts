// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { showFocusCompletion } from '../../src/focus/completionNotice';
import { emptyFocus, transitionFocus } from '../../src/focus/model';
import type { NoticeInput } from '../../src/newtab/ToastStack';

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const start = new Date(2026, 10, 20, 10).getTime();
  const state = transitionFocus(
    emptyFocus(),
    { type: 'start', minutes: 1 },
    start,
    'focus_sound',
  );
  const entry = transitionFocus(state, { type: 'sync' }, start + 60_000)
    .history[0];
  if (!entry) throw new Error('Completed fixture missing');
  const play = vi.fn(async () => undefined);
  const audio = { currentTime: 0, volume: 1, play };
  const Audio = vi.fn(function () {
    return audio;
  });
  vi.stubGlobal('Audio', Audio);
  return {
    entry,
    audio,
    play,
    Audio,
    notify: vi.fn<(notice: NoticeInput) => void>(),
    openFocus: vi.fn(),
  };
}

it('shows the completion popup immediately, plays once and allows replay without reopening Focus', async () => {
  const data = setup();
  showFocusCompletion(data.entry, data.notify, data.openFocus);
  expect(data.notify).toHaveBeenCalledTimes(1);
  expect(data.play).toHaveBeenCalledTimes(1);
  expect(data.Audio).toHaveBeenCalledTimes(1);
  expect(data.audio.volume).toBeGreaterThan(0);
  expect(data.audio.volume).toBeLessThan(1);
  const notice = data.notify.mock.calls[0]?.[0];
  expect(notice).toMatchObject({
    source: 'focus',
    kind: 'info',
    text: expect.stringContaining('Focus complete'),
  });
  expect(notice?.secondaryAction?.label).toBe('Play sound');
  await notice?.secondaryAction?.run();
  await notice?.secondaryAction?.run();
  expect(data.play).toHaveBeenCalledTimes(3);
  expect(data.notify).toHaveBeenCalledTimes(1);
  expect(data.openFocus).not.toHaveBeenCalled();
  await notice?.action?.run();
  expect(data.openFocus).toHaveBeenCalledTimes(1);
});

it('keeps the completion message and offers manual playback when autoplay is rejected', async () => {
  const data = setup();
  data.play.mockRejectedValueOnce(
    new DOMException('Autoplay blocked', 'NotAllowedError'),
  );
  showFocusCompletion(data.entry, data.notify, data.openFocus);
  await vi.waitFor(() => expect(data.notify).toHaveBeenCalledTimes(2));
  expect(data.notify.mock.calls[1]?.[0]).toMatchObject({
    kind: 'info',
    text: expect.stringContaining('Play sound'),
  });
  const notice = data.notify.mock.calls[0]?.[0];
  await notice?.secondaryAction?.run();
  expect(data.play).toHaveBeenCalledTimes(2);
  expect(
    data.notify.mock.calls.filter(([item]) => item.source === 'focus'),
  ).toHaveLength(1);
});

it('bundles an original non-silent short PCM chime without clipping', async () => {
  const bytes = await readFile('apps/extension/src/focus/completion-chime.wav');
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
  expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
  const sampleRate = bytes.readUInt32LE(24);
  const sampleBytes = bytes.readUInt16LE(34) / 8;
  const duration = (bytes.length - 44) / sampleRate / sampleBytes;
  expect(duration).toBeGreaterThan(0.5);
  expect(duration).toBeLessThan(1);
  const samples = Array.from(
    { length: (bytes.length - 44) / sampleBytes },
    (_, index) => Math.abs(bytes.readInt16LE(44 + index * sampleBytes)),
  );
  expect(Math.max(...samples)).toBeGreaterThan(1_000);
  expect(Math.max(...samples)).toBeLessThan(32_767);
});
