import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInsights } from '../frontend/insights.js';

test('computeInsights calculates CO2 avoided and identifies peak/deficit windows', () => {
  const readings = [
    { periodStart: '2026-10-01T11:00:00Z', generatedKwh: 4.5, consumedKwh: 1.0 },
    { periodStart: '2026-10-01T12:00:00Z', generatedKwh: 5.0, consumedKwh: 1.2 },
    { periodStart: '2026-10-01T13:00:00Z', generatedKwh: 4.8, consumedKwh: 1.1 },
    { periodStart: '2026-10-01T20:00:00Z', generatedKwh: 0.0, consumedKwh: 3.5, missingPeriodCount: 1 }
  ];

  const factor = 0.716;
  const insights = computeInsights(readings, factor);

  // Total Gen: 14.3 kWh * 0.716 = 10.2388 -> 10.2 kg
  assert.equal(insights.co2AvoidedKg, 10.2);
  assert.ok(insights.worstDeficitText.includes('3.5 kWh'));
  assert.ok(insights.missedGenText.includes('missing'));
});
