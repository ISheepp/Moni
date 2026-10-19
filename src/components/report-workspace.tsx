import {
  IconArrowDown,
  IconArrowUpRight,
  IconChevronLeft,
  IconChevronRight,
  IconInfoCircle,
  IconRefresh,
  IconWallet,
} from '@tabler/icons-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { EntryFilterForm } from '@/components/entry-list';
import { Button, buttonVariants } from '@/components/ui/button';
import { shiftMonth, todayInZone } from '@/ledger/dates';
import { type EntryFilters, entryFilters } from '@/ledger/entry-query';
import { decimalAmount, displayMoney } from '@/ledger/money';
import type { Report } from '@/ledger/reports';
import type { LedgerSettings } from '@/ledger/settings';
import type { Taxonomy } from '@/ledger/taxonomy';
import { categoryLabel } from '@/lib/category-label';
import { ApiError, privateApi } from '@/lib/client-api';
import { type AppLocale, message } from '@/lib/locale';

const metrics = [
  {
    key: 'income',
    label: 'entry_income',
    Icon: IconArrowUpRight,
    color: 'bg-green/25',
  },
  {
    key: 'expense',
    label: 'entry_expense',
    Icon: IconArrowDown,
    color: 'bg-orange/15',
  },
  {
    key: 'refund',
    label: 'query_refund',
    Icon: IconRefresh,
    color: 'bg-yellow/30',
  },
  {
    key: 'netExpense',
    label: 'query_net_expense',
    Icon: IconWallet,
    color: 'bg-muted',
  },
] as const;

export const reportOptions = z
  .object({
    mode: z.enum(['month', 'rolling_months', 'complete_months', 'custom']),
    month: z.string().regex(/^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/),
    months: z.number().int().min(1).max(120),
    groupBy: z.enum(['category', 'tag']),
    interval: z.enum(['day', 'week', 'month']),
  })
  .strict();

