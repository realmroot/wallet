import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly headers?: HeadersInit,
    readonly diagnostics?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const unauthorized = (message: string, headers?: HeadersInit) =>
  new ApiError(401, 'unauthorized', message, headers)
export const forbidden = (message: string, headers?: HeadersInit) =>
  new ApiError(403, 'forbidden', message, headers)
export const badRequest = (message: string) => new ApiError(400, 'bad_request', message)
export const conflict = (message: string) => new ApiError(409, 'conflict', message)
export const tooEarly = (message: string, retryAfterSeconds = 3) =>
  new ApiError(425, 'settlement_pending', message, {
    'Retry-After': String(retryAfterSeconds),
  })
export const notFound = (message: string) => new ApiError(404, 'not_found', message)
export const upstreamError = (
  message: string,
  diagnostics?: Readonly<Record<string, unknown>>,
) => new ApiError(502, 'upstream_error', message, undefined, diagnostics)
