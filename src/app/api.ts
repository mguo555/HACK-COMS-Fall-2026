// Thin fetch wrappers for the server API (server/app.ts). Errors carry the server's message,
// which is written to be shown to people as is.
import type {
  Board,
  LikeResult,
  Me,
  ModQueue,
  MyPost,
  Profile,
  SessionInfo,
  ThemeList,
} from './shared/protocol';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

async function request<T>(
  method: 'GET' | 'POST',
  url: string,
  options: { json?: unknown; body?: Blob; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined = options.body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch {
    throw new ApiError(0, "Can't reach TheDailyStalk right now. Check your connection.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Something went wrong.');
  return data as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, json: unknown = {}) => request<T>('POST', url, { json });

export const api = {
  session: () => get<SessionInfo>('/api/session'),
  requestCode: (email: string) => post<{ resendIn: number }>('/api/auth/code', { email }),
  verify: (email: string, code: string) => post<{ user: Me }>('/api/auth/verify', { email, code }),
  setHandle: (handle: string) => post<{ user: Me }>('/api/auth/handle', { handle }),
  signOut: () => post('/api/auth/sign-out'),

  themes: () => get<ThemeList>('/api/days'),
  board: (date: string) => get<Board>(`/api/days/${date}`),
  upload: (file: Blob, day: string) =>
    request<{ post: MyPost }>('POST', '/api/posts', {
      body: file,
      headers: { 'Content-Type': file.type || 'image/unknown', 'X-Day': day },
    }),
  like: (id: string, liked: boolean) => post<LikeResult>(`/api/posts/${id}/like`, { liked }),
  report: (id: string) => post(`/api/posts/${id}/report`),
  deletePost: (id: string) => post(`/api/posts/${id}/delete`),
  profile: (handle: string) => get<Profile>(`/api/users/${encodeURIComponent(handle)}`),

  modQueue: () => get<ModQueue>('/api/mod/queue'),
  moderate: (id: string, action: 'keep' | 'remove') => post(`/api/mod/posts/${id}`, { action }),
  ban: (handle: string) => post(`/api/mod/users/${encodeURIComponent(handle)}/ban`),
};

export function imageUrl(id: string, kind: 'full' | 'thumb' = 'thumb'): string {
  return `/api/img/${id}/${kind}`;
}
