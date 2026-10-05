import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { CoverageReport } from 'monocart-coverage-reports';

import { mergeOntoUnit } from './merge.mjs';
import {
  COVERAGE_FLOOR_PCT,
  COVERAGE_METRICS,
  COVERAGE_ROOT,
  E2E_COVERAGE_FILE,
  E2E_REPORT_OPTIONS,
  MERGED_OUTPUT_DIR,
  UNIT_COVERAGE_FILE,
} from './options.mjs';

/**
 * `pnpm test:coverage`: the AGENTS.md section 7 gate.
 *
 * 1. Vitest with V8 coverage -> coverage/unit (Istanbul JSON).
 * 2. A source-mapped, unminified build (DECK_COVERAGE=1).
 * 3. Playwright against it, collecting V8 coverage per page -> coverage/e2e.
 * 4. Merge E2E hits onto the unit report's structure (merge.mjs), report,
 *    and fail under the floor.
 *
 * `--merge-only` redoes step 4 from the files steps 1-3 left behind.
 *
 * The normal build is restored at the end even on failure: the owner loads
 * `apps/extension/dist` unpacked, and an instrumented build must not linger.
 */
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
}

async function collectE2e() {
  const e2eReport = new CoverageReport(E2E_REPORT_OPTIONS);
  e2eReport.cleanCache();
  run('pnpm', ['--filter', 'deck-extension', 'build'], { DECK_COVERAGE: '1' });
  run('pnpm', ['exec', 'playwright', 'test'], { DECK_COVERAGE: '1' });
  await e2eReport.generate();
}

function readIstanbul(file) {
  if (!existsSync(file)) throw new Error(`Missing coverage file: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function mergeAndCheck() {
  const merged = new CoverageReport({
    name: 'Deck coverage (unit + E2E)',
    outputDir: MERGED_OUTPUT_DIR,
    reports: ['text-summary', 'html', 'lcovonly', 'json-summary'],
  });
  await merged.add(
    mergeOntoUnit(
      readIstanbul(UNIT_COVERAGE_FILE),
      readIstanbul(E2E_COVERAGE_FILE),
    ),
  );
  const { summary } = await merged.generate();
  const failing = COVERAGE_METRICS.filter(
    (metric) => summary[metric].pct < COVERAGE_FLOOR_PCT,
  );
  for (const metric of failing)
    process.stderr.write(
      `Coverage ${metric} ${summary[metric].pct}% is below the ${COVERAGE_FLOOR_PCT}% floor.\n`,
    );
  return failing.length === 0;
}

async function main() {
  if (process.argv.includes('--merge-only')) {
    process.exitCode = (await mergeAndCheck()) ? 0 : 1;
    return;
  }
  rmSync(COVERAGE_ROOT, { recursive: true, force: true });
  try {
    run('pnpm', ['exec', 'vitest', 'run', '--coverage']);
    await collectE2e();
  } finally {
    run('pnpm', ['--filter', 'deck-extension', 'build']);
  }
  const isAboveFloor = await mergeAndCheck();
  process.exitCode = isAboveFloor ? 0 : 1;
}

await main();
