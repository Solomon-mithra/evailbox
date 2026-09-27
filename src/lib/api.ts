export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as {
    data: T;
    error?: { message: string; code: string };
  } | null;
  if (!response.ok || !result)
    throw new RequestError(
      result?.error?.message ?? 'Could not connect. Please try again.',
      response.status,
      result?.error?.code ?? 'NETWORK_ERROR',
    );
  return result.data;
}
export const api = {
  get: <T>(p: string, signal?: AbortSignal) => request<T>(p, 'GET', undefined, signal),
  post: <T>(p: string, b: unknown = {}) => request<T>(p, 'POST', b),
  patch: <T>(p: string, b: unknown) => request<T>(p, 'PATCH', b),
  delete: <T>(p: string, b?: unknown) => request<T>(p, 'DELETE', b),
};
