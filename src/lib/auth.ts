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

function passwordConfigured(env: Env) {
  if (
    !env.MONI_PASSWORD ||
    env.MONI_PASSWORD.length < 15 ||
    env.MONI_PASSWORD.length > 128 ||
    !env.MONI_PASSWORD.trim() ||
    !/^[a-f0-9]{64}$/i.test(env.CONFIG_ENCRYPTION_KEY ?? '')
  )
    throw new AccessError(503, 'access_not_configured');
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
  passwordConfigured(env);
  const token = sessionToken(request);
  if (!token) throw new AccessError(401, 'login_required');
  const valid = await env.DB.prepare(`SELECT 1 FROM auth_sessions
    WHERE token_hash=? AND credential_hash=? AND origin=? AND expires_at>?`)
    .bind(
      await digest(token),
      hex(await credentialHash(env, env.MONI_PASSWORD)),
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
  if (!['/api/auth/login', '/api/auth/logout'].includes(url.pathname))
    throw new HttpError(404, 'not_found');
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  if (mode !== 'password') throw new HttpError(409, 'access_login_required');
  passwordConfigured(env);
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
    .object({ password: z.string().min(1).max(128) })
    .strict()
    .safeParse(body);
  if (!input.success) throw new HttpError(400, 'invalid_login');
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
  const expected = await credentialHash(env, env.MONI_PASSWORD);
  if (
    !timingSafeEqual(
      new Uint8Array(expected),
      new Uint8Array(await credentialHash(env, input.data.password))
    )
  )
    throw new HttpError(401, 'login_failed');
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const previousToken = sessionToken(request);
  // Only token hashes and keyed credential fingerprints enter D1, never passwords.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM auth_sessions WHERE credential_hash<>?').bind(
      hex(expected)
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
      hex(expected),
      url.origin,
      now + sessionSeconds * 1000
    ),
  ]);
  return Response.json(
    { signedIn: true },
    { headers: { 'Set-Cookie': cookie(token, sessionSeconds) } }
  );
}
