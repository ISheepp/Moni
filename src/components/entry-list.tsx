import {
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconSearch,
} from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { currencies } from '@/ledger/currencies';
import type { Entry } from '@/ledger/entries';
import {
  type EntryFilters,
  type EntryPage,
  entryFilters,
} from '@/ledger/entry-query';
import { displayMoney } from '@/ledger/money';
import type { LedgerSettings } from '@/ledger/settings';
import type { Taxonomy } from '@/ledger/taxonomy';
import { categoryLabel } from '@/lib/category-label';
import { type AppLocale, message } from '@/lib/locale';

export function EntryList({
  data,
  taxonomy,
  settings,
  locale,
  filters,
  onApply,
}: {
  data: EntryPage;
  taxonomy: Taxonomy;
  settings: LedgerSettings;
  locale: AppLocale;
  filters: EntryFilters;
  onApply: (value: EntryFilters) => void;
}) {
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const category = (entry: Entry) =>
    categoryLabel(entry.categoryName, entry.categoryKey, locale);
  const kind = (entry: Entry) =>
    t(
      entry.kind === 'income'
        ? 'entry_income'
        : entry.kind === 'refund'
          ? 'query_refund'
          : 'entry_expense'
    );
  const tags = (entry: Entry) =>
    entry.tags.map((tag) => (
      <span
        key={tag.id}
        className="max-w-full break-words rounded-full bg-yellow/25 px-3 py-1 text-sm"
      >
        {tag.name}
      </span>
    ));
  const active = Boolean(
    filters.from ||
      filters.to ||
      filters.kind ||
      filters.currency ||
      filters.categoryId ||
      filters.tagIds?.length ||
      filters.requiredTagIds?.length ||
      filters.untagged ||
      filters.keyword
  );
  return (
    <>
      <EntryFilterForm
        key={JSON.stringify(filters)}
        filters={filters}
        taxonomy={taxonomy}
        locale={locale}
        onApply={onApply}
      />
      <output className="my-5 block text-sm text-muted-foreground">
        {t('query_matches')} {data.total}
      </output>
      {!data.items.length ? (
        <div className="py-8 text-center">
          <img
            alt=""
            src="/moni/illustrations/assistant-search.png"
            className="mx-auto w-40"
          />
          <h2 className="mt-3 text-xl font-bold">
            {t(active || data.total > 0 ? 'query_empty' : 'app_empty_ledger')}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t(
              active || data.total > 0
                ? 'query_empty_hint'
                : 'app_empty_description'
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-foreground/30 bg-surface md:block">
            <table className="w-full table-fixed text-left">
              <caption className="sr-only">{t('app_entries')}</caption>
              <thead className="border-b border-muted text-sm text-muted-foreground">
                <tr>
                  <th className="w-28 p-4">{t('entry_date')}</th>
                  <th className="w-[27%] p-4">{t('entry_name')}</th>
                  <th className="p-4">{t('query_type')}</th>
                  <th className="p-4">{t('entry_category')}</th>
                  <th className="p-4">{t('entry_tags')}</th>
                  <th className="w-32 p-4 text-right">
                    {t('entry_amount')} ({t('query_currency')})
                  </th>
                  <th className="w-32 p-4 text-right">
                    {t('query_equivalent')} ({settings.primaryCurrency})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-muted">
                {data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className="p-4 align-top text-sm">{entry.date}</td>
                    <td className="min-w-0 p-4 align-top">
                      <Link
                        to="/"
                        search={{ view: 'entries', entry: entry.id, filters }}
                        className="block min-h-11 rounded-lg focus-visible:outline-4 focus-visible:outline-focus"
                      >
                        <h2 className="break-words font-bold">{entry.name}</h2>
                        {entry.note && (
                          <p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">
                            {entry.note}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="break-words p-4 align-top text-sm">
                      {kind(entry)}
                    </td>
                    <td className="break-words p-4 align-top text-sm">
                      {category(entry)}
                    </td>
                    <td className="p-4 align-top">
                      <div className="flex flex-wrap gap-2">{tags(entry)}</div>
                    </td>
                    <td className="p-4 text-right align-top font-extrabold tabular-nums">
                      <span className="break-words">
                        {displayMoney(
                          entry.originalMinor,
                          entry.currency,
                          locale
                        )}
                      </span>
                    </td>{' '}
                    <td className="break-words p-4 text-right align-top font-extrabold tabular-nums">
                      {displayMoney(
                        entry.baseMinor,
                        settings.primaryCurrency,
                        locale
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-muted rounded-2xl border border-foreground/30 bg-surface px-4 md:hidden">
            {data.items.map((entry) => (
              <li key={entry.id}>
                <Link
                  to="/"
                  search={{ view: 'entries', entry: entry.id, filters }}
                  className="block rounded-lg py-5 focus-visible:outline-4 focus-visible:outline-focus"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words text-lg font-bold">
                        {entry.name}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {entry.date} · {category(entry)}
                      </p>
                    </div>
                    <div className="ml-auto max-w-full text-right">
                      <span className="text-sm text-muted-foreground">
                        {kind(entry)}
                      </span>
                      <p className="break-words font-extrabold tabular-nums">
                        {displayMoney(
                          entry.originalMinor,
                          entry.currency,
                          locale
                        )}
                      </p>
                      {entry.currency !== settings.primaryCurrency && (
                        <p className="text-sm text-muted-foreground">
                          {t('query_equivalent')}{' '}
                          {displayMoney(
                            entry.baseMinor,
                            settings.primaryCurrency,
                            locale
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  {entry.note && (
                    <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {entry.note}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">{tags(entry)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <section
        aria-label={t('query_totals')}
        className="mt-5 rounded-2xl border border-foreground/30 bg-surface p-4 md:p-6"
      >
        <h2 className="font-extrabold">
          {t('query_totals')} · {data.primaryCurrency}
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          {(['income', 'expense', 'refund', 'netExpense'] as const).map(
            (key) => (
              <div key={key}>
                <dt className="text-sm text-muted-foreground">
                  {t(
                    key === 'income'
                      ? 'entry_income'
                      : key === 'expense'
                        ? 'entry_expense'
                        : key === 'refund'
                          ? 'query_refund'
                          : 'query_net_expense'
                  )}
                </dt>
                <dd className="mt-2 break-words text-lg font-extrabold tabular-nums">
                  {displayMoney(data.totals[key], data.primaryCurrency, locale)}
                </dd>
              </div>
            )
          )}
        </dl>
        {filters.currency && data.originalTotals && (
          <div className="mt-5 border-t border-muted pt-4">
            <h3 className="font-bold">
              {t('query_original_totals')} · {filters.currency}
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
              {(['income', 'expense', 'refund', 'netExpense'] as const).map(
                (key) => (
                  <div key={key}>
                    <dt className="text-sm text-muted-foreground">
                      {t(
                        key === 'income'
                          ? 'entry_income'
                          : key === 'expense'
                            ? 'entry_expense'
                            : key === 'refund'
                              ? 'query_refund'
                              : 'query_net_expense'
                      )}
                    </dt>
                    <dd className="mt-1 break-words font-extrabold tabular-nums">
                      {displayMoney(
                        data.originalTotals?.[key] ?? 0,
                        filters.currency as NonNullable<
                          EntryFilters['currency']
                        >,
                        locale
                      )}
                    </dd>
                  </div>
                )
              )}
            </dl>
          </div>
        )}
      </section>
      {data.pageCount > 1 || filters.page > 1 ? (
        <nav
          aria-label={t('query_pagination')}
          className="mt-6 flex flex-wrap items-center justify-center gap-4"
        >
          <Button
            variant="plain"
            disabled={filters.page <= 1}
            onClick={() => onApply({ ...filters, page: filters.page - 1 })}
          >
            <IconChevronLeft size={20} aria-hidden />
            {t('query_previous')}
          </Button>
          <span className="tabular-nums">
            {filters.page} / {Math.max(1, data.pageCount)}
          </span>
          <Button
            variant="plain"
            disabled={filters.page >= data.pageCount}
            onClick={() => onApply({ ...filters, page: filters.page + 1 })}
          >
            {t('query_next')}
            <IconChevronRight size={20} aria-hidden />
          </Button>
        </nav>
      ) : null}
    </>
  );
}

export function EntryFilterForm({
  filters,
  taxonomy,
  locale,
  onApply,
}: {
  filters: EntryFilters;
  taxonomy: Taxonomy;
  locale: AppLocale;
  onApply: (value: EntryFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [expanded, setExpanded] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const summary = [
    filters.kind
      ? t(
          filters.kind === 'income'
            ? 'entry_income'
            : filters.kind === 'spending'
              ? 'query_spending'
              : filters.kind === 'expense'
                ? 'entry_expense'
                : 'query_refund'
        )
      : '',
    filters.categoryId
      ? categoryLabel(
          taxonomy.categories.find((item) => item.id === filters.categoryId)
            ?.name ?? t('query_unknown_filter'),
          taxonomy.categories.find((item) => item.id === filters.categoryId)
            ?.defaultKey ?? null,
          locale
        )
      : '',
    filters.currency,
    filters.untagged ? t('report_untagged') : '',
    ...(filters.requiredTagIds ?? []).map(
      (id) =>
        taxonomy.tags.find((tag) => tag.id === id)?.name ??
        t('query_unknown_filter')
    ),
    ...(filters.tagIds ?? []).map(
      (id) =>
        taxonomy.tags.find((tag) => tag.id === id)?.name ??
        t('query_unknown_filter')
    ),
  ].filter(Boolean);
  return (
    <form
      aria-label={t('query_filters')}
      className="mb-6"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = entryFilters.safeParse({ ...draft, page: 1 });
        setInvalid(!parsed.success);
        if (parsed.success) onApply(parsed.data);
      }}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[2fr_1fr_1fr]">
        <label className="col-span-2 block min-w-0 font-bold lg:col-span-1">
          <span className="mb-2 flex items-center gap-2">
            <IconSearch size={20} aria-hidden />
            {t('query_keyword')}
          </span>
          <input
            type="search"
            value={draft.keyword ?? ''}
            onChange={(event) =>
              setDraft({ ...draft, keyword: event.target.value || undefined })
            }
            className="moni-field"
          />
        </label>
        <label className="block min-w-0 font-bold">
          {t('query_from')}
          <input
            type="date"
            value={draft.from ?? ''}
            onChange={(event) =>
              setDraft({ ...draft, from: event.target.value || undefined })
            }
            className="moni-field mt-2"
          />
        </label>
        <label className="block min-w-0 font-bold">
          {t('query_to')}
          <input
            type="date"
            value={draft.to ?? ''}
            onChange={(event) =>
              setDraft({ ...draft, to: event.target.value || undefined })
            }
            className="moni-field mt-2"
          />
        </label>
      </div>
      <Button
        type="button"
        variant="plain"
        className="mt-3 md:hidden"
        aria-expanded={expanded}
        aria-controls="entry-more-filters"
        onClick={() => setExpanded(!expanded)}
      >
        <IconFilter size={20} aria-hidden />
        {t('query_more')}
      </Button>
      <div
        id="entry-more-filters"
        className={`${expanded ? 'grid' : 'hidden md:grid'} mt-3 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}
      >
        <label className="min-w-0 font-bold">
          {t('query_type')}
          <select
            className="moni-field mt-2"
            aria-label={t('query_type')}
            value={draft.kind ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                kind: (event.target.value as EntryFilters['kind']) || undefined,
                categoryId: undefined,
              })
            }
          >
            <option value="">{t('query_all')}</option>
            <option value="spending">{t('query_spending')}</option>
            <option value="expense">{t('entry_expense')}</option>
            <option value="income">{t('entry_income')}</option>
            <option value="refund">{t('query_refund')}</option>
          </select>
        </label>
        <label className="min-w-0 font-bold">
          {t('entry_category')}
          <select
            className="moni-field mt-2"
            aria-label={t('entry_category')}
            value={draft.categoryId ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                categoryId: event.target.value || undefined,
              })
            }
          >
            <option value="">{t('query_all')}</option>
            {(['expense', 'income'] as const)
              .filter(
                (kind) =>
                  !draft.kind ||
                  kind === (draft.kind === 'income' ? 'income' : 'expense')
              )
              .map((kind) => (
                <optgroup
                  key={kind}
                  label={t(
                    kind === 'income' ? 'entry_income' : 'entry_expense'
                  )}
                >
                  {taxonomy.categories
                    .filter((item) => item.kind === kind)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {categoryLabel(item.name, item.defaultKey, locale)}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </label>
        <label className="min-w-0 font-bold">
          {t('query_currency')}
          <select
            className="moni-field mt-2"
            aria-label={t('query_currency')}
            value={draft.currency ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                currency:
                  (event.target.value as EntryFilters['currency']) || undefined,
              })
            }
          >
            <option value="">{t('query_all')}</option>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <details className="min-w-0 self-end">
          <summary className="moni-field cursor-pointer font-bold">
            {t('query_tags_any')} ({draft.tagIds?.length ?? 0})
          </summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-muted bg-surface p-3">
            {taxonomy.tags.length ? (
              taxonomy.tags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3"
                >
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-orange"
                    checked={draft.tagIds?.includes(tag.id) ?? false}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tagIds: event.target.checked
                          ? [...(draft.tagIds ?? []), tag.id]
                          : draft.tagIds?.filter((id) => id !== tag.id),
                      })
                    }
                  />
                  <span className="break-words">{tag.name}</span>
                </label>
              ))
            ) : (
              <p className="text-sm">{t('query_no_tags')}</p>
            )}
          </div>
        </details>
      </div>
      {summary.length > 0 && (
        <p className="mt-3 break-words text-sm text-muted-foreground">
          {t('query_active')} {summary.join(' · ')}
        </p>
      )}
      {invalid && (
        <p role="alert" className="mt-3 font-bold">
          {t('query_invalid')}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit">{t('query_apply')}</Button>
        <Button
          type="button"
          variant="plain"
          onClick={() => {
            setDraft(entryFilters.parse({}));
            setInvalid(false);
            onApply(entryFilters.parse({}));
          }}
        >
          {t('query_clear')}
        </Button>
      </div>
    </form>
  );
}
