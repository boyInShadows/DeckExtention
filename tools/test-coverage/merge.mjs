/**
 * Merges E2E hits onto the unit report's structure.
 *
 * Vitest and the E2E converter split the same source into statements,
 * functions and branches differently, so a plain Istanbul merge unions two
 * maps and inflates every total. Instead the unit report's maps are the one
 * structure, and an E2E hit only counts where it provably lands:
 *
 * - statement: the innermost E2E statement containing its start ran, and so
 *   did the innermost E2E function around it;
 * - function: the innermost E2E function containing its start ran;
 * - branch arm: the innermost E2E branch arm containing its start ran.
 *
 * Anything without a match gets no credit. Under-counting is acceptable;
 * over-counting is a fabricated number (AGENTS.md section 5).
 */

function isBefore(a, b) {
  return a.line < b.line || (a.line === b.line && a.column <= b.column);
}

function contains(range, point) {
  return isBefore(range.start, point) && isBefore(point, range.end);
}

function size(range) {
  return (
    (range.end.line - range.start.line) * 1_000_000 +
    (range.end.column - range.start.column)
  );
}

/** The smallest of `entries` ({ range, count }) that contains `point`. */
function innermost(entries, point) {
  return entries
    .filter((entry) => contains(entry.range, point))
    .reduce(
      (best, entry) =>
        !best || size(entry.range) < size(best.range) ? entry : best,
      undefined,
    );
}

function e2eIndex(file) {
  const statements = Object.entries(file.statementMap).map(([id, range]) => ({
    range,
    count: file.s[id],
  }));
  const functions = Object.entries(file.fnMap).map(([id, fn]) => ({
    range: fn.loc,
    count: file.f[id],
  }));
  const arms = Object.entries(file.branchMap).flatMap(([id, branch]) =>
    branch.locations.map((range, arm) => ({ range, count: file.b[id][arm] })),
  );
  return { statements, functions, arms };
}

function hasRun(entry) {
  return Boolean(entry && entry.count > 0);
}

function statementRan(index, range) {
  const statement = innermost(index.statements, range.start);
  if (!hasRun(statement)) return false;
  const fn = innermost(index.functions, range.start);
  return !fn || (hasRun(fn) && contains(fn.range, statement.range.start));
}

function mergeFile(unit, e2e) {
  if (!e2e) return unit;
  const index = e2eIndex(e2e);
  const bump = (count, ran) => (count === 0 && ran ? 1 : count);
  return {
    ...unit,
    s: Object.fromEntries(
      Object.entries(unit.s).map(([id, count]) => [
        id,
        bump(count, statementRan(index, unit.statementMap[id])),
      ]),
    ),
    f: Object.fromEntries(
      Object.entries(unit.f).map(([id, count]) => [
        id,
        bump(
          count,
          hasRun(innermost(index.functions, unit.fnMap[id].loc.start)),
        ),
      ]),
    ),
    b: Object.fromEntries(
      Object.entries(unit.b).map(([id, counts]) => [
        id,
        counts.map((count, arm) => {
          const location = unit.branchMap[id].locations[arm];
          const ran =
            location?.start?.line !== undefined &&
            hasRun(innermost(index.arms, location.start));
          return bump(count, ran);
        }),
      ]),
    ),
  };
}

/**
 * @param unitCoverage Istanbul coverage map from Vitest: the structure.
 * @param e2eCoverage Istanbul coverage map from the E2E run: extra hits.
 * Files only the E2E run saw are left out, so the denominator stays the
 * unit report's (which already lists every measured file).
 */
export function mergeOntoUnit(unitCoverage, e2eCoverage) {
  return Object.fromEntries(
    Object.entries(unitCoverage).map(([path, file]) => [
      path,
      mergeFile(file, e2eCoverage[path]),
    ]),
  );
}
