import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { prisma } from './db.js';
import { requireBuildingMember, requireUser } from './auth.js';
import { asyncRoute, idSchema, readingSchema, validate } from './http.js';
import { getEnergySummary, SUMMARY_GRANULARITY } from './energyService.js';
import { z } from 'zod';

export const router = Router();
router.use(requireUser);
const buildingBody = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).default('UTC')
});
const listQuery = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() });
const metricRow = z.object({
  periodStart: z.iso.datetime({ offset: true }), periodEnd: z.iso.datetime({ offset: true }),
  generatedKwh: z.coerce.number().nonnegative(), consumedKwh: z.coerce.number().nonnegative(),
  gridImportKwh: z.preprocess(v => v === '' ? null : v, z.coerce.number().nonnegative().nullable().optional()),
  batteryChargeKwh: z.preprocess(v => v === '' ? null : v, z.coerce.number().nonnegative().nullable().optional()),
  batteryDischargeKwh: z.preprocess(v => v === '' ? null : v, z.coerce.number().nonnegative().nullable().optional()),
  source: z.enum(['MANUAL', 'IMPORT', 'API']).default('IMPORT')
}).refine(x => Date.parse(x.periodEnd) > Date.parse(x.periodStart), { message: 'periodEnd must be after periodStart' });

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
  const { from, to } = validate(listQuery, req.query);
  if (from && to && Date.parse(from) >= Date.parse(to)) return res.status(400).json({ error: { message: 'from must be before to' } });
  const rows = await prisma.energyPeriod.findMany({
    where: { buildingId, ...(from || to ? { periodStart: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } } : {}) },
    orderBy: { periodStart: 'asc' }
  });
  res.json({ data: rows });
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
  const body = validate(readingSchema.partial().refine(x => Object.keys(x).length > 0, 'At least one field is required'), req.body);
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
  const { from, to } = validate(listQuery, req.query);
  if (!from || !to || Date.parse(from) >= Date.parse(to)) return res.status(400).json({ error: { message: 'Valid from and to timestamps are required' } });
  const rows = await getEnergySummary(buildingId, req.userId, unit, new Date(from), new Date(to));
  res.json({ data: rows });
}));

router.get('/buildings/:buildingId/readings.csv', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  await requireBuildingMember(req.userId, buildingId);
  const rows = await prisma.energyPeriod.findMany({ where: { buildingId }, orderBy: { periodStart: 'asc' } });
  const csv = stringify(rows.map(r => ({
    periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString(),
    generatedKwh: r.generatedKwh.toString(), consumedKwh: r.consumedKwh.toString(),
    gridImportKwh: r.gridImportKwh?.toString() ?? '', batteryChargeKwh: r.batteryChargeKwh?.toString() ?? '',
    batteryDischargeKwh: r.batteryDischargeKwh?.toString() ?? '', source: r.source
  })), { header: true });
  res.type('text/csv').attachment(`building-${buildingId}-readings.csv`).send(csv);
}));

router.post('/buildings/:buildingId/readings.csv', asyncRoute(async (req, res) => {
  const buildingId = validate(idSchema, req.params.buildingId);
  await requireBuildingMember(req.userId, buildingId, true);
  const raw = typeof req.body === 'string' ? req.body : req.body?.csv;
  if (typeof raw !== 'string' || raw.length > 2_000_000) return res.status(400).json({ error: { message: 'Provide CSV text in the csv field (maximum 2 MB)' } });
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  if (rows.length < 1 || rows.length > 10000) return res.status(400).json({ error: { message: 'CSV must contain 1 to 10000 readings' } });
  const parsed = rows.map((row, i) => {
    const result = metricRow.safeParse(row);
    if (!result.success) {
      const error = new Error(`Invalid CSV row ${i + 2}`); error.status = 400; error.details = result.error.issues; throw error;
    }
    return result.data;
  });
  const created = await prisma.$transaction(parsed.map(r => prisma.energyPeriod.create({ data: {
    buildingId, periodStart: new Date(r.periodStart), periodEnd: new Date(r.periodEnd), generatedKwh: r.generatedKwh,
    consumedKwh: r.consumedKwh, gridImportKwh: r.gridImportKwh ?? null,
    batteryChargeKwh: r.batteryChargeKwh ?? null, batteryDischargeKwh: r.batteryDischargeKwh ?? null,
    source: r.source, recordedByUserId: req.userId
  } })));
  res.status(201).json({ data: { imported: created.length } });
}));
