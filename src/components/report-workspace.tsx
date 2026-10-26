import { Collapsible } from '@base-ui/react/collapsible';
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUpRight,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconInfoCircle,
  IconRefresh,
  IconWallet,
} from '@tabler/icons-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { EntryFilterForm } from '@/components/entry-list';
import {
  ReportChanges,
  ReportComparisonSummary,
  ReportDelta,
} from '@/components/report-comparison';
import { ReportEntryRanking } from '@/components/report-entry-ranking';
import { ReportMonthPicker } from '@/components/report-month-picker';
import { Button, buttonVariants } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { shiftMonth, todayInZone } from '@/ledger/dates';
import { type EntryFilters, entryFilters } from '@/ledger/entry-query';
import { decimalAmount, displayMoney } from '@/ledger/money';
import { averageMinor } from '@/ledger/report-comparison';
import { type Report, reportSelection } from '@/ledger/reports';
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
    selection: reportSelection.optional(),
    ranking: z.enum(['category', 'tag', 'entries']).optional(),
    expanded: z.string().max(100).optional(),
    changes: z.enum(['increase', 'decrease']).optional(),
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
  const [ranking, setRanking] = useState<'category' | 'tag' | 'entries'>(
    options?.ranking ?? options?.groupBy ?? 'category'
  );
  const groupBy = ranking === 'tag' ? 'tag' : 'category';
  const [selection, setSelection] = useState(options?.selection);
  const [changeDirection, setChangeDirection] = useState<
    'increase' | 'decrease'
  >(options?.changes ?? 'increase');
  const [expanded, setExpanded] = useState<string | undefined>(
    options?.expanded
  );
  const [interval, setInterval] = useState<'day' | 'week' | 'month'>(
    options?.interval ?? 'week'
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const chartScroller = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const location = JSON.stringify({
    filters,
    report: {
      mode,
      month,
      months,
      groupBy,
      interval,
      selection,
      ranking,
      expanded,
      changes: changeDirection,
    },
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
  const [loadedRequest, setLoadedRequest] = useState<{
    chart: string;
    scope: string;
  } | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const request = {
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
    selection,
    compare: true,
  };
  const payload = JSON.stringify(request);
  const chartPayload = JSON.stringify({
    ...request,
    selection: undefined,
    groupBy: undefined,
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
        setLoadedRequest({ chart: chartPayload, scope: payload });
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
  }, [payload, chartPayload, settings.datasetId, retry]);
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
    setSelection(undefined);
    setExpanded(undefined);
  };
  const formFilters = {
    ...filters,
    ...(mode !== 'custom' && data
      ? { from: data.range.from, to: data.range.to }
      : {}),
  };
  const rankedKind =
    filters.kind === 'income'
      ? 'income'
      : filters.kind === 'refund'
        ? 'refund'
        : 'expense';
  const groups = data?.groups.filter((group) => group.counts[rankedKind]) ?? [];
  const peak = Math.max(
    1,
    ...(data?.trend.flatMap((bucket) => [
      bucket.totals.expense,
      bucket.totals.refund,
    ]) ?? [])
  );
  const visible =
    !loading && !failure && loadedRequest?.scope === payload ? data : null;
  const chart = !failure && loadedRequest?.chart === chartPayload ? data : null;
  const selectPeriod = (period?: { from: string; to: string }) => {
    setSelection(period);
    setExpanded(undefined);
  };
  useEffect(() => {
    const revealSelection = () => {
      const scroller = chartScroller.current;
      const button = scroller?.querySelector<HTMLElement>(
        'button[aria-pressed="true"]'
      );
      if (!scroller || !button) return;
      const bounds = scroller.getBoundingClientRect();
      const selected = button.getBoundingClientRect();
      if (selected.left < bounds.left || selected.right > bounds.right)
        scroller.scrollLeft +=
          selected.left -
          bounds.left -
          (scroller.clientWidth - selected.width) / 2;
    };
    if (chart) revealSelection();
    window.addEventListener('resize', revealSelection);
    return () => window.removeEventListener('resize', revealSelection);
  }, [chart]);
  return (
    <div className="space-y-6 md:space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            {t('app_reports')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('report_overview')}
          </p>
        </div>
        <Button
          variant="icon"
          aria-label={t('report_refresh')}
          className="shrink-0 rounded-xl border-foreground/15!"
          onClick={() => setRetry((value) => value + 1)}
        >
          <IconRefresh
            aria-hidden
            size={20}
            className={loading ? 'motion-safe:animate-spin' : ''}
          />
        </Button>
      </header>
      <Collapsible.Root
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        className="rounded-2xl border border-foreground/10 bg-surface"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 md:flex md:justify-between md:p-4">
          <div className="contents md:flex md:min-w-0 md:flex-wrap md:items-center md:gap-3">
            <Select
              label={t('report_period')}
              className="w-full! max-w-full md:w-auto!"
              value={mode}
              onValueChange={(next) => {
                selectPeriod();
                if (next === 'custom') {
                  setFilters(formFilters);
                  setFiltersOpen(true);
                }
                setMode(next);
              }}
              items={[
                { value: 'month', label: t('report_calendar_month') },
                { value: 'rolling_months', label: t('report_rolling_months') },
                {
                  value: 'complete_months',
                  label: t('report_complete_months'),
                },
                { value: 'custom', label: t('report_custom') },
              ]}
            />
            {mode === 'month' && (
              <div className="col-span-2 row-start-2 flex max-w-full items-center rounded-xl border border-foreground/15">
                <Button
                  variant="icon"
                  className="shrink-0 border-0! bg-transparent!"
                  aria-label={t('report_previous_month')}
                  disabled={month <= '1900-01'}
                  onClick={() => {
                    selectPeriod();
                    setMonth(shiftMonth(month, -1));
                  }}
                >
                  <IconChevronLeft aria-hidden size={19} />
                </Button>
                <ReportMonthPicker
                  value={month}
                  onChange={(next) => {
                    selectPeriod();
                    setMonth(next);
                  }}
                  locale={locale}
                />
                <Button
                  variant="icon"
                  className="shrink-0 border-0! bg-transparent!"
                  aria-label={t('report_next_month')}
                  disabled={month >= '9999-12'}
                  onClick={() => {
                    selectPeriod();
                    setMonth(shiftMonth(month, 1));
                  }}
                >
                  <IconChevronRight aria-hidden size={19} />
                </Button>
              </div>
            )}
            {(mode === 'rolling_months' || mode === 'complete_months') && (
              <div className="col-span-2 row-start-2 flex items-center gap-2 text-sm">
                <span>{t('report_month_count')}</span>
                <Select
                  label={t('report_month_count')}
                  value={months}
                  onValueChange={(next) => {
                    selectPeriod();
                    setMonths(next);
                  }}
                  items={[...new Set([1, 3, 6, 12, months])]
                    .sort((a, b) => a - b)
                    .map((value) => ({ value, label: String(value) }))}
                  className="w-20!"
                />
              </div>
            )}
          </div>
          <Collapsible.Trigger
            render={
              <Button
                variant="plain"
                className="col-start-2 row-start-1 border-0! px-3! shadow-none!"
              />
            }
          >
            <IconFilter size={18} aria-hidden />
            {t('query_filters')}
            <IconChevronDown
              size={16}
              aria-hidden
              className={`transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
            />
          </Collapsible.Trigger>
        </div>
        <Collapsible.Panel className="border-t border-foreground/10 px-4 pt-5 md:px-5">
          {taxonomy && (
            <EntryFilterForm
              key={JSON.stringify(formFilters)}
              filters={formFilters}
              taxonomy={taxonomy}
              locale={locale}
              onApply={apply}
            />
          )}
        </Collapsible.Panel>
      </Collapsible.Root>
      {failure ? (
        <div className="rounded-2xl border border-orange/40 bg-orange/5 p-6">
          <p role="alert" className="mb-4">
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
        <>
          <section aria-label={t('query_totals')} aria-busy={loading}>
            {visible && (
              <p
                className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {selection && <span>{t('report_selected_period')}</span>}
                <span className="font-bold text-foreground">
                  {visible.filters.from} — {visible.filters.to}
                </span>
                <span>· {visible.timeZone}</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {metrics.map(({ key, label, Icon, color }) =>
                visible ? (
                  <Link
                    key={key}
                    to="/"
                    search={{
                      view: 'entries',
                      filters: {
                        ...visible.filters,
                        kind: key === 'netExpense' ? 'spending' : key,
                        sort: 'amount_desc',
                        page: 1,
                      },
                    }}
                    className={`group relative min-w-0 rounded-2xl border p-4 outline-none transition-colors hover:border-orange/60 focus-visible:ring-4 focus-visible:ring-focus md:p-5 ${key === 'netExpense' ? 'border-orange/35 bg-orange/10' : 'border-foreground/10 bg-surface'}`}
                  >
                    <dl>
                      <dt className="flex items-center justify-between gap-2 text-sm font-bold text-muted-foreground">
                        {t(label)}
                        <span
                          className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${color}`}
                        >
                          <Icon
                            aria-hidden
                            size={18}
                            className="text-foreground"
                          />
                        </span>
                      </dt>
                      <dd className="mt-4 break-words text-xl leading-tight font-extrabold tracking-tight tabular-nums sm:text-2xl">
                        {money(visible.totals[key])}
                      </dd>
                      <dd className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground md:text-sm">
                        <span>
                          {key !== 'netExpense'
                            ? visible.counts[key]
                            : visible.counts.expense +
                              visible.counts.refund}{' '}
                          {t('report_records')}
                        </span>
                        <IconArrowUpRight
                          size={16}
                          aria-hidden
                          className="shrink-0 opacity-50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                        />
                      </dd>
                      {visible.comparison && (
                        <dd className="mt-2">
                          <ReportDelta
                            current={visible.totals[key]}
                            previous={visible.comparison.previous.totals[key]}
                            format={money}
                            locale={locale}
                          />
                        </dd>
                      )}
                    </dl>
                  </Link>
                ) : (
                  <div
                    key={key}
                    aria-hidden
                    className="h-36 rounded-2xl border border-foreground/10 bg-muted/35 motion-safe:animate-pulse"
                  />
                )
              )}
            </div>
            {visible?.originalTotals && filters.currency && (
              <div className="mt-4 rounded-2xl border border-yellow/40 bg-yellow/10 p-4 md:p-5">
                <h2 className="text-sm font-bold">
                  {t('query_original_totals')} · {filters.currency}
                </h2>
                <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                  {metrics.map(({ key, label }) => (
                    <div key={key}>
                      <dt className="text-sm text-muted-foreground">
                        {t(label)}
                      </dt>
                      <dd className="mt-1 break-words font-bold tabular-nums">
                        {displayMoney(
                          visible.originalTotals?.[key] ?? 0,
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
          {visible && (
            <ReportComparisonSummary
              data={visible}
              kind={rankedKind}
              locale={locale}
            />
          )}
          {loading && (
            <output className="sr-only">{t('report_loading')}</output>
          )}
          {visible && (
            <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground md:text-sm">
              <IconInfoCircle
                size={18}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              {t('report_basis')} · {visible.primaryCurrency} · {visible.total}{' '}
              {t('report_records')}
            </p>
          )}
          {visible && !visible.total && (
            <div className="rounded-2xl border border-dashed border-foreground/20 py-8 text-center">
              <img
                src="/moni/illustrations/assistant-search.png"
                className="mx-auto w-28"
                alt=""
              />
              <h2 className="mt-3 text-lg font-bold">{t('query_empty')}</h2>
            </div>
          )}
        </>
      )}
      <section
        className="min-w-0 rounded-2xl border border-foreground/10 bg-surface p-4 md:p-6"
        aria-labelledby="report-trend-title"
        aria-busy={loading}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="report-trend-title" className="text-lg font-extrabold">
            {t('report_trend')}
          </h2>
          <SegmentedControl
            label={t('report_interval')}
            value={interval}
            onValueChange={(next) => {
              selectPeriod();
              setInterval(next);
            }}
            items={[
              { value: 'day', label: t('report_daily') },
              { value: 'week', label: t('report_weekly') },
              { value: 'month', label: t('report_monthly') },
            ]}
          />
        </div>
        {chart ? (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground md:text-sm">
              <span>
                {chart.primaryCurrency} · {chart.range.from} — {chart.range.to}
              </span>
              <p className="flex gap-4">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-orange" />
                  {t('entry_expense')}
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-yellow" />
                  {t('query_refund')}
                </span>
              </p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t('report_chart_hint')}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/35 px-3 py-2">
              <output className="text-sm font-bold tabular-nums">
                {selection
                  ? `${t('report_selected_period')} ${selection.from} — ${selection.to}`
                  : t('report_entire_period')}
              </output>
              {selection && (
                <Button
                  variant="plain"
                  className="min-h-10! border-foreground/15! px-3! text-xs!"
                  onClick={() => selectPeriod()}
                >
                  {t('report_clear_selection')}
                </Button>
              )}
            </div>
            {chart.trend.some(
              (bucket) => bucket.counts.expense || bucket.counts.refund
            ) ? (
              <div className="mt-7 flex min-w-0 gap-2 md:gap-4">
                <div
                  aria-hidden
                  className="mt-6 flex h-52 shrink-0 flex-col justify-between pb-0 text-right text-[11px] leading-none text-muted-foreground tabular-nums md:text-xs"
                >
                  {[peak, 0].map((amount) => (
                    <span key={amount}>
                      {decimalAmount(
                        Math.round(amount),
                        settings.primaryCurrency
                      ).replace(/\.0+$/, '')}
                    </span>
                  ))}
                </div>
                <section
                  ref={chartScroller}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable chart needs keyboard access on narrow screens.
                  tabIndex={0}
                  aria-label={t('report_trend')}
                  className="min-w-0 flex-1 overflow-x-auto rounded p-1 outline-none focus-visible:ring-4 focus-visible:ring-focus"
                >
                  <fieldset
                    className="relative min-w-0 pt-6"
                    style={{
                      minWidth: Math.max(210, chart.trend.length * 90),
                    }}
                    aria-label={t('report_chart_alternative')}
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-6 flex h-52 flex-col justify-between">
                      {[0, 1, 2].map((line) => (
                        <div
                          key={line}
                          className="border-t border-dashed border-foreground/10 last:border-solid last:border-foreground/20"
                        />
                      ))}
                    </div>
                    <div className="relative flex gap-4">
                      {chart.trend.map((bucket) => {
                        const selected =
                          selection?.from === bucket.from &&
                          selection?.to === bucket.to;
                        return (
                          <Button
                            key={bucket.from}
                            variant="plain"
                            aria-label={`${t('report_select_period')} ${bucket.from} — ${bucket.to}`}
                            aria-pressed={selected}
                            onClick={() =>
                              selectPeriod(
                                selected
                                  ? undefined
                                  : { from: bucket.from, to: bucket.to }
                              )
                            }
                            className="group min-w-0 flex-1 flex-col! justify-end! gap-0! rounded-lg! border-0! bg-transparent! px-1! py-0! text-center shadow-none! hover:bg-muted/20!"
                          >
                            <span
                              className="flex h-52 w-full items-end justify-center gap-2 md:gap-3"
                              aria-hidden
                            >
                              {(['expense', 'refund'] as const).map((kind) => (
                                <span
                                  key={kind}
                                  className={`relative w-[22%] max-w-14 rounded-t-md ${kind === 'expense' ? (selected ? 'bg-orange-strong' : selection ? 'bg-orange/45' : 'bg-orange') : selection && !selected ? 'bg-yellow/50' : 'bg-yellow'}`}
                                  style={{
                                    height: `${(bucket.totals[kind] / peak) * 100}%`,
                                  }}
                                >
                                  {bucket.totals[kind] > 0 && (
                                    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-xs font-bold tabular-nums">
                                      {decimalAmount(
                                        bucket.totals[kind],
                                        settings.primaryCurrency
                                      ).replace(/\.0+$/, '')}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </span>
                            <span className="flex min-h-12 items-center justify-center py-2 text-[11px] tabular-nums md:text-xs">
                              <span
                                className={`whitespace-nowrap rounded-md border-b-2 px-1 py-1 ${selected ? 'border-orange bg-orange/10 font-bold text-foreground' : 'border-transparent font-normal text-muted-foreground'}`}
                              >
                                {bucket.from.slice(5)}
                                {bucket.from !== bucket.to && (
                                  <> — {bucket.to.slice(5)}</>
                                )}
                              </span>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </fieldset>
                </section>
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {t('report_no_expenses')}
              </p>
            )}
            <Collapsible.Root className="mt-5 border-t border-foreground/10 pt-2">
              <Collapsible.Trigger className="group flex min-h-11 items-center gap-2 rounded-lg text-sm font-bold outline-none hover:text-orange-strong focus-visible:ring-4 focus-visible:ring-focus">
                {t('report_data_table')}
                <IconChevronDown
                  size={16}
                  aria-hidden
                  className="transition-transform group-data-[panel-open]:rotate-180"
                />
              </Collapsible.Trigger>
              <Collapsible.Panel>
                <section
                  aria-label={t('report_data_table')}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the wide data table.
                  tabIndex={0}
                  className="overflow-x-auto rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-focus"
                >
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">{t('report_trend')}</caption>
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="p-3">{t('report_period')}</th>
                        {metrics.map((metric) => (
                          <th key={metric.key} className="p-3">
                            {t(metric.label)}
                          </th>
                        ))}
                        <th className="p-3">{t('report_records')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart.trend.map((bucket) => (
                        <tr
                          key={bucket.from}
                          className="border-t border-foreground/10"
                        >
                          <th className="p-2 font-normal">
                            <Link
                              to="/"
                              search={{
                                view: 'entries',
                                filters: {
                                  ...bucket.filters,
                                  sort: 'amount_desc',
                                },
                              }}
                              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-1 underline decoration-foreground/30 underline-offset-4 outline-none hover:text-orange-strong focus-visible:ring-4 focus-visible:ring-focus"
                            >
                              {bucket.from} — {bucket.to}
                            </Link>
                          </th>
                          {metrics.map((metric) => (
                            <td
                              key={metric.key}
                              className="whitespace-nowrap p-3 tabular-nums"
                            >
                              {money(bucket.totals[metric.key])}
                            </td>
                          ))}
                          <td className="p-3">{bucket.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </Collapsible.Panel>
            </Collapsible.Root>
          </>
        ) : loading ? (
          <div
            aria-hidden
            className="mt-6 h-64 rounded-xl bg-muted/35 motion-safe:animate-pulse"
          />
        ) : null}
      </section>
      <ReportChanges
        data={visible}
        kind={rankedKind}
        locale={locale}
        currency={settings.primaryCurrency}
        loading={loading}
        direction={changeDirection}
        onDirectionChange={setChangeDirection}
      />
      <section
        className="min-w-0 rounded-2xl border border-foreground/10 bg-surface p-4 md:p-6"
        aria-labelledby="report-groups-title"
        aria-busy={loading}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="report-groups-title" className="text-lg font-extrabold">
            {t(
              rankedKind === 'income'
                ? 'report_income_ranking'
                : rankedKind === 'refund'
                  ? 'report_refund_ranking'
                  : 'report_distribution'
            )}
          </h2>
          <SegmentedControl
            label={t('report_group_by')}
            value={ranking}
            onValueChange={(next) => {
              setRanking(next);
              setExpanded(undefined);
            }}
            items={[
              { value: 'category', label: t('entry_category') },
              { value: 'tag', label: t('entry_tags') },
              { value: 'entries', label: t('report_individual_entries') },
            ]}
          />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t('report_rank_basis')} · {settings.primaryCurrency}
        </p>
        {visible && (
          <p className="mt-2 text-sm font-bold tabular-nums">
            {visible.filters.from} — {visible.filters.to}
          </p>
        )}
        {ranking === 'tag' && (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t('report_tags_overlap')}
          </p>
        )}
        {visible ? (
          <>
            {ranking === 'entries' ? (
              <ReportEntryRanking
                key={`${payload}:${retry}`}
                filters={visible.filters}
                revision={visible.revision}
                settings={settings}
                locale={locale}
                onRefresh={() => setRetry((value) => value + 1)}
              />
            ) : (
              <ol
                className="mt-4 divide-y divide-foreground/10"
                aria-label={t(
                  ranking === 'tag'
                    ? 'report_tag_ranking'
                    : 'report_category_ranking'
                )}
              >
                {groups.map((group, index) => {
                  const groupId = group.id ?? 'untagged';
                  const previous = visible.comparison?.groups.find(
                    (item) => item.id === group.id
                  )?.previous;
                  const average = averageMinor(
                    group.totals[rankedKind],
                    group.counts[rankedKind]
                  );
                  const share = visible.totals[rankedKind]
                    ? group.totals[rankedKind] / visible.totals[rankedKind]
                    : 0;
                  return (
                    <li key={groupId}>
                      <Collapsible.Root
                        open={expanded === groupId}
                        onOpenChange={(open) =>
                          setExpanded(open ? groupId : undefined)
                        }
                      >
                        <Collapsible.Trigger
                          render={<Button variant="plain" />}
                          className="group flex w-full items-start! justify-start! gap-3! rounded-xl! border-0! bg-transparent! px-1! py-5! text-left shadow-none! hover:bg-muted/30! md:gap-4! md:px-2!"
                        >
                          <span
                            aria-hidden
                            className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold tabular-nums ${index < 3 ? 'bg-yellow/35' : 'bg-muted text-muted-foreground'}`}
                          >
                            #{index + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                              <span className="min-w-0 break-words font-bold">
                                {label(group)}
                                <span className="text-sm font-normal text-muted-foreground">
                                  {' '}
                                  · {group.counts[rankedKind]}{' '}
                                  {t('report_records')}
                                </span>
                              </span>
                              <span className="text-lg font-extrabold tabular-nums">
                                {money(group.totals[rankedKind])}
                              </span>
                            </span>
                            <span className="mt-2 block text-xs font-normal text-muted-foreground">
                              {t('report_average')}{' '}
                              {average === null ? '—' : money(average)}
                            </span>
                            {previous && (
                              <span className="mt-1 block">
                                <ReportDelta
                                  current={group.totals[rankedKind]}
                                  previous={previous.totals[rankedKind]}
                                  format={money}
                                  locale={locale}
                                />
                                <span className="ms-2 text-xs font-normal text-muted-foreground">
                                  {t('report_count_change')}{' '}
                                  {group.counts[rankedKind] -
                                    previous.counts[rankedKind] >
                                  0
                                    ? '+'
                                    : ''}
                                  {group.counts[rankedKind] -
                                    previous.counts[rankedKind]}{' '}
                                  {t('report_records')}
                                </span>
                              </span>
                            )}
                            <span className="mt-3 flex items-center gap-3">
                              <span
                                className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60"
                                aria-hidden
                              >
                                <span
                                  className="block h-full rounded-full bg-orange"
                                  style={{ width: `${share * 100}%` }}
                                />
                              </span>
                              <span className="min-w-12 text-right text-xs font-normal text-muted-foreground tabular-nums">
                                {new Intl.NumberFormat(locale, {
                                  style: 'percent',
                                  maximumFractionDigits: 1,
                                }).format(share)}
                              </span>
                            </span>
                            {rankedKind === 'expense' &&
                              group.counts.refund > 0 && (
                                <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-normal text-muted-foreground">
                                  <span>
                                    {t('query_refund')}{' '}
                                    {money(group.totals.refund)}
                                  </span>
                                  <span>
                                    {t('query_net_expense')}{' '}
                                    {money(group.totals.netExpense)}
                                  </span>
                                </span>
                              )}
                            <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-muted-foreground">
                              {t(
                                expanded === groupId
                                  ? 'report_collapse_entries'
                                  : 'report_expand_entries'
                              )}
                              <IconChevronDown
                                size={14}
                                aria-hidden
                                className={`transition-transform ${expanded === groupId ? 'rotate-180' : ''}`}
                              />
                            </span>
                          </span>
                        </Collapsible.Trigger>
                        <Collapsible.Panel className="mb-4 rounded-xl border border-foreground/10 bg-background/60 p-3 md:ms-14 md:p-4">
                          <h3 className="text-sm font-extrabold">
                            {label(group)} · {t('report_entry_ranking')}
                          </h3>
                          <ReportEntryRanking
                            key={`${payload}:${retry}:${groupId}`}
                            filters={group.filters}
                            revision={visible.revision}
                            settings={settings}
                            locale={locale}
                            onRefresh={() => setRetry((value) => value + 1)}
                          />
                          <Link
                            to="/"
                            search={{
                              view: 'entries',
                              filters: {
                                ...group.filters,
                                sort: 'amount_desc',
                              },
                            }}
                            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-bold underline decoration-foreground/30 underline-offset-4 outline-none hover:text-orange-strong focus-visible:ring-4 focus-visible:ring-focus"
                          >
                            {label(group)} · {group.total} {t('report_records')}
                            <IconArrowUpRight aria-hidden size={16} />
                          </Link>
                        </Collapsible.Panel>
                      </Collapsible.Root>
                    </li>
                  );
                })}
              </ol>
            )}
            {ranking !== 'entries' && !groups.length && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t('report_no_ranked_entries')}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-foreground/10 pt-5">
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground md:text-sm">
                {t('report_refund_date')}
              </p>
              <Link
                to="/"
                search={{
                  view: 'entries',
                  filters: { ...visible.filters, sort: 'amount_desc' },
                }}
                className={buttonVariants({
                  variant: 'plain',
                  className: 'w-full border-foreground/15! text-sm sm:w-auto',
                })}
              >
                {t('report_view_entries')}
                <IconArrowRight size={18} aria-hidden />
              </Link>
            </div>
          </>
        ) : loading ? (
          <div
            aria-hidden
            className="mt-5 h-52 rounded-xl bg-muted/35 motion-safe:animate-pulse"
          />
        ) : null}
      </section>
    </div>
  );
}
