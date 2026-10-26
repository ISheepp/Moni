import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { resolveDatePeriod, trendEnd } from '../../src/ledger/dates';
import type { EntryPage } from '../../src/ledger/entry-query';
import type { Report } from '../../src/ledger/reports';

let signingKey: CryptoKey;
let datasetId: string;
beforeAll(async () => {
  const keys = await generateKeyPair('RS256', { extractable: true });
  signingKey = keys.privateKey;
  const publicKey = await exportJWK(keys.publicKey);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    if (
      String(input instanceof Request ? input.url : input) ===
      `${env.ACCESS_ISSUER}/cdn-cgi/access/certs`
    )
      return Response.json({
        keys: [{ ...publicKey, kid: 'reports-fixture', alg: 'RS256' }],
      });
    throw new Error('External services disabled in reports tests');
  });
});
afterAll(() => vi.unstubAllGlobals());
async function api(path: string, body?: unknown, method = 'POST') {
  const token = await new SignJWT({
    type: 'app',
    email: 'synthetic@example.invalid',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'reports-fixture' })
    .setIssuer(env.ACCESS_ISSUER)
    .setAudience(env.ACCESS_AUDIENCE)
    .setSubject(env.OWNER_SUBJECT)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(signingKey);
  return SELF.fetch(`https://moni.test/api/${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const command = () => ({ datasetId, operationId: crypto.randomUUID() });
beforeEach(async () => {
  datasetId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO datasets(id) VALUES (?)').bind(datasetId),
    env.DB.prepare(
      "INSERT INTO categories(dataset_id,id,kind,name,default_key) SELECT ?,id,kind,name,default_key FROM categories WHERE dataset_id = 'initial'"
    ).bind(datasetId),
    env.DB.prepare(
      'UPDATE moni_state SET active_dataset = ? WHERE singleton = 1'
    ).bind(datasetId),
  ]);
  expect(
    (
      await api('initialize', {
        ...command(),
        primaryCurrency: 'CNY',
        timeZone: 'Asia/Shanghai',
      })
    ).status
  ).toBe(200);
});
async function create(fields: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const response = await api('entries', {
    ...command(),
    id,
    kind: 'expense',
    name: 'Synthetic report entry',
    amount: '100',
    date: '2024-03-10',
    tags: ['Delivery', 'Lunch'],
    categoryId: 'expense-food',
    ...fields,
  });
  expect(response.status).toBe(200);
  return id;
}
async function refund(id: string, fields: Record<string, unknown> = {}) {
  const refundId = crypto.randomUUID();
  expect(
    (
      await api('refunds', {
        ...command(),
        id: refundId,
        expenseId: id,
        expenseVersion: 1,
        amount: '30',
        date: '2024-04-02',
        confirmedBaseMinor: 3000,
        ...fields,
      })
    ).status
  ).toBe(200);
  return refundId;
}
const range = { from: '2024-03-01', to: '2024-04-30' };
async function report(extra: Record<string, unknown> = {}) {
  const response = await api('reports/query', { filters: range, ...extra });
  expect(response.status).toBe(200);
  return response.json<Report>();
}
const entries = async (filters: unknown) =>
  (await api('entries/query', filters)).json<EntryPage>();

describe('protected shared financial reports', () => {
  it('compares equal weekly progress, retains disappeared and new groups, and preserves fixed currency/refund rules', async () => {
    for (const [amount, date] of [
      ['60', '2026-10-20'],
      ['40', '2026-10-21'],
      ['30', '2026-10-13'],
      ['20', '2026-10-14'],
    ])
      await create({ amount, date, tags: ['Delivery', 'Shared'] });
    await create({
      amount: '10',
      date: '2026-10-20',
      currency: 'USD',
      conversion: { rate: '7.00' },
      confirmedBaseMinor: 7000,
      categoryId: 'expense-other',
      tags: ['Promotion', 'Shared'],
    });
    await create({
      amount: '10',
      date: '2026-10-13',
      currency: 'USD',
      conversion: { rate: '8.00' },
      confirmedBaseMinor: 8000,
      categoryId: 'expense-other',
      tags: ['Retired'],
    });
    await create({
      amount: '25',
      date: '2026-10-21',
      categoryId: 'expense-sports',
      tags: ['New'],
    });
    await create({
      amount: '90',
      date: '2026-10-14',
      categoryId: 'expense-clothing',
      tags: ['Old'],
    });
    const original = await create({
      amount: '500',
      date: '2026-09-20',
      categoryId: 'expense-home',
      tags: [],
    });
    await refund(original, {
      amount: '10',
      date: '2026-10-22',
      confirmedBaseMinor: 1000,
    });
    await refund(original, {
      amount: '20',
      date: '2026-10-15',
      confirmedBaseMinor: 2000,
    });
    await create({
      amount: '2000',
      date: '2026-10-20',
      kind: 'income',
      categoryId: 'income-salary',
      tags: [],
    });
    await create({
      amount: '1000',
      date: '2026-10-13',
      kind: 'income',
      categoryId: 'income-salary',
      tags: [],
    });
    const deleted = await create({ amount: '999', date: '2026-10-13' });
    expect(
      (
        await api('entries/delete', {
          ...command(),
          id: deleted,
          version: 1,
          confirmed: true,
        })
      ).status
    ).toBe(200);
    const query = {
      filters: { from: '2026-10-01', to: '2026-10-31' },
      selection: { from: '2026-10-19', to: '2026-10-25' },
      interval: 'week',
      compare: true,
    };
    const data = await report(query);
    expect(data.totals).toEqual({
      income: 200000,
      expense: 19500,
      refund: 1000,
      netExpense: 18500,
    });
    expect(data.comparison?.filters).toMatchObject({
      from: '2026-10-12',
      to: '2026-10-18',
    });
    expect(data.comparison?.previous.totals).toEqual({
      income: 100000,
      expense: 22000,
      refund: 2000,
      netExpense: 20000,
    });
    expect(data.comparison?.previous.counts.expense).toBe(4);
    const changed = data.comparison?.groups ?? [];
    expect(changed.find((g) => g.id === 'expense-food')).toMatchObject({
      counts: { expense: 2 },
      totals: { expense: 10000 },
      previous: { counts: { expense: 2 }, totals: { expense: 5000 } },
    });
    expect(changed.find((g) => g.id === 'expense-sports')?.previous.total).toBe(
      0
    );
    expect(changed.find((g) => g.id === 'expense-clothing')).toMatchObject({
      total: 0,
      previous: { totals: { expense: 9000 } },
    });
    for (const group of changed) {
      expect((await entries(group.filters)).totals).toEqual(group.totals);
      expect(
        (
          await entries({
            ...group.filters,
            from: data.comparison?.filters.from,
            to: data.comparison?.filters.to,
          })
        ).totals
      ).toEqual(group.previous.totals);
    }
    const usd = await report({
      ...query,
      filters: { ...query.filters, currency: 'USD' },
    });
    expect(usd.originalTotals?.expense).toBe(1000);
    expect(usd.comparison?.previous.originalTotals?.expense).toBe(1000);
    expect([
      usd.totals.expense,
      usd.comparison?.previous.totals.expense,
    ]).toEqual([7000, 8000]);
    const tags = await report({ ...query, groupBy: 'tag' });
    expect(tags.totals).toEqual(data.totals);
    const shared = tags.comparison?.groups.find((g) => g.name === 'Shared');
    expect(shared).toMatchObject({
      totals: { expense: 17000 },
      previous: { totals: { expense: 5000 } },
    });
    if (!shared?.id) throw new Error('Missing shared fixture tag');
    const narrowed = await report({
      ...query,
      filters: { ...query.filters, requiredTagIds: [shared.id] },
      groupBy: 'tag',
    });
    expect([
      narrowed.totals.expense,
      narrowed.comparison?.previous.totals.expense,
    ]).toEqual([17000, 5000]);
    expect(
      (await report({ ...query, compare: undefined })).comparison
    ).toBeUndefined();
    const partial = await report({
      ...query,
      selection: { from: '2026-10-19', to: '2026-10-20' },
    });
    expect(partial.comparison?.filters).toMatchObject({
      from: '2026-10-12',
      to: '2026-10-13',
    });
    const first = await report({
      filters: {},
      period: { kind: 'month', month: '1900-01' },
      compare: true,
    });
    expect(first.comparison).toBeNull();
  });

  it('returns real zero-record comparisons without losing prior-only spending and rejects unsupported comparison input', async () => {
    await create({ date: '2024-02-29', amount: '25' });
    const data = await report({
      filters: {},
      period: { kind: 'month', month: '2024-03' },
      compare: true,
    });
    expect(data.comparison?.filters).toMatchObject({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(data.counts.expense).toBe(0);
    expect(data.comparison?.previous.counts.expense).toBe(1);
    expect(data.comparison?.groups[0]).toMatchObject({
      total: 0,
      previous: { totals: { expense: 2500 } },
    });
    const empty = await report({
      filters: {},
      period: { kind: 'month', month: '2024-01' },
      compare: true,
    });
    expect(empty.comparison?.previous.total).toBe(0);
    expect(empty.comparison?.groups).toEqual([]);
    expect((await api('reports/query', { compare: 'yes' })).status).toBe(400);
  });

  it('ranks the selected chart period by confirmed primary amounts with stable pages, notes, tags and exports', async () => {
    const small = await create({
      name: 'Small synthetic meal',
      amount: '100',
      date: '2024-03-05',
      tags: ['Meals', 'Shared'],
    });
    const foreign = await create({
      name: 'Foreign synthetic campaign',
      amount: '20',
      currency: 'USD',
      conversion: { rate: '7.20' },
      confirmedBaseMinor: 14400,
      date: '2024-03-06',
      categoryId: 'expense-other',
      tags: ['Promotion', 'Shared'],
      note: 'Synthetic campaign details',
    });
    const tied = await create({
      name: 'Synthetic groceries',
      amount: '144',
      date: '2024-03-06',
      tags: ['Meals', 'Shared'],
    });
    await create({
      name: 'Outside selected week',
      amount: '200',
      date: '2024-03-12',
    });
    await create({
      kind: 'income',
      amount: '5000',
      categoryId: 'income-salary',
      date: '2024-03-06',
      tags: [],
    });
    const deleted = await create({ amount: '999', date: '2024-03-06' });
    expect(
      (
        await api('entries/delete', {
          ...command(),
          id: deleted,
          version: 1,
          confirmed: true,
        })
      ).status
    ).toBe(200);
    const selection = { from: '2024-03-04', to: '2024-03-10' };
    const data = await report({ selection });
    expect(data.range).toEqual(range);
    expect(data.filters).toMatchObject(selection);
    expect(data.totals.expense).toBe(38800);
    expect(
      data.groups
        .filter((g) => g.counts.expense)
        .map((g) => [g.name, g.totals.expense])
    ).toEqual([
      ['饮食', 24400],
      ['其他', 14400],
    ]);
    expect(
      data.trend.some(
        (bucket) =>
          bucket.from === '2024-03-11' && bucket.totals.expense === 20000
      )
    ).toBe(true);
    const filters = {
      ...data.filters,
      kind: 'expense',
      sort: 'amount_desc',
      pageSize: 2,
    };
    const first = await entries(filters);
    const second = await entries({ ...filters, page: 2 });
    const expected = [...[foreign, tied].sort().reverse(), small];
    expect([...first.items, ...second.items].map((e) => e.id)).toEqual(
      expected
    );
    expect([first.total, first.pageCount, first.totals.expense]).toEqual([
      3, 2, 38800,
    ]);
    expect(first.items.find((e) => e.id === foreign)).toMatchObject({
      originalMinor: 2000,
      baseMinor: 14400,
      note: 'Synthetic campaign details',
    });
    const csvResponse = await api('exports/csv', { datasetId, filters });
    expect(csvResponse.status).toBe(200);
    expect(
      (await csvResponse.text())
        .trim()
        .split('\r\n')
        .slice(1)
        .map((line) => line.split(',')[0])
    ).toEqual(expected.map((id) => `"${id}"`));
    const tags = await report({ selection, groupBy: 'tag' });
    expect(
      tags.groups
        .filter((g) => g.counts.expense)
        .map((g) => [g.name, g.totals.expense])
    ).toEqual([
      ['Shared', 38800],
      ['Meals', 24400],
      ['Promotion', 14400],
    ]);
    for (const group of [...data.groups, ...tags.groups]) {
      const detail = await entries({ ...group.filters, sort: 'amount_desc' });
      expect(detail.totals).toEqual(group.totals);
      expect(
        detail.items.every(
          (e) => e.date >= selection.from && e.date <= selection.to
        )
      ).toBe(true);
    }
    expect((await entries({ kind: 'expense' })).items[0].name).toBe(
      'Outside selected week'
    );
  });

  it('keeps refund-only selections and day/month drilldowns independent from the full trend', async () => {
    const id = await create();
    await refund(id);
    for (const interval of ['day', 'week', 'month']) {
      const full = await report({ interval });
      const bucket = full.trend.find((b) => b.totals.refund > 0);
      if (!bucket) throw new Error('Missing refund bucket');
      const selected = await report({
        interval,
        selection: { from: bucket.from, to: bucket.to },
      });
      expect(selected.totals).toEqual(bucket.totals);
      expect(selected.trend).toEqual(full.trend);
      expect(selected.totals.netExpense).toBe(-3000);
      expect(
        (
          await entries({
            ...selected.filters,
            kind: 'expense',
            sort: 'amount_desc',
          })
        ).items
      ).toEqual([]);
    }
    expect(
      (await report({ selection: { from: '2024-03-20', to: '2024-03-20' } }))
        .total
    ).toBe(0);
  });

  it('counts fixed primary amounts, separate dated refunds, categories and inclusive weekly drilldowns from the same filters', async () => {
    const id = await create();
    await refund(id);
    await create({
      kind: 'income',
      amount: '500',
      categoryId: 'income-salary',
      date: '2024-03-01',
      tags: [],
    });
    const data = await report();
    expect(data.totals).toEqual({
      income: 50000,
      expense: 10000,
      refund: 3000,
      netExpense: 7000,
    });
    expect(data.counts).toEqual({ income: 1, expense: 1, refund: 1 });
    expect(data.total).toBe(3);
    expect(
      data.groups.find((g) => g.id === 'expense-food')?.totals.refund
    ).toBe(3000);
    const april = await report({
      filters: { from: '2024-04-01', to: '2024-04-30' },
    });
    expect(april.totals).toEqual({
      income: 0,
      expense: 0,
      refund: 3000,
      netExpense: -3000,
    });
    expect(april.trend[0]).toMatchObject({
      from: '2024-04-01',
      to: '2024-04-07',
    });
    for (const item of [...data.groups, ...data.trend]) {
      const detail = await entries(item.filters);
      expect(detail.totals).toEqual(item.totals);
      expect(detail.total).toBe(item.total);
    }
    expect(
      (await report({ interval: 'month' })).trend.map((b) => [b.from, b.to])
    ).toEqual([
      ['2024-03-01', '2024-03-31'],
      ['2024-04-01', '2024-04-30'],
    ]);
    expect(
      (
        await report({
          filters: { from: '2024-03-10', to: '2024-03-10' },
          interval: 'day',
        })
      ).trend[0]
    ).toMatchObject({ from: '2024-03-10', to: '2024-03-10' });
  });

  it('keeps USD original totals and actual refund differences without fetching AI or quotes', async () => {
    const id = await create({
      currency: 'USD',
      conversion: { rate: '7.20' },
      confirmedBaseMinor: 72000,
    });
    await refund(id, { actualAmount: '210.33', confirmedBaseMinor: 21033 });
    await create({ amount: '20', tags: [] });
    const data = await report({ filters: { ...range, currency: 'USD' } });
    expect(data.total).toBe(2);
    expect(data.originalTotals).toEqual({
      income: 0,
      expense: 10000,
      refund: 3000,
      netExpense: 7000,
    });
    expect(data.totals).toEqual({
      income: 0,
      expense: 72000,
      refund: 21033,
      netExpense: 50967,
    });
    expect(data.groups[0].originalTotals).toEqual(data.originalTotals);
    expect((await entries(data.filters)).totals).toEqual(data.totals);
  });

  it('keeps tag groups nonadditive while preserving the original any-tag predicate in every drilldown', async () => {
    const a = await create({ tags: ['A', 'C'] });
    await create({ tags: ['B', 'C'] });
    await create({ tags: ['C'] });
    await create({ tags: [] });
    const all = await report({ groupBy: 'tag' });
    expect(all.total).toBe(4);
    expect(all.groups.find((g) => g.id === null)?.total).toBe(1);
    const tagA = (await entries({})).items
      .find((e) => e.id === a)
      ?.tags.find((t) => t.name === 'A');
    if (!tagA) throw new Error('Missing synthetic tag');
    const selected = await report({
      groupBy: 'tag',
      filters: { ...range, tagIds: [tagA.id] },
    });
    expect(selected.total).toBe(1);
    expect(selected.totals.expense).toBe(10000);
    expect(selected.groups.map((g) => g.name).sort()).toEqual(['A', 'C']);
    for (const group of selected.groups) {
      expect((await entries(group.filters)).total).toBe(1);
      expect((await entries(group.filters)).totals).toEqual(group.totals);
    }
    const narrowed = await report({
      groupBy: 'tag',
      filters: { ...range, requiredTagIds: [tagA.id] },
    });
    for (const group of narrowed.groups)
      expect((await entries(group.filters)).total).toBe(1);
    for (const group of all.groups)
      expect((await entries(group.filters)).total).toBe(group.total);
  });

  it('reflects original category/tag edits, trash, restore and active dataset changes without a stale report cache', async () => {
    const id = await create();
    const refundId = await refund(id);
    const first = await report();
    expect(
      (
        await api(
          'entries',
          {
            ...command(),
            id,
            version: 1,
            kind: 'expense',
            name: 'Updated synthetic',
            amount: '100',
            categoryId: 'expense-other',
            tags: ['New tag'],
            note: 'Find this synthetic note',
          },
          'PUT'
        )
      ).status
    ).toBe(200);
    const updated = await report();
    expect(updated.revision).toBeGreaterThan(first.revision);
    expect(updated.groups.find((g) => g.id === 'expense-other')?.total).toBe(2);
    expect(
      (await report({ groupBy: 'tag' })).groups.map((g) => g.name)
    ).toEqual(['New tag']);
    expect(
      (await report({ filters: { ...range, keyword: 'Find this' } })).total
    ).toBe(1);
    expect(
      (
        await api('entries/delete', {
          ...command(),
          id: refundId,
          version: 1,
          confirmed: true,
        })
      ).status
    ).toBe(200);
    expect((await report()).totals.refund).toBe(0);
    expect(
      (
        await api('entries/restore', {
          ...command(),
          id: refundId,
          version: 2,
          confirmed: true,
        })
      ).status
    ).toBe(200);
    expect((await report()).totals.refund).toBe(3000);
    await env.DB.prepare(
      "UPDATE moni_state SET active_dataset = 'initial' WHERE singleton = 1"
    ).run();
    expect((await report()).total).toBe(0);
  });

  it('resolves explicit relative periods and caps the current calendar month at ledger today', async () => {
    await create({ date: '2024-02-29' });
    const month = await report({
      filters: {},
      period: { kind: 'month', month: '2024-02' },
    });
    expect(month.filters).toMatchObject({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    const current = await report({ filters: {} });
    expect(current.timeZone).toBe('Asia/Shanghai');
    expect(current.filters.from?.slice(0, 7)).toBe(
      current.filters.to?.slice(0, 7)
    );
    expect(current.primaryCurrency).toBe('CNY');
  });

  it('rejects unsafe aggregates, invalid or executable input and unauthenticated access', async () => {
    for (const body of [
      { sql: 'select *' },
      { filters: { from: '2024-02-30' } },
      { filters: { from: '2024-04-01', to: '2024-03-01' } },
      { filters: range, period: { kind: 'rolling_months', months: 3 } },
      { period: { kind: 'month', month: '2024-13' } },
      { period: { kind: 'complete_months', months: 0 } },
      { groupBy: 'note' },
      { interval: 'hour' },
      { filters: { untagged: 'true' } },
      { filters: range, selection: { from: '2024-02-29', to: '2024-03-05' } },
      { filters: range, selection: { from: '2024-03-01', to: '2024-05-01' } },
      { selection: { from: '2024-03-10', to: '2024-03-01' } },
      { selection: { from: '2024-02-30', to: '2024-03-01' } },
      { selection: { from: '2024-03-01', to: '2024-03-10', sql: 'select *' } },
      { filters: { sort: 'base_minor; DELETE FROM entries' } },
    ])
      expect((await api('reports/query', body)).status).toBe(400);
    expect(
      (
        await SELF.fetch('https://moni.test/api/reports/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status
    ).toBe(401);
    const id = await create();
    // A large synthetic historical dataset must fail explicitly instead of rounding totals.
    for (let batch = 0; batch < 11; batch++) {
      await env.DB.batch(
        Array.from({ length: 100 }, () =>
          env.DB.prepare(
            'INSERT INTO entries(dataset_id,id,kind,name,entry_date,currency,original_minor,base_minor,category_id,note,version,created_at,updated_at,deleted_at,conversion_json) SELECT dataset_id,?,kind,name,entry_date,currency,9000000000000,9000000000000,category_id,note,version,created_at,updated_at,deleted_at,conversion_json FROM entries WHERE dataset_id = ? AND id = ?'
          ).bind(crypto.randomUUID(), datasetId, id)
        )
      );
    }
    expect((await api('reports/query', { filters: range })).status).toBe(413);
  });
});

describe('ledger date windows', () => {
  it('clamps rolling month ends across leap years and separates complete calendar months', () => {
    const period = { kind: 'rolling_months' as const, months: 1 };
    expect(
      resolveDatePeriod(period, 'UTC', new Date('2024-03-31T12:00:00Z'))
    ).toEqual({ from: '2024-02-29', to: '2024-03-31' });
    expect(
      resolveDatePeriod(period, 'UTC', new Date('2023-03-31T12:00:00Z'))
    ).toEqual({ from: '2023-02-28', to: '2023-03-31' });
    expect(
      resolveDatePeriod(
        { kind: 'rolling_months', months: 3 },
        'Asia/Shanghai',
        new Date('2026-10-16T16:00:00Z')
      )
    ).toEqual({ from: '2026-07-17', to: '2026-10-17' });
    expect(
      resolveDatePeriod(
        { kind: 'complete_months', months: 3 },
        'Asia/Shanghai',
        new Date('2026-10-16T16:00:00Z')
      )
    ).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });
  it('uses the ledger local date at midnight and DST boundaries, and clips upper-bound trend dates', () => {
    const period = { kind: 'month' as const, month: '2024-02' };
    expect(
      resolveDatePeriod(
        period,
        'America/Los_Angeles',
        new Date('2024-03-01T00:30:00Z')
      ).to
    ).toBe('2024-02-29');
    expect(
      resolveDatePeriod(
        { kind: 'month', month: '2024-03' },
        'America/Los_Angeles',
        new Date('2024-03-10T10:01:00Z')
      ).to
    ).toBe('2024-03-10');
    expect(
      resolveDatePeriod(
        { kind: 'complete_months', months: 1 },
        'UTC',
        new Date('2024-01-31T12:00:00Z')
      )
    ).toEqual({ from: '2023-12-01', to: '2023-12-31' });
    expect(trendEnd('9999-12-27', 'week')).toBe('9999-12-31');
  });
});
