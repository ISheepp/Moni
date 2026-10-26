import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { Currency } from '@/ledger/currencies';
import { displayMoney } from '@/ledger/money';
import { averageMinor } from '@/ledger/report-comparison';
import type { Report } from '@/ledger/reports';
import { categoryLabel } from '@/lib/category-label';
import { type AppLocale, message } from '@/lib/locale';

export function ReportDelta({
  current,
  previous,
  format,
  locale,
}: {
  current: number;
  previous: number;
  format: (value: number) => string;
  locale: AppLocale;
}) {
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const difference = current - previous;
  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1 text-xs leading-relaxed text-muted-foreground tabular-nums">
      <span>{t('report_vs_previous')}</span>
      <span className="font-bold">
        {difference === 0
          ? t('report_unchanged')
          : previous === 0 && current > 0
            ? `${t('report_new')} ${format(current)}`
            : `${difference > 0 ? '+' : ''}${format(difference)}`}
      </span>
      {previous > 0 && difference !== 0 && (
        <span>
          (
          {new Intl.NumberFormat(locale, {
            style: 'percent',
            signDisplay: 'exceptZero',
            maximumFractionDigits: 1,
          }).format(difference / previous)}
          )
        </span>
      )}
    </span>
  );
}

export function ReportComparisonSummary({
  data,
  kind,
  locale,
}: {
  data: Report;
  kind: 'expense' | 'income' | 'refund';
  locale: AppLocale;
}) {
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const money = (value: number) =>
    displayMoney(value, data.primaryCurrency, locale);
  const count = (value: number) =>
    `${new Intl.NumberFormat(locale).format(value)} ${t('report_records')}`;
  const comparison = data.comparison;
  const average = averageMinor(data.totals[kind], data.counts[kind]);
  const previousAverage = comparison
    ? averageMinor(
        comparison.previous.totals[kind],
        comparison.previous.counts[kind]
      )
    : null;
  const basisLabels = {
    day: 'report_compare_day',
    week: 'report_compare_week',
    month: 'report_compare_month',
    complete_months: 'report_compare_months',
    range: 'report_compare_range',
  } as const;
  return (
    <section
      aria-label={t('report_frequency')}
      className="mt-4 rounded-2xl border border-foreground/10 bg-surface p-4 md:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2 text-xs leading-relaxed text-muted-foreground">
        <h2 className="text-sm font-bold text-foreground">
          {t('report_frequency')}
        </h2>
        {comparison === undefined ? null : comparison ? (
          <p>
            {t('report_previous_period')}{' '}
            <span className="font-bold tabular-nums">
              {comparison.filters.from} — {comparison.filters.to}
            </span>{' '}
            · {t(basisLabels[comparison.basis])}
          </p>
        ) : (
          <p>{t('report_compare_unavailable')}</p>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 md:gap-8">
        <div className="min-w-0">
          <h3 className="text-sm text-muted-foreground">
            {t(
              kind === 'income'
                ? 'report_income_count'
                : kind === 'refund'
                  ? 'report_refund_count'
                  : 'report_expense_count'
            )}
          </h3>
          <p className="mt-2 break-words text-2xl font-extrabold tabular-nums">
            {count(data.counts[kind])}
          </p>
          {comparison && (
            <div className="mt-2">
              <ReportDelta
                current={data.counts[kind]}
                previous={comparison.previous.counts[kind]}
                format={count}
                locale={locale}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('report_previous_value')}{' '}
                {count(comparison.previous.counts[kind])}
              </p>
            </div>
          )}
        </div>
        <div className="min-w-0 border-s border-foreground/10 ps-4 md:ps-8">
          <h3 className="text-sm text-muted-foreground">
            {t('report_average')}
          </h3>
          <p className="mt-2 break-words text-2xl font-extrabold tabular-nums">
            {average === null ? '—' : money(average)}
          </p>
          {comparison && (
            <div className="mt-2">
              {average !== null && previousAverage !== null ? (
                <ReportDelta
                  current={average}
                  previous={previousAverage}
                  format={money}
                  locale={locale}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t(
                    average === null
                      ? 'report_current_no_records'
                      : 'report_previous_no_records'
                  )}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {t('report_previous_value')}{' '}
                {previousAverage === null ? '—' : money(previousAverage)}
              </p>
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {t('report_average_basis')}
      </p>
    </section>
  );
}

export function ReportChanges({
  data,
  kind,
  locale,
  currency,
  loading,
  direction,
  onDirectionChange,
  titleId = 'report-changes-title',
}: {
  data: Report | null;
  kind: 'expense' | 'income' | 'refund';
  locale: AppLocale;
  currency: Currency;
  loading: boolean;
  direction: 'increase' | 'decrease';
  onDirectionChange: (value: 'increase' | 'decrease') => void;
  titleId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const money = (value: number) => displayMoney(value, currency, locale);
  const comparison = data?.comparison;
  const changes =
    comparison?.groups
      .filter((group) =>
        direction === 'increase'
          ? group.totals[kind] > group.previous.totals[kind]
          : group.totals[kind] < group.previous.totals[kind]
      )
      .sort((a, b) => {
        const difference =
          a.totals[kind] -
          a.previous.totals[kind] -
          (b.totals[kind] - b.previous.totals[kind]);
        return (
          (direction === 'increase' ? -difference : difference) ||
          (a.id ?? '').localeCompare(b.id ?? '', 'en')
        );
      }) ?? [];
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={loading}
      className="min-w-0 rounded-2xl border border-foreground/10 bg-surface p-4 md:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id={titleId} className="text-lg font-extrabold">
          {t('report_changes_title')}
        </h2>
        <SegmentedControl
          label={t('report_change_direction')}
          value={direction}
          onValueChange={(next) => {
            setShowAll(false);
            onDirectionChange(next);
          }}
          items={[
            { value: 'increase', label: t('report_increases') },
            { value: 'decrease', label: t('report_decreases') },
          ]}
        />
      </div>
      {data && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t(
            data.groupBy === 'tag'
              ? 'report_tag_changes'
              : 'report_category_changes'
          )}{' '}
          · {t('report_changes_basis')}
        </p>
      )}
      {comparison && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground tabular-nums">
          {data?.filters.from} — {data?.filters.to} /{' '}
          {t('report_previous_value')} {comparison.filters.from} —{' '}
          {comparison.filters.to}
        </p>
      )}
      {data?.groupBy === 'tag' && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t('report_tags_overlap')}
        </p>
      )}
      {loading ? (
        <div
          aria-hidden
          className="mt-5 h-48 rounded-xl bg-muted/35 motion-safe:animate-pulse"
        />
      ) : comparison ? (
        changes.length ? (
          <>
            <ol
              aria-label={t('report_changes_title')}
              className="mt-5 divide-y divide-foreground/10"
            >
              {(showAll ? changes : changes.slice(0, 5)).map((group, index) => {
                const name =
                  group.name === null
                    ? t('report_untagged')
                    : categoryLabel(group.name, group.categoryKey, locale);
                const difference =
                  group.totals[kind] - group.previous.totals[kind];
                const currentAverage = averageMinor(
                  group.totals[kind],
                  group.counts[kind]
                );
                const previousAverage = averageMinor(
                  group.previous.totals[kind],
                  group.previous.counts[kind]
                );
                const currentFilters = {
                  ...group.filters,
                  kind,
                  sort: 'amount_desc' as const,
                  page: 1,
                };
                return (
                  <li
                    key={group.id ?? 'untagged'}
                    className="flex gap-3 py-5 md:gap-4"
                  >
                    <span
                      aria-hidden
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${index < 3 ? 'bg-yellow/30' : 'bg-muted text-muted-foreground'}`}
                    >
                      #{index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="min-w-0 break-words font-bold">
                          {name}
                        </h3>
                        <p className="text-lg font-extrabold tabular-nums">
                          {difference > 0 ? '+' : ''}
                          {money(difference)}
                        </p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs leading-relaxed text-muted-foreground md:gap-6">
                        <div className="min-w-0">
                          <p>
                            {t('report_current_value')}{' '}
                            <strong className="break-words text-foreground tabular-nums">
                              {money(group.totals[kind])}
                            </strong>
                          </p>
                          <p className="mt-1">
                            {group.counts[kind]} {t('report_records')} ·{' '}
                            {t('report_average_short')}{' '}
                            {currentAverage === null
                              ? '—'
                              : money(currentAverage)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p>
                            {t('report_previous_value')}{' '}
                            <strong className="break-words text-foreground tabular-nums">
                              {money(group.previous.totals[kind])}
                            </strong>
                          </p>
                          <p className="mt-1">
                            {group.previous.counts[kind]} {t('report_records')}{' '}
                            · {t('report_average_short')}{' '}
                            {previousAverage === null
                              ? '—'
                              : money(previousAverage)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <ReportDelta
                          current={group.totals[kind]}
                          previous={group.previous.totals[kind]}
                          format={money}
                          locale={locale}
                        />
                        <div className="flex gap-4 text-xs font-bold">
                          <Link
                            to="/"
                            search={{
                              view: 'entries',
                              filters: currentFilters,
                            }}
                            className="inline-flex min-h-11 items-center rounded underline decoration-foreground/30 underline-offset-4 outline-none hover:text-orange-strong focus-visible:ring-4 focus-visible:ring-focus"
                          >
                            {t('report_current_entries')}
                          </Link>
                          <Link
                            to="/"
                            search={{
                              view: 'entries',
                              filters: {
                                ...currentFilters,
                                from: comparison.filters.from,
                                to: comparison.filters.to,
                              },
                            }}
                            className="inline-flex min-h-11 items-center rounded underline decoration-foreground/30 underline-offset-4 outline-none hover:text-orange-strong focus-visible:ring-4 focus-visible:ring-focus"
                          >
                            {t('report_previous_entries')}
                          </Link>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {changes.length > 5 && (
              <Button
                variant="plain"
                className="mt-4 w-full border-foreground/15! text-sm"
                onClick={() => setShowAll((value) => !value)}
              >
                {t(showAll ? 'report_fewer_changes' : 'report_all_changes')} (
                {changes.length})
              </Button>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('report_no_changes')}
          </p>
        )
      ) : (
        data && (
          <p className="py-8 text-sm text-muted-foreground">
            {t('report_compare_unavailable')}
          </p>
        )
      )}
    </section>
  );
}
