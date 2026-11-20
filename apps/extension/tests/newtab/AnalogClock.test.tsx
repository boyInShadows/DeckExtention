// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import {
  createElement,
  render,
  type RenderResult,
} from '../../src/testing/render';
import AnalogClock from '../../src/newtab/AnalogClock';

let view: RenderResult | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

it.each([
  [0, 0, 0, 0, 0, 0],
  [3, 0, 0, 90, 0, 0],
  [3, 30, 0, 105, 180, 0],
  [15, 30, 30, 105.25, 183, 180],
  [23, 59, 59, 359.9916666667, 359.9, 354],
])(
  'shows local %i:%i:%i with fractional hour/minute positions',
  async (hour, minute, second, hourAngle, minuteAngle, secondAngle) => {
    view = await render(
      createElement(AnalogClock, {
        now: new Date(2026, 10, 20, hour, minute, second),
        label: 'Readable local time',
        showSeconds: true,
      }),
    );
    expect(view.get('svg').getAttribute('aria-label')).toBe(
      'Readable local time',
    );
    expect(view.get('svg').getAttribute('role')).toBe('img');
    for (const [hand, angle] of [
      ['hour', hourAngle],
      ['minute', minuteAngle],
      ['second', secondAngle],
    ] as const) {
      const transform = view
        .get(`[data-deck="analog-${hand}"]`)
        .getAttribute('transform');
      expect(transform).toMatch(/^rotate\([\d.]+ 50 50\)$/);
      expect(Number(transform?.slice(7).split(' ')[0])).toBeCloseTo(angle, 8);
    }
  },
);

it('hides the optional second hand and updates hands/text when time changes', async () => {
  view = await render(
    createElement(AnalogClock, {
      now: new Date(2026, 10, 20, 11, 59),
      label: '11:59',
      showSeconds: false,
    }),
  );
  expect(view.query('[data-deck="analog-second"]')).toBeNull();
  expect(view.getAll('[data-deck="analog-tick"]')).toHaveLength(12);
  await view.rerender(
    createElement(AnalogClock, {
      now: new Date(2026, 10, 20, 12),
      label: '12:00 PM',
      showSeconds: false,
    }),
  );
  expect(view.get('svg').getAttribute('aria-label')).toBe('12:00 PM');
  expect(view.get('[data-deck="analog-hour"]').getAttribute('transform')).toBe(
    'rotate(0 50 50)',
  );
  expect(
    view.get('[data-deck="analog-minute"]').getAttribute('transform'),
  ).toBe('rotate(0 50 50)');
});
