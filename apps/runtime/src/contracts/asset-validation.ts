import {isBusinessId, isTimestamp} from './primitives.js';
import {fields} from './story-draft-validation.js';
import {IMAGE_LIMITS, type AssetBeginUpload, type AssetGetUpload, type AssetGet, type AssetCompleteUpload, type UploadIntentDTO, type AssetDTO, type UploadStatus} from './asset.js';

const COMMAND = 'INVALID_ASSET_COMMAND', QUERY = 'INVALID_ASSET_QUERY', DTO = 'INVALID_ASSET_DTO';
function id(value: unknown, code: string): string {if (!isBusinessId(value)) throw Error(code); return value;}
function hash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw Error(code); return value;
}
function bytes(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string' || value.length > 8 || !/^[1-9][0-9]*$/.test(value) || Number(value) > max) throw Error(code); return value;
}
function text(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string' || [...value].length > max || !value.trim()) throw Error(code); return value;
}
function filename(value: unknown, code: string): string {
  const name = text(value, 255, code);
  if (/[/\\\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') throw Error(code); return name;
}
function timestamp(value: unknown, code: string): string {if (!isTimestamp(value)) throw Error(code); return value;}
function integer(value: unknown, min: number, max: number, code: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw Error(code); return value;
}
/** Canonical wire metadata, shared by bytes-only normalization and upload commands. */
export function parseImageInputMetadata(value: unknown): {inputSha256: string; inputByteSize: string} {
  fields(value, ['inputSha256', 'inputByteSize'], [], 'INVALID_IMAGE_INPUT');
  return {inputSha256: hash(value.inputSha256, 'INVALID_IMAGE_INPUT'), inputByteSize: bytes(value.inputByteSize, IMAGE_LIMITS.inputBytes, 'INVALID_IMAGE_INPUT')};
}
export function parseBeginUpload(value: unknown): AssetBeginUpload {
  fields(value, ['datasetId', 'commandId', 'inputSha256', 'inputByteSize', 'originalName', 'rightsDeclaration'], [], COMMAND);
  return {datasetId: id(value.datasetId, COMMAND), commandId: id(value.commandId, COMMAND), inputSha256: hash(value.inputSha256, COMMAND),
    inputByteSize: bytes(value.inputByteSize, IMAGE_LIMITS.inputBytes, COMMAND), originalName: filename(value.originalName, COMMAND), rightsDeclaration: text(value.rightsDeclaration, 2000, COMMAND)};
}
export function parseGetUpload(value: unknown): AssetGetUpload {
  fields(value, ['datasetId', 'uploadId'], [], QUERY); return {datasetId: id(value.datasetId, QUERY), uploadId: id(value.uploadId, QUERY)};
}
export function parseGetAsset(value: unknown): AssetGet {
  fields(value, ['datasetId', 'assetId'], [], QUERY); return {datasetId: id(value.datasetId, QUERY), assetId: id(value.assetId, QUERY)};
}
export function parseCompleteUpload(value: unknown): AssetCompleteUpload {
  fields(value, ['datasetId', 'commandId', 'uploadId'], [], COMMAND);
  return {datasetId: id(value.datasetId, COMMAND), commandId: id(value.commandId, COMMAND), uploadId: id(value.uploadId, COMMAND)};
}
export function parseUploadIntentDTO(value: unknown): UploadIntentDTO {
  fields(value, ['id', 'datasetId', 'assetId', 'inputSha256', 'inputByteSize', 'originalName', 'rightsDeclaration', 'status', 'outputSha256', 'outputByteSize', 'outputWidth', 'outputHeight', 'createdAt', 'updatedAt', 'expiresAt', 'revision'], [], DTO);
  const statuses: readonly unknown[] = ['reserved', 'processing', 'published', 'finalizing', 'completed', 'failed', 'deleting'];
  if (!statuses.includes(value.status)) throw Error(DTO);
  const output = [value.outputSha256, value.outputByteSize, value.outputWidth, value.outputHeight];
  const hasOutput = output.every(v => v !== null);
  if (!hasOutput && output.some(v => v !== null)) throw Error(DTO);
  if (['published', 'finalizing', 'completed'].includes(value.status as string) && !hasOutput) throw Error(DTO);
  if (value.status === 'reserved' && hasOutput) throw Error(DTO);
  return {id: id(value.id, DTO), datasetId: id(value.datasetId, DTO), assetId: id(value.assetId, DTO), inputSha256: hash(value.inputSha256, DTO),
    inputByteSize: bytes(value.inputByteSize, IMAGE_LIMITS.inputBytes, DTO), originalName: filename(value.originalName, DTO), rightsDeclaration: text(value.rightsDeclaration, 2000, DTO), status: value.status as UploadStatus,
    outputSha256: hasOutput ? hash(value.outputSha256, DTO) : null, outputByteSize: hasOutput ? bytes(value.outputByteSize, IMAGE_LIMITS.outputBytes, DTO) : null,
    outputWidth: hasOutput ? integer(value.outputWidth, 1, IMAGE_LIMITS.outputMaxEdge, DTO) : null, outputHeight: hasOutput ? integer(value.outputHeight, 1, IMAGE_LIMITS.outputMaxEdge, DTO) : null,
    createdAt: timestamp(value.createdAt, DTO), updatedAt: timestamp(value.updatedAt, DTO), expiresAt: timestamp(value.expiresAt, DTO), revision: integer(value.revision, 1, 2147483647, DTO)};
}
export function parseAssetDTO(value: unknown): AssetDTO {
  fields(value, ['id', 'datasetId', 'sha256', 'mimeType', 'byteSize', 'originalName', 'rightsDeclaration', 'width', 'height', 'status', 'deletedAt', 'createdAt', 'updatedAt', 'revision'], [], DTO);
  if (value.mimeType !== 'image/webp' || !['ready', 'unavailable'].includes(value.status as string)) throw Error(DTO);
  return {id: id(value.id, DTO), datasetId: id(value.datasetId, DTO), sha256: hash(value.sha256, DTO), mimeType: 'image/webp', byteSize: bytes(value.byteSize, IMAGE_LIMITS.outputBytes, DTO),
    originalName: filename(value.originalName, DTO), rightsDeclaration: text(value.rightsDeclaration, 2000, DTO), width: integer(value.width, 1, IMAGE_LIMITS.outputMaxEdge, DTO), height: integer(value.height, 1, IMAGE_LIMITS.outputMaxEdge, DTO),
    status: value.status as AssetDTO['status'], deletedAt: value.deletedAt === null ? null : timestamp(value.deletedAt, DTO), createdAt: timestamp(value.createdAt, DTO), updatedAt: timestamp(value.updatedAt, DTO), revision: integer(value.revision, 1, 2147483647, DTO)};
}
