import { getIdToken } from './auth';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CaptureItem {
  pk: string;
  capturedAt: number;
  scenario: string;
  location: string;
  taskType: string;
  deviceId: string;
  s3Key: string;
  labelStatus: string;
  labelQuality: string;
  labelTags: string[];
  labelNotes: string;
}

export interface SensorResponse {
  start: number;
  rate: number;
  data: number[][];
}

export interface Labels {
  quality: string;
  tags: string[];
  issues: string[];
  notes: string;
  reviewer: string;
  reviewedAt: number | null;
  status: string;
}

export interface ListCapturesResponse {
  items: CaptureItem[];
  count: number;
}

// ── Client ────────────────────────────────────────────────────────────────────

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

  if (res.status === 401 || res.status === 403) {
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export function listCaptures(params: { limit?: number; scenario?: string; status?: string } = {}) {
  const q = new URLSearchParams();
  if (params.limit)    q.set('limit', String(params.limit));
  if (params.scenario) q.set('scenario', params.scenario);
  if (params.status)   q.set('status', params.status);
  const qs = q.toString() ? `?${q}` : '';
  return request<ListCapturesResponse>(`/api/captures${qs}`);
}

export function getVideoUrl(captureId: string) {
  return request<{ url: string; expiresIn: number }>(
    `/api/captures/${encodeURIComponent(captureId)}/video`
  );
}

export function getSensorData(captureId: string) {
  return request<SensorResponse>(
    `/api/captures/${encodeURIComponent(captureId)}/sensor-data`
  );
}

export function getLabels(captureId: string) {
  return request<Labels>(
    `/api/captures/${encodeURIComponent(captureId)}/labels`
  );
}

export function updateLabels(captureId: string, labels: Partial<Labels>) {
  return request<{ success: boolean }>(
    `/api/captures/${encodeURIComponent(captureId)}/labels`,
    { method: 'PUT', body: JSON.stringify(labels) }
  );
}
