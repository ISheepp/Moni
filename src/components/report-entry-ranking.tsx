import { Dialog } from '@base-ui/react/dialog';
import {
  IconArrowUpRight,
  IconChevronLeft,
  IconChevronRight,
  IconX,
} from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import type { Entry } from '@/ledger/entries';
import type { EntryFilters, EntryPage } from '@/ledger/entry-query';
import { displayMoney } from '@/ledger/money';
import type { LedgerSettings } from '@/ledger/settings';
import { categoryLabel } from '@/lib/category-label';
import { ApiError, privateApi } from '@/lib/client-api';
import { type AppLocale, message } from '@/lib/locale';

export function ReportEntryRanking({
  filters,
  revision,
  settings,
  locale,
  onRefresh,
}: {
  filters: EntryFilters;
  revision: number;
  settings: LedgerSettings;
  locale: AppLocale;
  onRefresh: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EntryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<'load' | 'changed' | 'large' | null>(
    null
  );
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Entry | null>(null);
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const payload = JSON.stringify({
    ...filters,
    kind: filters.kind === 'spending' ? 'expense' : (filters.kind ?? 'expense'),
    sort: 'amount_desc',
    page,
    pageSize: 10,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads the same ranked page.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailure(null);
    void privateApi<EntryPage>(
      'entries/query',
      JSON.parse(payload),
      'POST',
      controller.signal
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          result.datasetId !== settings.datasetId ||
          result.revision !== revision
        ) {
          setFailure('changed');
          return;
        }
        setData(result);
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
  }, [payload, revision, settings.datasetId, retry]);
  if (loading || (!failure && data?.filters.page !== page))
    return (
      <div aria-busy="true" className="py-8">
        <output className="text-sm text-muted-foreground">
          {t('entry_loading')}
        </output>
      </div>
    );
  if (failure)
    return (
      <div className="space-y-3 py-5">
        <p role="alert" className="text-sm">
          {t(
            failure === 'changed'
              ? 'report_entries_changed'
              : failure === 'large'
                ? 'query_aggregate_error'
                : 'entry_load_error'
          )}
        </p>
        <Button
          variant="plain"
          onClick={() =>
            failure === 'changed' ? onRefresh() : setRetry((value) => value + 1)
          }
        >
          {t(failure === 'changed' ? 'report_refresh' : 'app_retry')}
        </Button>
      </div>
    );
  if (!data?.items.length)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t('report_no_ranked_entries')}
      </p>
    );
  const first = (page - 1) * 10 + 1;
  return (
    <Dialog.Root
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) setSelected(null);
      }}
    >
      <ol
        start={first}
        className="divide-y divide-foreground/10"
        aria-label={t('report_entry_ranking')}
      >
        {data.items.map((entry, index) => (
          <li key={entry.id}>
            <Dialog.Trigger
              render={<Button variant="plain" />}
              onClick={() => setSelected(entry)}
              className="group w-full justify-start! gap-3! rounded-xl! border-0! bg-transparent! px-1! py-5! text-left shadow-none! hover:bg-muted/30! sm:gap-4! sm:px-2!"
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-sm tabular-nums ${first + index <= 3 ? 'bg-yellow/35 text-foreground' : 'bg-muted text-muted-foreground'}`}
                aria-hidden
              >
                #{first + index}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <span className="min-w-0 break-words font-bold group-hover:underline decoration-orange underline-offset-4">
                    {entry.name}
                  </span>
                  <span className="flex shrink-0 flex-col text-right">
                    <span className="text-lg font-extrabold tabular-nums">
                      {displayMoney(
                        entry.baseMinor,
                        settings.primaryCurrency,
                        locale
                      )}
                    </span>
                    {entry.currency !== settings.primaryCurrency && (
                      <span className="mt-1 text-xs font-normal text-muted-foreground tabular-nums">
                        {entry.currency}{' '}
                        {displayMoney(
                          entry.originalMinor,
                          entry.currency,
                          locale
                        )}
                      </span>
                    )}
                  </span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-muted-foreground">
                  <time dateTime={entry.date}>{entry.date}</time>
                  <span>
                    ·{' '}
                    {categoryLabel(
                      entry.categoryName,
                      entry.categoryKey,
                      locale
                    )}
                  </span>
                  {entry.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="max-w-full break-words rounded-full bg-yellow/20 px-2 py-1"
                    >
                      {tag.name}
                    </span>
                  ))}
                </span>
                {entry.note && (
                  <span className="mt-2 block line-clamp-2 break-words text-sm leading-relaxed font-normal text-muted-foreground">
                    {entry.note}
                  </span>
                )}
              </span>
              <IconChevronRight
                aria-hidden
                size={17}
                className="hidden shrink-0 text-muted-foreground sm:block"
              />
            </Dialog.Trigger>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 pt-4">
        <p className="text-xs text-muted-foreground tabular-nums">
          {first}–{first + data.items.length - 1} / {data.total}{' '}
          {t('report_records')}
        </p>
        <div className="flex gap-2">
          <Button
            variant="icon"
            aria-label={t('query_previous')}
            disabled={page === 1}
            className="rounded-xl! border-foreground/15!"
            onClick={() => setPage((value) => value - 1)}
          >
            <IconChevronLeft aria-hidden size={18} />
          </Button>
          <Button
            variant="icon"
            aria-label={t('query_next')}
            disabled={page >= data.pageCount || page >= 5000}
            className="rounded-xl! border-foreground/15!"
            onClick={() => setPage((value) => value + 1)}
          >
            <IconChevronRight aria-hidden size={18} />
          </Button>
        </div>
      </div>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Popup className="fixed inset-x-3 top-1/2 z-50 max-h-[85dvh] -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border-2 border-foreground bg-surface p-5 text-foreground shadow-brutal sm:inset-x-auto sm:left-1/2 sm:w-[min(36rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="min-w-0 break-words text-xl font-extrabold">
              {selected?.name}
            </Dialog.Title>
            <Dialog.Close
              render={<Button variant="icon" />}
              aria-label={t('report_close_detail')}
              className="shrink-0 border-0!"
            >
              <IconX aria-hidden size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {t('report_entry_detail')}
          </Dialog.Description>
          {selected && (
            <>
              <p className="mt-6 break-words text-3xl font-extrabold tabular-nums">
                {displayMoney(
                  selected.baseMinor,
                  settings.primaryCurrency,
                  locale
                )}
              </p>
              {selected.currency !== settings.primaryCurrency && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {selected.currency}{' '}
                  {displayMoney(
                    selected.originalMinor,
                    selected.currency,
                    locale
                  )}
                </p>
              )}
              <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-4 text-sm">
                <dt className="text-muted-foreground">{t('entry_date')}</dt>
                <dd>
                  <time dateTime={selected.date}>{selected.date}</time>
                </dd>
                <dt className="text-muted-foreground">{t('entry_category')}</dt>
                <dd className="break-words">
                  {categoryLabel(
                    selected.categoryName,
                    selected.categoryKey,
                    locale
                  )}
                </dd>
                <dt className="text-muted-foreground">{t('entry_tags')}</dt>
                <dd className="flex flex-wrap gap-2">
                  {selected.tags.length
                    ? selected.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="max-w-full break-words rounded-full bg-yellow/25 px-2 py-1"
                        >
                          {tag.name}
                        </span>
                      ))
                    : t('report_untagged')}
                </dd>
                <dt className="text-muted-foreground">{t('entry_note')}</dt>
                <dd className="whitespace-pre-wrap break-words leading-relaxed">
                  {selected.note || '—'}
                </dd>
              </dl>
              <Link
                to="/"
                search={{
                  view: 'entries',
                  entry: selected.id,
                  filters: JSON.parse(payload),
                }}
                className={buttonVariants({
                  variant: 'plain',
                  className: 'mt-6 w-full border-foreground/15! text-sm',
                })}
              >
                {t('report_open_entry')}
                <IconArrowUpRight aria-hidden size={17} />
              </Link>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
