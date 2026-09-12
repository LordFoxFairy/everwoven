import type {AssetBeginUpload, AssetGetUpload, AssetCompleteUpload, UploadIntentDTO, AssetDTO, AssetCommandResult} from 'runtime/contracts/asset';
export type DemoAssetRef = Readonly<{kind: 'demo'; id: string}>;
export type FormalAssetRef = Readonly<{kind: 'formal'; datasetId: string; id: string}>;
export type AssetRef = DemoAssetRef | FormalAssetRef;
export interface DemoAssetClient {
  readonly kind: 'demo';
  read(ref: DemoAssetRef, signal?: AbortSignal): Promise<Blob>;
  importImage(file: File): Promise<DemoAssetRef>;
}
export interface FormalAssetClient {
  readonly kind: 'formal';
  read(ref: FormalAssetRef, signal?: AbortSignal): Promise<Blob>;
  beginUpload(input: AssetBeginUpload): Promise<AssetCommandResult<UploadIntentDTO>>;
  getUpload(input: AssetGetUpload): Promise<UploadIntentDTO>;
  process(input: AssetGetUpload, file: File, signal?: AbortSignal): Promise<UploadIntentDTO>;
  completeUpload(input: AssetCompleteUpload): Promise<AssetCommandResult<AssetDTO>>;
}
export type AssetClient = DemoAssetClient | FormalAssetClient;
export type AssetFailureKind = 'session' | 'forbidden' | 'datasetChanged' | 'precondition' | 'missing' | 'conflict' | 'invalid' | 'tooLarge' | 'unsupported' | 'busy' | 'unavailable' | 'network' | 'internal';
export type AssetFailure = Readonly<{kind: AssetFailureKind; message: string}>;
export type AssetReadBinding = Readonly<{client: AssetClient; connected: boolean; datasetId: string | null; invalidate: () => void}>;
export type AssetUploadBinding = AssetReadBinding & Readonly<{editingKey: string}>;
export type AssetUploadPhase = 'idle' | 'validating' | 'beginning' | 'sending' | 'completing' | 'unknown' | 'ready' | 'rejected';
export type AssetUploadResult = Readonly<{operationId: string; editingKey: string; ref: AssetRef}>;
export type AssetUploadState = Readonly<{
  phase: AssetUploadPhase; busy: boolean; unknown: boolean; datasetChanged: boolean;
  unknownStage: 'begin' | 'process' | 'complete' | null;
  fileName: string; error: AssetFailure | null; result: AssetUploadResult | null;
}>;
export type AssetPreviewState = {
  status: 'empty' | 'loading' | 'ready' | 'missing' | 'disconnected' | 'error';
  url: string | null; error: AssetFailure | null; retry(): void;
};
