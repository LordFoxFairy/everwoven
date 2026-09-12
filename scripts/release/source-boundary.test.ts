import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {expect, it} from 'vitest';

it('tracks the upload route without exposing private upload directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'everwoven-source-boundary-'));
  const route = 'apps/web/app/api/local-assets/uploads/[uploadId]/route.ts';
  const privatePaths = ['uploads/photo.png', 'apps/web/uploads/photo.png',
    'apps/web/app/api/local-assets/uploads/photo.png',
    'apps/web/app/api/local-assets/uploads/[uploadId]/photo.png'];
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, '.gitignore'), readFileSync(new URL('../../.gitignore', import.meta.url)));
    for (const path of [route, ...privatePaths]) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      writeFileSync(join(root, path), 'synthetic fixture');
    }
    const visible = execFileSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard'], {encoding: 'utf8'}).trim().split('\n');
    expect(visible).toContain(route);
    for (const path of privatePaths) expect(visible).not.toContain(path);
  } finally {rmSync(root, {recursive: true, force: true});}
});
