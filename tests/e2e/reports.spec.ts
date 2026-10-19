import { expect, test } from '@playwright/test';
import { startTestServer } from '../../scripts/local-test-server.mjs';

let fixture: Awaited<ReturnType<typeof startTestServer>>;
test.beforeAll(async () => {
  fixture = await startTestServer();
});
test.afterAll(async () => {
  await fixture?.close();
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
    page.getByRole('img', { name: /Expense and refund bars/ })
  ).toBeVisible();
  await page.getByText('View trend data and entries', { exact: true }).click();
  await expect(
    page.getByRole('table').getByText('CN¥210.33', { exact: true })
  ).toBeVisible();
  await page.getByLabel('Group by', { exact: true }).selectOption('tag');
  await expect(
    page.getByText(/An entry can appear in multiple tag groups/)
  ).toBeVisible();
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
    .getByLabel('Original currency', { exact: true })
    .selectOption('USD');
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
  await expect(page.getByLabel('原币', { exact: true })).toHaveValue('USD');
  await page.route('**/api/reports/query', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"synthetic_failure"}',
    })
  );
  await page.getByRole('button', { name: '刷新统计', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('img', { name: /柱状图/ })).toHaveCount(0);
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
