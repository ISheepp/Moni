import { describe, expect, it } from 'vitest';
import {
  averageMinor,
  previousReportRange,
} from '../../src/ledger/report-comparison';

describe('report comparison periods', () => {
  it.each([
    [
      { from: '2026-10-26', to: '2026-10-26' },
      'day',
      { from: '2026-10-25', to: '2026-10-25' },
    ],
    [
      { from: '2026-10-26', to: '2026-10-28' },
      'week',
      { from: '2026-10-19', to: '2026-10-21' },
    ],
    [
      { from: '2026-10-01', to: '2026-10-04' },
      'week',
      { from: '2026-09-24', to: '2026-09-27' },
    ],
    [
      { from: '2026-10-01', to: '2026-10-26' },
      'month',
      { from: '2026-09-01', to: '2026-09-26' },
    ],
    [
      { from: '2024-02-01', to: '2024-02-29' },
      'month',
      { from: '2024-01-01', to: '2024-01-31' },
    ],
    [
      { from: '2024-03-01', to: '2024-03-30' },
      'month',
      { from: '2024-02-01', to: '2024-02-29' },
    ],
    [
      { from: '2024-03-31', to: '2024-03-31' },
      'month',
      { from: '2024-02-29', to: '2024-02-29' },
    ],
    [
      { from: '2026-01-01', to: '2026-01-31' },
      'month',
      { from: '2025-12-01', to: '2025-12-31' },
    ],
    [
      { from: '2024-03-09', to: '2024-03-11' },
      'range',
      { from: '2024-03-06', to: '2024-03-08' },
    ],
  ] as const)('resolves %s with %s without timezone or month-end drift', (range, basis, expected) => {
    expect(previousReportRange(range, basis)).toEqual(expected);
  });
  it('compares complete calendar month blocks and handles the supported lower bound', () => {
    expect(
      previousReportRange(
        { from: '2026-07-01', to: '2026-09-30' },
        'complete_months'
      )
    ).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    for (const basis of ['day', 'week', 'month', 'range'] as const)
      expect(
        previousReportRange({ from: '1900-01-01', to: '1900-01-01' }, basis)
      ).toBeNull();
  });
  it('rounds average minor units exactly, distinguishes no records and validates inputs', () => {
    expect(averageMinor(36000, 9)).toBe(4000);
    expect(averageMinor(1, 2)).toBe(1);
    expect(averageMinor(1, 3)).toBe(0);
    expect(averageMinor(0, 0)).toBeNull();
    expect(averageMinor(Number.MAX_SAFE_INTEGER, 2)).toBe(4503599627370496);
    expect(() => averageMinor(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow(
      RangeError
    );
    expect(() => averageMinor(1, -1)).toThrow(RangeError);
  });
});
