import { describe, it, expect } from 'vitest';
import {
  AppError,
  validationError,
  notFoundError,
  timeoutError,
  conflictError,
  upstreamError,
  serviceUnavailableError,
} from '../../src/utils/errors';

describe('AppError', () => {
  it('should create an error with correct properties', () => {
    const err = new AppError('NOT_FOUND', 'Resource not found', { retryable: false });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Resource not found');
    expect(err.statusCode).toBe(404);
    expect(err.retryable).toBe(false);
  });

  it('should default retryable to false', () => {
    const err = new AppError('VALIDATION_ERROR', 'Bad input');
    expect(err.retryable).toBe(false);
  });

  it('should include details when provided', () => {
    const details = { field: 'url', reason: 'invalid format' };
    const err = new AppError('VALIDATION_ERROR', 'Bad input', { details });
    expect(err.details).toEqual(details);
  });

  it('should serialize to JSON correctly', () => {
    const err = new AppError('CONFLICT', 'Duplicate entry', { retryable: false, details: { id: '123' } });
    const json = err.toJSON();
    expect(json).toEqual({
      code: 'CONFLICT',
      message: 'Duplicate entry',
      retryable: false,
      details: { id: '123' },
    });
  });

  it('should omit details from JSON when undefined', () => {
    const err = new AppError('TIMEOUT', 'Request timed out', { retryable: true });
    const json = err.toJSON();
    expect(json).not.toHaveProperty('details');
  });
});

describe('Error factory functions', () => {
  it('validationError creates 400 error', () => {
    const err = validationError('Invalid URL format');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.retryable).toBe(false);
  });

  it('notFoundError creates 404 error', () => {
    const err = notFoundError('Subscription not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.retryable).toBe(false);
  });

  it('timeoutError creates 408 error', () => {
    const err = timeoutError('Feed fetch timed out');
    expect(err.code).toBe('TIMEOUT');
    expect(err.statusCode).toBe(408);
    expect(err.retryable).toBe(true);
  });

  it('conflictError creates 409 error', () => {
    const err = conflictError('Subscription already exists');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
    expect(err.retryable).toBe(false);
  });

  it('upstreamError creates 502 error', () => {
    const err = upstreamError('GitHub API failed');
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.statusCode).toBe(502);
    expect(err.retryable).toBe(true);
  });

  it('serviceUnavailableError creates 503 error', () => {
    const err = serviceUnavailableError('Service temporarily unavailable');
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.statusCode).toBe(503);
    expect(err.retryable).toBe(true);
  });

  it('factory functions pass details correctly', () => {
    const err = validationError('Bad input', { fields: ['name'] });
    expect(err.details).toEqual({ fields: ['name'] });
  });
});

describe('HTTP status code mapping', () => {
  const cases: Array<[() => AppError, number]> = [
    [() => validationError('x'), 400],
    [() => notFoundError('x'), 404],
    [() => timeoutError('x'), 408],
    [() => conflictError('x'), 409],
    [() => upstreamError('x'), 502],
    [() => serviceUnavailableError('x'), 503],
  ];

  it.each(cases)('maps to correct status code %#', (factory, expected) => {
    expect(factory().statusCode).toBe(expected);
  });
});
