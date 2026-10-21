import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { handlePrivateApi } from '../../src/worker';

const password = 'synthetic-web-setup-password';
const config = (): Env => ({
  ...env,
  ACCESS_ISSUER: '',
  ACCESS_AUDIENCE: '',
  OWNER_SUBJECT: '',
  MONI_PASSWORD: '',
  AI_API_KEY: '',
  AI_BASE_URL: '',
  AI_MODEL: '',
});
function api(
  path: string,
  body?: unknown,
  settings = config(),
  headers: Record<string, string> = {}
) {
  return handlePrivateApi(
    new Request(`https://moni.test/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    settings
  );
}
const setup = (
  settings = config(),
  value = password,
  headers: Record<string, string> = {}
) =>
  api(
    'auth/setup',
    { password: value, confirmPassword: value },
    settings,
    headers
  );
const cookieOf = (response: Response) =>
  (response.headers.get('Set-Cookie') ?? '').split(';')[0];

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_credentials'),
    env.DB.prepare('DELETE FROM auth_sessions'),
    env.DB.prepare('DELETE FROM auth_login_limits'),
    env.DB.prepare('DELETE FROM entries'),
    env.DB.prepare('DELETE FROM operation_receipts'),
    env.DB.prepare('DELETE FROM service_configuration'),
    env.DB.prepare("DELETE FROM datasets WHERE id<>'initial'"),
    env.DB.prepare(
      'UPDATE datasets SET initialized=0,currency_locked=0,version=0'
    ),
    env.DB.prepare('UPDATE moni_state SET revision=0'),
  ]);
});

describe('first-run web password setup', () => {
  it('exposes only setup readiness and denies all business access until a password is saved', async () => {
    const response = await api('auth/setup');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ setupRequired: true });
    for (const path of [
      'settings',
      'entries',
      'ai',
      'wechat',
      'exports/backup',
      'auth',
      'chat',
    ]) {
      const denied = await api(path);
      expect(denied.status, path).toBe(503);
      expect(await denied.json()).toEqual({ error: 'password_setup_required' });
    }
    expect(
      await env.DB.prepare('SELECT count(*) n FROM auth_sessions').first('n')
    ).toBe(0);
  });

  it('sets a salted password, signs in, preserves manual notes, and excludes authentication from backups', async () => {
    const before = await env.DB.prepare('SELECT * FROM datasets').all();
    const response = await setup();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedIn: true });
    const cookie = cookieOf(response);
    expect(cookie).toMatch(/^__Host-moni_session=[a-f0-9]{64}$/);
    expect(response.headers.get('Set-Cookie')).toContain(
      'HttpOnly; Secure; SameSite=Strict'
    );
    const credential = await env.DB.prepare(
      'SELECT * FROM auth_credentials'
    ).first();
    expect(credential).toMatchObject({
      source: 'web',
      salt: expect.stringMatching(/^[a-f0-9]{64}$/),
      verifier: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(credential)).not.toContain(password);
    expect(
      (await env.DB.prepare('SELECT * FROM datasets').all()).results
    ).toEqual(before.results);
    expect(await (await api('auth/setup')).json()).toEqual({
      setupRequired: false,
    });
    expect((await api('settings')).status).toBe(401);
    expect(
      (await api('settings', undefined, config(), { Cookie: cookie })).status
    ).toBe(200);
    expect(
      (
        await api(
          'initialize',
          {
            datasetId: 'initial',
            operationId: crypto.randomUUID(),
            primaryCurrency: 'CNY',
            timeZone: 'Asia/Shanghai',
          },
          config(),
          { Cookie: cookie }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await api(
          'entries',
          {
            datasetId: 'initial',
            operationId: crypto.randomUUID(),
            id: crypto.randomUUID(),
            kind: 'expense',
            name: 'Synthetic first-run lunch',
            amount: '35',
            note: 'Synthetic preserved lunch note',
          },
          config(),
          { Cookie: cookie }
        )
      ).status
    ).toBe(200);
    const backup = await api(
      'exports/backup?datasetId=initial',
      undefined,
      config(),
      { Cookie: cookie }
    );
    expect(backup.status).toBe(200);
    const content = await backup.text();
    expect(content).toContain('Synthetic preserved lunch note');
    for (const value of [
      password,
      cookie.split('=')[1],
      'auth_credentials',
      String(credential?.salt),
      String(credential?.verifier),
    ])
      expect(content).not.toContain(value);
    expect(
      (await api('ai', undefined, config(), { Cookie: cookie })).status
    ).toBe(200);
  });

  it('uses the saved password on subsequent logins, rotates sessions and revokes logout', async () => {
    const first = cookieOf(await setup());
    expect((await api('auth/login', { password: 'incorrect' })).status).toBe(
      401
    );
    const response = await api('auth/login', { password }, config(), {
      Cookie: first,
    });
    expect(response.status).toBe(200);
    const second = cookieOf(response);
    expect(second).not.toBe(first);
    expect(
      (await api('settings', undefined, config(), { Cookie: first })).status
    ).toBe(401);
    expect(
      (await api('auth/logout', {}, config(), { Cookie: second })).status
    ).toBe(200);
    expect(
      (await api('settings', undefined, config(), { Cookie: second })).status
    ).toBe(401);
    expect(await (await api('auth/setup')).json()).toEqual({
      setupRequired: false,
    });
    expect((await setup()).status).toBe(409);
    expect((await api('auth/login', { password })).status).toBe(200);
  });

  it('allows exactly one winner across competing first-run requests and never signs in losers', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        setup(config(), `${password}-${index}`)
      )
    );
    expect(results.filter((response) => response.status === 200)).toHaveLength(
      1
    );
    expect(results.filter((response) => response.status === 409)).toHaveLength(
      3
    );
    for (const response of results.filter(
      (response) => response.status !== 200
    ))
      expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(
      await env.DB.prepare('SELECT count(*) n FROM auth_credentials').first('n')
    ).toBe(1);
    expect(
      await env.DB.prepare('SELECT count(*) n FROM auth_sessions').first('n')
    ).toBe(1);
    const winner = results.findIndex((response) => response.status === 200);
    for (let index = 0; index < results.length; index++) {
      const response = await api(
        'auth/login',
        { password: `${password}-${index}` },
        config(),
        { 'CF-Connecting-IP': `192.0.2.${index}` }
      );
      expect(response.status).toBe(index === winner ? 200 : 401);
    }
  });

  it.each([
    'short',
    ' '.repeat(16),
    'x'.repeat(129),
  ])('rejects unsafe initial passwords: %s', async (value) => {
    expect((await setup(config(), value)).status).toBe(400);
    expect(await (await api('auth/setup')).json()).toEqual({
      setupRequired: true,
    });
    expect(
      await env.DB.prepare('SELECT count(*) n FROM auth_credentials').first('n')
    ).toBe(0);
  });

  it('validates matching confirmation, strict fields, origin, transport, method and bounded input', async () => {
    for (const body of [
      { password },
      { password, confirmPassword: 'different' },
      { password, confirmPassword: password, owner: true },
    ]) {
      expect((await api('auth/setup', body)).status).toBe(400);
    }
    const origins: Record<string, string>[] = [
      { Origin: 'https://untrusted.test' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of origins) {
      expect((await setup(config(), password, headers)).status).toBe(403);
    }
    const insecure = new Request('http://moni.test/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, confirmPassword: password }),
    });
    expect((await handlePrivateApi(insecure, config())).status).toBe(400);
    expect(
      (
        await handlePrivateApi(
          new Request('https://moni.test/api/auth/setup', { method: 'PUT' }),
          config()
        )
      ).status
    ).toBe(405);
    expect((await setup(config(), 'x'.repeat(3000))).status).toBe(413);
    expect(
      await env.DB.prepare('SELECT count(*) n FROM auth_credentials').first('n')
    ).toBe(0);
  });

  it.each([
    'UPDATE datasets SET initialized=1',
    'UPDATE moni_state SET revision=1',
    "INSERT INTO service_configuration(name,version) VALUES ('ai',1)",
    "INSERT INTO datasets(id) VALUES ('retired')",
  ])('refuses to claim an existing instance with missing authentication: %s', async (sql) => {
    await env.DB.prepare(sql).run();
    const before = await env.DB.prepare('SELECT * FROM datasets').all();
    expect((await api('auth/setup')).status).toBe(503);
    expect((await setup()).status).toBe(503);
    expect(
      (await env.DB.prepare('SELECT * FROM datasets').all()).results
    ).toEqual(before.results);
    expect(
      await env.DB.prepare('SELECT count(*) n FROM auth_credentials').first('n')
    ).toBe(0);
  });

  it('never bypasses Access, invalid deployment passwords, or missing encryption keys', async () => {
    for (const settings of [
      { ...config(), ACCESS_ISSUER: env.ACCESS_ISSUER },
      { ...config(), ACCESS_AUDIENCE: env.ACCESS_AUDIENCE },
      { ...config(), OWNER_SUBJECT: env.OWNER_SUBJECT },
      { ...env },
    ]) {
      expect((await api('auth/setup', undefined, settings)).status).toBe(409);
      expect((await setup(settings)).status).toBe(409);
    }
    for (const settings of [
      { ...config(), MONI_PASSWORD: 'short' },
      { ...config(), CONFIG_ENCRYPTION_KEY: '' },
    ]) {
      expect((await api('auth/setup', undefined, settings)).status).toBe(503);
      expect((await setup(settings)).status).toBe(503);
    }
  });

  it('honors existing password secrets and keeps setup closed after an environment password is removed', async () => {
    const settings = { ...config(), MONI_PASSWORD: password };
    expect(await (await api('auth/setup', undefined, settings)).json()).toEqual(
      { setupRequired: false }
    );
    expect((await setup(settings)).status).toBe(409);
    expect((await api('auth/login', { password }, settings)).status).toBe(200);
    await env.DB.prepare('DELETE FROM auth_sessions').run();
    expect((await setup()).status).toBe(503);
    expect((await api('auth/setup')).status).toBe(503);
  });

  it('allows environment recovery, invalidates old web sessions and never revives the old web password', async () => {
    const cookie = cookieOf(await setup());
    const settings = {
      ...config(),
      MONI_PASSWORD: 'synthetic-recovered-password',
    };
    expect(
      (await api('settings', undefined, settings, { Cookie: cookie })).status
    ).toBe(401);
    expect((await api('auth/login', { password }, settings)).status).toBe(401);
    expect(
      (await api('auth/login', { password: settings.MONI_PASSWORD }, settings))
        .status
    ).toBe(200);
    expect((await api('auth/login', { password })).status).toBe(503);
    expect((await setup()).status).toBe(503);
    expect(
      await env.DB.prepare('SELECT source FROM auth_credentials').first(
        'source'
      )
    ).toBe('environment');
    expect(
      (await api('settings', undefined, config(), { Cookie: cookie })).status
    ).toBe(503);
  });

  it('preserves prior password ownership when upgrading an otherwise empty deployment', async () => {
    await applyD1Migrations(env.DB_UPGRADE, env.TEST_MIGRATIONS.slice(0, -1));
    await env.DB_UPGRADE.prepare(
      "INSERT INTO auth_sessions VALUES ('synthetic','synthetic','https://moni.test',1)"
    ).run();
    await applyD1Migrations(env.DB_UPGRADE, env.TEST_MIGRATIONS);
    expect((await setup({ ...config(), DB: env.DB_UPGRADE })).status).toBe(503);
    expect(
      await env.DB_UPGRADE.prepare('SELECT source FROM auth_credentials').first(
        'source'
      )
    ).toBe('environment');
  });
});
