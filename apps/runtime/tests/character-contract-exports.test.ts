import {expect, it} from 'vitest';
it('exposes independent character contracts and parsers', async () => {
  const module = await import('../src/contracts/character-template-validation.js').catch(() => ({}));
  for (const name of ['parseName', 'parseSettings', 'parseId', 'parseCreate', 'parseUpdate', 'parseLifecycle', 'parseList']) {
    expect(typeof (module as Record<string, unknown>)[name], name).toBe('function');
  }
});
it('exposes a dedicated character host composition', async () => {
  const module = await import('../src/host/index.js');
  expect(typeof (module as Record<string, unknown>).withLocalCharacters).toBe('function');
});
