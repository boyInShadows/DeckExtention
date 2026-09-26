import { globSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Bundle budgets - AGENTS.md section 3.3.
 *
 * These numbers are the gate, not a suggestion: if a build exceeds one, the fix
 * is smaller code, never a bigger number. `gzip: true` is required because the
 * budgets are stated in gzipped kilobytes and size-limit measures brotli by
 * default. "kB" here is 1000 bytes, the stricter of the two readings.
 *
 * The file lists are derived from the built import graph, not from chunk-name
 * globs. Rollup renames and regroups shared chunks whenever the module graph
 * changes (adding a service-worker import once moved zod into a chunk called
 * `src-*.js`), and a glob that stops matching silently shrinks the measured
 * surface. Walking the static imports measures exactly what the browser
 * fetches before first paint, whatever the chunks are called.
 */
const BUDGET_SURFACE_TOTAL = '60 kB';
const BUDGET_SURFACE_ENTRY = '21 kB';
const BUDGET_DRAWER = '180 kB';

const DIST = 'dist';
const NEWTAB_HTML = join(DIST, 'src/newtab/index.html');
/** The lazily-imported drawer module (`import('../drawer/drawer')`). */
const DRAWER_GLOB = 'dist/assets/drawer-*.js';

/** `import{a}from"./x.js"` and `import"./x.js"` - never `import("./x.js")`. */
const STATIC_IMPORT =
  /\bimport\s*(?:[\w$\s{},*]+?from\s*)?["'](\.\/[^"']+\.js)["']/g;

function staticGraph(entryFile) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(STATIC_IMPORT)) {
      visit(join(dirname(file), specifier));
    }
  };
  visit(entryFile);
  return [...seen];
}

function newtabEntry() {
  const html = readFileSync(NEWTAB_HTML, 'utf8');
  const match = /<script[^>]+src="\/([^"]+\.js)"/.exec(html);
  if (!match) throw new Error(`No module script found in ${NEWTAB_HTML}`);
  return join(DIST, match[1]);
}

function onlyFile(glob) {
  const files = globSync(glob);
  if (files.length !== 1) {
    throw new Error(`Expected exactly one ${glob}, found ${files.length}`);
  }
  return files[0];
}

const toPath = (file) => relative('.', file).replaceAll('\\', '/');

const surfaceEntry = newtabEntry();
const surfaceFiles = staticGraph(surfaceEntry);
const surfaceSet = new Set(surfaceFiles);
/* The drawer is charged for what it adds on top of the already-loaded surface. */
const drawerFiles = staticGraph(onlyFile(DRAWER_GLOB)).filter(
  (file) => !surfaceSet.has(file),
);

export default [
  {
    name: `surface total (${surfaceFiles.length} files, static graph)`,
    path: surfaceFiles.map(toPath),
    limit: BUDGET_SURFACE_TOTAL,
    gzip: true,
  },
  {
    name: 'surface entry (new tab)',
    path: toPath(surfaceEntry),
    limit: BUDGET_SURFACE_ENTRY,
    gzip: true,
  },
  {
    name: `drawer chunk (${drawerFiles.length} files beyond the surface)`,
    path: drawerFiles.map(toPath),
    limit: BUDGET_DRAWER,
    gzip: true,
  },
];
