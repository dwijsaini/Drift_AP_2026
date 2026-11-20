import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { readingSchema } from './http.js';

export const CSV_READING_HEADERS = [
  'periodStart', 'periodEnd', 'generatedKwh', 'consumedKwh', 'gridImportKwh',
  'batteryChargeKwh', 'batteryDischargeKwh', 'source'
];

export function serializeReadingCsv(readings) {
  return stringify(readings.map(reading => ({
    periodStart: reading.periodStart.toISOString(),
    periodEnd: reading.periodEnd.toISOString(),
    generatedKwh: reading.generatedKwh.toString(),
    consumedKwh: reading.consumedKwh.toString(),
    gridImportKwh: reading.gridImportKwh?.toString() ?? '',
    batteryChargeKwh: reading.batteryChargeKwh?.toString() ?? '',
    batteryDischargeKwh: reading.batteryDischargeKwh?.toString() ?? '',
    source: reading.source
  })), { header: true, columns: CSV_READING_HEADERS });
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
