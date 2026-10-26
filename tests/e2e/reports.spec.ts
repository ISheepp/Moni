import { type APIRequestContext, expect, test } from '@playwright/test';
import { startTestServer } from '../../scripts/local-test-server.mjs';

let fixture: Awaited<ReturnType<typeof startTestServer>>;
test.beforeEach(async () => {
  fixture = await startTestServer();
});
test.afterEach(async () => {
  await fixture?.close();
});

async function seedRankings(request: APIRequestContext) {
  const command = () => ({
    datasetId: 'initial',
    operationId: crypto.randomUUID(),
  });
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`${fixture.url}/api/${path}`, { data });
    expect(response.status()).toBe(200);
    return response.json();
  };
  await post('initialize', {
    ...command(),
    primaryCurrency: 'CNY',
    timeZone: 'Asia/Shanghai',
  });
  const entries = [
    {
      name: 'Synthetic groceries',
      amount: '155',
      categoryId: 'expense-food',
      tags: ['Shared', 'Groceries'],
      note: `Synthetic milk and snacks. ${'Full note. '.repeat(70)}<img src=x onerror=alert(1)>`,
    },
    {
      name: 'Synthetic campaign',
      amount: '20',
      categoryId: 'expense-other',
      currency: 'USD',
      conversion: { rate: '7.20' },
      confirmedBaseMinor: 14400,
      tags: ['Shared', 'Promotion'],
      note: 'Synthetic website campaign',
    },
    {
      name: 'Synthetic dinner',
      amount: '90',
      categoryId: 'expense-food',
      tags: ['Shared', 'Meals'],
    },
    {
      name: 'Synthetic untagged',
      amount: '30',
      categoryId: 'expense-other',
      tags: [],
    },
    {
      name: 'Synthetic tea',
      amount: '20',
      categoryId: 'expense-food',
      tags: ['Tea'],
    },
    {
      name: 'Synthetic coffee',
      amount: '10',
      categoryId: 'expense-food',
      tags: ['Coffee'],
    },
    {
      name: 'Synthetic water',
      amount: '4',
      categoryId: 'expense-food',
      tags: [],
    },
    {
      name: 'Synthetic snack',
      amount: '3',
      categoryId: 'expense-food',
      tags: [],
    },
    {
      name: 'Synthetic bus',
      amount: '2',
      categoryId: 'expense-other',
      tags: [],
    },
    {
      name: 'Synthetic breakfast',
      amount: '1.50',
      categoryId: 'expense-food',
      tags: [],
    },
    {
      name: 'Synthetic tissue',
      amount: '1',
      categoryId: 'expense-other',
      tags: [],
    },
    {
      name: 'Synthetic parking',
      amount: '0.50',
      categoryId: 'expense-other',
      tags: [],
    },
  ];
  for (const entry of entries)
    await post('entries', {
      ...command(),
      id: crypto.randomUUID(),
      kind: 'expense',
      date: '2024-03-06',
      ...entry,
    });
  await post('entries', {
    ...command(),
    id: crypto.randomUUID(),
    kind: 'expense',
    name: 'Synthetic shoes outside week',
    amount: '500',
    date: '2024-03-20',
    categoryId: 'expense-clothing',
    tags: ['Shoes'],
  });
  const original = crypto.randomUUID();
  await post('entries', {
    ...command(),
    id: original,
    kind: 'expense',
    name: 'Synthetic prior-month purchase',
    amount: '300',
    date: '2024-02-20',
    categoryId: 'expense-other',
  });
  await post('refunds', {
    ...command(),
    id: crypto.randomUUID(),
    expenseId: original,
    expenseVersion: 1,
    amount: '60',
    confirmedBaseMinor: 6000,
    date: '2024-03-07',
  });
  await post('entries', {
    ...command(),
    id: crypto.randomUUID(),
    kind: 'income',
    name: 'Synthetic salary',
    amount: '9000',
    date: '2024-03-08',
    categoryId: 'income-salary',
  });
  const deleted = crypto.randomUUID();
  await post('entries', {
    ...command(),
    id: deleted,
    kind: 'expense',
    name: 'Synthetic deleted entry',
    amount: '1000',
    date: '2024-03-08',
    categoryId: 'expense-other',
  });
  await post('entries/delete', {
    ...command(),
    id: deleted,
    version: 1,
    confirmed: true,
  });
  const url = new URL(fixture.url);
  url.searchParams.set('view', 'reports');
  url.searchParams.set(
    'report',
    JSON.stringify({
      mode: 'month',
      month: '2024-03',
      months: 3,
      groupBy: 'category',
      interval: 'week',
    })
  );
  return { url: url.toString(), post, command };
}