export function ReportWorkspace({
  settings,
  locale,
  filters: requested,
  options,
}: {
  settings: LedgerSettings;
  locale: AppLocale;
  filters?: EntryFilters;
  options?: z.infer<typeof reportOptions>;
}) {
  const [filters, setFilters] = useState(
    () => requested ?? entryFilters.parse({})
  );
  const [mode, setMode] = useState<
    'month' | 'rolling_months' | 'complete_months' | 'custom'
  >(options?.mode ?? (requested?.from || requested?.to ? 'custom' : 'month'));
  const [month, setMonth] = useState(
    () => options?.month ?? todayInZone(settings.timeZone).slice(0, 7)
  );
  const [months, setMonths] = useState(options?.months ?? 3);
  const [groupBy, setGroupBy] = useState<'category' | 'tag'>(
    options?.groupBy ?? 'category'
  );
  const [interval, setInterval] = useState<'day' | 'week' | 'month'>(
    options?.interval ?? 'week'
  );
  const navigate = useNavigate();
  const location = JSON.stringify({
    filters,
    report: { mode, month, months, groupBy, interval },
  });
  useEffect(() => {
    void navigate({
      to: '/',
      search: { view: 'reports', ...JSON.parse(location) },
      replace: true,
      resetScroll: false,
    });
  }, [navigate, location]);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<null | 'load' | 'large'>(null);
  const [data, setData] = useState<Report | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const payload = JSON.stringify({
    filters: {
      ...filters,
      ...(mode !== 'custom' ? { from: undefined, to: undefined } : {}),
    },
    ...(mode === 'month'
      ? { period: { kind: 'month', month } }
      : mode === 'custom'
        ? {}
        : { period: { kind: mode, months } }),
    groupBy,
    interval,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads the current financial report.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailure(null);
    void Promise.all([
      privateApi<Report>(
        'reports/query',
        JSON.parse(payload),
        'POST',
        controller.signal
      ),
      privateApi<Taxonomy>('taxonomy', undefined, 'GET', controller.signal),
    ])
      .then(([result, catalog]) => {
        if (controller.signal.aborted) return;
        if (
          result.datasetId !== settings.datasetId ||
          catalog.datasetId !== settings.datasetId
        )
          throw new Error('dataset_changed');
        setData(result);
        setTaxonomy(catalog);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setFailure(
            error instanceof ApiError && error.status === 413 ? 'large' : 'load'
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [payload, settings.datasetId, retry]);
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const money = (amount: number) =>
    displayMoney(amount, settings.primaryCurrency, locale);
  const label = (group: Report['groups'][number]) =>
    group.name === null
      ? t('report_untagged')
      : categoryLabel(group.name, group.categoryKey, locale);
  const apply = (next: EntryFilters) => {
    setFilters(next);
    setMode('custom');
  };
  const formFilters = {
    ...filters,
    ...(mode !== 'custom' && data
      ? { from: data.filters.from, to: data.filters.to }
      : {}),
  };
  const groups =
    data?.groups.filter(
      (group) => group.counts.expense || group.counts.refund
    ) ?? [];
  const peak = Math.max(
    1,
    ...(data?.trend.flatMap((bucket) => [
      bucket.totals.expense,
      bucket.totals.refund,
    ]) ?? [])
  );
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold">{t('app_reports')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'month' && (
            <>
              <Button
                variant="icon"
                aria-label={t('report_previous_month')}
                disabled={month <= '1900-01'}
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <IconChevronLeft aria-hidden size={22} />
              </Button>
              <label className="min-w-0">
                <span className="sr-only">{t('report_month')}</span>
                <input
                  type="month"
                  min="1900-01"
                  max="9999-12"
                  required
                  value={month}
                  onChange={(event) => {
                    if (
                      /^(19\d{2}|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(
                        event.target.value
                      )
                    )
                      setMonth(event.target.value);
                  }}
                  className="moni-field w-40!"
                />
              </label>
              <Button
                variant="icon"
                aria-label={t('report_next_month')}
                disabled={month >= '9999-12'}
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <IconChevronRight aria-hidden size={22} />
              </Button>
            </>
          )}
          <Button
            variant="icon"
            aria-label={t('report_refresh')}
            onClick={() => setRetry((value) => value + 1)}
          >
            <IconRefresh aria-hidden size={22} />
          </Button>
        </div>
      </div>
      {data && !loading && !failure && (
        <p
          className="mb-3 w-fit rounded-xl bg-muted px-3 py-2 text-sm tabular-nums"
          aria-live="polite"
        >
          {data.filters.from} — {data.filters.to} · {data.timeZone}
        </p>
      )}
      {taxonomy && (
        <details className="mb-5 rounded-xl border border-muted bg-surface px-4">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold focus-visible:outline-4 focus-visible:outline-focus">
            {t('query_filters')}
          </summary>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="min-w-0 text-sm font-bold">
              {t('report_period')}
              <select
                className="moni-field mt-2"
                aria-label={t('report_period')}
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="month">{t('report_calendar_month')}</option>
                <option value="rolling_months">
                  {t('report_rolling_months')}
                </option>
                <option value="complete_months">
                  {t('report_complete_months')}
                </option>
                <option value="custom">{t('report_custom')}</option>
              </select>
            </label>
            {(mode === 'rolling_months' || mode === 'complete_months') && (
              <label className="text-sm font-bold">
                {t('report_month_count')}
                <select
                  className="moni-field mt-2"
                  aria-label={t('report_month_count')}
                  value={months}
                  onChange={(event) => setMonths(Number(event.target.value))}
                >
                  {[1, 3, 6, 12].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <EntryFilterForm
            key={JSON.stringify(formFilters)}
            filters={formFilters}
            taxonomy={taxonomy}
            locale={locale}
            onApply={apply}
          />
        </details>
      )}
      {loading ? (
        <output>{t('probe_loading')}</output>
      ) : failure ? (
        <div>
          <p role="alert" className="my-5">
            {t(
              failure === 'large'
                ? 'query_aggregate_error'
                : 'report_load_error'
            )}
          </p>
          <Button onClick={() => setRetry((value) => value + 1)}>
            {t('app_retry')}
          </Button>
        </div>
      ) : (
        data && (
          <>
            <section aria-label={t('query_totals')}>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {metrics.map(({ key, label, Icon, color }) => (
                  <Link
                    key={key}
                    to="/"
                    search={{ view: 'entries', filters: data.filters }}
                    className="flex min-w-0 items-center gap-2 rounded-xl border border-foreground/30 bg-surface p-3 focus-visible:outline-4 focus-visible:outline-focus md:p-4"
                  >
                    <span
                      className={`hidden size-9 shrink-0 items-center justify-center rounded-full min-[380px]:flex md:size-11 ${color}`}
                    >
                      <Icon aria-hidden size={25} />
                    </span>
                    <dl className="min-w-0">
                      <dt className="text-sm font-bold">{t(label)}</dt>
                      <dd className="mt-1 break-words text-base font-extrabold tabular-nums md:text-xl">
                        {money(data.totals[key])}
                      </dd>
                      <dd className="mt-1 text-sm text-muted-foreground">
                        {key !== 'netExpense'
                          ? data.counts[key]
                          : data.counts.expense + data.counts.refund}{' '}
                        {t('report_records')}
                      </dd>
                    </dl>
                  </Link>
                ))}
              </div>
              {data.originalTotals && filters.currency && (
                <div className="mt-4 rounded-xl bg-yellow/15 p-4">
                  <h2 className="font-bold">
                    {t('query_original_totals')} · {filters.currency}
                  </h2>
                  <dl className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
                    {metrics.map(({ key, label }) => (
                      <div key={key}>
                        <dt className="text-sm">{t(label)}</dt>
                        <dd className="mt-1 break-words font-bold tabular-nums">
                          {displayMoney(
                            data.originalTotals?.[key] ?? 0,
                            filters.currency as NonNullable<
                              EntryFilters['currency']
                            >,
                            locale
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </section>
            <p className="my-4 flex gap-2 text-sm text-muted-foreground">
              <IconInfoCircle size={20} className="shrink-0" aria-hidden />
              {t('report_basis')} · {data.primaryCurrency} · {data.total}{' '}
              {t('report_records')}
            </p>
            {!data.total && (
              <div className="py-6 text-center">
                <img
                  src="/moni/illustrations/assistant-search.png"
                  className="mx-auto w-32"
                  alt=""
                />
                <h2 className="mt-3 text-xl font-bold">{t('query_empty')}</h2>
              </div>
            )}
            <section
              className="mt-4 rounded-xl border border-foreground bg-surface p-4 md:p-6"
              aria-labelledby="report-trend-title"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="report-trend-title" className="text-lg font-extrabold">
                  {t('report_trend')}
                </h2>
                <label className="flex items-center gap-2 text-sm">
                  <span>{t('report_interval')}</span>
                  <select
                    className="moni-field w-auto!"
                    aria-label={t('report_interval')}
                    value={interval}
                    onChange={(event) =>
                      setInterval(event.target.value as typeof interval)
                    }
                  >
                    <option value="day">{t('report_daily')}</option>
                    <option value="week">{t('report_weekly')}</option>
                    <option value="month">{t('report_monthly')}</option>
                  </select>
                </label>
              </div>
              <p className="my-2 flex justify-end gap-5 text-sm">
                <span>
                  <span className="mr-2 inline-block size-3 rounded-full bg-orange" />
                  {t('entry_expense')}
                </span>
                <span>
                  <span className="mr-2 inline-block size-3 rounded-full bg-yellow" />
                  {t('query_refund')}
                </span>
              </p>
              {data.trend.length > 0 && (
                <div
                  className="overflow-x-auto"
                  role="img"
                  aria-label={t('report_chart_alternative')}
                >
                  <div
                    className="flex min-w-full items-end gap-4 border-b border-muted pt-3"
                    style={{ minWidth: Math.max(260, data.trend.length * 92) }}
                    aria-hidden="true"
                  >
                    {data.trend.map((bucket) => (
                      <div
                        key={bucket.from}
                        className="min-w-0 flex-1 text-center"
                      >
                        <div className="flex h-28 items-end justify-center gap-3 md:gap-4 border-t border-dashed border-muted">
                          {(['expense', 'refund'] as const).map((kind) => (
                            <div
                              key={kind}
                              className={`relative w-8 rounded-t md:w-16 ${kind === 'expense' ? 'bg-orange' : 'bg-yellow'}`}
                              style={{
                                height: `${(bucket.totals[kind] / peak) * 75}%`,
                              }}
                            >
                              <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-sm font-bold tabular-nums">
                                {decimalAmount(
                                  bucket.totals[kind],
                                  settings.primaryCurrency
                                ).replace(/\.0+$/, '')}
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="py-2 text-sm tabular-nums">
                          {bucket.from.slice(5)} — {bucket.to.slice(5)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold focus-visible:outline-4 focus-visible:outline-focus">
                  {t('report_data_table')}
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">{t('report_trend')}</caption>
                    <thead>
                      <tr>
                        <th className="p-2">{t('report_period')}</th>
                        {metrics.map((metric) => (
                          <th key={metric.key} className="p-2">
                            {t(metric.label)}
                          </th>
                        ))}
                        <th className="p-2">{t('report_records')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trend.map((bucket) => (
                        <tr key={bucket.from} className="border-t border-muted">
                          <th className="p-2 font-normal">
                            <Link
                              to="/"
                              search={{
                                view: 'entries',
                                filters: bucket.filters,
                              }}
                              className="inline-flex min-h-11 items-center rounded px-1 underline focus-visible:outline-4 focus-visible:outline-focus"
                            >
                              {bucket.from} — {bucket.to}
                            </Link>
                          </th>
                          {metrics.map((metric) => (
                            <td
                              key={metric.key}
                              className="whitespace-nowrap p-2 tabular-nums"
                            >
                              {money(bucket.totals[metric.key])}
                            </td>
                          ))}
                          <td className="p-2">{bucket.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
            <section
              className="mt-4 rounded-xl border border-foreground bg-surface p-4 md:p-6"
              aria-labelledby="report-groups-title"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="report-groups-title" className="text-lg font-extrabold">
                  {t('report_distribution')}
                </h2>
                <label className="flex items-center gap-2 text-sm">
                  {t('report_group_by')}
                  <select
                    className="moni-field w-auto!"
                    aria-label={t('report_group_by')}
                    value={groupBy}
                    onChange={(event) =>
                      setGroupBy(event.target.value as typeof groupBy)
                    }
                  >
                    <option value="category">{t('entry_category')}</option>
                    <option value="tag">{t('entry_tags')}</option>
                  </select>
                </label>
              </div>
              {groupBy === 'tag' && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('report_tags_overlap')}
                </p>
              )}
              <ul className="mt-4 space-y-3">
                {groups.map((group) => (
                  <li key={group.id ?? 'untagged'}>
                    <Link
                      to="/"
                      search={{ view: 'entries', filters: group.filters }}
                      className="grid gap-x-5 rounded-lg focus-visible:outline-4 focus-visible:outline-focus md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                    >
                      <div className="flex flex-wrap justify-between gap-2 text-sm md:col-span-2">
                        <span className="min-w-0 break-words font-bold">
                          {label(group)} · {group.total} {t('report_records')}
                        </span>
                        <span className="tabular-nums">
                          {money(group.totals.expense)} ·{' '}
                          {new Intl.NumberFormat(locale, {
                            style: 'percent',
                            maximumFractionDigits: 1,
                          }).format(
                            data.totals.expense
                              ? group.totals.expense / data.totals.expense
                              : 0
                          )}
                        </span>
                      </div>
                      <div
                        className="my-2 h-3 overflow-hidden rounded-full bg-muted md:col-start-1 md:self-center"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-orange"
                          style={{
                            width: `${data.totals.expense ? (group.totals.expense / data.totals.expense) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('query_refund')} {money(group.totals.refund)} ·{' '}
                        {t('query_net_expense')}{' '}
                        {money(group.totals.netExpense)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
              {!groups.length && (
                <p className="my-5 text-sm text-muted-foreground">
                  {t('report_no_expenses')}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  {t('report_refund_date')}
                </p>
                <Link
                  to="/"
                  search={{ view: 'entries', filters: data.filters }}
                  className={buttonVariants({ className: 'w-full sm:w-auto' })}
                >
                  {t('report_view_entries')}
                </Link>
              </div>
            </section>
          </>
        )
      )}
    </>
  );
}
