import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEnergyMetrics, estimateGridCost, getBuildingComparison, getEnergySummary, SUMMARY_GRANULARITY, withCompleteness } from '../src/energyService.js';
import { electricityRateSchema, readingSchema, validate } from '../src/http.js';
import { CSV_READING_HEADERS, parseReadingCsv, serializeReadingCsv } from '../src/csvReadings.js';
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

test('completeness preserves hasGap and reports the missing hourly period count', () => {
  assert.deepEqual(withCompleteness({ readingCount: 21n, expectedReadingCount: 24n }), {
    readingCount: 21, expectedReadingCount: 24, missingPeriodCount: 3, hasGap: true
  });
  assert.deepEqual(withCompleteness({ readingCount: 24n, expectedReadingCount: 24n }), {
    readingCount: 24, expectedReadingCount: 24, missingPeriodCount: 0, hasGap: false
  });
  assert.deepEqual(withCompleteness({ readingCount: 0n, expectedReadingCount: 0n }), {
    readingCount: 0, expectedReadingCount: 0, missingPeriodCount: 0, hasGap: false
  });
});

test('summary service returns empty buckets and explicit completeness fields', async () => {
  const originalQueryRaw = prisma.$queryRaw;
  prisma.$queryRaw = async () => [{
    periodStart: new Date('2026-10-01T00:00:00Z'), periodEnd: new Date('2026-10-02T00:00:00Z'),
    timezone: 'Asia/Kolkata', generatedKwh: 0, consumedKwh: 0, energyBalanceKwh: 0,
    energyGapKwh: 0, solarCoveragePct: null, gridImportKwh: null, readingCount: 0n,
    gridImportReadingCount: 0n, expectedReadingCount: 24n
  }];
  try {
    const [row] = await getEnergySummary(1n, 1n, SUMMARY_GRANULARITY.daily,
      new Date('2026-10-01T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));
    assert.equal(row.readingCount, 0);
    assert.equal(row.expectedReadingCount, 24);
    assert.equal(row.missingPeriodCount, 24);
    assert.equal(row.hasGap, true);
  } finally {
    prisma.$queryRaw = originalQueryRaw;
  }
});

test('electricity rate validation and recorded-grid cost estimate are explicit and precise', () => {
  assert.equal(validate(electricityRateSchema, '8.2500'), 8.25);
  assert.equal(electricityRateSchema.safeParse('-1').success, false);
  assert.equal(electricityRateSchema.safeParse('1000.01').success, false);
  assert.equal(electricityRateSchema.safeParse('1.12345').success, false);
  assert.equal(estimateGridCost('12.345', 8.25), '101.85');
  assert.equal(estimateGridCost(null, 8.25), null);
  assert.equal(estimateGridCost('12.345', undefined), null);
});

test('CSV import shares reading validation and treats blank optional meter values as null', () => {
  const csv = [
    'periodStart,periodEnd,generatedKwh,consumedKwh,gridImportKwh,batteryChargeKwh,batteryDischargeKwh,source',
    '2026-10-01T10:00:00+05:30,2026-10-01T11:00:00+05:30,3.5,2.1,,,,IMPORT'
  ].join('\n');
  const [reading] = parseReadingCsv(csv);
  assert.equal(reading.gridImportKwh, null);
  assert.equal(reading.source, 'IMPORT');
  assert.throws(() => parseReadingCsv('periodStart,generatedKwh\ninvalid,1'), { status: 400 });
  assert.throws(() => parseReadingCsv(csv.replace('3.5,2.1', '-3.5,2.1')), { status: 400 });
  const emptyExport = `${CSV_READING_HEADERS.join(',')}\n`;
  assert.equal(serializeReadingCsv([]), emptyExport, 'empty export still provides import-compatible headers');
  assert.throws(() => parseReadingCsv(emptyExport), { status: 400 });
  const roundTrip = parseReadingCsv(serializeReadingCsv([{
    periodStart: new Date('2026-10-01T04:30:00Z'), periodEnd: new Date('2026-10-01T05:30:00Z'),
    generatedKwh: '3.500', consumedKwh: '2.100', gridImportKwh: null,
    batteryChargeKwh: null, batteryDischargeKwh: null, source: 'IMPORT'
  }]));
  assert.equal(roundTrip[0].gridImportKwh, null);
  assert.equal(roundTrip[0].generatedKwh, 3.5);
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
    assert.ok(typeof row.expectedReadingCount === 'number', 'expectedReadingCount should be a number');
    assert.ok(typeof row.missingPeriodCount === 'number', 'missingPeriodCount should be a number');
    assert.equal(row.hasGap, row.missingPeriodCount > 0, 'hasGap remains consistent with missing count');
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

  const comparison = await getBuildingComparison(userId, from, to);
  assert.ok(comparison.length >= 1, 'Comparison includes accessible buildings');
  assert.ok(comparison.every(row => typeof row.missingPeriodCount === 'number' && typeof row.hasGap === 'boolean'));
  const hiddenComparison = await getBuildingComparison(nonMemberUser, from, to);
  assert.deepEqual(hiddenComparison, [], 'Comparison excludes buildings with no membership');
});
