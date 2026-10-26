import { entryDate, monthEnd, shiftMonth } from './dates';

type DateRange = { from: string; to: string };
export type ComparisonBasis =
  | 'day'
  | 'week'
  | 'month'
  | 'complete_months'
  | 'range';

export function previousReportRange(
  range: DateRange,
  basis: ComparisonBasis
): DateRange | null {
  const shiftDay = (date: string, days: number) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.getUTCFullYear() < 1900
      ? null
      : value.toISOString().slice(0, 10);
  };
  const shiftDateMonth = (date: string) => {
    const month = shiftMonth(date.slice(0, 7), -1);
    return `${month}-${String(Math.min(Number(date.slice(8)), Number(monthEnd(month).slice(8)))).padStart(2, '0')}`;
  };
  let from: string | null;
  let to: string | null;
  if (basis === 'month') {
    from = shiftDateMonth(range.from);
    to =
      range.from.endsWith('-01') &&
      range.to === monthEnd(range.from.slice(0, 7))
        ? monthEnd(shiftMonth(range.from.slice(0, 7), -1))
        : shiftDateMonth(range.to);
  } else if (basis === 'complete_months') {
    const months =
      (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 +
      Number(range.to.slice(5, 7)) -
      Number(range.from.slice(5, 7)) +
      1;
    from = `${shiftMonth(range.from.slice(0, 7), -months)}-01`;
    to = shiftDay(range.from, -1);
  } else {
    const days =
      basis === 'week'
        ? 7
        : basis === 'day'
          ? 1
          : (Date.parse(`${range.to}T12:00:00Z`) -
              Date.parse(`${range.from}T12:00:00Z`)) /
              86400000 +
            1;
    from = shiftDay(range.from, -days);
    to = shiftDay(range.to, -days);
  }
  return entryDate.safeParse(from).success && entryDate.safeParse(to).success
    ? { from: from as string, to: to as string }
    : null;
}

export function averageMinor(total: number, count: number): number | null {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(count) ||
    count < 0
  )
    throw new RangeError('Unsafe average');
  if (!count) return null;
  return Number((2n * BigInt(total) + BigInt(count)) / (2n * BigInt(count)));
}
