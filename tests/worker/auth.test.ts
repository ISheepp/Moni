import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticationMode } from '../../src/lib/auth';
import { handlePrivateApi } from '../../src/worker';

const password = 'synthetic-ledger-password-only';
const config = (): Env => ({
  ...env,
  ACCESS_ISSUER: '',
  ACCESS_AUDIENCE: '',
  OWNER_SUBJECT: '',
  MONI_PASSWORD: password,
  AI_API_KEY: '',
  AI_BASE_URL: '',
  AI_MODEL: '',
});
function request(path: string, body?: unknown, headers: HeadersInit = {}) {
  return new Request(`https://moni.test/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const api = (path: string, cookie = '', settings = config()) =>
  handlePrivateApi(request(path, undefined, { Cookie: cookie }), settings);
async function login(
  settings = config(),
  value = password,
  headers: Record<string, string> = {}
) {
  return handlePrivateApi(
    request('auth/login', { password: value }, headers),
    settings
  );
}
async function session(settings = config()) {
  const response = await login(settings);
  expect(response.status).toBe(200);
  return (response.headers.get('Set-Cookie') ?? '').split(';')[0];
}
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions'),
    env.DB.prepare('DELETE FROM auth_login_limits'),
    env.DB.prepare('DELETE FROM auth_credentials'),
  ]);
});

describe('single-owner password authentication', () => {
  it('defaults to password and keeps missing setup closed across private operations', async () => {
    const settings = { ...config(), MONI_PASSWORD: '' };
    expect(authenticationMode(settings)).toBe('password');
    for (const path of [
      'settings',
      'entries',
      'exports/backup',
      'initialize',
      'chat',
      'ai',
      'wechat',
      'auth',
    ]) {
      const response = await api(path, '', settings);
      expect(response.status, path).toBe(503);
      expect(await response.json()).toEqual({
        error: 'password_setup_required',
      });
    }
  });

  it.each([
    'short',
    ' '.repeat(16),
    'a'.repeat(129),
  ])('rejects unsafe deployment password configuration', async (value) => {
    expect((await login({ ...config(), MONI_PASSWORD: value })).status).toBe(
      503
    );
  });

  it('requires the automatically prepared encryption secret', async () => {
    expect(
      (await login({ ...config(), CONFIG_ENCRYPTION_KEY: '' })).status
    ).toBe(503);
  });

  it('keeps all existing Access configurations authoritative, including partial ones', async () => {
    const passwordCookie = await session();
    for (const settings of [
      { ...env, MONI_PASSWORD: password },
      { ...config(), ACCESS_ISSUER: env.ACCESS_ISSUER },
      { ...config(), ACCESS_AUDIENCE: env.ACCESS_AUDIENCE },
      { ...config(), OWNER_SUBJECT: env.OWNER_SUBJECT },
    ]) {
      expect(authenticationMode(settings)).toBe('access');
      expect((await api('settings', passwordCookie, settings)).status).toBe(
        settings.ACCESS_ISSUER &&
          settings.ACCESS_AUDIENCE &&
          settings.OWNER_SUBJECT
          ? 401
          : 503
      );
      expect((await login(settings)).status).toBe(409);
    }
  });

  it('denies incorrect passwords, forged Access headers and unauthenticated business requests', async () => {
    const response = await login(config(), 'incorrect');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'login_failed' });
    for (const path of [
      'settings',
      'entries',
      'exports/backup',
      'ai',
      'chat',
      'wechat',
    ]) {
      const denied = await handlePrivateApi(
        request(path, undefined, { 'Cf-Access-Jwt-Assertion': 'forged' }),
        config()
      );
      expect(denied.status, path).toBe(401);
      expect(await denied.json()).toEqual({ error: 'login_required' });
    }
    expect(
      await env.DB.prepare('SELECT COUNT(*) n FROM auth_sessions').first('n')
    ).toBe(0);
  });

  it('issues a host-only secure session, stores no raw credential and permits manual operations without AI', async () => {
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(/^__Host-moni_session=[a-f0-9]{64};/);
    for (const flag of [
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Max-Age=2592000',
    ])
      expect(setCookie).toContain(flag);
    expect(setCookie).not.toContain('Domain=');
    expect(setCookie).not.toContain(password);
    const cookie = setCookie.split(';')[0];
    const row = await env.DB.prepare('SELECT * FROM auth_sessions').first();
    expect(row?.origin).toBe('https://moni.test');
    expect(row?.token_hash).not.toBe(cookie.split('=')[1]);
    expect(JSON.stringify(row)).not.toContain(password);
    expect((await api('auth', cookie)).status).toBe(200);
    expect(await (await api('auth', cookie)).json()).toEqual({
      mode: 'password',
    });
    const initialized = await handlePrivateApi(
      request(
        'initialize',
        {
          datasetId: 'initial',
          operationId: crypto.randomUUID(),
          primaryCurrency: 'CNY',
          timeZone: 'Asia/Shanghai',
        },
        { Cookie: cookie }
      ),
      config()
    );
    expect(initialized.status).toBe(200);
    const saved = await handlePrivateApi(
      request(
        'entries',
        {
          datasetId: 'initial',
          operationId: crypto.randomUUID(),
          id: crypto.randomUUID(),
          kind: 'expense',
          name: 'Synthetic password login lunch',
          amount: '35',
          note: 'Synthetic preserved note',
        },
        { Cookie: cookie }
      ),
      config()
    );
    expect(saved.status).toBe(200);
    const entries = await api('entries', cookie);
    expect(entries.status).toBe(200);
    expect(await entries.text()).toContain('Synthetic preserved note');
    const backup = await api('exports/backup?datasetId=initial', cookie);
    expect(backup.status).toBe(200);
    const body = await backup.text();
    for (const excluded of [
      password,
      cookie.split('=')[1],
      'auth_sessions',
      'auth_login_limits',
      'credential_hash',
    ])
      expect(body).not.toContain(excluded);
    expect(body).toContain('Synthetic preserved note');
  });

  it('logs out the current session permanently while another browser stays signed in', async () => {
    const first = await session();
    const second = await session();
    expect(first).not.toBe(second);
    const response = await handlePrivateApi(
      request('auth/logout', {}, { Cookie: first }),
      config()
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await api('settings', first)).status).toBe(401);
    expect((await api('settings', second)).status).toBe(200);
    expect(
      (
        await handlePrivateApi(
          request('auth/logout', {}, { Cookie: first }),
          config()
        )
      ).status
    ).toBe(200);
  });

  it('rejects expired, tampered, duplicated and other-host session cookies', async () => {
    const cookie = await session();
    expect((await api('settings', cookie.replace(/.$/, 'z'))).status).toBe(401);
    expect((await api('settings', `${cookie}; ${cookie}`)).status).toBe(401);
    expect(
      (
        await handlePrivateApi(
          new Request('https://alternate.test/api/settings', {
            headers: { Cookie: cookie },
          }),
          config()
        )
      ).status
    ).toBe(401);
    await env.DB.prepare('UPDATE auth_sessions SET expires_at=?')
      .bind(Date.now() - 1)
      .run();
    expect((await api('settings', cookie)).status).toBe(401);
  });

  it('invalidates old sessions on password or master-key changes without changing business data', async () => {
    const cookie = await session();
    const before = await env.DB.prepare('SELECT * FROM datasets').all();
    const settings = {
      ...config(),
      MONI_PASSWORD: 'synthetic-replacement-password',
    };
    expect((await api('settings', cookie, settings)).status).toBe(401);
    expect((await login(settings)).status).toBe(401);
    expect((await login(settings, settings.MONI_PASSWORD)).status).toBe(200);
    expect((await api('settings', cookie)).status).toBe(401);
    expect(
      (
        await api('settings', cookie, {
          ...config(),
          CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
        })
      ).status
    ).toBe(401);
    expect(
      (await env.DB.prepare('SELECT * FROM datasets').all()).results
    ).toEqual(before.results);
  });

  it('rotates an existing browser session on successful sign-in', async () => {
    const oldCookie = await session();
    const response = await login(config(), password, { Cookie: oldCookie });
    expect(response.status).toBe(200);
    const nextCookie = (response.headers.get('Set-Cookie') ?? '').split(';')[0];
    expect(nextCookie).not.toBe(oldCookie);
    expect((await api('settings', oldCookie)).status).toBe(401);
    expect((await api('settings', nextCookie)).status).toBe(200);
  });

  it('does not accept cross-site login or logout and preserves a valid session on rejection', async () => {
    const cookie = await session();
    const requests: Record<string, string>[] = [
      { Origin: 'https://untrusted.test' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of requests) {
      expect((await login(config(), password, headers)).status).toBe(403);
      const rejected = await handlePrivateApi(
        request('auth/logout', {}, { ...headers, Cookie: cookie }),
        config()
      );
      expect(rejected.status).toBe(403);
    }
    expect((await api('settings', cookie)).status).toBe(200);
  });

  it('enforces a persistent atomic per-client limit across simultaneous requests and resets after the window', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        login(config(), 'incorrect', { 'CF-Connecting-IP': '192.0.2.10' })
      )
    );
    expect(responses.filter((r) => r.status === 401)).toHaveLength(5);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
    expect(
      responses.find((r) => r.status === 429)?.headers.get('Retry-After')
    ).toBe('900');
    expect(
      (await login(config(), password, { 'CF-Connecting-IP': '192.0.2.10' }))
        .status
    ).toBe(429);
    expect(
      (await login(config(), password, { 'CF-Connecting-IP': '192.0.2.11' }))
        .status
    ).toBe(200);
    await env.DB.prepare('UPDATE auth_login_limits SET reset_at=?')
      .bind(Date.now() - 1)
      .run();
    expect(
      (await login(config(), password, { 'CF-Connecting-IP': '192.0.2.10' }))
        .status
    ).toBe(200);
    const body = JSON.stringify(
      (await env.DB.prepare('SELECT * FROM auth_login_limits').all()).results
    );
    expect(body).not.toContain('192.0.2.10');
    expect(body).not.toContain(password);
  });

  it('validates methods, size, input and transport without exposing credentials', async () => {
    expect((await api('auth/login')).status).toBe(405);
    expect((await api('auth/unrelated')).status).toBe(404);
    expect(
      (
        await handlePrivateApi(
          request('auth/login', { password, owner: true }),
          config()
        )
      ).status
    ).toBe(400);
    expect(
      (
        await handlePrivateApi(
          request('auth/login', { password: 'x'.repeat(3000) }),
          config()
        )
      ).status
    ).toBe(413);
    const insecure = await handlePrivateApi(
      new Request('http://moni.test/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }),
      config()
    );
    expect(insecure.status).toBe(400);
    expect(await insecure.text()).not.toContain(password);
    const broken = await login({ ...config(), DB: env.DB_UPGRADE });
    expect(broken.status).toBe(500);
    expect(await broken.json()).toEqual({ error: 'request_failed' });
  });
});
