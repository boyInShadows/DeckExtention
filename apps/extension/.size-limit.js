import { globSync } from 'node:fs';

/**
 * Bundle budgets - AGENTS.md section 3.3.
 *
 * These numbers are the gate, not a suggestion: if a build exceeds one, the fix
 * is smaller code, never a bigger number. `gzip: true` is required because the
 * budgets are stated in gzipped kilobytes and size-limit measures brotli by
 * default. "kB" here is 1000 bytes, the stricter of the two readings.
 */
const BUDGET_SURFACE_ENTRY = '21 kB';
const BUDGET_SURFACE_RUNTIME = '9.7 kB';
const BUDGET_SURFACE_STORAGE = '27.5 kB';
const BUDGET_SURFACE_STRINGS = '1.8 kB';
const BUDGET_DRAWER = '180 kB';

/*
 * The initial surface graph is emitted as shared files because both the service
 * worker and new tab use storage. Their allocations add to exactly 60 kB; this
 * prevents a small entry file from hiding a large synchronously loaded shared
 * chunk.
 */

/** CRXJS names the new-tab entry after its HTML input. */
const SURFACE_GLOB = 'dist/assets/index.html-*.js';
const SURFACE_RUNTIME_GLOB = 'dist/assets/jsx-runtime-*.js';
const SURFACE_STORAGE_GLOB = 'dist/assets/storage-*.js';
const SURFACE_STRINGS_GLOB = 'dist/assets/strings-*.js';
const SURFACE_ALL_GLOB =
  'dist/assets/{index.html,jsx-runtime,storage,strings,WorkspaceDnd}-*.js';

/** The lazily-imported drawer chunk. It arrives in P2.S1. */
const DRAWER_GLOB = 'dist/assets/*drawer*.js';

const entries = [
  {
    name: 'surface total',
    path: SURFACE_ALL_GLOB,
    limit: '60 kB',
    gzip: true,
  },
  {
    name: 'surface entry (new tab)',
    path: SURFACE_GLOB,
    limit: BUDGET_SURFACE_ENTRY,
    gzip: true,
  },
  {
    name: 'surface runtime dependency',
    path: SURFACE_RUNTIME_GLOB,
    limit: BUDGET_SURFACE_RUNTIME,
    gzip: true,
  },
  {
    name: 'surface storage dependency',
    path: SURFACE_STORAGE_GLOB,
    limit: BUDGET_SURFACE_STORAGE,
    gzip: true,
  },
  {
    name: 'surface strings dependency',
    path: SURFACE_STRINGS_GLOB,
    limit: BUDGET_SURFACE_STRINGS,
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
