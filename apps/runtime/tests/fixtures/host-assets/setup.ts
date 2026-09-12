import {chmod, copyFile, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {v7} from 'uuid';
import sharp from 'sharp';
import {initializeHost, migrateDatabase} from '../../../src/host/storage.js';
import * as host from '../../../src/host/index.js';
import {openRuntimeDatabase} from '../../../src/infrastructure/db/client.js';
import type {PrismaClient} from '../../../src/generated/prisma/client.js';
let baseline: string;
export async function prepare() {
  baseline = await mkdtemp(join(await realpath(tmpdir()), 'host-assets-base-'));
  await chmod(baseline, 0o700);
  await writeFile(join(baseline, 'base.db'), '', {mode: 0o600});
  await migrateDatabase(join(baseline, 'base.db'));
}
export async function dispose() {await rm(baseline, {recursive: true, force: true});}
export async function fixture() {
  const parent = await mkdtemp(join(await realpath(tmpdir()), 'host-assets-'));
  await chmod(parent, 0o700);
  const directory = join(parent, 'host');
  const manifest = await initializeHost(directory, 'dev', {migrate: path => copyFile(join(baseline, 'base.db'), path)});
  const reconnect = async () => host.exchangeConnectionCode(directory, 'dev', await host.issueConnectionCode(directory, 'dev'));
  const {token} = await reconnect();
  const bytes = await sharp({create: {width: 320, height: 256, channels: 3, background: 'blue'}}).png().toBuffer();
  const input = () => ({datasetId: manifest.datasetId, commandId: v7(), inputSha256: createHash('sha256').update(bytes).digest('hex'), inputByteSize: String(bytes.length), originalName: 'fixture.png', rightsDeclaration: 'fixture own artwork'});
  const database = async <T>(work: (db: PrismaClient) => Promise<T>) => {
    const db = await openRuntimeDatabase(join(directory, 'runtime.db'));
    try {return await work(db);} finally {await db.$disconnect();}
  };
  return {parent, directory, manifest, token, bytes, input, reconnect, database,
    assetsPath: join(directory, 'assets'), candidate: (id: string) => join(directory, 'assets', manifest.datasetId, `${id}.webp`),
    query: (uploadId: string) => ({datasetId: manifest.datasetId, uploadId}),
    complete: (uploadId: string) => ({datasetId: manifest.datasetId, uploadId, commandId: v7()}),
    close: () => rm(parent, {recursive: true, force: true}),
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
