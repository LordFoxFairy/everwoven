import {vi} from 'vitest';
import type {AssetService} from 'runtime/host';
import type {AssetDTO, UploadIntentDTO} from 'runtime/contracts/asset';
export const origin = 'http://127.0.0.1:3196';
export const datasetId = '01993ce0-0000-7000-8000-000000000001';
export const uploadId = '01993ce0-0000-7000-8000-000000000002';
export const assetId = '01993ce0-0000-7000-8000-000000000003';
export const commandId = '01993ce0-0000-7000-8000-000000000004';
export const env = {APP_ORIGIN: origin, APP_ENV: 'dev', RUNTIME_DATA_DIR: '/unused/asset-fixture', EVERWOVEN_LOCAL_LAUNCH: 'loopback-v1'};
export const headers = {origin, 'x-everwoven-request': '1', cookie: `everwoven_local=${'a'.repeat(43)}`};
export const begin = {datasetId, commandId, inputSha256: 'a'.repeat(64), inputByteSize: '12', originalName: 'own.png', rightsDeclaration: 'own work'};
export const upload: UploadIntentDTO = {
  id: uploadId, datasetId, assetId, inputSha256: begin.inputSha256, inputByteSize: begin.inputByteSize,
  originalName: begin.originalName, rightsDeclaration: begin.rightsDeclaration,
  status: 'reserved', outputSha256: null, outputByteSize: null, outputWidth: null, outputHeight: null,
  createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z', expiresAt: '2026-09-13T00:00:00.000Z', revision: 1,
};
export const asset: AssetDTO = {
  id: assetId, datasetId, sha256: 'b'.repeat(64), byteSize: '4', mimeType: 'image/webp', width: 1, height: 1,
  originalName: begin.originalName, rightsDeclaration: begin.rightsDeclaration,
  status: 'ready', deletedAt: null, createdAt: upload.createdAt, updatedAt: upload.updatedAt, revision: 1,
};
export const published: UploadIntentDTO = {...upload, status: 'published', revision: 4, outputSha256: asset.sha256, outputByteSize: asset.byteSize, outputWidth: 1, outputHeight: 1};
export function serviceFixture(): AssetService {
  return {
    begin: vi.fn(async () => ({data: upload, replayed: false})),
    getUpload: vi.fn(async () => upload), complete: vi.fn(async () => ({data: asset, replayed: false})),
    process: vi.fn(async () => published), getBytes: vi.fn(async () => ({data: asset, bytes: Buffer.from('RIFF')})),
    cleanup: vi.fn(async () => ({kind: 'absent' as const})),
  };
}
