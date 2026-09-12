/** Public protocol only. Filesystem identity, ownership and leases never cross this boundary. */
export const IMAGE_LIMITS = Object.freeze({
  inputBytes: 10 * 1024 * 1024,
  inputMinEdge: 256,
  inputMaxEdge: 8000,
  inputPixels: 24_000_000,
  outputMaxEdge: 2048,
  outputBytes: 10 * 1024 * 1024,
});
export type UploadStatus = 'reserved' | 'processing' | 'published' | 'finalizing' | 'completed' | 'failed' | 'deleting';
export type AssetBeginUpload = {
  readonly datasetId: string; readonly commandId: string;
  inputSha256: string; inputByteSize: string; originalName: string; rightsDeclaration: string;
};
export type AssetGetUpload = {readonly datasetId: string; uploadId: string};
export type AssetGet = {readonly datasetId: string; assetId: string};
export type AssetCompleteUpload = {readonly datasetId: string; readonly commandId: string; uploadId: string};
export type UploadIntentDTO = {
  id: string; datasetId: string; assetId: string;
  inputSha256: string; inputByteSize: string; originalName: string; rightsDeclaration: string;
  status: UploadStatus;
  outputSha256: string | null; outputByteSize: string | null; outputWidth: number | null; outputHeight: number | null;
  createdAt: string; updatedAt: string; expiresAt: string; revision: number;
};
export type AssetDTO = {
  id: string; datasetId: string; sha256: string; mimeType: 'image/webp'; byteSize: string;
  originalName: string; rightsDeclaration: string; width: number; height: number;
  status: 'ready' | 'unavailable'; deletedAt: string | null; createdAt: string; updatedAt: string; revision: number;
};
export type AssetCommandResult<T extends UploadIntentDTO | AssetDTO> = {data: T; replayed: boolean};