test('previous-period totals, counts, averages and change rankings follow chart selection and preserve drilldowns', async ({
  page,
  request,
  isMobile,
}) => {
  const { url } = await seedRankings(request);
  const errors: string[] = [];
  let serviceCalls = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (/\/api\/(probe|chats|rates)/.test(req.url())) serviceCalls++;
  });
  await page.goto(url);
  const frequency = page.getByRole('region', {
    name: 'Frequency and average',
    exact: true,
  });
  await expect(frequency).toContainText('2024-02-01 — 2024-02-29');
  await expect(
    frequency.getByText('13 records', { exact: true })
  ).toBeVisible();
  await expect(frequency.getByText('CN¥73.92', { exact: true })).toBeVisible();
  await expect(frequency).toContainText('Previous CN¥300.00');
  const changes = page.getByRole('region', {
    name: 'Change rankings',
    exact: true,
  });
  const rows = changes.getByRole('list').locator(':scope > li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Clothing');
  await expect(rows.first()).toContainText('+CN¥500.00');
  await expect(rows.first()).toContainText('New CN¥500.00');
  await expect(rows.nth(1)).toContainText('Food');
  await changes
    .getByRole('button', { name: 'Largest decreases', exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Other');
  await expect(rows.first()).toContainText('-CN¥122.50');
  await changes
    .getByRole('link', { name: 'Previous entries', exact: true })
    .click();
  await expect(
    page.getByText('Matching entries: 1', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic prior-month purchase',
      exact: true,
    })
  ).toBeVisible();
  await page.goBack();
  await expect(
    changes.getByRole('button', { name: 'Largest decreases', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.first()).toContainText('-CN¥122.50');
  await page
    .getByRole('group', { name: 'Group by', exact: true })
    .getByRole('button', { name: 'Tags', exact: true })
    .click();
  await expect(changes).toContainText('By tag');
  await expect(rows.first()).toContainText('Untagged');
  await expect(rows.first()).toContainText('-CN¥258.00');
  await page
    .getByRole('button', {
      name: 'Select period 2024-03-04 — 2024-03-10',
      exact: true,
    })
    .click();
  await expect(frequency).toContainText('2024-02-26 — 2024-03-03');
  await expect(
    frequency.getByText('12 records', { exact: true })
  ).toBeVisible();
  await expect(frequency.getByText('CN¥38.42', { exact: true })).toBeVisible();
  await expect(frequency).toContainText(
    'No matching entries in the previous period'
  );
  await expect(
    changes.getByText('No matching changes in this direction.', { exact: true })
  ).toBeVisible();
  await changes
    .getByRole('button', { name: 'Largest increases', exact: true })
    .click();
  await expect(rows.first()).toContainText('Shared');
  await expect(rows.first()).toContainText('+CN¥389.00');
  await expect(rows).toHaveCount(5);
  await changes.getByRole('button', { name: 'Show all changes (7)' }).click();
  await expect(rows).toHaveCount(7);
  await changes.getByRole('button', { name: 'Show fewer changes (7)' }).click();
  await expect(rows).toHaveCount(5);
  await page.reload();
  await expect(frequency).toContainText('2024-02-26 — 2024-03-03');
  await expect(rows.first()).toContainText('Shared');
  await page
    .getByRole('group', { name: 'Trend interval', exact: true })
    .getByRole('button', { name: 'Daily', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Select period 2024-03-07 — 2024-03-07',
      exact: true,
    })
    .click();
  await expect(frequency).toContainText('2024-03-06 — 2024-03-06');
  await expect(frequency.getByText('0 records', { exact: true })).toBeVisible();
  await expect(frequency).toContainText('No matching entries this period');
  await changes
    .getByRole('button', { name: 'Largest decreases', exact: true })
    .click();
  await expect(rows.first()).toContainText('Shared');
  await expect(rows.first()).toContainText('-CN¥389.00');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('[data-slot="app-language-trigger"]:visible').click();
  await page.locator('[data-app-language="zh"]').click();
  await expect(
    page.getByRole('heading', { name: '变化排行', exact: true })
  ).toBeVisible();
  if (isMobile) await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  expect(serviceCalls).toBe(0);
  expect(errors).toEqual([]);
});

test('chart selection links amount-ranked categories, tags and paged entries with complete notes on both screen sizes', async ({
  page,
  request,
  isMobile,
}) => {
  const { url } = await seedRankings(request);
  const errors: string[] = [];
  let externalRequests = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (/\/api\/(probe|chats|rates)/.test(req.url())) externalRequests++;
  });
  await page.goto(url);
  const totals = page.getByRole('region', {
    name: 'Totals for all matching entries',
    exact: true,
  });
  await expect(totals.getByText('CN¥961.00', { exact: true })).toBeVisible();
  const week = page.getByRole('button', {
    name: 'Select period 2024-03-04 — 2024-03-10',
    exact: true,
  });
  await week.focus();
  await page.keyboard.press('Enter');
  await expect(week).toHaveAttribute('aria-pressed', 'true');
  await expect(totals.getByText('CN¥461.00', { exact: true })).toBeVisible();
  await expect(totals.getByText('CN¥60.00', { exact: true })).toBeVisible();
  await expect(totals.getByText('CN¥401.00', { exact: true })).toBeVisible();
  await expect(
    totals.getByText('2024-03-04 — 2024-03-10', { exact: true })
  ).toBeVisible();
  await expect(week).toBeFocused();
  const categories = page.getByRole('list', {
    name: 'Category ranking',
    exact: true,
  });
  await expect(categories.locator(':scope > li')).toHaveCount(2);
  await expect(categories.locator(':scope > li').nth(0)).toContainText(
    'CN¥283.50'
  );
  await expect(categories.locator(':scope > li').nth(1)).toContainText(
    'CN¥177.50'
  );
  await categories.getByRole('button', { name: /^Food · 7 records/ }).click();
  let ranked = page.getByRole('list', { name: 'Entry ranking', exact: true });
  await expect(ranked.getByRole('button').first()).toContainText(
    'Synthetic groceries'
  );
  await expect(ranked.getByRole('button').nth(1)).toContainText(
    'Synthetic dinner'
  );
  await page
    .getByRole('group', { name: 'Group by', exact: true })
    .getByRole('button', { name: 'Tags', exact: true })
    .click();
  const tags = page.getByRole('list', { name: 'Tag ranking', exact: true });
  await expect(tags.locator(':scope > li').first()).toContainText('Shared');
  await expect(tags.locator(':scope > li').first()).toContainText('CN¥389.00');
  await tags.getByRole('button', { name: /^Shared · 3 records/ }).click();
  ranked = page.getByRole('list', { name: 'Entry ranking', exact: true });
  await expect(ranked.getByRole('button')).toHaveCount(3);
  await expect(ranked.getByRole('button').nth(1)).toContainText(
    'Synthetic campaign'
  );
  await expect(ranked.getByRole('button').nth(1)).toContainText('USD $20.00');
  await page
    .getByRole('group', { name: 'Group by', exact: true })
    .getByRole('button', { name: 'Entries', exact: true })
    .click();
  ranked = page.getByRole('list', { name: 'Entry ranking', exact: true });
  await expect(ranked.getByRole('button')).toHaveCount(10);
  await expect(ranked.getByRole('button').first()).toContainText(
    'Synthetic groceries'
  );
  await expect(ranked).not.toContainText('outside week');
  await expect(ranked).not.toContainText('Synthetic salary');
  await expect(ranked).not.toContainText('Synthetic prior-month purchase');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(ranked.getByRole('button')).toHaveCount(2);
  await expect(ranked.getByRole('button').first()).toContainText('#11');
  await expect(ranked.getByRole('button').first()).toContainText(
    'Synthetic tissue'
  );
  await expect(ranked.getByRole('button').last()).toContainText(
    'Synthetic parking'
  );
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  const groceries = ranked.getByRole('button').first();
  await expect(groceries).toContainText('Synthetic groceries');
  await groceries.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: 'Synthetic groceries',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Synthetic milk and snacks/)).toContainText(
    '<img src=x onerror=alert(1)>'
  );
  await expect(dialog.locator('img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(groceries).toBeFocused();
  await page.reload();
  await expect(week).toHaveAttribute('aria-pressed', 'true');
  expect(
    await week.evaluate((button) => {
      const scroller = button.closest('section');
      if (!scroller) return false;
      const b = button.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return b.left >= s.left - 1 && b.right <= s.right + 1;
    })
  ).toBe(true);
  await expect(ranked.getByRole('button').first()).toContainText(
    'Synthetic groceries'
  );
  await ranked.getByRole('button').first().click();
  await page.getByRole('link', { name: 'Open entry', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic groceries',
      level: 1,
      exact: true,
    })
  ).toBeVisible();
  await page.goBack();
  await expect(week).toHaveAttribute('aria-pressed', 'true');
  await expect(ranked.getByRole('button').first()).toContainText(
    'Synthetic groceries'
  );
  await page
    .getByRole('button', { name: 'Show entire range', exact: true })
    .click();
  await expect(totals.getByText('CN¥961.00', { exact: true })).toBeVisible();
  await expect(ranked.getByRole('button').first()).toContainText(
    'Synthetic shoes outside week'
  );
  await page
    .getByRole('group', { name: 'Trend interval', exact: true })
    .getByRole('button', { name: 'Daily', exact: true })
    .click();
  const lastDay = page.getByRole('button', {
    name: 'Select period 2024-03-20 — 2024-03-20',
    exact: true,
  });
  await lastDay.click();
  await expect(ranked.getByRole('button')).toHaveCount(1);
  await lastDay.evaluate((button) => {
    const scroller = button.closest('section');
    if (scroller) scroller.scrollLeft = 0;
  });
  await page.reload();
  await expect(lastDay).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      lastDay.evaluate((button) => {
        const scroller = button.closest('section');
        if (!scroller) return false;
        const b = button.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        return b.left >= s.left - 1 && b.right <= s.right + 1;
      })
    )
    .toBe(true);
  await page
    .getByRole('button', {
      name: 'Select period 2024-03-06 — 2024-03-06',
      exact: true,
    })
    .click();
  await expect(totals.getByText('CN¥461.00', { exact: true })).toHaveCount(2);
  await expect(totals.getByText('CN¥0.00', { exact: true })).toHaveCount(2);
  await page
    .getByRole('group', { name: 'Trend interval', exact: true })
    .getByRole('button', { name: 'Monthly', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Show entire range', exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Select period 2024-03-01 — 2024-03-31',
      exact: true,
    })
    .click();
  await expect(totals.getByText('CN¥961.00', { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.locator('[data-slot="app-language-trigger"]:visible').click();
  await page.locator('[data-app-language="zh"]').click();
  await expect(
    page.getByRole('heading', { name: '消费排行', exact: true })
  ).toBeVisible();
  if (isMobile) await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  expect(externalRequests).toBe(0);
  expect(errors).toEqual([]);
});

test('ranked details hide stale results on errors and require a refresh when posted data changes', async ({
  page,
  request,
}) => {
  const { url, post, command } = await seedRankings(request);
  await page.goto(url);
  await expect(
    page.getByRole('list', { name: 'Category ranking', exact: true })
  ).toBeVisible();
  await post('entries', {
    ...command(),
    id: crypto.randomUUID(),
    kind: 'expense',
    name: 'Synthetic new largest expense',
    amount: '700',
    date: '2024-03-06',
    categoryId: 'expense-other',
  });
  await page
    .getByRole('group', { name: 'Group by', exact: true })
    .getByRole('button', { name: 'Entries', exact: true })
    .click();
  const rankings = page.getByRole('region', {
    name: 'Spending rankings',
    exact: true,
  });
  await expect(rankings.getByRole('alert')).toContainText(
    'Your ledger has changed'
  );
  await expect(
    rankings.getByRole('list', { name: 'Entry ranking', exact: true })
  ).toHaveCount(0);
  await rankings
    .getByRole('button', { name: 'Refresh reports', exact: true })
    .click();
  const list = rankings.getByRole('list', {
    name: 'Entry ranking',
    exact: true,
  });
  await expect(list.getByRole('button').first()).toContainText(
    'Synthetic new largest expense'
  );
  await page.route('**/api/entries/query', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_failure"}',
    })
  );
  await rankings.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rankings.getByRole('alert')).toBeVisible();
  await expect(list).toHaveCount(0);
  await page.unroute('**/api/entries/query');
  await rankings.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(list.getByRole('button').first()).toContainText('#11');
  await page
    .getByRole('button', {
      name: 'Select period 2024-03-18 — 2024-03-24',
      exact: true,
    })
    .click();
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list.getByRole('button').first()).toContainText('#1');
  await expect(list.getByRole('button').first()).toContainText(
    'Synthetic shoes outside week'
  );
});

