import type { ModelMessage } from '@tanstack/ai';
import { z } from 'zod';
import { parseQueryResult, parseQueryUpdates } from './chat-query-contract';
import { type Currency, currencies } from './currencies';
import type { EntryTotals } from './entry-query';
import { decimalAmount } from './money';
import { averageMinor } from './report-comparison';
import type { ReportAggregate } from './reports';

const amount = (minor: number, currency: Currency) =>
  `${currency} ${decimalAmount(minor, currency)}`;

function queryMoney(value: unknown): unknown {
  const result = parseQueryResult(value);
  if (!result) return value;
  const { report } = result;
  const rankedKind = result.query.scope === 'income' ? 'income' : 'expense';
  const totals = (values: EntryTotals, currency: Currency) =>
    Object.fromEntries(
      Object.entries(values).map(([key, minor]) => [
        key,
        amount(minor, currency),
      ])
    );
  const aggregate = (row: {
    totals: EntryTotals;
    originalTotals: EntryTotals | null;
    counts: { income: number; expense: number; refund: number };
  }) => ({
    ...row,
    totals: totals(row.totals, report.primaryCurrency),
    originalTotals:
      row.originalTotals && report.filters.currency
        ? totals(row.originalTotals, report.filters.currency)
        : null,
    averages: Object.fromEntries(
      (['income', 'expense', 'refund'] as const).map((kind) => {
        const average = averageMinor(row.totals[kind], row.counts[kind]);
        return [
          kind,
          average === null ? null : amount(average, report.primaryCurrency),
        ];
      })
    ),
  });
  const change = (current: number, previous: number, monetary: boolean) => ({
    difference: monetary
      ? amount(current - previous, report.primaryCurrency)
      : current - previous,
    percentage:
      previous > 0
        ? new Intl.NumberFormat('en', {
            style: 'percent',
            signDisplay: 'exceptZero',
            maximumFractionDigits: 1,
          }).format((current - previous) / previous)
        : null,
    isNew: previous === 0 && current > 0,
  });
  const differences = (current: ReportAggregate, previous: ReportAggregate) => {
    const kind = result.query.scope === 'income' ? 'income' : 'expense';
    const average = averageMinor(current.totals[kind], current.counts[kind]);
    const priorAverage = averageMinor(
      previous.totals[kind],
      previous.counts[kind]
    );
    return {
      amounts: Object.fromEntries(
        Object.keys(current.totals).map((key) => [
          key,
          change(
            current.totals[key as keyof EntryTotals],
            previous.totals[key as keyof EntryTotals],
            true
          ),
        ])
      ),
      count: change(current.counts[kind], previous.counts[kind], false),
      average:
        average === null || priorAverage === null
          ? null
          : change(average, priorAverage, true),
    };
  };
  return {
    ...result,
    ...(result.entries
      ? {
          entries: {
            ...result.entries,
            items: result.entries.items.map(
              ({ originalMinor, baseMinor, ...entry }) => ({
                ...entry,
                originalAmount: amount(originalMinor, entry.currency),
                baseAmount: amount(baseMinor, report.primaryCurrency),
              })
            ),
          },
        }
      : {}),
    report: {
      ...aggregate(report),
      groups: report.groups.map(({ filters: _filters, ...row }) =>
        aggregate(row)
      ),
      trend: report.trend.map(({ filters: _filters, ...row }) =>
        aggregate(row)
      ),
      ...(report.comparison
        ? {
            comparison: {
              basis: report.comparison.basis,
              filters: report.comparison.filters,
              previous: aggregate(report.comparison.previous),
              changes: differences(report, report.comparison.previous),
              groups: [...report.comparison.groups]
                .sort(
                  (a, b) =>
                    Math.abs(
                      b.totals[rankedKind] - b.previous.totals[rankedKind]
                    ) -
                      Math.abs(
                        a.totals[rankedKind] - a.previous.totals[rankedKind]
                      ) || (a.id ?? '').localeCompare(b.id ?? '', 'en')
                )
                .map(({ filters: _filters, previous, ...row }) => ({
                  ...aggregate(row),
                  previous: aggregate(previous),
                  changes: differences(row, previous),
                })),
            },
          }
        : {}),
    },
  };
}

// Only provider input changes; persisted tool results keep exact integer minor units.
export function modelMoney(message: ModelMessage): ModelMessage {
  if (message.role !== 'tool' || typeof message.content !== 'string')
    return message;
  try {
    const value = JSON.parse(message.content);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return message;
    let presented = queryMoney(value) as Record<string, unknown>;
    if (Array.isArray(value.queryUpdates))
      presented = {
        ...presented,
        queryUpdates: parseQueryUpdates(value).map((update) => ({
          id: update.id,
          result: update.result ? queryMoney(update.result) : null,
        })),
      };
    else if (value.queryResult)
      presented = { ...presented, queryResult: queryMoney(value.queryResult) };
    const currency = z.enum(currencies).safeParse(value.baseCurrency);
    if (currency.success && Number.isSafeInteger(value.totalBaseMinor)) {
      const { totalBaseMinor: _minor, ...rest } = presented;
      presented = {
        ...rest,
        totalBaseAmount: amount(value.totalBaseMinor, currency.data),
      };
    }
    return presented === value
      ? message
      : { ...message, content: JSON.stringify(presented) };
  } catch {
    return message;
  }
}
