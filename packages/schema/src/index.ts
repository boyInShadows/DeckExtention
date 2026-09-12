/**
 * deck-schema - the single source of truth for every persisted shape in Deck.
 *
 * Nothing reads storage without parsing through here first (AGENTS.md 6:
 * "validate at every boundary"). Types are inferred from the schemas so a
 * schema change is a type error at every call site rather than a silent drift.
 */
export * from './common';
export * from './page';
export * from './deck';
export * from './card';
export * from './settings';
export * from './op';
export * from './snapshot';
