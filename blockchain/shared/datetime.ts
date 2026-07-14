/**
 * shared/datetime.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single shared date/time util (D10). All calendar-date input/display uses
 * Vietnam local time (UTC+7); on-chain and in-circuit values always stay
 * plain Unix epoch seconds — never convert timezone on that side.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Current time as Unix epoch seconds. */
export function nowUnixTimestamp(): bigint {
  return BigInt(dayjs().unix());
}

/** Parse a calendar date (interpreted in Vietnam local time) to Unix epoch seconds. */
export function toUnixTimestamp(date: string | Date): bigint {
  return BigInt(dayjs.tz(date, VN_TIMEZONE).unix());
}

/** Format a Unix epoch seconds value as a Vietnam local calendar date/time string. */
export function fromUnixTimestamp(timestamp: bigint, format = 'DD/MM/YYYY'): string {
  return dayjs.unix(Number(timestamp)).tz(VN_TIMEZONE).format(format);
}
