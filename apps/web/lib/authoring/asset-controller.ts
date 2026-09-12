import {v7} from 'uuid';
import {parseBeginUpload, parseUploadIntentDTO, parseAssetDTO} from 'runtime/contracts/asset-validation';
import type {AssetBeginUpload, AssetCompleteUpload, UploadIntentDTO} from 'runtime/contracts/asset';
import type {AssetUploadBinding, AssetUploadState, AssetUploadResult, FormalAssetClient, AssetRef, DemoAssetRef} from './asset-ports';
import {AssetTransportError, assetTransportError} from './asset-failure';
import {prepareAssetFile, validateAssetSelection} from './asset-preflight';

type WriteStage = 'begin' | 'process' | 'complete';
type Pending = {
  operationId: string; editingKey: string; kind: 'formal' | 'demo'; datasetId: string | null;
  file: File; rights: string; sent: boolean; stage: 'begin' | 'process' | 'complete';
  demoImport?: Promise<DemoAssetRef>;
  repairCandidate?: boolean;
  uncertainWrites: Set<WriteStage>; activeWrite: WriteStage | null;
  begin: AssetBeginUpload | null; upload: UploadIntentDTO | null; complete: AssetCompleteUpload | null;
};
const initial = (): AssetUploadState => ({phase: 'idle', busy: false, unknown: false, datasetChanged: false, unknownStage: null, fileName: '', error: null, result: null});
const superseded = () => Error('ASSET_RESPONSE_SUPERSEDED');
/** One editor-slot lifetime. No persistence, automatic retry, or cross-dataset command conversion. */
export class AssetUploadController {
  private state = initial();
  private binding: AssetUploadBinding | null = null;
  private pending: Pending | null = null;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private suspended = false;
  private abort: AbortController | null = null;
  private flight: Promise<void> | null = null;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = () => this.state;
  private publish(patch: Partial<AssetUploadState>) {this.state = {...this.state, ...patch}; this.listeners.forEach(fn => fn());}
  private fence() {
    const p = this.pending;
    if (p?.activeWrite) {p.uncertainWrites.add(p.activeWrite); p.activeWrite = null;}
    this.epoch++; this.abort?.abort(); this.abort = null; this.flight = null;
  }
  bind(next: AssetUploadBinding): void {
    const old = this.binding;
    if (!this.suspended && old && old.client === next.client && old.connected === next.connected && old.datasetId === next.datasetId && old.invalidate === next.invalidate && old.editingKey === next.editingKey) return;
    this.fence(); this.binding = next; this.suspended = false;
    const p = this.pending;
    if (p?.sent) {
      const changed = p.kind !== next.client.kind || (p.kind === 'formal' && next.datasetId !== null && p.datasetId !== next.datasetId);
      this.publish({busy: false, phase: 'unknown', unknown: true, unknownStage: p.stage, result: null, datasetChanged: this.state.datasetChanged || changed});
    } else {this.pending = null; this.state = initial(); this.publish({});}
  }
  suspend(): void {
    this.fence(); this.suspended = true;
    if (this.pending?.sent) this.publish({busy: false, phase: 'unknown', unknown: true, unknownStage: this.pending.stage, result: null});
    else {this.pending = null; this.state = initial(); this.publish({});}
  }
  reset(): boolean {
    if (this.state.busy || this.state.unknown || this.state.datasetChanged) return false;
    this.fence(); this.pending = null; this.state = initial(); this.publish({}); return true;
  }
  discardForDatasetChange(): boolean {
    const b = this.binding, p = this.pending;
    if (this.state.busy || !b || (b.client.kind === 'formal' && !b.connected)) return false;
    if (p?.sent && p.kind === b.client.kind && p.datasetId === b.datasetId) return false;
    this.fence(); this.pending = null; this.state = initial(); this.publish({}); return true;
  }
  takeResult(operationId: string): AssetUploadResult | null {
    const result = this.state.result, b = this.binding;
    if (!result || result.operationId !== operationId || !b || this.suspended || result.editingKey !== b.editingKey ||
      result.ref.kind !== b.client.kind || (result.ref.kind === 'formal' && (!b.connected || result.ref.datasetId !== b.datasetId))) return null;
    // Consume synchronously before notifying React; callbacks/effects may run more than once.
    this.publish({result: null}); return result;
  }
  start(file: File, rightsDeclaration: string): Promise<void> {
    if (this.flight) return this.flight;
    if (this.state.unknown || this.state.datasetChanged) return Promise.resolve();
    const b = this.binding;
    if (!b || this.suspended || (b.client.kind === 'formal' && (!b.connected || !b.datasetId))) {
      this.publish({phase: 'rejected', error: new AssetTransportError('session').failure}); return Promise.resolve();
    }
    const p: Pending = {operationId: v7(), editingKey: b.editingKey, kind: b.client.kind, datasetId: b.client.kind === 'formal' ? b.datasetId : null, file, rights: rightsDeclaration, sent: false, stage: 'begin', uncertainWrites: new Set(), activeWrite: null, begin: null, upload: null, complete: null};
    this.pending = p; return this.launch(p, true);
  }
  confirm(): Promise<void> {return this.resume();}
  retry(): Promise<void> {return this.resume();}
  private resume(): Promise<void> {
    if (this.flight) return this.flight;
    const b = this.binding, p = this.pending;
    if (!p || !b || this.suspended || this.state.datasetChanged || (b.client.kind === 'formal' && (!b.connected || p.datasetId !== b.datasetId)) || b.client.kind !== p.kind) return Promise.resolve();
    return this.launch(p, !p.sent);
  }
  private launch(p: Pending, preparing: boolean): Promise<void> {
    const b = this.binding!, epoch = this.epoch, abort = new AbortController(); this.abort = abort;
    const current = () => epoch === this.epoch && p === this.pending && !this.suspended;
    const check = () => {if (!current()) throw superseded();};
    let done!: () => void;
    const task = new Promise<void>(resolve => {done = resolve;}); this.flight = task;
    let repairAttempt = false, readingUpload = false;
    this.publish({phase: preparing ? 'validating' : p.stage === 'begin' ? 'beginning' : p.stage === 'process' ? 'sending' : 'completing', busy: true, error: null, result: null, fileName: p.file.name});
    void (async () => {
      try {
        if (preparing) validateAssetSelection(p.file, p.rights);
        if (b.client.kind === 'demo') {
          this.publish({phase: 'sending'}); p.sent = true;
          // IndexedDB import has no remote receipt. Retain its actual promise across
          // editor suspension rather than creating another browser asset on confirm.
          if (!p.demoImport) {
            const imported = b.client.importImage(p.file);
            p.demoImport = imported;
            // Keep pending/fulfilled imports across epochs, but a settled rejection
            // is not a reusable result. Clear only this attempt, even if its UI epoch
            // ended; no new browser transaction starts until an explicit retry.
            void imported.catch(() => {if (p.demoImport === imported) p.demoImport = undefined;});
          }
          const ref = await p.demoImport; check();
          if (ref.kind !== 'demo' || !ref.id) throw new AssetTransportError('internal');
          this.finish(p, ref); return;
        }
        if (preparing) {
          const metadata = await prepareAssetFile(p.file); check();
          try {p.begin = Object.freeze(parseBeginUpload({datasetId: p.datasetId, commandId: v7(), ...metadata, originalName: p.file.name, rightsDeclaration: p.rights}));}
          catch {throw new AssetTransportError('invalid');}
        }
        if (b.client.kind !== 'formal' || !p.begin) throw new AssetTransportError('internal');
        const client = b.client;
        if (!p.upload) {
          p.stage = 'begin'; p.sent = true; this.publish({phase: 'beginning'});
          p.activeWrite = 'begin';
          const response = await client.beginUpload(p.begin); check();
          p.upload = this.upload(p, response.data);
          p.activeWrite = null; p.uncertainWrites.delete('begin');
          p.complete = Object.freeze({datasetId: p.datasetId!, uploadId: p.upload.id, commandId: v7()});
          p.stage = 'process';
        }
        if (p.stage !== 'complete' || p.repairCandidate) {
          // Begin replies are historical. PUT uncertainty and explicit missing-candidate
          // recovery both read the current intent before deciding whether bytes may be sent.
          readingUpload = true;
          const latest = await client.getUpload({datasetId: p.datasetId!, uploadId: p.upload.id}); check();
          readingUpload = false;
          p.upload = this.upload(p, latest);
          if (p.upload.status === 'published' || p.upload.status === 'completed') p.uncertainWrites.delete('process');
          if (['failed', 'deleting'].includes(p.upload.status)) throw new AssetTransportError('conflict', 'ASSET_UPLOAD_EXPIRED');
          if (p.upload.status === 'completed') p.repairCandidate = false;
          if (p.upload.status !== 'completed' && (p.repairCandidate || p.upload.status === 'reserved' || (p.upload.status === 'processing' && p.upload.outputSha256 === null))) {
            repairAttempt = p.repairCandidate === true;
            // An uncertain PUT must first read published/completed on its next confirmation.
            // Only an exact server busy rejection below retains permission to try this repair.
            p.repairCandidate = false;
            p.stage = 'process'; this.publish({phase: 'sending'});
            p.activeWrite = 'process';
            const published = await client.process({datasetId: p.datasetId!, uploadId: p.upload.id}, p.file, abort.signal); check();
            p.upload = this.upload(p, published); if (p.upload.status !== 'published') throw new AssetTransportError('internal');
            p.activeWrite = null; p.uncertainWrites.delete('process');
          }
        }
        await this.complete(p, client, check);
      } catch (cause) {
        if (current()) {
          const error = assetTransportError(cause);
          const unresolved = p.uncertainWrites.size > 0;
          // A receipt lookup can race an older, still-valid finalizer. Even expiry
          // cannot settle an already uncertain command; only its confirmed outcome can.
          const terminal = !readingUpload && !unresolved && ['ASSET_UPLOAD_EXPIRED', 'IDEMPOTENCY_CONFLICT'].includes(error.identifier ?? '');
          if (!readingUpload && p.stage === 'complete' && p.upload?.status !== 'completed' && error.failure.kind === 'missing' && error.identifier === 'PRIVATE_ASSET_NOT_FOUND') p.repairCandidate = true;
          if (repairAttempt && error.identifier === 'ASSET_UPLOAD_BUSY') p.repairCandidate = true;
          // The command-specific terminal proof above is required to discard pending work;
          // a parser rejection, generic HTTP error, or lost session is not that proof.
          if (terminal) this.pending = null;
          // HTTP status alone (including 400/404/413/415) is not evidence that a write
          // did not commit. A failed status read likewise cannot settle an earlier write.
          const uncertain = p.sent && !terminal && (unresolved || (p.kind === 'formal' && (error.identifier === null || readingUpload)) ||
            ['session','forbidden','datasetChanged','precondition','conflict','busy','unavailable','network','internal'].includes(error.failure.kind));
          if (uncertain && p.activeWrite) p.uncertainWrites.add(p.activeWrite);
          this.publish({phase: uncertain ? 'unknown' : 'rejected', busy: false, unknown: uncertain, unknownStage: uncertain ? p.stage : null, error: error.failure});
          if (error.failure.kind === 'datasetChanged') {this.fence(); this.publish({datasetChanged: true});}
          if (['session', 'forbidden', 'datasetChanged'].includes(error.failure.kind)) b.invalidate();
        }
      } finally {
        if (epoch === this.epoch) {p.activeWrite = null; this.flight = null; this.abort = null; this.publish({busy: false});}
      }
    })().then(done, () => done());
    return task;
  }
  private upload(p: Pending, value: unknown): UploadIntentDTO {
    let dto: UploadIntentDTO; try {dto = parseUploadIntentDTO(value);} catch {throw new AssetTransportError('internal');}
    if (dto.datasetId !== p.datasetId || (p.upload && (dto.id !== p.upload.id || dto.assetId !== p.upload.assetId)) || !p.begin ||
      dto.inputSha256 !== p.begin.inputSha256 || dto.inputByteSize !== p.begin.inputByteSize || dto.originalName !== p.begin.originalName || dto.rightsDeclaration !== p.begin.rightsDeclaration) throw new AssetTransportError('internal');
    return dto;
  }
  private async complete(p: Pending, client: FormalAssetClient, check: () => void) {
    if (!p.complete || !p.upload) throw new AssetTransportError('internal');
    p.stage = 'complete'; this.publish({phase: 'completing'});
    p.activeWrite = 'complete';
    const response = await client.completeUpload(p.complete); check();
    let dto; try {dto = parseAssetDTO(response.data);} catch {throw new AssetTransportError('internal');}
    if (dto.id !== p.upload.assetId || dto.datasetId !== p.datasetId || dto.status !== 'ready' || dto.deletedAt !== null ||
      dto.sha256 !== p.upload.outputSha256 || dto.byteSize !== p.upload.outputByteSize || dto.width !== p.upload.outputWidth || dto.height !== p.upload.outputHeight ||
      dto.originalName !== p.upload.originalName || dto.rightsDeclaration !== p.upload.rightsDeclaration) throw new AssetTransportError('internal');
    this.finish(p, {kind: 'formal', datasetId: dto.datasetId, id: dto.id});
  }
  private finish(p: Pending, ref: AssetRef) {
    this.pending = null;
    this.publish({phase: 'ready', busy: false, unknown: false, unknownStage: null, error: null, result: this.binding?.editingKey === p.editingKey ? {operationId: p.operationId, editingKey: p.editingKey, ref} : null});
  }
}
