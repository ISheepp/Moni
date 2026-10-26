import { z } from 'zod';
import { HttpError } from '../lib/http';
import type { Currency } from './currencies';
import {
  datePeriod,
  entryDate,
  resolveDatePeriod,
  todayInZone,
  trendEnd,
} from './dates';
import {
  type EntryFilters,
  type EntryTotals,
  entryFilters,
  entryQuery,
  readTotals,
  sumColumns,
} from './entry-query';
import { type ComparisonBasis, previousReportRange } from './report-comparison';
import { readSettings } from './settings';

export const reportSelection = z
  .object({ from: entryDate, to: entryDate })
  .strict()
  .refine((value) => value.from <= value.to);

export const reportInput = z
  .object({
    filters: entryFilters.default(() => entryFilters.parse({})),
    period: datePeriod.optional(),
    groupBy: z.enum(['category', 'tag']).default('category'),
    interval: z.enum(['day', 'week', 'month']).default('week'),
    selection: reportSelection.optional(),
    compare: z.literal(true).optional(),
    comparisonBasis: z
      .enum(['day', 'week', 'month', 'complete_months', 'range'])
      .optional(),
  })
  .strict()
  .refine(
    (value) => !value.period || (!value.filters.from && !value.filters.to)
  );

export type ReportAggregate = {
  total: number;
  counts: { income: number; expense: number; refund: number };
  totals: EntryTotals;
  originalTotals: EntryTotals | null;
};
export type ReportGroup = ReportAggregate & {
  id: string | null;
  name: string | null;
  categoryKey: string | null;
  kind: 'income' | 'expense' | null;
  filters: EntryFilters;
};
export type Report = ReportAggregate & {
  datasetId: string;
  revision: number;
  primaryCurrency: Currency;
  timeZone: string;
  range: z.infer<typeof reportSelection>;
  filters: EntryFilters;
  groupBy: 'category' | 'tag';
  interval: 'day' | 'week' | 'month';
  groups: ReportGroup[];
  trend: (ReportAggregate & {
    from: string;
    to: string;
    filters: EntryFilters;
  })[];
  comparison?: {
    basis: ComparisonBasis;
    filters: EntryFilters;
    previous: ReportAggregate;
    groups: (ReportGroup & { previous: ReportAggregate })[];
  } | null;
};

