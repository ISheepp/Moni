import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AccessError, verifyAccess } from './access';
import { HttpError, readJson } from './http';

const cookieName = '__Host-moni_session';
const sessionSeconds = 30 * 24 * 60 * 60;
const loginWindowMs = 15 * 60 * 1000;
const loginLimit = 5;
const encoder = new TextEncoder();
const hex = (value: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
const digest = async (value: string) =>
  hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

export function authenticationMode(env: Env) {
  // A partial Access configuration must never silently enable password fallback.
  return env.ACCESS_ISSUER || env.ACCESS_AUDIENCE || env.OWNER_SUBJECT
    ? 'access'
    : 'password';
}

const passwordInput = z
  .string()
  .min(15)
  .max(128)
  .refine((value) => !!value.trim());
const hex64 = /^[a-f0-9]{64}$/i;
const freshLedger = `EXISTS (SELECT 1 FROM moni_state s JOIN datasets d ON d.id=s.active_dataset
  WHERE s.singleton=1 AND s.active_dataset='initial' AND s.revision=0 AND d.initialized=0 AND d.version=0)
  AND NOT EXISTS (SELECT 1 FROM datasets WHERE id<>'initial')
  AND NOT EXISTS (SELECT 1 FROM entries)
  AND NOT EXISTS (SELECT 1 FROM conversations)
  AND NOT EXISTS (SELECT 1 FROM chat_messages)
  AND NOT EXISTS (SELECT 1 FROM chat_runs)
  AND NOT EXISTS (SELECT 1 FROM drafts)
  AND NOT EXISTS (SELECT 1 FROM service_configuration)
  AND NOT EXISTS (SELECT 1 FROM wechat_binding)
  AND NOT EXISTS (SELECT 1 FROM auth_sessions)
  AND NOT EXISTS (SELECT 1 FROM auth_credentials)`;

async function assertSetupAllowed(env: Env) {
  if (
    !env.CONVERSATIONS ||
    !(await env.DB.prepare(`SELECT 1 WHERE ${freshLedger}`).first())
  )
    throw new AccessError(503, 'access_not_configured');
}

async function passwordCredential(env: Env) {
  if (!hex64.test(env.CONFIG_ENCRYPTION_KEY ?? ''))
    throw new AccessError(503, 'access_not_configured');
  if (env.MONI_PASSWORD) {
    if (!passwordInput.safeParse(env.MONI_PASSWORD).success)
      throw new AccessError(503, 'access_not_configured');
    return {
      source: 'environment' as const,
      fingerprint: hex(await credentialHash(env, env.MONI_PASSWORD)),
    };
  }
  const stored = await env.DB.prepare(
    'SELECT source,salt,verifier FROM auth_credentials WHERE singleton=1'
  ).first<{ source: string; salt: string | null; verifier: string | null }>();
  if (!stored) return null;
  if (
    stored.source !== 'web' ||
    !stored.salt ||
    !hex64.test(stored.salt) ||
    !stored.verifier ||
    !hex64.test(stored.verifier)
  )
    throw new AccessError(503, 'access_not_configured');
  return {
    source: 'web' as const,
    salt: stored.salt,
    verifier: stored.verifier,
    fingerprint: hex(
      await credentialHash(env, `web:v1\0${stored.salt}\0${stored.verifier}`)
    ),
  };
}

async function requireCredential(env: Env) {
  const credential = await passwordCredential(env);
  if (credential) return credential;
  await assertSetupAllowed(env);
  throw new AccessError(503, 'password_setup_required');
}

async function credentialHash(env: Env, password: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.CONFIG_ENCRYPTION_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`moni:password:v1\0${password}`)
  );
}

async function passwordVerifier(env: Env, password: string, salt: string) {
  // A database copy alone cannot test guesses without the deployment's pepper.
  const key = await crypto.subtle.importKey(
    'raw',
    await credentialHash(env, password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: 100000,
        salt: Uint8Array.from(salt.match(/../g) ?? [], (pair) =>
          Number.parseInt(pair, 16)
        ),
      },
      key,
      256
    )
  );
}

