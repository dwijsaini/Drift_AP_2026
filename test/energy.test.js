import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEnergyMetrics, getEnergySummary, SUMMARY_GRANULARITY } from '../src/energyService.js';
import { readingSchema, validate } from '../src/http.js';
import { prisma } from '../src/db.js';

test('computeEnergyMetrics calculates correct balance, gap, and solar coverage', () => {
  // Case 1: Partial solar coverage (deficit)
  const case1 = computeEnergyMetrics(10, 20);
  assert.equal(case1.balanceKwh, -10);
  assert.equal(case1.gapKwh, 10);
  assert.equal(case1.solarCoveragePct, 50);

  // Case 2: Surplus solar generation (coverage capped at 100%)
  const case2 = computeEnergyMetrics(30, 20);
  assert.equal(case2.balanceKwh, 10);
  assert.equal(case2.gapKwh, -10);
  assert.equal(case2.solarCoveragePct, 100);

  // Case 3: Exact match
  const case3 = computeEnergyMetrics(25, 25);
  assert.equal(case3.balanceKwh, 0);
  assert.equal(case3.gapKwh, 0);
  assert.equal(case3.solarCoveragePct, 100);

  // Case 4: Zero generation
  const case4 = computeEnergyMetrics(0, 15);
  assert.equal(case4.balanceKwh, -15);
  assert.equal(case4.gapKwh, 15);
  assert.equal(case4.solarCoveragePct, 0);

  // Case 5: Zero consumption (coverage must be null to avoid division by zero)
  const case5 = computeEnergyMetrics(15, 0);
  assert.equal(case5.balanceKwh, 15);
  assert.equal(case5.gapKwh, -15);
  assert.equal(case5.solarCoveragePct, null);

  // Case 6: Both zero
  const case6 = computeEnergyMetrics(0, 0);
  assert.equal(case6.balanceKwh, 0);
  assert.equal(case6.gapKwh, 0);
  assert.equal(case6.solarCoveragePct, null);
});

test('readingSchema validates interval and kWh constraints', () => {
  const baseValid = {
    periodStart: '2026-10-01T10:00:00+05:30',
    periodEnd: '2026-10-01T11:00:00+05:30',
    generatedKwh: 3.5,
    consumedKwh: 2.1,
    source: 'MANUAL',
  };

  // Valid reading passes
  assert.doesNotThrow(() => validate(readingSchema, baseValid));

  // periodEnd before periodStart fails
  const resBefore = readingSchema.safeParse({ ...baseValid, periodEnd: '2026-10-01T09:00:00+05:30' });
  assert.equal(resBefore.success, false);
  assert.ok(resBefore.error.issues.some(i => i.message.includes('periodEnd must be after periodStart')));

  // periodEnd equal to periodStart fails
  const resEqual = readingSchema.safeParse({ ...baseValid, periodEnd: baseValid.periodStart });
  assert.equal(resEqual.success, false);
  assert.ok(resEqual.error.issues.some(i => i.message.includes('periodEnd must be after periodStart')));

  // Period exceeding 365 days fails
  const resExceed = readingSchema.safeParse({
    ...baseValid,
    periodEnd: '2027-10-05T10:00:00+05:30',
  });
  assert.equal(resExceed.success, false);
  assert.ok(resExceed.error.issues.some(i => i.message.includes('Reading period must not exceed 365 days')));

  // Negative generation fails
  const resNegative = readingSchema.safeParse({ ...baseValid, generatedKwh: -1 });
  assert.equal(resNegative.success, false);

  // Exceeding maximum kWh (999,999) fails
  const resMaxKwh = readingSchema.safeParse({ ...baseValid, generatedKwh: 1_000_000 });
  assert.equal(resMaxKwh.success, false);
  assert.ok(resMaxKwh.error.issues.some(i => i.message.includes('generatedKwh must not exceed 999999 kWh')));

  // Invalid source fails
  const resSource = readingSchema.safeParse({ ...baseValid, source: 'INVALID_SOURCE' });
  assert.equal(resSource.success, false);
});

test('getEnergySummary aggregates daily, weekly, and monthly summaries with gap detection', async (t) => {
  try {
    // Check if database is accessible
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    t.skip(`Skipping integration test: database not reachable (${err.message})`);
    return;
  }

  const buildingId = 1n;
  const userId = 1n; // demo user (OWNER of building 1)
  const from = new Date('2026-10-01T00:00:00Z');
  const to = new Date('2026-11-01T00:00:00Z');

  // Daily
  const daily = await getEnergySummary(buildingId, userId, SUMMARY_GRANULARITY.daily, from, to);
  assert.ok(Array.isArray(daily), 'Daily summary should be an array');
  if (daily.length > 0) {
    const row = daily[0];
    assert.ok(row.periodStart, 'Should have periodStart');
    assert.ok(row.periodEnd, 'Should have periodEnd');
    assert.ok(row.timezone, 'Should have timezone');
    assert.ok('generatedKwh' in row, 'Should have generatedKwh');
    assert.ok('consumedKwh' in row, 'Should have consumedKwh');
    assert.ok('energyBalanceKwh' in row, 'Should have energyBalanceKwh');
    assert.ok('energyGapKwh' in row, 'Should have energyGapKwh');
    assert.ok('solarCoveragePct' in row, 'Should have solarCoveragePct');
    assert.ok(typeof row.readingCount === 'number', 'readingCount should be a number');
    assert.ok(typeof row.hasGap === 'boolean', 'hasGap should be a boolean');
  }

  // Weekly
  const weekly = await getEnergySummary(buildingId, userId, SUMMARY_GRANULARITY.weekly, from, to);
  assert.ok(Array.isArray(weekly), 'Weekly summary should be an array');

  // Monthly
  const monthly = await getEnergySummary(buildingId, userId, SUMMARY_GRANULARITY.monthly, from, to);
  assert.ok(Array.isArray(monthly), 'Monthly summary should be an array');

  // Unauthorized user (non-member) returns empty results
  const nonMemberUser = 999999n;
  const unauthorized = await getEnergySummary(buildingId, nonMemberUser, SUMMARY_GRANULARITY.daily, from, to);
  assert.equal(unauthorized.length, 0, 'Unauthorized user should see 0 rows');
});
