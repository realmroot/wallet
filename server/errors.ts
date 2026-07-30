export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: HeadersInit,
  ) {
    super(message)
  }
}

export const unauthorized = (message: string, headers?: HeadersInit) =>
  new ApiError(401, 'unauthorized', message, headers)
export const forbidden = (message: string) => new ApiError(403, 'forbidden', message)
export const badRequest = (message: string) => new ApiError(400, 'bad_request', message)
export const conflict = (message: string) => new ApiError(409, 'conflict', message)
export const notFound = (message: string) => new ApiError(404, 'not_found', message)