function sessionToken(request: Request) {
  const header = request.headers.get('Cookie') ?? '';
  if (header.length > 8192) return null;
  const values = header
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${cookieName}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export async function verifyOwner(request: Request, env: Env) {
  if (authenticationMode(env) === 'access') return verifyAccess(request, env);
  const credential = await requireCredential(env);
  const token = sessionToken(request);
  if (!token) throw new AccessError(401, 'login_required');
  const valid = await env.DB.prepare(`SELECT 1 FROM auth_sessions
    WHERE token_hash=? AND credential_hash=? AND origin=? AND expires_at>?`)
    .bind(
      await digest(token),
      credential.fingerprint,
      new URL(request.url).origin,
      Date.now()
    )
    .first();
  if (!valid) throw new AccessError(401, 'login_required');
  return 'password-owner';
}

function cookie(value: string, maxAge: number) {
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function handleAuthentication(request: Request, env: Env) {
  const url = new URL(request.url);
  const mode = authenticationMode(env);
  if (url.pathname === '/api/auth' && request.method === 'GET') {
    await verifyOwner(request, env);
    return Response.json({ mode });
  }
  const setup = url.pathname === '/api/auth/setup';
  if (
    !['/api/auth/login', '/api/auth/logout', '/api/auth/setup'].includes(
      url.pathname
    )
  )
    throw new HttpError(404, 'not_found');
  if (setup && request.method === 'GET') {
    if (mode !== 'password') throw new HttpError(409, 'access_login_required');
    if (await passwordCredential(env))
      return Response.json({ setupRequired: false });
    await assertSetupAllowed(env);
    return Response.json({ setupRequired: true });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  if (mode !== 'password') throw new HttpError(409, 'access_login_required');
  const credential = setup
    ? await passwordCredential(env)
    : await requireCredential(env);
  if (setup) {
    if (credential) throw new HttpError(409, 'password_already_configured');
    await assertSetupAllowed(env);
  }
  if (
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new HttpError(400, 'https_required');
  const body = await readJson(request, 2048);
  if (url.pathname === '/api/auth/logout') {
    if (!z.object({}).strict().safeParse(body).success)
      throw new HttpError(400, 'invalid_login');
    const token = sessionToken(request);
    if (token)
      await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?')
        .bind(await digest(token))
        .run();
    return Response.json(
      { signedOut: true },
      { headers: { 'Set-Cookie': cookie('', 0) } }
    );
  }
  const input = z
    .object({
      password: setup ? passwordInput : z.string().min(1).max(128),
      ...(setup ? { confirmPassword: z.string().max(128) } : {}),
    })
    .strict()
    .safeParse(body);
  if (!input.success) throw new HttpError(400, 'invalid_login');
  if (setup && input.data.password !== input.data.confirmPassword)
    throw new HttpError(400, 'password_mismatch');
  const now = Date.now();
  const client = await digest(
    request.headers.get('CF-Connecting-IP') ?? 'unknown'
  );
  const limit =
    await env.DB.prepare(`INSERT INTO auth_login_limits(client_hash,attempts,reset_at)
    VALUES (?,1,?) ON CONFLICT(client_hash) DO UPDATE SET
      attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END
    WHERE reset_at<=? OR attempts<? RETURNING reset_at`)
      .bind(client, now + loginWindowMs, now, now, now, loginLimit)
      .first<{ reset_at: number }>();
  if (!limit)
    return Response.json(
      { error: 'login_rate_limited' },
      { status: 429, headers: { 'Retry-After': '900' } }
    );
  let active = credential;
  if (setup) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = await passwordVerifier(env, input.data.password, salt);
    // The condition and singleton insert are one write: only one first-run request can win.
    const saved =
      await env.DB.prepare(`INSERT INTO auth_credentials(singleton,source,salt,verifier)
      SELECT 1,'web',?,? WHERE ${freshLedger} ON CONFLICT(singleton) DO NOTHING`)
        .bind(salt, verifier)
        .run();
    if (saved.meta.changes !== 1)
      throw new HttpError(409, 'password_already_configured');
    active = await requireCredential(env);
  } else if (active) {
    const expected =
      active.source === 'web' ? active.verifier : active.fingerprint;
    const actual =
      active.source === 'web'
        ? await passwordVerifier(env, input.data.password, active.salt)
        : hex(await credentialHash(env, input.data.password));
    if (!timingSafeEqual(encoder.encode(expected), encoder.encode(actual)))
      throw new HttpError(401, 'login_failed');
  }
  if (!active) throw new AccessError(503, 'access_not_configured');
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const previousToken = sessionToken(request);
  // Environment recovery replaces the web verifier so removing the override cannot revive an old password.
  await env.DB.batch([
    ...(active.source === 'environment'
      ? [
          env.DB.prepare(`INSERT INTO auth_credentials(singleton,source)
      VALUES (1,'environment') ON CONFLICT(singleton) DO UPDATE SET source='environment',salt=NULL,verifier=NULL`),
        ]
      : []),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM auth_sessions WHERE credential_hash<>?').bind(
      active.fingerprint
    ),
    ...(previousToken
      ? [
          env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(
            await digest(previousToken)
          ),
        ]
      : []),
    env.DB.prepare('DELETE FROM auth_login_limits WHERE reset_at<=?').bind(now),
    env.DB.prepare(`INSERT INTO auth_sessions(token_hash,credential_hash,origin,expires_at)
      VALUES (?,?,?,?)`).bind(
      await digest(token),
      active.fingerprint,
      url.origin,
      now + sessionSeconds * 1000
    ),
  ]);
  return Response.json(
    { signedIn: true },
    { headers: { 'Set-Cookie': cookie(token, sessionSeconds) } }
  );
}
