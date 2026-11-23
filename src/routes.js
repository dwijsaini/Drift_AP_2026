import { Router } from 'express';
import { prisma } from './db.js';
import { requireBuildingMember, requireUser } from './auth.js';
import { asyncRoute, dateSchema, electricityRateSchema, idSchema, readingPatchSchema, readingSchema, validate } from './http.js';
import { estimateGridCost, getBuildingComparison, getEnergySummary, SUMMARY_GRANULARITY } from './energyService.js';
import { parseReadingCsv, serializeReadingCsv } from './csvReadings.js';
import { z } from 'zod';

export const router = Router();
router.use(requireUser);
const buildingBody = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).default('UTC')
});
const listQuery = z.object({
  from: dateSchema.optional(), to: dateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).default(''),
  sortBy: z.enum(['periodStart','generatedKwh','consumedKwh']).default('periodStart'),
  sortOrder: z.enum(['asc','desc']).default('desc')
});
const summaryQuery = listQuery.extend({ electricityRateInrPerKwh: electricityRateSchema.optional() });
const comparisonQuery = z.object({ from: dateSchema, to: dateSchema, electricityRateInrPerKwh: electricityRateSchema.optional() });

function attachCostEstimate(row, rate) {
  return {
    ...row,
    electricityRateInrPerKwh: rate ?? null,
    estimatedGridCostInr: estimateGridCost(row.gridImportKwh, rate),
    estimatedGridCostLabel: rate === undefined ? null : 'Estimate from recorded grid import only; not a utility bill.'
  };
}

router.get('/buildings', asyncRoute(async (req, res) => {
  const buildings = await prisma.building.findMany({
    where: { memberships: { some: { userId: req.userId } } },
    include: { memberships: { where: { userId: req.userId }, select: { role: true } } },
    orderBy: { buildingId: 'asc' }
  });
  res.json({ data: buildings.map(({ memberships, ...b }) => ({ ...b, role: memberships[0]?.role })) });
}));

router.post('/buildings', asyncRoute(async (req, res) => {
  const body = validate(buildingBody, req.body);
  const building = await prisma.building.create({
    data: { ...body, memberships: { create: { userId: req.userId, role: 'OWNER' } } }
  });
  res.status(201).json({ data: building });
}));

router.get('/buildings/:buildingId/readings', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  await requireBuildingMember(req.userId, buildingId);
  const { from, to, page, pageSize, search, sortBy, sortOrder } = validate(listQuery, req.query);
  if (from && to && Date.parse(from) >= Date.parse(to)) return res.status(400).json({ error: { message: 'from must be before to' } });
  const where = { buildingId, AND: [
    ...(from || to ? [{ periodStart: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } }] : []),
    ...(search ? [{ OR: [
      ...(Number.isFinite(Date.parse(search)) && /^\d{4}-\d{2}-\d{2}$/.test(search)
        ? [{ periodStart: { gte: new Date(search + 'T00:00:00Z'), lt: new Date(Date.parse(search + 'T00:00:00Z') + 86400000) } }] : []),
      ...(Number.isFinite(Number(search)) ? [{ generatedKwh: Number(search) }, { consumedKwh: Number(search) }] : [])
    ] }] : [])
  ] };
  const rows = await prisma.energyPeriod.findMany({ where,
    orderBy: { [sortBy]: sortOrder }, skip: (page - 1) * pageSize, take: pageSize + 1 });
  res.json({ data: rows.slice(0, pageSize), meta: { page, pageSize, hasMore: rows.length > pageSize } });
}));

router.post('/buildings/:buildingId/readings', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  await requireBuildingMember(req.userId, buildingId, true);
  const body = validate(readingSchema, req.body);
  const created = await prisma.energyPeriod.create({ data: {
    buildingId, periodStart: new Date(body.periodStart), periodEnd: new Date(body.periodEnd),
    generatedKwh: body.generatedKwh, consumedKwh: body.consumedKwh,
    gridImportKwh: body.gridImportKwh ?? null, batteryChargeKwh: body.batteryChargeKwh ?? null,
    batteryDischargeKwh: body.batteryDischargeKwh ?? null, source: body.source, recordedByUserId: req.userId
  } });
  res.status(201).json({ data: created });
}));

