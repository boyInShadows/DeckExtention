import { globSync } from 'node:fs';

/**
 * Bundle budgets - AGENTS.md section 3.3.
 *
 * These numbers are the gate, not a suggestion: if a build exceeds one, the fix
 * is smaller code, never a bigger number. `gzip: true` is required because the
 * budgets are stated in gzipped kilobytes and size-limit measures brotli by
 * default. "kB" here is 1000 bytes, the stricter of the two readings.
 */
const BUDGET_SURFACE = '60 kB';
const BUDGET_DRAWER = '180 kB';

/** CRXJS names the new-tab entry after its HTML input. */
const SURFACE_GLOB = 'dist/assets/index.html-*.js';

/** The lazily-imported drawer chunk. It arrives in P2.S1. */
const DRAWER_GLOB = 'dist/assets/*drawer*.js';

const entries = [
  {
    name: 'surface entry (new tab)',
    path: SURFACE_GLOB,
    limit: BUDGET_SURFACE,
    gzip: true,
  },
];

/*
 * The drawer budget is declared now so it is not "decided" under pressure later,
 * but size-limit fails hard on a glob that matches nothing, so it is only
 * enforced once the chunk exists. The glob is deliberately loose (*drawer*) so a
 * rename does not quietly drop the budget.
 */
if (globSync(DRAWER_GLOB).length > 0) {
  entries.push({
    name: 'drawer chunk',
    path: DRAWER_GLOB,
    limit: BUDGET_DRAWER,
    gzip: true,
  });
}

export default entries;
