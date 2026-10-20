import { expect, test } from '@playwright/test';
import { startTestServer } from '../../scripts/local-test-server.mjs';

const password = 'synthetic-browser-password-only';
const fixtures: Awaited<ReturnType<typeof startTestServer>>[] = [];
test.afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function fixture() {
  const value = await startTestServer(0, {
    ai: { AI_API_KEY: '', AI_BASE_URL: '', AI_MODEL: '' },
    access: {
      ACCESS_ISSUER: '',
      ACCESS_AUDIENCE: '',
      OWNER_SUBJECT: '',
      MONI_PASSWORD: password,
    },
  });
  fixtures.push(value);
  return value;
}

test('server-rendered login never sends the password in a navigation before JavaScript is ready', async ({
  page,
}) => {
  const server = await fixture();
  let release = () => {};
  const hydration = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/*.js', async (route) => {
    await hydration;
    await route.continue();
  });
  try {
    await page.goto(`${server.url}/login`, { waitUntil: 'commit' });
    await expect(page.locator('form')).toHaveAttribute('method', 'post');
    const input = page.getByLabel('Ledger password', { exact: true });
    await expect(input).toBeVisible();
    const submit = page.getByRole('button', {
      name: 'Unlock my ledger',
      exact: true,
    });
    if (await input.isEnabled()) {
      await input.fill(password);
      const navigation = page.waitForRequest((request) =>
        request.isNavigationRequest()
      );
      await submit.click({ noWaitAfter: true });
      const request = await navigation;
      expect(new URL(request.url()).searchParams.has('password')).toBe(false);
    } else {
      await expect(submit).toBeDisabled();
    }
  } finally {
    release();
  }
  await page.waitForLoadState('load');
  await page.getByLabel('Ledger password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Unlock my ledger', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Create your private ledger',
      exact: true,
    })
  ).toBeVisible();
});

test('password login protects the ledger, supports manual entries and survives refresh; sign-out revokes the cookie', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const server = await fixture();
  await page.goto(`${server.url}/?view=entries`);
  await expect(page).toHaveURL(/\/login\?/);
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true })
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('password-login.png') });
  await expect(
    page.getByRole('button', { name: 'Unlock my ledger', exact: true })
  ).toBeEnabled();
  await expect(page.locator('main#main-content')).toBeVisible();
  expect((await page.request.get(`${server.url}/api/settings`)).status()).toBe(
    401
  );
  expect(
    (await page.request.post(`${server.url}/login`, { data: {} })).status()
  ).toBe(401);
  const input = page.getByLabel('Ledger password', { exact: true });
  await input.fill('incorrect');
  await page
    .getByRole('button', { name: 'Unlock my ledger', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'That password did not match'
  );
  await input.fill(password);
  await page
    .getByRole('button', { name: 'Show password', exact: true })
    .click();
  await expect(input).toHaveAttribute('type', 'text');
  await page
    .getByRole('button', { name: 'Hide password', exact: true })
    .click();
  await expect(input).toHaveAttribute('type', 'password');
  await page
    .getByRole('button', { name: 'Unlock my ledger', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Create your private ledger',
      exact: true,
    })
  ).toBeVisible();
  const cookies = await page.context().cookies();
  const cookie = cookies.find((value) => value.name === '__Host-moni_session');
  expect(cookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
  });
  expect(cookie?.value).not.toBe(password);
  await page
    .getByRole('button', { name: 'Create ledger', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Entries', exact: true })
  ).toBeVisible();
  const savedStatus = await page.evaluate(async () => {
    const response = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId: 'initial',
        operationId: crypto.randomUUID(),
        id: crypto.randomUUID(),
        kind: 'expense',
        name: 'Synthetic signed-in lunch',
        amount: '35',
        note: 'Synthetic login preserved note',
      }),
    });
    return response.status;
  });
  expect(savedStatus).toBe(200);
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic signed-in lunch',
      exact: true,
    })
  ).toBeVisible();
  await page.goto(`${server.url}/?view=settings`);
  const access = page.getByRole('region', {
    name: 'Ledger access',
    exact: true,
  });
  await expect(
    access.getByText('Ledger password', { exact: true })
  ).toBeVisible();
  await access.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true })
  ).toBeVisible();
  const replay = await page.request.get(`${server.url}/api/entries`, {
    headers: { Cookie: `__Host-moni_session=${cookie?.value}` },
  });
  expect(replay.status()).toBe(401);
  await input.fill(password);
  await page
    .getByRole('button', { name: 'Unlock my ledger', exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.goto(`${server.url}/?view=entries`);
  await expect(
    page.getByRole('heading', {
      name: 'Synthetic signed-in lunch',
      exact: true,
    })
  ).toBeVisible();
  const db = await server.runtime.getD1Database('DB');
  expect(await db.prepare('SELECT note FROM entries').first('note')).toBe(
    'Synthetic login preserved note'
  );
});

test('Chinese login follows system theme, remains usable at 320px and ignores external return destinations', async ({
  page,
}) => {
  const server = await fixture();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(
    `${server.url}/login?lang=zh&returnTo=${encodeURIComponent('https://untrusted.invalid/')}`
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(
    page.getByRole('heading', { name: '欢迎回来', exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('password-login-zh-dark.png'),
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
  await page.getByLabel('账本密码', { exact: true }).focus();
  await expect(page.getByLabel('账本密码', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: '显示密码', exact: true })
  ).toBeFocused();
  await page.getByLabel('账本密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开我的账本', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '建立你的私人账本', exact: true })
  ).toBeVisible();
  expect(new URL(page.url()).origin).toBe(server.url);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.goto(`${server.url}/zh?view=settings`);
  await expect(
    page.getByRole('heading', { name: '设置', exact: true })
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});
