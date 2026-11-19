import { z } from 'zod';

export const idSchema = z.coerce.bigint().positive();
export const dateSchema = z.iso.datetime({ offset: true });
export const readingSchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
  generatedKwh: z.coerce.number().finite().nonnegative(),
  consumedKwh: z.coerce.number().finite().nonnegative(),
  gridImportKwh: z.coerce.number().finite().nonnegative().nullable().optional(),
  batteryChargeKwh: z.coerce.number().finite().nonnegative().nullable().optional(),
  batteryDischargeKwh: z.coerce.number().finite().nonnegative().nullable().optional(),
  source: z.enum(['MANUAL', 'IMPORT', 'API']).default('MANUAL')
}).refine(v => Date.parse(v.periodEnd) > Date.parse(v.periodStart), {
  message: 'periodEnd must be after periodStart', path: ['periodEnd']
});

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
