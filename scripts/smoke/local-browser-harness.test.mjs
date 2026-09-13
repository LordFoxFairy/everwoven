import {describe, expect, it} from 'vitest';
import {fillConnectionCode} from './local-browser-harness.mjs';

describe('private connection entry', () => {
  it('still enters the supplied code through the original UI locator', async () => {
    const values = [];
    await fillConnectionCode({fill: async value => {values.push(value);}}, 'fixture-code');
    expect(values).toEqual(['fixture-code']);
  });
  it('does not propagate a Playwright call log, cause or credential on failure', async () => {
    const source = Object.assign(Error('fill("FIXTURE-SECRET") timed out'), {cause: Error('FIXTURE-SECRET'), log: ['FIXTURE-SECRET']});
    let failure;
    try {await fillConnectionCode({fill: async () => {throw source;}}, 'FIXTURE-SECRET');} catch (error) {failure = error;}
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe('Connection code entry failed');
    expect(failure.cause).toBeUndefined();
    expect(`${failure.stack} ${JSON.stringify(failure)}`).not.toContain('FIXTURE-SECRET');
  });
});
