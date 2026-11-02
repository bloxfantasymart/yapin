import { z } from 'zod';
import { ValidationError } from '../../utils/errors.js';

export const dateField = (defaultNow = false) =>
  z.preprocess((val) => {
    if (val === undefined) return defaultNow ? new Date() : undefined;
    if (val instanceof Date) return val;
    if (typeof val === 'string' || typeof val === 'number') {
      const parsed = new Date(val);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return val;
  }, z.date());

export const nullableDateField = () =>
  z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return null;
      if (val instanceof Date) return val;
      if (typeof val === 'string' || typeof val === 'number') {
        const parsed = new Date(val);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
      return val;
    }, z.date().nullable())
    .default(null);

export const defaultedObject = (shape) =>
  z.preprocess((val) => (val === undefined || val === null ? {} : val), z.object(shape));

export function deepCloneRecord(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(deepCloneRecord);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = deepCloneRecord(v);
  }
  return out;
}

export function deepFreezeRecord(value) {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  for (const v of Object.values(value)) {
    deepFreezeRecord(v);
  }
  return Object.freeze(value);
}

/**
 * Validates and normalizes a domain record against its Zod schema.
 */
export function validateWithSchema(schema, modelName, rawData) {
  const parsed = schema.safeParse(rawData);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || modelName}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`${modelName} validation failed: ${details}`);
  }
  return deepCloneRecord(parsed.data);
}
