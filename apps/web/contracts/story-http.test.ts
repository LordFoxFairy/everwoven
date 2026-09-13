import {expect, it} from 'vitest';
import {STORY_HTTP_STATUS, STORY_QUERY_MAX_BYTES, storyErrorHTTPStatus} from './story-http';
import {StoryClientError} from '../lib/authoring/story-ports';
import {readFileSync} from 'node:fs';
import {createRequire, stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';

// Vitest resolves .js specifiers to TS sources; production Webpack does not.
// Inspect emitted value imports, then verify package resolution outside Vitest.
it.each([
  '../lib/authoring/story-client.ts',
  '../lib/authoring/story-ports.ts',
  '../lib/authoring/story-client.test.ts',
  '../server/api/story-drafts.ts',
  '../server/api/http.ts',
  '../server/api/story-drafts.http.test.ts',
  '../server/local-runtime.ts',
  '../server/local-runtime.integration.test.ts',
  './story-http.ts',
])('keeps runtime value imports behind compiled package exports: %s', file => {
  const url = new URL(file, import.meta.url);
  const emitted = stripTypeScriptTypes(readFileSync(url, 'utf8'), {mode: 'transform'});
  for (const match of emitted.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]*runtime\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    expect(specifier, `${file}: ${specifier}`).toMatch(/^runtime\//);
    expect(createRequire(url).resolve(specifier)).toMatch(/\/runtime\/dist\/.*\.js$/);
  }
});

it('loads the public story constants and complete parser graph in native Node ESM', () => {
  const script = `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    const exports = {
      'runtime/contracts/story-draft': ['STORY_MUTATION_MAX_BYTES'],
      'runtime/contracts/story-draft-validation': ['parseCreate','parseUpdate','parseLifecycle','parseGet','parseList'],
      'runtime/contracts/story-draft-output': ['parseDraftDTO','parseDraftPage','parseDraftCommandResult'],
    };
    for (const [specifier, names] of Object.entries(exports)) {
      assert.match(createRequire(import.meta.url).resolve(specifier), /\\/dist\\/contracts\\/.*\\.js$/);
      const module = await import(specifier);
      for (const name of names) assert.equal(typeof module[name], name === 'STORY_MUTATION_MAX_BYTES' ? 'number' : 'function');
    }
    console.log('compiled-story-contracts-ok');
  `;
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
  }).trim()).toBe('compiled-story-contracts-ok');
});

it('freezes an exact story-only public error table with distinct preconditions', () => {
  expect(STORY_HTTP_STATUS.CLIENT_RELOAD_REQUIRED).toBe(412);
  expect(STORY_HTTP_STATUS.DATASET_CHANGED).toBe(412);
  expect(STORY_HTTP_STATUS.STORY_REQUEST_TOO_LARGE).toBe(413);
  expect(STORY_QUERY_MAX_BYTES).toBe(16384);
  expect(storyErrorHTTPStatus('INVALID_STORY_COMMAND secret')).toBeUndefined();
  expect(storyErrorHTTPStatus('toString')).toBeUndefined();
  const error = new StoryClientError('CLIENT_RELOAD_REQUIRED', 412, 'rejected');
  expect(error).toMatchObject({name: 'StoryClientError', code: 'CLIENT_RELOAD_REQUIRED', status: 412, outcome: 'rejected', message: 'CLIENT_RELOAD_REQUIRED'});
});
