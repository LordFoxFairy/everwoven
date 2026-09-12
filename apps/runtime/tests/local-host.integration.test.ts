import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {v7} from 'uuid';
import {raceOpenedFile} from './local-host-races.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let parent: string, directory: string;
beforeEach(async () => {parent = await mkdtemp(join(await realpath(tmpdir()), 'local-host-')); directory = join(parent, 'host');});
afterEach(async () => {await chmod(parent, 0o700); await rm(parent, {recursive: true, force: true});});
const host = () => import('../src/host/index.js');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const codePath = (code: string) => join(directory, 'security', 'codes', `${hash(code)}.json`);
const sessionPath = (token: string) => join(directory, 'security', 'sessions', `${hash(token)}.json`);
async function connected() {
  const h = await host(), manifest = await h.initializeLocalHost(directory, 'dev');
  const code = await h.issueConnectionCode(directory, 'dev');
  return {h, manifest, code, ...await h.exchangeConnectionCode(directory, 'dev', code)};
}
function child(input: Record<string, unknown>): Promise<{ok: boolean; ownerId?: string; title?: string}> {
  return new Promise((resolveResult, reject) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', join(runtime, 'tests/local-host-child.ts')], {
      cwd: runtime, stdio: ['pipe', 'ignore', 'pipe', 'ipc'],
    });
    let result: {ok: boolean; ownerId?: string; title?: string} | undefined;
    proc.on('message', message => {result = message as typeof result;});
    proc.on('error', () => reject(new Error('CHILD_START_FAILED')));
    proc.on('exit', () => result ? resolveResult(result) : reject(new Error('CHILD_RESULT_MISSING')));
    // Secrets are piped, never argv, output or assertion diffs.
    proc.stdin!.end(JSON.stringify(input));
  });
}

