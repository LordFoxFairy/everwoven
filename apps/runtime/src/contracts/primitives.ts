/** Transport-neutral scalar checks; no database, crypto or application dependencies. */
export function isBusinessId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
