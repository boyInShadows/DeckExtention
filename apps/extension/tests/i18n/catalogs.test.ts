import { describe, expect, expectTypeOf, it } from 'vitest';

import { strings } from '../../src/i18n/strings';
import { panelStrings } from '../../src/i18n/panelStrings';
import { captureStrings } from '../../src/i18n/captureStrings';
import { strings as englishSurface } from '../../src/i18n/en/strings';
import { panelStrings as englishPanels } from '../../src/i18n/en/panelStrings';
import { captureStrings as englishCapture } from '../../src/i18n/en/captureStrings';
import type {
  SurfaceCatalog,
  PanelCatalog,
  CaptureCatalog,
} from '../../src/i18n/catalogs';

describe('translation catalogs', () => {
  it('keeps English as the default for each loading boundary', () => {
    expect(strings).toEqual(englishSurface);
    expect(panelStrings).toEqual(englishPanels);
    expect(captureStrings).toEqual(englishCapture);
  });

  it('includes every shared surface key unchanged in the panel catalog', () => {
    for (const key of Object.keys(strings) as (keyof typeof strings)[]) {
      expect(panelStrings[key], key).toEqual(strings[key]);
    }
  });

  it('allows translated text while preserving interpolation contracts', () => {
    const surface: SurfaceCatalog = { ...englishSurface, links: 'Links test' };
    const panels: PanelCatalog = {
      ...englishPanels,
      settings: 'Settings test',
    };
    const capture: CaptureCatalog = { ...englishCapture, saved: 'Saved test' };
    expect(surface.links).toBe('Links test');
    expect(panels.settings).toBe('Settings test');
    expect(capture.saved).toBe('Saved test');
    expectTypeOf<SurfaceCatalog['pinRange']>().parameters.toEqualTypeOf<
      [number, number, number]
    >();
    expectTypeOf<PanelCatalog['focusCompleted']>().parameters.toEqualTypeOf<
      [string | undefined]
    >();
  });

  it('retains English plural, optional-title and boundary formatting', () => {
    expect(panelStrings.focusStreak(0)).toBe('0 days');
    expect(panelStrings.focusStreak(1)).toBe('1 day');
    expect(panelStrings.focusStreak(2)).toBe('2 days');
    expect(panelStrings.focusCompleted(undefined)).toBe(
      'Focus complete. A little further along.',
    );
    expect(panelStrings.focusCompleted('Read')).toBe('Focus complete: Read.');
    expect(strings.isoWeek(2026, 1)).toBe('2026-W01');
    expect(strings.pinRange(7, 12, 12)).toBe('7-12 of 12');
    expect(panelStrings.importNothingNew(0)).toBe('Nothing new to import.');
    expect(panelStrings.importDone(1)).toBe('Imported 1 link.');
    expect(panelStrings.importDone(2)).toBe('Imported 2 links.');
  });

  it('catalogs the drag lifecycle and accessible descriptions', () => {
    expect(strings.dragInstructions).toContain('press the space bar');
    expect(strings.sortable).toBe('sortable');
    expect(strings.dragPickedUp('card:one')).toBe(
      'Picked up draggable item card:one.',
    );
    expect(strings.dragOver('card:one', 'deck:two')).toBe(
      'Draggable item card:one was moved over droppable area deck:two.',
    );
    expect(strings.dragLeft('card:one')).toBe(
      'Draggable item card:one is no longer over a droppable area.',
    );
    expect(strings.dragDropped('card:one', 'deck:two')).toBe(
      'Draggable item card:one was dropped over droppable area deck:two',
    );
    expect(strings.dragDropped('card:one', undefined)).toBe(
      'Draggable item card:one was dropped.',
    );
    expect(strings.dragCancelled('card:one')).toBe(
      'Dragging was cancelled. Draggable item card:one was dropped.',
    );
    expect(panelStrings.deckColorNames.slate).toBe('slate');
  });
});
