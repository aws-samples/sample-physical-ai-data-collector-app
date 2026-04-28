/**
 * auth.ts — Cognito OAuth2 PKCE helpers
 *
 * Env vars (Vite):
 *   VITE_USER_POOL_DOMAIN      e.g. https://pai-viewer-123456789.auth.us-east-1.amazoncognito.com
 *   VITE_USER_POOL_CLIENT_ID   e.g. abc123xyz
 *   VITE_OAUTH_REDIRECT_URI    e.g. https://xxxxx.cloudfront.net
 */

const DOMAIN       = (import.meta.env.VITE_USER_POOL_DOMAIN ?? '').replace(/\/$/, '');
const CLIENT_ID    = import.meta.env.VITE_USER_POOL_CLIENT_ID ?? '';
const REDIRECT_URI = import.meta.env.VITE_OAUTH_REDIRECT_URI ?? window.location.origin + '/';

const KEY_ID_TOKEN     = 'pai_id_token';
const KEY_ACCESS_TOKEN = 'pai_access_token';
const KEY_VERIFIER     = 'pai_pkce_verifier';
const KEY_STATE        = 'pai_pkce_state';

// ── PKCE utils ────────────────────────────────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateVerifier(): Promise<string> {
  const arr = new Uint8Array(48);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

async function deriveChallenge(verifier: string): Promise<string> {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return b64url(new Uint8Array(digest));
}

function randomState(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function login(): Promise<void> {
  const verifier  = await generateVerifier();
  const challenge = await deriveChallenge(verifier);
  const state     = randomState();

  sessionStorage.setItem(KEY_VERIFIER, verifier);
  sessionStorage.setItem(KEY_STATE, state);

  const params = new URLSearchParams({
    response_type:          'code',
    client_id:              CLIENT_ID,
    redirect_uri:           REDIRECT_URI,
    scope:                  'openid email profile',
    code_challenge_method:  'S256',
    code_challenge:         challenge,
    state,
  });

  window.location.href = `${DOMAIN}/oauth2/authorize?${params}`;
}

export async function handleCallback(): Promise<boolean> {
  const params   = new URLSearchParams(window.location.search);
  const code     = params.get('code');
  const retState = params.get('state');
  const verifier = sessionStorage.getItem(KEY_VERIFIER);
  const sentState = sessionStorage.getItem(KEY_STATE);

  if (!code || !verifier) return false;
  if (retState && sentState && retState !== sentState) return false;

  sessionStorage.removeItem(KEY_VERIFIER);
  sessionStorage.removeItem(KEY_STATE);

  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      client_id:    CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) return false;

  const tokens = await res.json() as { id_token: string; access_token: string };
  localStorage.setItem(KEY_ID_TOKEN, tokens.id_token);
  localStorage.setItem(KEY_ACCESS_TOKEN, tokens.access_token);
  window.history.replaceState({}, '', window.location.pathname);
  return true;
}

export interface UserInfo {
  sub: string;
  email: string;
  username: string;
}

export function getUser(): UserInfo | null {
  const token = localStorage.getItem(KEY_ID_TOKEN);
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as Record<string, string>;
    // Check expiry
    if (Number(payload.exp) * 1000 < Date.now()) {
      logout();
      return null;
    }
    return {
      sub:      payload.sub ?? '',
      email:    payload.email ?? '',
      username: payload['cognito:username'] ?? payload.email ?? payload.sub ?? '',
    };
  } catch {
    return null;
  }
}

export function getIdToken(): string {
  return localStorage.getItem(KEY_ID_TOKEN) ?? '';
}

export function isAuthenticated(): boolean {
  return !!getUser();
}

export function logout(): void {
  localStorage.removeItem(KEY_ID_TOKEN);
  localStorage.removeItem(KEY_ACCESS_TOKEN);
  const url = `${DOMAIN}/logout?client_id=${CLIENT_ID}&logout_uri=${encodeURIComponent(REDIRECT_URI)}`;
  window.location.href = url;
}
