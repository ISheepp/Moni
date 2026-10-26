import type { LedgerQueryResult } from '../ledger/chat-query-contract';
import type { Currency } from '../ledger/currencies';
import type { EntryTotals } from '../ledger/entry-query';
import { displayMoney } from '../ledger/money';
import { averageMinor } from '../ledger/report-comparison';
import { categoryLabel } from './category-label';
import { type AppLocale, message } from './locale';

export function markdownText(value: string) {
  return value.replace(/[\\`*_[\]{}<>#+.!|()~-]/g, '\\$&');
}

export function wechatStatistics(result: LedgerQueryResult, locale: AppLocale) {
  const t = (key: Parameters<typeof message>[0]) => message(key, locale);
  const literal = (value: string) =>
    markdownText(value.replace(/\r\n?|\n/g, ' '));
  const colon = locale === 'zh' ? '：' : ': ';
  const { query, report, criteria } = result;
  const title = t(
    query.view === 'entries'
      ? 'nl_query_entries'
      : query.view === 'categories'
        ? 'nl_query_categories'
        : query.view === 'tags'
          ? 'nl_query_tags'
          : query.view === 'trend'
            ? 'nl_query_trend'
            : 'nl_query_title'
  );
  const range =
    query.period.kind === 'all_time'
      ? t('wechat_report_all_time')
      : `${report.filters.from} — ${report.filters.to}`;
  const labels = [
    t(
      query.scope === 'income'
        ? 'entry_income'
        : query.scope === 'all'
          ? 'query_all'
          : 'query_spending'
    ),
    criteria.category
      ? categoryLabel(
          criteria.category.name,
          criteria.category.defaultKey,
          locale
        )
      : '',
    report.filters.tagIds?.length
      ? `${t('nl_query_any_tags')}${colon}${report.filters.tagIds.map((id) => criteria.tags.find((tag) => tag.id === id)?.name ?? t('query_unknown_filter')).join(' · ')}`
      : '',
    report.filters.requiredTagIds?.length
      ? `${t('nl_query_required_tags')}${colon}${report.filters.requiredTagIds.map((id) => criteria.tags.find((tag) => tag.id === id)?.name ?? t('query_unknown_filter')).join(' · ')}`
      : '',
    report.filters.untagged ? t('report_untagged') : '',
    report.filters.keyword
      ? `${t('nl_query_keyword')}${colon}“${report.filters.keyword}”`
      : '',
    report.filters.currency
      ? `${t('query_currency')}${colon}${report.filters.currency}`
      : '',
  ].filter(Boolean);
  const metrics =
    query.scope === 'income'
      ? ([{ key: 'income', label: 'entry_income' }] as const)
      : ([
          ...(query.scope === 'all'
            ? ([{ key: 'income', label: 'entry_income' }] as const)
            : []),
          { key: 'expense', label: 'entry_expense' },
          { key: 'refund', label: 'query_refund' },
          { key: 'netExpense', label: 'query_net_expense' },
        ] as const);
  const mainKey = query.scope === 'income' ? 'income' : 'netExpense';
  const amounts = (
    totals: EntryTotals,
    currency: Currency,
    includeMain = false
  ) =>
    metrics
      .filter(({ key }) => includeMain || key !== mainKey)
      .map(
        ({ key, label }) =>
          `${t(label)}${colon}**${displayMoney(totals[key], currency, locale)}**`
      );
  const mainLabel =
    query.scope === 'income' ? 'entry_income' : 'query_net_expense';
  const header = `📊 **${title}**\n\n📅 ${range}\n${literal(labels.join(' · '))}\n${report.timeZone} · ${t('app_currency')} ${report.primaryCurrency}`;
  const footer = [
    t('report_basis'),
    report.totals.refund ? t('report_refund_date') : '',
    query.view === 'tags' ? t('report_tags_overlap') : '',
    `${t('nl_query_as_of')} ${new Intl.DateTimeFormat(locale, { timeZone: report.timeZone, dateStyle: 'short', timeStyle: 'short' }).format(result.asOf)}`,
  ]
    .filter(Boolean)
    .join('\n');
  if (!report.total && !report.comparison?.previous.total)
    return `${header}\n\n${t('nl_query_no_matches')}\n\n${footer}`.length <=
      2300
      ? `${header}\n\n${t('nl_query_no_matches')}\n\n${footer}`
      : `📊 **${title}**\n\n${t('wechat_report_web_required')}`;
  let body = `${header}\n\n**${t(mainLabel)}${colon}${displayMoney(report.totals[mainKey], report.primaryCurrency, locale)}**\n\n${amounts(
    report.totals,
    report.primaryCurrency
  )
    .map((line) => `- ${line}`)
    .join('\n')}\n- ${t('nl_query_matching')}${colon}${report.total}`;
  const kind = query.scope === 'income' ? 'income' : 'expense';
  const money = (value: number) =>
    displayMoney(value, report.primaryCurrency, locale);
  const average = averageMinor(report.totals[kind], report.counts[kind]);
  const difference = (
    current: number,
    previous: number,
    format: (value: number) => string
  ) => {
    const delta = current - previous;
    if (!delta) return t('report_unchanged');
    if (!previous && current > 0)
      return `${t('report_new')} ${format(current)}`;
    return `${delta > 0 ? '+' : ''}${format(delta)}${previous > 0 ? ` (${new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(delta / previous)})` : ''}`;
  };
  body += `\n- ${t(kind === 'income' ? 'report_income_count' : 'report_expense_count')}${colon}${report.counts[kind]} ${t('report_records')}\n- ${t('report_average')}${colon}**${average === null ? '—' : money(average)}**`;
  if (!report.total) body += `\n${t('nl_query_no_matches')}`;
  if (report.comparison) {
    const previous = report.comparison.previous;
    const priorAverage = averageMinor(
      previous.totals[kind],
      previous.counts[kind]
    );
    body += `\n\n**${t('report_previous_period')} · ${report.comparison.filters.from} — ${report.comparison.filters.to}**\n${t(kind === 'income' ? 'entry_income' : 'entry_expense')}${colon}${money(previous.totals[kind])} → ${money(report.totals[kind])} · ${difference(report.totals[kind], previous.totals[kind], money)}\n${t(kind === 'income' ? 'report_income_count' : 'report_expense_count')}${colon}${previous.counts[kind]} → ${report.counts[kind]}\n${t('report_average_short')}${colon}${priorAverage === null ? '—' : money(priorAverage)} → ${average === null ? '—' : money(average)}`;
    if (query.view !== 'entries' && query.view !== 'trend') {
      for (const direction of ['increase', 'decrease'] as const) {
        const changes = report.comparison.groups
          .filter((row) =>
            direction === 'increase'
              ? row.totals[kind] > row.previous.totals[kind]
              : row.totals[kind] < row.previous.totals[kind]
          )
          .sort((a, b) => {
            const delta =
              a.totals[kind] -
              a.previous.totals[kind] -
              b.totals[kind] +
              b.previous.totals[kind];
            return (
              (direction === 'increase' ? -delta : delta) ||
              (a.id ?? '').localeCompare(b.id ?? '', 'en')
            );
          })
          .slice(0, 3);
        if (changes.length) {
          const block = `\n\n**${t(direction === 'increase' ? 'report_increases' : 'report_decreases')}**\n${changes.map((row, index) => `${index + 1}. ${literal(row.name === null ? t('report_untagged') : categoryLabel(row.name, row.categoryKey, locale))} · ${difference(row.totals[kind], row.previous.totals[kind], money)}`).join('\n')}`;
          if (`${body}${block}\n\n${footer}`.length <= 1900) body += block;
        }
      }
    }
  }
  if (report.originalTotals && report.filters.currency)
    body += `\n\n**${t('query_original_totals')} · ${report.filters.currency}**\n${amounts(
      report.originalTotals,
      report.filters.currency,
      true
    )
      .map((line) => `- ${line}`)
      .join('\n')}`;
  if (`${body}\n\n${footer}`.length > 2100)
    return `📊 **${title}**\n\n${t('wechat_report_web_required')}`;
  const rows =
    query.view === 'summary'
      ? report.groups.slice(0, 5).map((row) => ({
          ...row,
          label: categoryLabel(
            row.name ?? t('query_unknown_filter'),
            row.categoryKey,
            locale
          ),
        }))
      : query.view === 'trend'
        ? report.trend.map((row) => ({
            ...row,
            label: row.from === row.to ? row.from : `${row.from} — ${row.to}`,
          }))
        : report.groups.map((row) => ({
            ...row,
            label:
              query.view === 'tags'
                ? (row.name ?? t('report_untagged'))
                : categoryLabel(
                    row.name ?? t('query_unknown_filter'),
                    row.categoryKey,
                    locale
                  ),
          }));
  if (query.view === 'entries' && result.entries) {
    const { entries } = result;
    if (entries.pageCount > 1)
      body += `\n\n${t('nl_query_page')} ${entries.page} / ${entries.pageCount}`;
    if (entries.items.length > 5) {
      const rowBudget = Math.floor(
        (2300 -
          body.length -
          footer.length -
          t('nl_query_details_compact').length -
          t('nl_query_next_hint').length -
          40) /
          entries.items.length
      );
      let shown = 0;
      for (const entry of entries.items) {
        const name = Array.from(entry.name)
          .slice(0, Math.max(8, Math.min(30, Math.floor((rowBudget - 48) / 2))))
          .join('');
        let block = `\n\n**${entry.date} · ${literal(name)}${name !== entry.name ? '…' : ''} · ${displayMoney(entry.originalMinor, entry.currency, locale)}**`;
        if (entry.currency !== report.primaryCurrency)
          block += `\n${t('query_equivalent')}${colon}${money(entry.baseMinor)}`;
        const note = entry.note
          ? Array.from(entry.note).slice(0, 24).join('')
          : '';
        if (note && block.length + literal(note).length + 8 <= rowBudget)
          block += `\n${t('entry_note')}${colon}${literal(note)}${note !== entry.note || entry.noteTruncated ? '…' : ''}`;
        if (
          `${body}${block}\n\n${footer}\n\n${t('nl_query_entries_partial')}\n${t('nl_query_details_compact')}\n${t('nl_query_next_hint')}`
            .length > 2300
        )
          break;
        body += block;
        shown++;
      }
      body += `\n\n${t('nl_query_details_compact')}`;
      if (shown < entries.items.length)
        body += `\n${t('nl_query_entries_partial')}`;
      else if (entries.page < entries.pageCount)
        body += `\n${t('nl_query_next_hint')}`;
      return `${body}\n\n---\n\n${footer}`;
    }
    let shown = 0;
    for (const entry of entries.items) {
      const kind = t(
        entry.kind === 'income'
          ? 'entry_income'
          : entry.kind === 'refund'
            ? 'query_refund'
            : 'entry_expense'
      );
      const note = entry.note
        ? `\n${t('entry_note')}${colon}${literal(entry.note)}${entry.noteTruncated ? ` · ${t('nl_query_note_excerpt')}` : ''}`
        : '';
      const block = `\n\n**${literal(entry.name)} · ${displayMoney(entry.originalMinor, entry.currency, locale)}**\n${entry.date} · ${kind} · ${literal(categoryLabel(entry.categoryName, entry.categoryKey, locale))}${entry.currency !== report.primaryCurrency ? `\n${t('query_equivalent')}${colon}${displayMoney(entry.baseMinor, report.primaryCurrency, locale)}` : ''}${entry.tags.length ? `\n${t('entry_tags')}${colon}${literal(entry.tags.join(' · '))}` : ''}${note}`;
      if (
        `${body}${block}\n\n${footer}\n\n${t('nl_query_entries_partial')}`
          .length > 2300
      )
        break;
      body += block;
      shown++;
    }
    if (shown < entries.items.length)
      body += `\n\n${t('nl_query_entries_partial')}`;
    else if (entries.page < entries.pageCount)
      body += `\n\n${t('nl_query_next_hint')}`;
    return `${body}\n\n---\n\n${footer}`;
  }
  const visible =
    query.view === 'trend' ? rows.slice(-12).reverse() : rows.slice(0, 12);
  const blocks: string[] = [];
  for (const row of visible) {
    const block = `\n\n**${query.view === 'trend' ? row.label : literal(row.label)} · ${displayMoney(row.totals[mainKey], report.primaryCurrency, locale)}**\n${amounts(row.totals, report.primaryCurrency).join(' · ')}\n${t('nl_query_matching')}${colon}${row.total}`;
    if (
      `${body}${blocks.join('')}${block}\n\n${footer}\n\n${t('wechat_report_partial')}`
        .length > 2300
    )
      break;
    blocks.push(block);
  }
  if (query.view === 'trend') blocks.reverse();
  body += blocks.join('');
  if (blocks.length < rows.length) body += `\n\n${t('wechat_report_partial')}`;
  return `${body}\n\n---\n\n${footer}`;
}
