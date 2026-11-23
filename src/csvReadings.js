import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { readingSchema } from './http.js';

export const CSV_READING_HEADERS = [
  'periodStart', 'periodEnd', 'generatedKwh', 'consumedKwh', 'gridImportKwh',
  'batteryChargeKwh', 'batteryDischargeKwh', 'source'
];

export function serializeReadingCsv(readings, columns = CSV_READING_HEADERS) {
  const selectedColumns = Array.isArray(columns) && columns.length > 0
    ? columns.filter(c => CSV_READING_HEADERS.includes(c))
    : CSV_READING_HEADERS;
  const activeCols = selectedColumns.length > 0 ? selectedColumns : CSV_READING_HEADERS;

  return stringify(readings.map(reading => {
    const row = {};
    if (activeCols.includes('periodStart')) row.periodStart = reading.periodStart instanceof Date ? reading.periodStart.toISOString() : new Date(reading.periodStart).toISOString();
    if (activeCols.includes('periodEnd')) row.periodEnd = reading.periodEnd instanceof Date ? reading.periodEnd.toISOString() : new Date(reading.periodEnd).toISOString();
    if (activeCols.includes('generatedKwh')) row.generatedKwh = reading.generatedKwh.toString();
    if (activeCols.includes('consumedKwh')) row.consumedKwh = reading.consumedKwh.toString();
    if (activeCols.includes('gridImportKwh')) row.gridImportKwh = reading.gridImportKwh?.toString() ?? '';
    if (activeCols.includes('batteryChargeKwh')) row.batteryChargeKwh = reading.batteryChargeKwh?.toString() ?? '';
    if (activeCols.includes('batteryDischargeKwh')) row.batteryDischargeKwh = reading.batteryDischargeKwh?.toString() ?? '';
    if (activeCols.includes('source')) row.source = reading.source;
    return row;
  }), { header: true, columns: activeCols });
}

export function parseReadingCsv(text) {
  let records;
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (cause) {
    const error = new Error('CSV could not be parsed');
    error.status = 400;
    error.details = [{ message: cause.message }];
    throw error;
  }
  if (!records.length || records.length > 10000) {
    const error = new Error('CSV must contain 1 to 10000 readings');
    error.status = 400;
    throw error;
  }
  const actualHeaders = Object.keys(records[0]);
  if (actualHeaders.length !== CSV_READING_HEADERS.length || CSV_READING_HEADERS.some((header, index) => actualHeaders[index] !== header)) {
    const error = new Error(`CSV headers must be exactly: ${CSV_READING_HEADERS.join(',')}`);
    error.status = 400;
    throw error;
  }
  return records.map((record, index) => {
    for (const field of ['gridImportKwh', 'batteryChargeKwh', 'batteryDischargeKwh']) {
      if (record[field] === '') record[field] = null;
    }
    if (record.source === '') record.source = 'IMPORT';
    const result = readingSchema.safeParse(record);
    if (!result.success) {
      const error = new Error(`Invalid CSV row ${index + 2}`);
      error.status = 400;
      error.details = result.error.issues;
      throw error;
    }
    return result.data;
  });
}
