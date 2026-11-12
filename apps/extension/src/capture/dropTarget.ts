export type DropDestination =
  { kind: 'pin' } | { kind: 'inbox' } | { kind: 'deck'; deckId: string };

export function dropDestination(
  target: EventTarget | null,
): { element: HTMLElement; destination: DropDestination } | null {
  if (
    !(target instanceof Element) ||
    target.closest(
      'input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"], [role="menu"], [data-deck="settings"], [data-deck="help"], [data-deck="note"]',
    )
  )
    return null;
  const surface = target.closest<HTMLElement>('[data-deck="surface"]');
  if (!surface) return null;
  const pins = target.closest<HTMLElement>('[data-deck="pins"]');
  if (pins) return { element: pins, destination: { kind: 'pin' } };
  const deck = target.closest<HTMLElement>('[data-deck="deck"][data-deck-id]');
  if (deck?.dataset.deckId)
    return {
      element: deck,
      destination: { kind: 'deck', deckId: deck.dataset.deckId },
    };
  const inbox = target.closest<HTMLElement>(
    '[data-drop-inbox], [data-deck="inbox"]',
  );
  if (inbox) return { element: inbox, destination: { kind: 'inbox' } };
  if (target.closest('[data-deck="drawer"], [data-deck="section-nav"]'))
    return null;
  return {
    element: surface.querySelector<HTMLElement>('[data-drop-inbox]') ?? surface,
    destination: { kind: 'inbox' },
  };
}
