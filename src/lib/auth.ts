// Autenticación del panel.
// Dos vías, en este orden:
//  1. Cloudflare Access (si CF_ACCESS_TEAM_DOMAIN y CF_ACCESS_AUD están definidos):
//     se verifica el JWT que Access agrega a cada pedido.
//  2. Clave de administrador (secreto ADMIN_PASSWORD): login en /admin/login
//     que deja una cookie firmada (HMAC) por 30 días.
// Si no hay ninguna de las dos configuradas, el panel queda cerrado.
import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

type Secrets = {
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
};
const secrets = () => env as unknown as Secrets;

export const COOKIE = 'ff_admin';
const SESSION_DAYS = 30;

export interface Session {
  user: string;
  via: 'access' | 'password';
}

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(): Promise<CryptoKey | null> {
  const s = secrets();
  const material = s.ADMIN_SESSION_SECRET || s.ADMIN_PASSWORD;
  if (!material) return null;
  return crypto.subtle.importKey('raw', enc.encode('ff-session:' + material), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Valor firmado para la cookie de sesión (sin atributos). */
export async function createSessionToken(user: string): Promise<string> {
  const key = await hmacKey();
  if (!key) throw new Error('Sin secreto de sesión');
  const payload = b64u(enc.encode(JSON.stringify({ u: user, e: Date.now() + SESSION_DAYS * 86400_000 })));
  const sig = b64u(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `${payload}.${sig}`;
}

export const sessionCookieOptions = (secure: boolean) => ({
  path: '/',
  httpOnly: true,
  secure,
  sameSite: 'lax' as const,
  maxAge: SESSION_DAYS * 86400,
});


function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function sessionFromCookie(request: Request): Promise<Session | null> {
  const token = readCookie(request, COOKIE);
  const key = await hmacKey();
  if (!token || !key) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', key, unb64u(sig), enc.encode(payload));
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64u(payload))) as { u: string; e: number };
    if (data.e < Date.now()) return null;
    return { user: data.u, via: 'password' };
  } catch {
    return null;
  }
}

async function sessionFromAccess(request: Request): Promise<Session | null> {
  const { CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud } = secrets();
  if (!team || !aud) return null;
  const token = request.headers.get('cf-access-jwt-assertion') ?? readCookie(request, 'CF_Authorization');
  if (!token) return null;
  try {
    const jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { audience: aud, issuer: `https://${team}` });
    return { user: String(payload.email ?? payload.sub ?? 'access'), via: 'access' };
  } catch {
    return null;
  }
}

export async function getSession(request: Request): Promise<Session | null> {
  return (await sessionFromAccess(request)) ?? (await sessionFromCookie(request));
}

export function passwordLoginEnabled(): boolean {
  return Boolean(secrets().ADMIN_PASSWORD);
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = secrets().ADMIN_PASSWORD;
  if (!expected) return false;
  // Comparación en tiempo constante.
  const a = enc.encode(candidate);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
