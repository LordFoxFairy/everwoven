import {beforeAll, afterAll, beforeEach, afterEach, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {prepare, dispose, fixture, type Fixture} from './fixtures/asset-service/setup.js';
import {parseAssetDTO, parseUploadIntentDTO} from '../src/contracts/asset-validation.js';
import {PrismaAssetStore} from '../src/infrastructure/db/prisma-asset-store.js';
import {createAssets} from '../src/application/assets.js';

let f: Fixture;
beforeAll(prepare, 30000); afterAll(dispose);
beforeEach(async () => {f = await fixture();});
afterEach(async () => {vi.restoreAllMocks(); await f?.close();});

it.each(['inputSha256', 'inputByteSize', 'originalName', 'rightsDeclaration', 'id', 'assetId', 'createdAt', 'expiresAt'])('begin rejects structurally valid but mismatched receipt %s', async field => {
  const input = f.begin(), result = await f.service.begin(input);
  const values = {inputSha256: 'f'.repeat(64), inputByteSize: '1', originalName: 'other.png', rightsDeclaration: 'other rights', id: v7(), assetId: v7(), createdAt: '2026-09-11T00:00:00.000Z', expiresAt: '2026-09-14T00:00:00.000Z'};
  const response = parseUploadIntentDTO({...result.data, [field]: values[field as keyof typeof values]});
  await f.db.commandReceipt.updateMany({where: {commandId: input.commandId}, data: {response}});
  await expect(f.service.begin(input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
  expect(await f.db.assetUpload.count()).toBe(1);
  expect(f.deps.openFiles).not.toHaveBeenCalled();
});

it.each(['id', 'sha256', 'byteSize', 'width', 'height', 'originalName', 'rightsDeclaration'])('complete rejects structurally valid but mismatched receipt %s', async field => {
  const upload = (await f.service.begin(f.begin())).data;
  await f.service.process(f.query(upload.id), f.source);
  const input = f.complete(upload.id), result = await f.service.complete(input);
  const values = {id: v7(), sha256: 'f'.repeat(64), byteSize: '1', width: 1, height: 1, originalName: 'other.png', rightsDeclaration: 'other rights'};
  const response = parseAssetDTO({...result.data, [field]: values[field as keyof typeof values]});
  await f.db.commandReceipt.updateMany({where: {commandId: input.commandId}, data: {response}});
  vi.mocked(f.deps.openFiles).mockClear();
  await expect(f.service.complete(input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
  expect(await f.db.asset.count()).toBe(1);
  expect(f.deps.openFiles).not.toHaveBeenCalled();
});

it.each(['missing', 'foreign', 'duplicate', 'input-changed', 'asset-changed', 'output-changed'])('receipts reject %s intent binding, despite unchanged response/hash', async kind => {
  const begin = f.begin(), upload = (await f.service.begin(begin)).data;
  await f.service.process(f.query(upload.id), f.source);
  const complete = f.complete(upload.id); await f.service.complete(complete);
  const row = await f.db.assetUpload.findUniqueOrThrow({where: {id: upload.id}});
  if (kind === 'missing') await f.db.assetUpload.delete({where: {id: upload.id}});
  if (kind === 'foreign') await f.db.assetUpload.update({where: {id: upload.id}, data: {ownerId: v7()}});
  if (kind === 'duplicate') await f.db.assetUpload.create({data: {...row, id: v7(), ownerId: v7()}});
  if (kind === 'input-changed') await f.db.assetUpload.update({where: {id: upload.id}, data: {inputSha256: 'f'.repeat(64)}});
  if (kind === 'asset-changed') await f.db.assetUpload.update({where: {id: upload.id}, data: {assetId: v7()}});
  if (kind === 'output-changed') await f.db.assetUpload.update({where: {id: upload.id}, data: {outputSha256: 'f'.repeat(64)}});
  if (kind !== 'output-changed') await expect(f.service.begin(begin)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
  if (kind !== 'input-changed') await expect(f.service.complete(complete)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
});

it('historical replies survive expiry and mutable upload/Asset state changes without reading current Asset or files', async () => {
  const begin = f.begin(), initial = await f.service.begin(begin);
  await f.service.process(f.query(initial.data.id), f.source);
  const complete = f.complete(initial.data.id), finished = await f.service.complete(complete);
  await f.db.asset.update({where: {id: initial.data.assetId}, data: {status: 'unavailable', deletedAt: new Date(), revision: {increment: 1}}});
  await f.db.assetUpload.update({where: {id: initial.data.id}, data: {status: 'failed', revision: {increment: 1}, updatedAt: new Date()}});
  f.advance(86400001); vi.mocked(f.deps.openFiles).mockClear();
  const base = new PrismaAssetStore(f.db), findAsset = vi.fn();
  const service = createAssets({read: base.read.bind(base), write: (owner, work) => base.write(owner, scope => work({...scope, findAsset}))}, f.deps);
  expect(await service.begin(begin)).toEqual({...initial, replayed: true});
  expect(await service.complete(complete)).toEqual({...finished, replayed: true});
  expect(findAsset).not.toHaveBeenCalled(); expect(f.deps.openFiles).not.toHaveBeenCalled();
});

it('dataset and original command hash checks precede receipt semantic identity reads', async () => {
  const input = f.begin(); await f.service.begin(input);
  const base = new PrismaAssetStore(f.db), findReceipt = vi.fn(), findUpload = vi.fn();
  const service = createAssets({read: base.read.bind(base), write: (owner, work) => base.write(owner, scope => work({...scope, findReceipt: findReceipt.mockImplementation(scope.findReceipt), findUpload}))}, f.deps);
  await expect(service.begin({...input, datasetId: v7()})).rejects.toThrow('DATASET_CHANGED');
  expect(findReceipt).not.toHaveBeenCalled(); expect(findUpload).not.toHaveBeenCalled();
  await expect(service.begin({...input, originalName: 'different.png'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  expect(findReceipt).toHaveBeenCalledTimes(1); expect(findUpload).not.toHaveBeenCalled();
});

it.each(['status', 'revision', 'updatedAt', 'output'])('begin rejects a legal DTO with impossible initial %s', async field => {
  const input = f.begin(), initial = await f.service.begin(input);
  const changes = {status: {status: 'processing'}, revision: {revision: 2}, updatedAt: {updatedAt: '2026-09-12T00:00:01.000Z'}, output: {status: 'processing', outputSha256: 'f'.repeat(64), outputByteSize: '1', outputWidth: 1, outputHeight: 1}};
  const response = parseUploadIntentDTO({...initial.data, ...changes[field as keyof typeof changes]});
  await f.db.commandReceipt.updateMany({where: {commandId: input.commandId}, data: {response}});
  await expect(f.service.begin(input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
});

it.each(['status', 'deletedAt'])('complete rejects a legal DTO with impossible successful %s', async field => {
  const upload = (await f.service.begin(f.begin())).data; await f.service.process(f.query(upload.id), f.source);
  const input = f.complete(upload.id), result = await f.service.complete(input);
  const response = parseAssetDTO({...result.data, [field]: field === 'status' ? 'unavailable' : '2026-09-12T00:00:01.000Z'});
  await f.db.commandReceipt.updateMany({where: {commandId: input.commandId}, data: {response}});
  await expect(f.service.complete(input)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
});

it('a new completed command preserves its actual ready Asset revision snapshot, even after later unavailability', async () => {
  const upload = (await f.service.begin(f.begin())).data; await f.service.process(f.query(upload.id), f.source);
  await f.service.complete(f.complete(upload.id));
  // Exercise the existing new-command/current-ready contract without introducing a restore API.
  await f.db.asset.update({where: {id: upload.assetId}, data: {revision: 2, updatedAt: new Date('2026-09-12T00:00:01.000Z')}});
  const command = f.complete(upload.id), result = await f.service.complete(command);
  expect(result.data.revision).toBe(2);
  await f.db.asset.update({where: {id: upload.assetId}, data: {status: 'unavailable', revision: 3}});
  expect(await f.service.complete(command)).toEqual({...result, replayed: true});
});

it('begin binds command to upload independently of response: swapping complete DTOs of identical uploads fails', async () => {
  const a = f.begin(), b = {...a, commandId: v7()};
  const first = await f.service.begin(a), second = await f.service.begin(b);
  expect(first.data.id).not.toBe(second.data.id);
  expect(first.data.createdAt).toBe(second.data.createdAt);
  expect(await f.service.begin(a)).toEqual({...first, replayed: true});
  expect(await f.service.begin(b)).toEqual({...second, replayed: true});
  await f.db.commandReceipt.updateMany({where: {commandId: a.commandId}, data: {response: second.data}});
  await f.db.commandReceipt.updateMany({where: {commandId: b.commandId}, data: {response: first.data}});
  await expect(f.service.begin(a)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
  await expect(f.service.begin(b)).rejects.toThrow('COMMAND_RECEIPT_INVALID');
  expect(await f.db.assetUpload.count()).toBe(2);
  expect(await f.db.commandReceipt.count()).toBe(2);
});

it('begin receipt uses server upload identity; complete receipt uses a separately generated identity', async () => {
  const begin = f.begin(), upload = (await f.service.begin(begin)).data;
  const beginReceipt = await f.db.commandReceipt.findUniqueOrThrow({where: {ownerId_commandId: {ownerId: f.owner.ownerId, commandId: begin.commandId}}});
  expect(beginReceipt.id).toBe(upload.id); expect(upload.id).not.toBe(begin.commandId);
  const backing = new PrismaAssetStore(f.db);
  const stored = await backing.write(f.owner.ownerId, scope => scope.findReceipt(begin.commandId));
  expect(stored).toHaveProperty('id', upload.id);
  await f.service.process(f.query(upload.id), f.source);
  const complete = f.complete(upload.id); await f.service.complete(complete);
  const completeReceipt = await f.db.commandReceipt.findUniqueOrThrow({where: {ownerId_commandId: {ownerId: f.owner.ownerId, commandId: complete.commandId}}});
  expect(completeReceipt.id).not.toBe(upload.id); expect(completeReceipt.id).not.toBe(upload.assetId);
  expect(completeReceipt.id).not.toBe(complete.commandId);
});

it.each(['sha256', 'byteSize', 'width', 'height', 'originalName', 'rightsDeclaration'])('completed new command rejects mismatched current Asset %s before writing any receipt', async field => {
  const upload = (await f.service.begin(f.begin())).data;
  await f.service.process(f.query(upload.id), f.source);
  const initial = f.complete(upload.id), original = await f.service.complete(initial);
  const changes = {sha256: {sha256: 'f'.repeat(64)}, byteSize: {byteSize: 1n}, width: {width: 1}, height: {height: 1}, originalName: {originalName: 'other.png'}, rightsDeclaration: {rightsDeclaration: 'other rights'}};
  await f.db.asset.update({where: {id: upload.assetId}, data: changes[field as keyof typeof changes]});
  const command = f.complete(upload.id); vi.mocked(f.deps.openFiles).mockClear();
  await expect(f.service.complete(command)).rejects.toThrow('ASSET_IDENTITY_CONFLICT');
  expect(await f.db.commandReceipt.count({where: {commandId: command.commandId}})).toBe(0);
  expect(await f.db.commandReceipt.count()).toBe(2);
  expect(f.deps.openFiles).not.toHaveBeenCalled();
  // The original receipt still binds immutable intent output, not today's corrupted Asset.
  expect(await f.service.complete(initial)).toEqual({...original, replayed: true});
});
