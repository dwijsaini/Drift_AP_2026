import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSlabCost } from '../frontend/tariff.js';

test('calculateSlabCost correctly applies tiered rate slabs', () => {
  const slabs = [
    { from: 0, to: 50, rate: 4.15 },
    { from: 51, to: 100, rate: 5.60 },
    { from: 101, to: 200, rate: 7.15 },
    { from: 201, to: null, rate: 8.50 }
  ];

  // Case 1: Zero consumption
  assert.equal(calculateSlabCost(0, slabs), 0);
  assert.equal(calculateSlabCost(-10, slabs), 0);

  // Case 2: Within first slab (30 units @ 4.15)
  assert.equal(calculateSlabCost(30, slabs), 30 * 4.15);

  // Case 3: Exactly spans first slab (51 units: 51 @ 4.15)
  // Slab 0: 0 to 50 = 51 units
  const cost51 = 51 * 4.15;
  assert.equal(calculateSlabCost(51, slabs), cost51);

  // Case 4: Spans into second slab (75 units: 51 @ 4.15 + 24 @ 5.60)
  const cost75 = 51 * 4.15 + 24 * 5.60;
  assert.equal(calculateSlabCost(75, slabs), cost75);

  // Case 5: Spans into final unbounded slab (250 units: 51@4.15 + 50@5.60 + 100@7.15 + 49@8.50)
  const cost250 = (51 * 4.15) + (50 * 5.60) + (100 * 7.15) + (49 * 8.50);
  assert.equal(calculateSlabCost(250, slabs), cost250);
});
