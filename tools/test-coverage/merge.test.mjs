import { describe, expect, it } from 'vitest';

import { mergeOntoUnit } from './merge.mjs';

const at = (line, column) => ({ line, column });
const range = (startLine, startColumn, endLine, endColumn) => ({
  start: at(startLine, startColumn),
  end: at(endLine, endColumn),
});

/** Unit structure: a function (lines 1-5) with two statements and an if. */
function unitFile() {
  return {
    path: 'a.ts',
    statementMap: { 0: range(2, 2, 2, 20), 1: range(4, 4, 4, 20) },
    fnMap: {
      0: { name: 'f', decl: range(1, 9, 1, 10), loc: range(1, 0, 5, 1) },
    },
    branchMap: {
      0: {
        type: 'if',
        loc: range(3, 2, 5, 3),
        locations: [range(3, 2, 5, 3), range(3, 2, 5, 3)],
      },
    },
    s: { 0: 0, 1: 0 },
    f: { 0: 0 },
    b: { 0: [0, 0] },
  };
}

/** E2E split the same code differently: one wide statement, function ran. */
function e2eFile({ fnCount, outerCount, innerCount }) {
  return {
    path: 'a.ts',
    statementMap: { 0: range(2, 0, 5, 0), 1: range(4, 4, 4, 20) },
    fnMap: {
      0: { name: 'f', decl: range(1, 9, 1, 10), loc: range(1, 0, 5, 1) },
    },
    branchMap: {},
    s: { 0: outerCount, 1: innerCount },
    f: { 0: fnCount },
    b: {},
  };
}

describe('mergeOntoUnit', () => {
  it('keeps the unit structure, so totals never grow', () => {
    const merged = mergeOntoUnit(
      { 'a.ts': unitFile() },
      { 'a.ts': e2eFile({ fnCount: 1, outerCount: 1, innerCount: 1 }) },
    );
    expect(Object.keys(merged['a.ts'].s)).toHaveLength(2);
    expect(merged['a.ts'].statementMap).toEqual(unitFile().statementMap);
  });

  it('credits statements and functions the E2E run executed', () => {
    const merged = mergeOntoUnit(
      { 'a.ts': unitFile() },
      { 'a.ts': e2eFile({ fnCount: 1, outerCount: 1, innerCount: 1 }) },
    );
    expect(merged['a.ts'].s).toEqual({ 0: 1, 1: 1 });
    expect(merged['a.ts'].f).toEqual({ 0: 1 });
  });

  it('uses the innermost E2E statement: a run outer block does not credit an unrun inner one', () => {
    const merged = mergeOntoUnit(
      { 'a.ts': unitFile() },
      { 'a.ts': e2eFile({ fnCount: 1, outerCount: 1, innerCount: 0 }) },
    );
    expect(merged['a.ts'].s).toEqual({ 0: 1, 1: 0 });
  });

  it('gives no credit inside a function that never ran', () => {
    const merged = mergeOntoUnit(
      { 'a.ts': unitFile() },
      { 'a.ts': e2eFile({ fnCount: 0, outerCount: 1, innerCount: 1 }) },
    );
    expect(merged['a.ts'].s).toEqual({ 0: 0, 1: 0 });
    expect(merged['a.ts'].f).toEqual({ 0: 0 });
  });

  it('gives branch arms no credit without a matching E2E arm', () => {
    const merged = mergeOntoUnit(
      { 'a.ts': unitFile() },
      { 'a.ts': e2eFile({ fnCount: 1, outerCount: 1, innerCount: 1 }) },
    );
    expect(merged['a.ts'].b).toEqual({ 0: [0, 0] });
  });

  it('keeps unit hits and ignores files only the E2E run saw', () => {
    const unit = { ...unitFile(), s: { 0: 3, 1: 0 } };
    const merged = mergeOntoUnit(
      { 'a.ts': unit },
      { 'b.ts': e2eFile({ fnCount: 1, outerCount: 1, innerCount: 1 }) },
    );
    expect(merged).toEqual({ 'a.ts': unit });
  });

  it('does not mutate its inputs', () => {
    const unit = unitFile();
    const e2e = e2eFile({ fnCount: 1, outerCount: 1, innerCount: 1 });
    mergeOntoUnit({ 'a.ts': unit }, { 'a.ts': e2e });
    expect(unit).toEqual(unitFile());
  });
});