test('reports expose exact dated figures, reusable drilldowns, filters, themes and bilingual data tables without AI', async ({
  page,
  request,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const command = () => ({
    datasetId: 'initial',
    operationId: crypto.randomUUID(),
  });
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`${fixture.url}/api/${path}`, { data });
    expect(response.status()).toBe(200);
    return response.json();
  };
  await post('initialize', {
    ...command(),
    primaryCurrency: 'CNY',
    timeZone: 'Asia/Shanghai',
  });
  const id = crypto.randomUUID();
  await post('entries', {
    ...command(),
    id,
    name: 'Synthetic campaign',
    kind: 'expense',
    amount: '100',
    currency: 'USD',
    conversion: { rate: '7.20' },
    confirmedBaseMinor: 72000,
    date: '2024-03-10',
    categoryId: 'expense-other',
    tags: ['Delivery', 'Campaign'],
    note: 'Synthetic report note',
  });
  await post('entries', {
    ...command(),
    id: crypto.randomUUID(),
    name: 'Synthetic lunch',
    kind: 'expense',
    amount: '35',
    date: '2024-03-31',
    categoryId: 'expense-food',
    tags: ['Delivery', 'Lunch'],
  });
  await post('entries', {
    ...command(),
    id: crypto.randomUUID(),
    name: 'Synthetic salary',
    kind: 'income',
    amount: '500',
    date: '2024-03-01',
    categoryId: 'income-salary',
  });
  const refundId = crypto.randomUUID();
  await post('refunds', {
    ...command(),
    id: refundId,
    expenseId: id,
    expenseVersion: 1,
    amount: '30',
    actualAmount: '210.33',
    confirmedBaseMinor: 21033,
    date: '2024-04-02',
  });
  let aiCalls = 0;
  page.on('request', (req) => {
    if (/\/api\/(probe|chats|rates)/.test(req.url())) aiCalls++;
  });
  const filters = { from: '2024-03-01', to: '2024-04-30' };
  const url = new URL(fixture.url);
  url.searchParams.set('view', 'reports');
  url.searchParams.set('filters', JSON.stringify(filters));
  await page.goto(url.toString());
  const totals = page.getByRole('region', {
    name: 'Totals for all matching entries',
    exact: true,
  });
  await expect(totals.getByText('CN¥755.00', { exact: true })).toBeVisible();
  await expect(totals.getByText('CN¥210.33', { exact: true })).toBeVisible();
  await expect(totals.getByText('CN¥544.67', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('group', { name: /Expense and refund bars/ })
  ).toBeVisible();
  await page.getByText('View trend data and entries', { exact: true }).click();
  await expect(
    page.getByRole('table').getByText('CN¥210.33', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('group', { name: 'Group by', exact: true })
    .getByRole('button', { name: 'Tags', exact: true })
    .click();
  await expect(
    page.getByRole('list', { name: 'Tag ranking', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/An entry can appear in multiple tag groups/)
  ).toHaveCount(1);
  await expect(
    page.getByText(/An entry can appear in multiple tag groups/)
  ).toBeVisible();
  await page.getByRole('button', { name: /^Delivery · 2 records/ }).click();
  await page.getByRole('link', { name: /^Delivery · 3 records/ }).click();
  await expect(
    page.getByText('Matching entries: 3', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Synthetic campaign', exact: true })
  ).toHaveCount(2);
  await expect(
    page.getByRole('heading', { name: 'Synthetic salary', exact: true })
  ).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Reports', exact: true })
  ).toBeVisible();
  await page.getByText('Entry filters', { exact: true }).click();
  if (isMobile)
    await page
      .getByRole('button', { name: 'More filters', exact: true })
      .click();
  await page
    .getByRole('combobox', { name: 'Original currency', exact: true })
    .click();
  await page.getByRole('option', { name: 'USD', exact: true }).click();
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Original-currency totals · USD',
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText('$70.00', { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.locator('[data-slot="app-language-trigger"]:visible').click();
  await page.locator('[data-app-language="zh"]').click();
  await expect(
    page.getByRole('heading', { name: '统计', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('¥509.67', { exact: true }).first()
  ).toBeVisible();
  if (isMobile)
    await page.getByRole('button', { name: '更多筛选', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: '原币', exact: true })
  ).toContainText('USD');
  await page.route('**/api/reports/query', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_failure"}',
    })
  );
  await page.getByRole('button', { name: '刷新统计', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('group', { name: /柱状图/ })).toHaveCount(0);
  await page.unroute('**/api/reports/query');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '支出与退款趋势', exact: true })
  ).toBeVisible();
  if (isMobile) await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  expect(aiCalls).toBe(0);
  expect(errors).toEqual([]);
});

test('Base UI month selection, keyboard controls and empty or refund-only periods keep exact figures', async ({
  page,
  request,
  isMobile,
}) => {
  const command = () => ({
    datasetId: 'initial',
    operationId: crypto.randomUUID(),
  });
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`${fixture.url}/api/${path}`, { data });
    expect(response.status()).toBe(200);
    return response.json();
  };
  await post('initialize', {
    ...command(),
    primaryCurrency: 'CNY',
    timeZone: 'Asia/Shanghai',
  });
  const id = crypto.randomUUID();
  await post('entries', {
    ...command(),
    id,
    kind: 'expense',
    name: 'Synthetic October purchase',
    amount: '100',
    date: '2024-10-02',
    categoryId: 'expense-food',
  });
  await post('refunds', {
    ...command(),
    id: crypto.randomUUID(),
    expenseId: id,
    expenseVersion: 1,
    amount: '30',
    confirmedBaseMinor: 3000,
    date: '2024-11-02',
  });
  const url = new URL(fixture.url);
  url.searchParams.set('view', 'reports');
  url.searchParams.set(
    'report',
    JSON.stringify({
      mode: 'month',
      month: '2024-10',
      months: 3,
      groupBy: 'category',
      interval: 'week',
    })
  );
  await page.goto(url.toString());
  const totals = page.getByRole('region', {
    name: 'Totals for all matching entries',
    exact: true,
  });
  await expect(totals.getByText('CN¥100.00', { exact: true })).toHaveCount(2);
  const month = page.getByRole('button', { name: 'Report month', exact: true });
  await month.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Report month' })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(month).toBeFocused();
  await month.click();
  await page
    .getByRole('dialog', { name: 'Report month' })
    .getByRole('button', { name: 'Sep', exact: true })
    .click();
  await expect(month).toContainText('September 2024');
  await expect(
    page.getByText('No matching entries', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: /Expense and refund bars/ })
  ).toHaveCount(0);
  await month.click();
  await page.getByLabel('Year', { exact: true }).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('2025');
  await page
    .getByRole('button', { name: 'Previous year', exact: true })
    .click();
  await expect(page.getByLabel('Year', { exact: true })).toHaveValue('2024');
  await page
    .getByRole('dialog', { name: 'Report month' })
    .getByRole('button', { name: 'Nov', exact: true })
    .click();
  await expect(totals.getByText('-CN¥30.00', { exact: true })).toBeVisible();
  await expect(totals.getByText('CN¥30.00', { exact: true })).toBeVisible();
  const interval = page.getByRole('group', {
    name: 'Trend interval',
    exact: true,
  });
  await interval.getByRole('button', { name: 'Daily', exact: true }).click();
  await expect(
    interval.getByRole('button', { name: 'Daily', exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole('group', { name: /Expense and refund bars/ })
  ).toBeVisible();
  await interval.getByRole('button', { name: 'Daily', exact: true }).click();
  await expect(
    interval.getByRole('button', { name: 'Daily', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  const range = page.getByRole('combobox', { name: 'Date range', exact: true });
  await range.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(range).toBeFocused();
  await range.click();
  await page.getByRole('option', { name: 'Custom dates', exact: true }).click();
  await expect(page.getByLabel('From date', { exact: true })).toHaveValue(
    '2024-11-01'
  );
  await expect(page.getByLabel('Through date', { exact: true })).toHaveValue(
    '2024-11-30'
  );
  if (isMobile) await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