router.patch('/buildings/:buildingId/readings/:readingId', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  const readingId = validate(idSchema, req.params.readingId);
  await requireBuildingMember(req.userId, buildingId, true);
  const body = validate(readingPatchSchema, req.body);
  const current = await prisma.energyPeriod.findFirst({ where: { readingId, buildingId }, select: { periodStart: true, periodEnd: true } });
  if (!current) return res.status(404).json({ error: { message: 'Reading not found' } });
  const start = body.periodStart ? new Date(body.periodStart) : current.periodStart;
  const end = body.periodEnd ? new Date(body.periodEnd) : current.periodEnd;
  if (end <= start) return res.status(400).json({ error: { message: 'periodEnd must be after periodStart' } });
  const updated = await prisma.energyPeriod.update({ where: { readingId }, data: {
    ...(body.periodStart ? { periodStart: start } : {}), ...(body.periodEnd ? { periodEnd: end } : {}),
    ...Object.fromEntries(['generatedKwh','consumedKwh','gridImportKwh','batteryChargeKwh','batteryDischargeKwh','source'].filter(k => k in body).map(k => [k, body[k]]))
  } });
  res.json({ data: updated });
}));

router.delete('/buildings/:buildingId/readings/:readingId', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  const readingId = validate(idSchema, req.params.readingId);
  await requireBuildingMember(req.userId, buildingId, true);
  const removed = await prisma.energyPeriod.deleteMany({ where: { readingId, buildingId } });
  if (!removed.count) return res.status(404).json({ error: { message: 'Reading not found' } });
  res.status(204).end();
}));

const summaryGranularity = SUMMARY_GRANULARITY;
router.get('/buildings/:buildingId/summaries/:granularity', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  const unit = summaryGranularity[req.params.granularity];
  if (!unit) return res.status(400).json({ error: { message: 'granularity must be daily, weekly, or monthly' } });
  await requireBuildingMember(req.userId, buildingId);
  const { from, to, electricityRateInrPerKwh } = validate(summaryQuery, req.query);
  if (!from || !to || Date.parse(from) >= Date.parse(to)) return res.status(400).json({ error: { message: 'Valid from and to timestamps are required' } });
  const rows = await getEnergySummary(buildingId, req.userId, unit, new Date(from), new Date(to));
  res.json({ data: rows.map(row => attachCostEstimate(row, electricityRateInrPerKwh)) });
}));

router.get('/buildings/comparison', asyncRoute(async (req, res) => {
  const { from, to, electricityRateInrPerKwh } = validate(comparisonQuery, req.query);
  if (Date.parse(from) >= Date.parse(to)) return res.status(400).json({ error: { message: 'from must be before to' } });
  const rows = await getBuildingComparison(req.userId, new Date(from), new Date(to));
  res.json({ data: rows.map(row => attachCostEstimate(row, electricityRateInrPerKwh)) });
}));

router.get('/buildings/:buildingId/readings.csv', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  await requireBuildingMember(req.userId, buildingId);
  const { from, to } = validate(listQuery, req.query);
  if (from && to && Date.parse(from) >= Date.parse(to)) return res.status(400).json({ error: { message: 'from must be before to' } });
  const rows = await prisma.energyPeriod.findMany({ where: { buildingId,
    ...(from || to ? { periodStart: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } } : {}) }, orderBy: { periodStart: 'asc' } });
  const csv = serializeReadingCsv(rows);
  res.type('text/csv').attachment(`building-${buildingId}-readings.csv`).send(csv);
}));

router.post('/buildings/:buildingId/readings.csv', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  await requireBuildingMember(req.userId, buildingId, true);
  const raw = typeof req.body === 'string' ? req.body : req.body?.csv;
  if (typeof raw !== 'string' || raw.length > 2_000_000) return res.status(400).json({ error: { message: 'Provide CSV text in the csv field (maximum 2 MB)' } });
  const parsed = parseReadingCsv(raw);
  const created = await prisma.$transaction(parsed.map(r => prisma.energyPeriod.create({ data: {
    buildingId, periodStart: new Date(r.periodStart), periodEnd: new Date(r.periodEnd), generatedKwh: r.generatedKwh,
    consumedKwh: r.consumedKwh, gridImportKwh: r.gridImportKwh ?? null,
    batteryChargeKwh: r.batteryChargeKwh ?? null, batteryDischargeKwh: r.batteryDischargeKwh ?? null,
    source: r.source, recordedByUserId: req.userId
  } })));
  res.status(201).json({ data: { imported: created.length } });
}));
