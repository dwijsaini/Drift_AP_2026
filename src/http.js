import { z } from 'zod';

export const idSchema = z.coerce.bigint().positive();
export const dateSchema = z.iso.datetime({ offset: true });
// Maximum kWh for a single reading period (999,999 kWh ≈ 1 GWh, well beyond any
// real building; guards against data-entry errors like entering MWh as kWh).
const MAX_KWH = 999_999;
// Maximum period duration: 365 days in milliseconds. A reading spanning more
// than one year almost certainly indicates a data entry error (e.g. wrong year
// in periodEnd). Annual totals should be submitted as 365 daily readings.
const MAX_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;

export const readingSchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
  generatedKwh: z.coerce.number().finite().nonnegative().max(MAX_KWH, {
    message: `generatedKwh must not exceed ${MAX_KWH} kWh per period`
  }),
  consumedKwh: z.coerce.number().finite().nonnegative().max(MAX_KWH, {
    message: `consumedKwh must not exceed ${MAX_KWH} kWh per period`
  }),
  gridImportKwh: z.coerce.number().finite().nonnegative().max(MAX_KWH).nullable().optional(),
  batteryChargeKwh: z.coerce.number().finite().nonnegative().max(MAX_KWH).nullable().optional(),
  batteryDischargeKwh: z.coerce.number().finite().nonnegative().max(MAX_KWH).nullable().optional(),
  source: z.enum(['MANUAL', 'IMPORT', 'API']).default('MANUAL')
}).refine(v => Date.parse(v.periodEnd) > Date.parse(v.periodStart), {
  message: 'periodEnd must be after periodStart', path: ['periodEnd']
}).refine(
  v => (Date.parse(v.periodEnd) - Date.parse(v.periodStart)) <= MAX_PERIOD_MS,
  { message: 'Reading period must not exceed 365 days', path: ['periodEnd'] }
);

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error('Request validation failed');
    error.status = 400;
    error.details = result.error.issues;
    throw error;
  }
  return result.data;
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function errorMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status ?? (error.code === 'P2002' ? 409 : error.code === 'P2025' ? 404 : 500);
  const message = status === 500 ? 'Internal server error' : error.message;
  res.status(status).json({ error: { message, ...(error.details ? { details: error.details } : {}) } });
}
