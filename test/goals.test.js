import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoals } from '../frontend/goals.js';

test('evaluateGoals computes coverage % and surplus projections accurately', () => {
  // Case 1: Empty readings
  const empty = evaluateGoals([]);
  assert.equal(empty.coveragePct, 0);
  assert.equal(empty.coverageOnTrack, false);

  // Case 2: Surplus day meeting coverage goal
  const readings = [
    { generatedKwh: 30, consumedKwh: 20 },
    { generatedKwh: 25, consumedKwh: 20 }
  ];
  const eval1 = evaluateGoals(readings, { targetCoveragePct: 80, targetSurplusKwh: 100 });
  // Total gen: 55, total con: 40 -> coverage = 100%
  assert.equal(eval1.coveragePct, 100);
  assert.equal(eval1.coverageOnTrack, true);
  assert.equal(eval1.surplusKwh, 15);
  assert.equal(eval1.surplusOnTrack, true);

  // Case 3: Deficit readings failing coverage
  const deficitReadings = [
    { generatedKwh: 5, consumedKwh: 20 },
    { generatedKwh: 5, consumedKwh: 20 }
  ];
  const eval2 = evaluateGoals(deficitReadings, { targetCoveragePct: 75, targetSurplusKwh: 50 });
  // Total gen: 10, total con: 40 -> coverage = 25%
  assert.equal(eval2.coveragePct, 25);
  assert.equal(eval2.coverageOnTrack, false);
  assert.equal(eval2.surplusKwh, 0);
  assert.equal(eval2.surplusOnTrack, false);
});