export async function queryReport(
  db: D1Database,
  raw: unknown,
  now = new Date()
): Promise<Report> {
  const parsed = reportInput.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'invalid_report_query');
  const input = parsed.data;
  const settings = await readSettings(db);
  const range =
    input.period || (!input.filters.from && !input.filters.to)
      ? resolveDatePeriod(
          input.period ?? {
            kind: 'month',
            month: todayInZone(settings.timeZone, now).slice(0, 7),
          },
          settings.timeZone,
          now
        )
      : {
          from: input.filters.from ?? '1900-01-01',
          to: input.filters.to ?? '9999-12-31',
        };
  if (
    input.selection &&
    (input.selection.from < range.from || input.selection.to > range.to)
  )
    throw new HttpError(400, 'invalid_report_query');
  const resolved = entryFilters.safeParse({
    ...input.filters,
    ...range,
    ...input.selection,
    page: 1,
  });
  if (!resolved.success) throw new HttpError(400, 'invalid_report_query');
  const filters = resolved.data;
  const basis: ComparisonBasis =
    input.comparisonBasis ??
    (input.selection
      ? input.interval
      : input.period?.kind === 'complete_months'
        ? 'complete_months'
        : input.period?.kind === 'month' ||
            (!input.period && !input.filters.from && !input.filters.to)
          ? 'month'
          : 'range');
  const previousRange = input.compare
    ? previousReportRange(
        { from: filters.from as string, to: filters.to as string },
        basis
      )
    : null;
  const previousFilters = previousRange
    ? { ...filters, ...previousRange }
    : null;
  const previousQuery = previousFilters ? entryQuery(previousFilters) : null;
  const { from, condition, values } = entryQuery(filters);
  const trendQuery = entryQuery({ ...filters, ...range });
  const amounts = `${sumColumns('base_minor', 'base_')}${filters.currency ? `, ${sumColumns('original_minor', 'original_')}` : ''}`;
  const counts = `count(*) AS total, ${(['income', 'expense', 'refund'] as const).map((kind) => `coalesce(sum(e.kind = '${kind}'),0) AS count_${kind}`).join(',')}`;
  const columns = `${counts}, ${amounts}`;
  const tagJoin =
    ' LEFT JOIN entry_tags gt ON gt.dataset_id = e.dataset_id AND gt.entry_id = coalesce(p.id, e.id) LEFT JOIN tags g ON g.dataset_id = gt.dataset_id AND g.id = gt.tag_id';
  const group =
    input.groupBy === 'category'
      ? 'c.id AS id, c.name AS name, c.default_key AS categoryKey, c.kind AS kind'
      : 'g.id AS id, g.name AS name, NULL AS categoryKey, NULL AS kind';
  const rankedAmount =
    filters.kind === 'income'
      ? 'base_income'
      : filters.kind === 'refund'
        ? 'base_refund'
        : 'base_expense';
  const bucket =
    input.interval === 'day'
      ? 'e.entry_date'
      : input.interval === 'month'
        ? "substr(e.entry_date,1,7) || '-01'"
        : "date(e.entry_date, 'weekday 0', '-6 days')";
  const [state, total, groups, trend, previousTotal, previousGroups] =
    await db.batch<Record<string, unknown>>([
      db
        .prepare(
          'SELECT s.revision FROM moni_state s JOIN datasets d ON d.id = s.active_dataset WHERE s.singleton = 1 AND s.active_dataset = ? AND d.version = ?'
        )
        .bind(settings.datasetId, settings.version),
      db
        .prepare(`SELECT ${columns} ${from} WHERE ${condition}`)
        .bind(...values),
      db
        .prepare(
          `SELECT ${group}, ${columns} ${from}${input.groupBy === 'tag' ? tagJoin : ''} WHERE ${condition} GROUP BY ${input.groupBy === 'tag' ? 'g.id' : 'c.id'} ORDER BY ${rankedAmount} DESC, id`
        )
        .bind(...values),
      db
        .prepare(
          `SELECT ${bucket} AS bucket, ${columns} ${trendQuery.from} WHERE ${trendQuery.condition} GROUP BY bucket ORDER BY bucket`
        )
        .bind(...trendQuery.values),
      ...(previousQuery
        ? [
            db
              .prepare(
                `SELECT ${columns} ${previousQuery.from} WHERE ${previousQuery.condition}`
              )
              .bind(...previousQuery.values),
            db
              .prepare(
                `SELECT ${group}, ${columns} ${previousQuery.from}${input.groupBy === 'tag' ? tagJoin : ''} WHERE ${previousQuery.condition} GROUP BY ${input.groupBy === 'tag' ? 'g.id' : 'c.id'}`
              )
              .bind(...previousQuery.values),
          ]
        : []),
    ]);
  if (!state.results.length) throw new HttpError(409, 'dataset_changed');
  const aggregate = (row: Record<string, unknown>): ReportAggregate => ({
    total: row.total as number,
    counts: {
      income: row.count_income as number,
      expense: row.count_expense as number,
      refund: row.count_refund as number,
    },
    totals: readTotals(row, 'base_'),
    originalTotals: filters.currency ? readTotals(row, 'original_') : null,
  });
  const makeGroup = (row: Record<string, unknown>): ReportGroup => ({
    ...aggregate(row),
    id: row.id as string | null,
    name: row.name as string | null,
    categoryKey: row.categoryKey as string | null,
    kind: row.kind as 'income' | 'expense' | null,
    filters: {
      ...filters,
      ...(input.groupBy === 'category'
        ? { categoryId: row.id as string }
        : row.id
          ? {
              requiredTagIds: [
                ...new Set([
                  ...(filters.requiredTagIds ?? []),
                  row.id as string,
                ]),
              ],
              untagged: undefined,
            }
          : { untagged: true }),
    },
  });
  const result: Report = {
    ...aggregate(total.results[0]),
    datasetId: settings.datasetId,
    revision: state.results[0].revision as number,
    primaryCurrency: settings.primaryCurrency,
    timeZone: settings.timeZone,
    range,
    filters,
    groupBy: input.groupBy,
    interval: input.interval,
    groups: groups.results.map(makeGroup),
    trend: trend.results.map((row) => {
      const start = row.bucket as string;
      const from = start < range.from ? range.from : start;
      const end = trendEnd(start, input.interval);
      const to = end > range.to ? range.to : end;
      return { ...aggregate(row), from, to, filters: { ...filters, from, to } };
    }),
  };
  if (input.compare) {
    result.comparison = null;
    if (previousFilters && previousTotal && previousGroups) {
      const zero: ReportAggregate = {
        total: 0,
        counts: { income: 0, expense: 0, refund: 0 },
        totals: { income: 0, expense: 0, refund: 0, netExpense: 0 },
        originalTotals: filters.currency
          ? { income: 0, expense: 0, refund: 0, netExpense: 0 }
          : null,
      };
      const previous = aggregate(previousTotal.results[0]);
      const previousById = new Map(
        previousGroups.results.map((row) => [
          row.id as string | null,
          makeGroup(row),
        ])
      );
      const allGroups = new Map(result.groups.map((item) => [item.id, item]));
      for (const [id, item] of previousById)
        if (!allGroups.has(id)) allGroups.set(id, { ...item, ...zero });
      const changes = [...allGroups.values()].map((item) => {
        const prior = previousById.get(item.id);
        return {
          ...item,
          previous: prior
            ? {
                total: prior.total,
                counts: prior.counts,
                totals: prior.totals,
                originalTotals: prior.originalTotals,
              }
            : zero,
        };
      });
      for (const pair of [
        { current: result, previous },
        ...changes.map((item) => ({ current: item, previous: item.previous })),
      ])
        if (
          Object.keys(pair.current.totals).some(
            (key) =>
              !Number.isSafeInteger(
                pair.current.totals[key as keyof EntryTotals] -
                  pair.previous.totals[key as keyof EntryTotals]
              )
          )
        )
          throw new HttpError(413, 'aggregate_out_of_range');
      result.comparison = {
        basis,
        filters: previousFilters,
        previous,
        groups: changes,
      };
    }
  }
  return result;
}
