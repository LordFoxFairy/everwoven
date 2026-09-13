import {execFileSync} from 'node:child_process';
import {mkdtemp, chmod, copyFile, rm, writeFile, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {v7} from 'uuid';
import {openRuntimeDatabase} from '../../../src/infrastructure/db/client.js';
import {createStoryDraftService} from '../../../src/composition/story-draft-service.js';
let baseline: string;
export async function prepare() {
  baseline = await mkdtemp(join(await realpath(tmpdir()), 'story-aggregate-base-'));
  await chmod(baseline, 0o700);
  const path = join(baseline, 'base.db');
  await writeFile(path, '', {mode: 0o600});
  const runtime = fileURLToPath(new URL('../../../', import.meta.url));
  execFileSync(process.execPath, [join(runtime, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: runtime,
    env: {...process.env, RUNTIME_DATABASE_URL: `file:${path}`},
    stdio: 'pipe',
  });
}
export async function dispose() {
  await rm(baseline, {recursive: true, force: true});
}
export const settings = {
  world: 'world',
  opening: 'opening',
  genre: 'genre',
  playerRole: '',
  worldRules: [''],
  tone: '',
};
export const characterSettings = {personality: 'original', appearance: '', speakingStyle: '', boundaries: ''};
export const slots = {cover: null, opening: null, character: null};
export const overrides = {portrait: {mode: 'inherit' as const}, relationship: ''};
export async function fixture() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'story-aggregate-'));
  await chmod(dir, 0o700);
  const path = join(dir, 'runtime.db');
  await copyFile(join(baseline, 'base.db'), path);
  const db = await openRuntimeDatabase(path),
    owner = {ownerId: v7(), datasetId: v7()},
    now = new Date('2026-09-12T00:00:00.000Z');
  await db.localProfile.create({data: {id: owner.ownerId, displayName: 'fixture', createdAt: now, updatedAt: now}});
  const protocol = {protocolVersion: 1 as const, datasetId: owner.datasetId};
  return {
    db,
    owner,
    protocol,
    service: createStoryDraftService(db),
    now,
    create: (title = 'story') => ({
      ...protocol,
      commandId: v7(),
      title,
      settings: structuredClone(settings),
      mainCharacter: null,
      assetSlots: {...slots},
    }),
    get: (id: string) => ({...protocol, id}),
    change: (id: string, revision: number) => ({...protocol, commandId: v7(), id, expectedRevision: revision}),
    template: async (portraitAssetId: string | null = null) =>
      db.characterTemplate.create({
        data: {
          id: v7(),
          ownerId: owner.ownerId,
          name: 'name',
          settings: characterSettings,
          portraitAssetId,
          createdAt: now,
          updatedAt: now,
        },
      }),
    asset: async () => {
      const id = v7();
      return db.asset.create({
        data: {
          id,
          ownerId: owner.ownerId,
          storageKey: `assets/${owner.datasetId}/${id}.webp`,
          sha256: 'a'.repeat(64),
          mimeType: 'image/webp',
          byteSize: 20n,
          originalName: 'fixture.webp',
          width: 320,
          height: 256,
          rightsDeclaration: 'fixture',
          createdAt: now,
          updatedAt: now,
        },
      });
    },
    close: async () => {
      await db.$disconnect();
      await rm(dir, {recursive: true, force: true});
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
