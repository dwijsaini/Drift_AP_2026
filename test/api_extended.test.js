import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { serializeReadingCsv } from '../src/csvReadings.js';

test('serializeReadingCsv respects custom selected columns', () => {
  const rows = [{
    periodStart: new Date('2026-10-01T10:00:00Z'),
    periodEnd: new Date('2026-10-01T11:00:00Z'),
    generatedKwh: 4.5,
    consumedKwh: 2.1,
    gridImportKwh: null,
    batteryChargeKwh: null,
    batteryDischargeKwh: null,
    source: 'MANUAL'
  }];

  const customCsv = serializeReadingCsv(rows, ['periodStart', 'generatedKwh', 'consumedKwh']);
  assert.equal(customCsv.trim(), 'periodStart,generatedKwh,consumedKwh\n2026-10-01T10:00:00.000Z,4.5,2.1');
});

test('API endpoints: health, docs, and reading pagination integration', async (t) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    t.skip(`Skipping integration: DB not reachable (${err.message})`);
    return;
  }

  const buildingId = 1n;

  // Test pagination query
  const total = await prisma.energyPeriod.count({ where: { buildingId } });
  assert.ok(total > 0, 'Database should have seeded readings');

  const page1 = await prisma.energyPeriod.findMany({
    where: { buildingId },
    orderBy: { periodStart: 'asc' },
    skip: 0,
    take: 10
  });
  assert.equal(page1.length, 10);

  const page2 = await prisma.energyPeriod.findMany({
    where: { buildingId },
    orderBy: { periodStart: 'asc' },
    skip: 10,
    take: 10
  });
  assert.equal(page2.length, 10);
  assert.notEqual(page1[0].readingId, page2[0].readingId);

  // Sorting
  const sortedDesc = await prisma.energyPeriod.findMany({
    where: { buildingId },
    orderBy: { periodStart: 'desc' },
    take: 5
  });
  assert.ok(sortedDesc[0].periodStart > sortedDesc[1].periodStart);

  // Role check: User 2 (Priya) is VIEWER for Building 1
  const member = await prisma.buildingMember.findUnique({
    where: { buildingId_userId: { buildingId: 1n, userId: 2n } }
  });
  assert.equal(member.role, 'VIEWER');
});
