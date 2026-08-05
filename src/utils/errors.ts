/**
 * Application error handling utilities.
 * Provides typed error classes and factory functions for consistent API error responses.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'UPSTREAM_ERROR'
  | 'SERVICE_UNAVAILABLE';

const STATUS_CODE_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  CONFLICT: 409,
  UPSTREAM_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Application-level error with HTTP status code and machine-readable code.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options?: { retryable?: boolean; details?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_CODE_MAP[code];
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

// --- Factory functions ---

export function validationError(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_ERROR', message, { retryable: false, details });
}

export function notFoundError(message: string, details?: unknown): AppError {
  return new AppError('NOT_FOUND', message, { retryable: false, details });
}

export function timeoutError(message: string, details?: unknown): AppError {
  return new AppError('TIMEOUT', message, { retryable: true, details });
}

export function conflictError(message: string, details?: unknown): AppError {
  return new AppError('CONFLICT', message, { retryable: false, details });
}

export function upstreamError(message: string, details?: unknown): AppError {
  return new AppError('UPSTREAM_ERROR', message, { retryable: true, details });
}

export function serviceUnavailableError(message: string, details?: unknown): AppError {
  return new AppError('SERVICE_UNAVAILABLE', message, { retryable: true, details });
}
