/**
 * The calm layer.
 *
 * P1.S1 ships it deliberately empty: the star finish for this step is a blank
 * Night page that paints instantly, and everything visible arrives later - the
 * clock, greeting and The Line in P1.S3, pins in P1.S4, the drawer in P2.
 *
 * The `data-deck` attributes are already here because AGENTS.md section 6
 * treats them as public API for the owner's Custom CSS escape hatch: they are
 * cheaper to establish now than to retrofit.
 */
export function Surface() {
  return (
    <main data-deck="surface" className="deck-surface">
      <div data-deck="surface-column" className="deck-surface__column" />
    </main>
  );
}
