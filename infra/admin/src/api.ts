import { getIdToken } from './auth';

const BASE_URL = (import.meta.env.VITE_ADMIN_API_URL ?? '').replace(/\/$/, '');

export interface Invite {
  token: string;
  workspaceName: string;
  orgName: string;
  expiresAt: number;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  isExpired: boolean;
  requireEmailVerification: boolean;
  dailyQuotaGB: number;
  totalQuotaGB: number;
  createdAt: number;
  region: string;
  bucketName: string;
  bucketPrefix: string;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  inviteApiEndpoint: string;
}

export interface QRPayload {
  workspaceName: string;
  orgName: string;
  region: string;
  bucketName: string;
  bucketPrefix: string;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  inviteApiEndpoint: string;
  inviteToken: string;
  expiresAt: string;
  requireEmailVerification: boolean;
}

export interface CreateInviteRequest {
  workspaceName: string;
  orgName: string;
  timeWindowHours: number;
  maxUses: number;
  requireEmailVerification: boolean;
  dailyQuotaGB: number;
  totalQuotaGB: number;
  // QR payload fields (app-level infra)
  region: string;
  bucketName: string;
  bucketPrefix: string;
  autoCreatePrefix: boolean;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  inviteApiEndpoint: string;
}

export interface Member {
  username: string;
  email: string;
  sub: string;
  status: string;
  createdAt: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getIdToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Unauthorized');
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function createInvite(data: CreateInviteRequest) {
  return request<{ token: string; expiresAt: number; qrPayload: QRPayload }>(
    '/admin/invites',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function listInvites(opts: { includeExpired?: boolean; includeInactive?: boolean } = {}) {
  const q = new URLSearchParams();
  if (opts.includeExpired)  q.set('includeExpired', 'true');
  if (opts.includeInactive) q.set('includeInactive', 'true');
  const qs = q.toString() ? `?${q}` : '';
  return request<{ invites: Invite[]; count: number }>(`/admin/invites${qs}`);
}

export function listMembers() {
  return request<{ users: Member[]; count: number }>('/admin/members');
}

// Reuse extend/revoke from InviteStack API
const INVITE_API = (import.meta.env.VITE_INVITE_API_ENDPOINT ?? '').replace(/\/$/, '');

export async function extendInvite(token: string, expiresAtUnix: number) {
  const res = await fetch(`${INVITE_API}/invite/${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresAt: expiresAtUnix }),
  });
  if (!res.ok) throw new Error(`Extend failed: ${res.status}`);
  return res.json();
}

export async function revokeInvite(token: string) {
  const res = await fetch(`${INVITE_API}/invite/${encodeURIComponent(token)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Revoke failed: ${res.status}`);
  return res.json();
}

export function changeAdminPassword(newPassword: string) {
  return request<{ message: string }>('/admin/password', {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}
