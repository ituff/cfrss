import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { FC_OPTIONS } from './setup';

describe('Testing framework setup', () => {
  it('should run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should run fast-check with configured options', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      FC_OPTIONS
    );
  });
});