describe('local host: real SQLite and restricted filesystem', () => {
  it('exports the exact host contract', async () => {
    const exports = await host().catch(() => ({}));
    for (const name of ['initializeLocalHost', 'readLocalHost', 'issueConnectionCode', 'exchangeConnectionCode', 'authenticateSession', 'revokeSession', 'withLocalStories']) {
      expect(typeof (exports as Record<string, unknown>)[name], name).toBe('function');
    }
  });
  it('initializes once, publishes only the manifest fields, and keeps exactly one owner', async () => {
    const h = await host(), first = await h.initializeLocalHost(directory, 'dev');
    expect(await h.initializeLocalHost(directory, 'dev')).toEqual(first);
    expect(await h.readLocalHost(directory, 'dev')).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(['createdAt', 'datasetId', 'environment', 'ownerId', 'version']);
    expect(first.environment).toBe('dev'); expect(first.version).toBe(1);
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(directory, 'manifest.json'))).mode & 0o777).toBe(0o600);
    const db = await openRuntimeDatabase(join(directory, 'runtime.db'));
    try {expect(await db.localProfile.count()).toBe(1); expect((await db.localProfile.findFirstOrThrow()).id).toBe(first.ownerId);}
    finally {await db.$disconnect();}
  }, 30_000);
  it('binds stable commands and credentials to two isolated host datasets', async () => {
    const {h, manifest: first, token} = await connected();
    const other = join(parent, 'other-host');
    const second = await h.initializeLocalHost(other, 'dev');
    expect(first.datasetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.datasetId).not.toBe(first.ownerId);
    expect(second.datasetId).not.toBe(first.datasetId);
    expect(await h.readLocalHost(directory, 'dev')).toEqual(first);
    expect(await h.authenticateSession(directory, 'dev', token)).toEqual({ownerId: first.ownerId, datasetId: first.datasetId});
    const command = {datasetId: first.datasetId, commandId: v7(), title: '原命令', settings: {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''}};
    const created = await h.withLocalStories(directory, 'dev', token, (s, o) => s.create(o, command));
    const reconnected = await h.exchangeConnectionCode(directory, 'dev', await h.issueConnectionCode(directory, 'dev'));
    expect((await h.withLocalStories(directory, 'dev', reconnected.token, (s, o) => s.create(o, command)))).toEqual({...created, replayed: true});
    for (const [action, expectedRevision] of [['update', 1], ['delete', 2], ['restore', 3]] as const) {
      const input = {datasetId: first.datasetId, commandId: v7(), id: created.data.id, expectedRevision};
      const invoke = (session: string) => h.withLocalStories(directory, 'dev', session, (s, o) => action === 'update'
        ? s.update(o, {...input, patch: {title: '更新后的文本'}}) : s[action](o, input));
      const saved = await invoke(token);
      const reconnect = await h.exchangeConnectionCode(directory, 'dev', await h.issueConnectionCode(directory, 'dev'));
      expect(await invoke(reconnect.token)).toEqual({...saved, replayed: true});
    }
    const fresh = await h.exchangeConnectionCode(other, 'dev', await h.issueConnectionCode(other, 'dev'));
    for (const action of ['create', 'update', 'delete', 'restore'] as const) {
      const lifecycle = {datasetId: first.datasetId, commandId: v7(), id: created.data.id, expectedRevision: 1};
      await expect(h.withLocalStories(other, 'dev', fresh.token, (s, o) => action === 'create' ? s.create(o, command)
        : action === 'update' ? s.update(o, {...lifecycle, patch: {title: '旧输入'}}) : s[action](o, lifecycle))).rejects.toThrow('DATASET_CHANGED');
    }
    const db = await openRuntimeDatabase(join(other, 'runtime.db'));
    try {expect(await db.storyDraft.count()).toBe(0); expect(await db.commandReceipt.count()).toBe(0);
      expect((await db.localProfile.findUniqueOrThrow({where: {id: second.ownerId}})).writeEpoch).toBe(0);}
    finally {await db.$disconnect();}
  }, 30_000);
  it('rejects missing, invalid and owner-equal dataset manifests and foreign dataset credentials', async () => {
    const {h, manifest, token} = await connected();
    const path = join(directory, 'manifest.json');
    for (const datasetId of [undefined, 'bad', manifest.ownerId]) {
      await writeFile(path, JSON.stringify({...manifest, datasetId}));
      await expect(h.readLocalHost(directory, 'dev')).rejects.toThrow('LOCAL_HOST_INVALID');
    }
    await writeFile(path, JSON.stringify(manifest));
    const session = sessionPath(token), record = JSON.parse(await readFile(session, 'utf8'));
    for (const datasetId of [undefined, v7()]) {
      await writeFile(session, JSON.stringify({...record, datasetId}));
      await expect(h.authenticateSession(directory, 'dev', token)).rejects.toThrow('LOCAL_SESSION_INVALID');
    }
  }, 30_000);
  it('rejects relative paths, missing parents, unsafe parents and non dev/prod environments without creating a host', async () => {
    const h = await host();
    for (const path of ['relative', join(parent, 'missing', 'host'), `${parent}/../host`]) {
      await expect(h.initializeLocalHost(path, 'dev')).rejects.toThrow();
    }
    await expect(h.initializeLocalHost(directory, 'staging' as 'dev')).rejects.toThrow();
    await chmod(parent, 0o777); await expect(h.initializeLocalHost(directory, 'dev')).rejects.toThrow();
    await expect(lstat(directory)).rejects.toThrow();
  });
  it('rejects symlinks in the parent chain and target without modifying the destination', async () => {
    const h = await host(), actual = join(parent, 'actual'), link = join(parent, 'alias');
    await mkdir(actual, {mode: 0o700}); await symlink(actual, link);
    await expect(h.initializeLocalHost(join(link, 'nested'), 'dev')).rejects.toThrow();
    await symlink(actual, directory); await expect(h.initializeLocalHost(directory, 'dev')).rejects.toThrow();
    expect(await readdir(actual)).toEqual([]);
  });
  it('never overwrites or removes an existing incomplete target', async () => {
    const h = await host(); await mkdir(directory, {mode: 0o700});
    await writeFile(join(directory, 'someone-elses-data'), 'keep');
    await expect(h.initializeLocalHost(directory, 'dev')).rejects.toThrow();
    expect(await readFile(join(directory, 'someone-elses-data'), 'utf8')).toBe('keep');
    await expect(lstat(join(directory, 'manifest.json'))).rejects.toThrow();
  });
  it('does not steal a target-level wx lock', async () => {
    const h = await host(), lock = join(parent, `.local-host-${hash(directory)}.lock`);
    await writeFile(lock, 'existing-lock', {mode: 0o600});
    await expect(h.initializeLocalHost(directory, 'dev')).rejects.toThrow();
    expect(await readFile(lock, 'utf8')).toBe('existing-lock'); await expect(lstat(directory)).rejects.toThrow();
  });
  it('rejects malformed, extra-field, wrong-environment manifests and unsafe file permissions', async () => {
    const h = await host(), m = await h.initializeLocalHost(directory, 'prod');
    await expect(h.readLocalHost(directory, 'dev')).rejects.toThrow();
    const file = join(directory, 'manifest.json');
    for (const value of ['{', JSON.stringify({...m, version: 2}), JSON.stringify({...m, ownerId: 'bad'}), JSON.stringify({...m, createdAt: 'bad'}), JSON.stringify({...m, ready: true})]) {
      await writeFile(file, value); await expect(h.readLocalHost(directory, 'prod')).rejects.toThrow();
    }
    await writeFile(file, JSON.stringify(m)); await chmod(file, 0o644);
    await expect(h.readLocalHost(directory, 'prod')).rejects.toThrow();
    await chmod(file, 0o600); await chmod(directory, 0o750);
    await expect(h.readLocalHost(directory, 'prod')).rejects.toThrow(); await chmod(directory, 0o700);
    await chmod(join(directory, 'runtime.db'), 0o666); await expect(h.readLocalHost(directory, 'prod')).rejects.toThrow();
  }, 30_000);
  it('reads security files no-follow and rejects linked manifests/databases/security directories', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev');
    for (const name of ['manifest.json', 'runtime.db', 'security']) {
      const file = join(directory, name), moved = join(parent, `moved-${name}`);
      await rename(file, moved); await symlink(moved, file);
      await expect(h.readLocalHost(directory, 'dev')).rejects.toThrow();
      await rm(file); await rename(moved, file);
    }
  }, 30_000);
  it('persists only hash-indexed credentials, survives process reopen, revokes without extending expiry', async () => {
    const {h, manifest, code, token, expiresAt} = await connected();
    expect(code.length).toBe(43); expect(token.length).toBe(43);
    const records = await readdir(join(directory, 'security', 'sessions'));
    expect(records).toEqual([`${hash(token)}.json`]);
    const raw = await readFile(sessionPath(token), 'utf8');
    expect(raw.includes(token)).toBe(false); expect(raw.includes(code)).toBe(false);
    expect(JSON.parse(raw).expiresAt).toBe(expiresAt);
    expect(await child({action: 'authenticate', directory, token})).toEqual({ok: true, ownerId: manifest.ownerId, datasetId: manifest.datasetId});
    await h.revokeSession(directory, 'dev', token); await h.revokeSession(directory, 'dev', token);
    await expect(h.authenticateSession(directory, 'dev', token)).rejects.toThrow();
    await expect(h.exchangeConnectionCode(directory, 'dev', code)).rejects.toThrow();
  }, 30_000);
  it('permits at most one exchange across separate processes', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev'); const code = await h.issueConnectionCode(directory, 'dev');
    const results = await Promise.all(Array.from({length: 4}, () => child({action: 'exchange', directory, code})));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await readdir(join(directory, 'security', 'sessions'))).toHaveLength(1);
  }, 30_000);
  it('parallel process initialization leaves one owner and a valid host', async () => {
    const results = await Promise.all([child({action: 'init', directory}), child({action: 'init', directory})]);
    expect(results.some(r => r.ok)).toBe(true);
    const h = await host(), m = await h.readLocalHost(directory, 'dev');
    expect(results.filter(r => r.ok).every(r => r.ownerId === m.ownerId)).toBe(true);
    const db = await openRuntimeDatabase(join(directory, 'runtime.db'));
    try {expect(await db.localProfile.count()).toBe(1);} finally {await db.$disconnect();}
  }, 30_000);
  it('enforces exact five-minute code and eight-hour absolute session expiry with an internal clock', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev');
    const {createSessionOperations} = await import('../src/host/sessions.js');
    let time = Date.now(); const ops = createSessionOperations({now: () => time});
    const code = await ops.issueConnectionCode(directory, 'dev');
    const raw = await readFile(codePath(code), 'utf8'); expect(raw.includes(code)).toBe(false);
    time += 5 * 60_000; await expect(ops.exchangeConnectionCode(directory, 'dev', code)).rejects.toThrow();
    const good = await ops.issueConnectionCode(directory, 'dev'); time += 5 * 60_000 - 1;
    const {token, expiresAt} = await ops.exchangeConnectionCode(directory, 'dev', good);
    expect(expiresAt).toBe(time + 8 * 60 * 60_000);
    time = expiresAt - 1; await expect(ops.authenticateSession(directory, 'dev', token)).resolves.toHaveProperty('ownerId');
    time++; await expect(ops.authenticateSession(directory, 'dev', token)).rejects.toThrow();
  }, 30_000);
  it('rejects raw format, record binding/TTL tampering and symlink session records', async () => {
    const {h, token} = await connected(), path = sessionPath(token), record = JSON.parse(await readFile(path, 'utf8'));
    for (const bad of ['', '../secret', 'x'.repeat(44)]) {
      await expect(h.authenticateSession(directory, 'dev', bad)).rejects.toThrow();
      await expect(h.exchangeConnectionCode(directory, 'dev', bad)).rejects.toThrow();
    }
    for (const change of [{version: 2}, {extra: true}, {environment: 'prod'}, {ownerId: v7()}, {expiresAt: record.expiresAt + 1}, {issuedAt: -1}]) {
      await writeFile(path, JSON.stringify({...record, ...change})); await expect(h.authenticateSession(directory, 'dev', token)).rejects.toThrow();
    }
    await writeFile(path, JSON.stringify(record)); await chmod(path, 0o644); await expect(h.authenticateSession(directory, 'dev', token)).rejects.toThrow();
    await chmod(path, 0o600); const moved = join(parent, 'session'); await rename(path, moved); await symlink(moved, path);
    await expect(h.authenticateSession(directory, 'dev', token)).rejects.toThrow();
  }, 30_000);
  it('reopens SQLite for CRUD, handles callback failure, and persists across another process', async () => {
    const {h, token, manifest} = await connected();
    const work = <T>(fn: Parameters<typeof h.withLocalStories<T>>[3]) => h.withLocalStories(directory, 'dev', token, fn);
    const input = {datasetId: manifest.datasetId, commandId: v7(), title: 'Host draft', settings: {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''}};
    const created = await work((s, o) => s.create(o, input));
    expect((await work((s, o) => s.create(o, input))).replayed).toBe(true);
    const id = created.data.id;
    await work((s, o) => s.update(o, {datasetId: manifest.datasetId, commandId: v7(), id, expectedRevision: 1, patch: {title: 'Persisted'}}));
    await expect(work((s, o) => s.update(o, {datasetId: manifest.datasetId, commandId: v7(), id, expectedRevision: 1, patch: {title: 'Stale'}}))).rejects.toThrow('REVISION_CONFLICT');
    await work((s, o) => s.delete(o, {datasetId: manifest.datasetId, commandId: v7(), id, expectedRevision: 2}));
    expect((await work((s, o) => s.list(o))).items).toHaveLength(0);
    await work((s, o) => s.restore(o, {datasetId: manifest.datasetId, commandId: v7(), id, expectedRevision: 3}));
    expect((await work((s, o) => s.get(o, id))).revision).toBe(4);
    await expect(work(async () => {throw new Error('PRIVATE /sensitive/path');})).rejects.toThrow('LOCAL_STORIES_FAILED');
    expect(await child({action: 'get', directory, token, id})).toEqual({ok: true, title: 'Persisted'});
    await h.revokeSession(directory, 'dev', token);
    let called = false; await expect(work(async () => {called = true;})).rejects.toThrow(); expect(called).toBe(false);
  }, 30_000);
  it('CLI requires explicit absolute directory/environment and never reflects invalid arguments', async () => {
    async function cli(args: string[]) {
      return new Promise<{status: number | null; stdout: string; stderr: string}>(resolveResult => {
        const proc = spawn(process.execPath, ['--import', 'tsx', join(runtime, 'src/host/cli.ts'), ...args], {cwd: runtime});
        let stdout = '', stderr = ''; proc.stdout.on('data', b => {stdout += b;}); proc.stderr.on('data', b => {stderr += b;});
        proc.on('exit', status => resolveResult({status, stdout, stderr}));
      });
    }
    for (const args of [[], ['init', '--directory', directory], ['init', '--directory', 'relative', '--environment', 'dev'], ['connect', '--directory', directory, '--environment', 'secret-value']]) {
      const result = await cli(args); expect(result.status).not.toBe(0); expect(result.stdout).toBe(''); expect(result.stderr.includes('secret-value')).toBe(false);
    }
    const initialized = await cli(['init', '--directory', directory, '--environment', 'dev']); expect(initialized.status).toBe(0);
    const connected = await cli(['connect', '--directory', directory, '--environment', 'dev']);
    expect(connected.status).toBe(0); expect(connected.stderr).toBe(''); expect(/^[A-Za-z0-9_-]{43}\n$/.test(connected.stdout)).toBe(true);
  }, 30_000);
  it('leaves initialization failures unready and preserves a competitor target', async () => {
    const {initializeHost, migrateDatabase} = await import('../src/host/storage.js');
    const {readLocalHost} = await host();
    const failures = [
      {migrate: async () => {throw new Error('PRIVATE migration detail');}},
      {migrate: async (path: string) => {await migrateDatabase(path); const db = await openRuntimeDatabase(path);
        try {const now = new Date(); await db.localProfile.create({data: {id: v7(), displayName: 'Existing', createdAt: now, updatedAt: now}});} finally {await db.$disconnect();}}},
      {beforePublish: async () => {throw new Error('PRIVATE publish detail');}},
    ];
    for (const [i, options] of failures.entries()) {
      const target = join(parent, `failure-${i}`);
      await expect(initializeHost(target, 'dev', options)).rejects.toThrow('LOCAL_HOST_INVALID');
      await expect(lstat(join(target, 'manifest.json'))).rejects.toThrow();
      await expect(readLocalHost(target, 'dev')).rejects.toThrow();
      expect((await lstat(target)).isDirectory()).toBe(true);
      await expect(initializeHost(target, 'dev')).rejects.toThrow();
    }
    await expect(initializeHost(directory, 'dev', {beforeReserve: async () => {
      await mkdir(directory, {mode: 0o700}); await writeFile(join(directory, 'competitor'), 'preserve');
    }})).rejects.toThrow();
    expect(await readFile(join(directory, 'competitor'), 'utf8')).toBe('preserve');
    await expect(lstat(join(directory, 'manifest.json'))).rejects.toThrow();
  }, 30_000);
  it('publishes ready with wx/no-follow and preserves competing manifest files', async () => {
    const {initializeHost} = await import('../src/host/storage.js');
    const external = join(parent, 'external'); await writeFile(external, 'preserve', {mode: 0o600});
    await expect(initializeHost(directory, 'dev', {beforePublish: async () => {
      await symlink(external, join(directory, 'manifest.json'));
    }})).rejects.toThrow('LOCAL_HOST_INVALID');
    expect(await readFile(external, 'utf8')).toBe('preserve');
    expect((await lstat(join(directory, 'manifest.json'))).isSymbolicLink()).toBe(true);
    await expect((await host()).readLocalHost(directory, 'dev')).rejects.toThrow();
  }, 30_000);
  it('does not leave ready when releasing the initialization lock fails', async () => {
    const {initializeHost} = await import('../src/host/storage.js');
    try {
      await expect(initializeHost(directory, 'dev', {beforePublish: () => chmod(parent, 0o500)})).rejects.toThrow('LOCAL_HOST_INVALID');
      await expect(lstat(join(directory, 'manifest.json'))).rejects.toThrow();
    } finally {await chmod(parent, 0o700);}
  }, 30_000);
  it('rejects linked SQLite sidecars before opening a database', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev');
    const external = join(parent, 'external'); await writeFile(external, 'preserve', {mode: 0o600});
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const path = join(directory, `runtime.db${suffix}`); await symlink(external, path);
      await expect(h.readLocalHost(directory, 'dev')).rejects.toThrow('LOCAL_HOST_INVALID'); await rm(path);
    }
    expect(await readFile(external, 'utf8')).toBe('preserve');
  }, 30_000);
  it('fstat owner validation rejects a host belonging to a different effective user', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev');
    const own = process.getuid!(); const spy = vi.spyOn(process, 'getuid').mockReturnValue(own + 1);
    try {await expect(h.readLocalHost(directory, 'dev')).rejects.toThrow('LOCAL_HOST_INVALID');}
    finally {spy.mockRestore();}
  }, 30_000);
  it('rechecks code expiry after claiming and burns a claimed expired code', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev');
    const {createSessionOperations} = await import('../src/host/sessions.js');
    const issued = Date.now(); let calls = 0;
    const ops = createSessionOperations({now: () => ++calls === 1 ? issued : calls === 2 ? issued + 299_999 : issued + 300_000});
    const code = await ops.issueConnectionCode(directory, 'dev');
    await expect(ops.exchangeConnectionCode(directory, 'dev', code)).rejects.toThrow('LOCAL_SESSION_INVALID');
    await expect(lstat(codePath(code))).rejects.toThrow();
    expect(await readdir(join(directory, 'security/sessions'))).toHaveLength(0);
  }, 30_000);
  it('preserves public input validation errors while always closing database sidecars', async () => {
    const {h, token, manifest} = await connected();
    await expect(h.withLocalStories(directory, 'dev', token, (s, o) => s.create(o, {
      datasetId: manifest.datasetId, commandId: 'bad', title: 'Bad', settings: {world: '', opening: '', genre: '', playerRole: '', worldRules: [], tone: ''},
    }))).rejects.toThrow('INVALID_STORY_COMMAND');
    const names = await readdir(directory);
    expect(names.includes('runtime.db-wal')).toBe(false); expect(names.includes('runtime.db-shm')).toBe(false);
  }, 30_000);

  it('rejects hard-linked/non-regular security material and altered code records', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev');
    const manifestPath = join(directory, 'manifest.json'), alias = join(parent, 'manifest-hardlink');
    await link(manifestPath, alias); await expect(h.readLocalHost(directory, 'dev')).rejects.toThrow(); await rm(alias);
    const saved = join(parent, 'manifest-saved'); await rename(manifestPath, saved); await mkdir(manifestPath, {mode: 0o700});
    await expect(h.readLocalHost(directory, 'dev')).rejects.toThrow(); await rm(manifestPath, {recursive: true}); await rename(saved, manifestPath);
    const code = await h.issueConnectionCode(directory, 'dev'), path = codePath(code), original = JSON.parse(await readFile(path, 'utf8'));
    for (const patch of [{environment: 'prod'}, {ownerId: v7()}, {datasetId: v7()}, {datasetId: undefined}, {expiresAt: original.expiresAt + 1}]) {
      await writeFile(path, JSON.stringify({...original, ...patch}));
      await expect(h.exchangeConnectionCode(directory, 'dev', code)).rejects.toThrow('LOCAL_SESSION_INVALID');
    }
    await writeFile(path, JSON.stringify(original)); await chmod(path, 0o644);
    await expect(h.exchangeConnectionCode(directory, 'dev', code)).rejects.toThrow('LOCAL_SESSION_INVALID'); await chmod(path, 0o600);
    const external = join(parent, 'code-record'); await rename(path, external); await symlink(external, path);
    await expect(h.exchangeConnectionCode(directory, 'dev', code)).rejects.toThrow('LOCAL_SESSION_INVALID');
    expect(await readdir(join(directory, 'security/sessions'))).toHaveLength(0);
  }, 30_000);

  it('accepts optional sidecars unlinked after open and before fstat, without leaking handles', async () => {
    const h = await host(), manifest = await h.initializeLocalHost(directory, 'dev');
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const path = join(directory, `runtime.db${suffix}`); await writeFile(path, '', {mode: 0o600});
      const outcome = await raceOpenedFile(path, () => unlink(path), () => h.readLocalHost(directory, 'dev'));
      expect(outcome.result).toEqual(manifest); expect(outcome.attempts).toBe(1);
      expect(outcome.handles.every(handle => handle.fd === -1)).toBe(true);
      await expect(lstat(path)).rejects.toThrow();
    }
  }, 30_000);
  it('reopens and validates a replacement sidecar, with a bounded churn retry budget', async () => {
    const h = await host(), manifest = await h.initializeLocalHost(directory, 'dev');
    const path = join(directory, 'runtime.db-wal'); await writeFile(path, '', {mode: 0o600});
    const replacement = await raceOpenedFile(path, async attempt => {
      if (attempt === 1) {await unlink(path); await writeFile(path, '', {mode: 0o600});}
    }, () => h.readLocalHost(directory, 'dev'));
    expect(replacement.result).toEqual(manifest); expect(replacement.attempts).toBe(2);
    expect(replacement.handles.every(handle => handle.fd === -1)).toBe(true);
    let attempts = 0;
    await expect(raceOpenedFile(path, async () => {
      attempts++; await unlink(path); await writeFile(path, '', {mode: 0o600});
    }, () => h.readLocalHost(directory, 'dev'))).rejects.toThrow('LOCAL_HOST_INVALID');
    expect(attempts).toBe(3);
  }, 30_000);
  it('rejects unsafe sidecar replacements and unsafe unlinked descriptors', async () => {
    const h = await host(); await h.initializeLocalHost(directory, 'dev');
    const path = join(directory, 'runtime.db-wal'), other = join(parent, 'sidecar-source');
    await writeFile(other, '', {mode: 0o600});
    const replacements = [
      () => symlink(other, path),
      () => link(other, path),
      () => writeFile(path, '', {mode: 0o644}),
      () => mkdir(path, {mode: 0o700}),
    ];
    for (const replace of replacements) {
      await writeFile(path, '', {mode: 0o600});
      await expect(raceOpenedFile(path, async () => {await unlink(path); await replace();},
        () => h.readLocalHost(directory, 'dev'))).rejects.toThrow('LOCAL_HOST_INVALID');
      await rm(path, {recursive: true});
    }
    await writeFile(path, '', {mode: 0o600});
    await expect(raceOpenedFile(path, async () => {await chmod(path, 0o644); await unlink(path);},
      () => h.readLocalHost(directory, 'dev'))).rejects.toThrow('LOCAL_HOST_INVALID');
    await writeFile(path, '', {mode: 0o600});
    const own = process.getuid!(); let ownerSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await expect(raceOpenedFile(path, async () => {
        await unlink(path); ownerSpy = vi.spyOn(process, 'getuid').mockReturnValue(own + 1);
      }, () => h.readLocalHost(directory, 'dev'))).rejects.toThrow('LOCAL_HOST_INVALID');
    } finally {ownerSpy?.mockRestore();}
  }, 30_000);
  it('continues rejecting unlinked manifest and credential descriptors', async () => {
    const {h, token} = await connected(), manifest = join(directory, 'manifest.json');
    await expect(raceOpenedFile(sessionPath(token), () => unlink(sessionPath(token)),
      () => h.authenticateSession(directory, 'dev', token))).rejects.toThrow('LOCAL_SESSION_INVALID');
    await expect(raceOpenedFile(manifest, () => unlink(manifest),
      () => h.readLocalHost(directory, 'dev'))).rejects.toThrow('LOCAL_HOST_INVALID');
  }, 30_000);
  it('keeps 900 authentications and 540 read/reopen operations valid under sidecar churn', async () => {
    const {h, token, manifest} = await connected();
    const counts = {auth: 0, read: 0}, failures: string[] = [];
    async function lane(kind: 'auth' | 'read') {
      for (let i = 0; i < 180; i++) {
        try {
          if (kind === 'auth') {
            const owner = await h.authenticateSession(directory, 'dev', token);
            if (owner.ownerId !== manifest.ownerId || owner.datasetId !== manifest.datasetId) throw new Error('OWNER_MISMATCH');
          } else {
            await h.withLocalStories(directory, 'dev', token, (service, owner) => service.list(owner));
          }
          counts[kind]++;
        } catch (error) {failures.push(`${kind}:${error instanceof Error ? error.message : 'UNKNOWN'}`);}
      }
    }
    await Promise.all([...Array.from({length: 5}, () => lane('auth')), ...Array.from({length: 3}, () => lane('read'))]);
    expect(failures).toEqual([]); expect(counts).toEqual({auth: 900, read: 540});
    expect(await h.authenticateSession(directory, 'dev', token)).toEqual({ownerId: manifest.ownerId, datasetId: manifest.datasetId});
  }, 120_000);

});
