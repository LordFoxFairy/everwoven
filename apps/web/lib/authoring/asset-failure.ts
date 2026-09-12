import {assetErrorHTTPStatus, assetErrorTRPCCode} from '../../contracts/asset-http';
import type {AssetFailure, AssetFailureKind} from './asset-ports';
const text: Record<AssetFailureKind, string> = {
  session: '连接已失效，请重新连接；原上传命令仍保留。', forbidden: '请求被拒绝，请检查本机连接；原上传命令仍保留。',
  datasetChanged: '数据已重置，原图片命令停止重放。请显式恢复后重新选择图片。', precondition: '请求前置条件未满足，原命令仍待确认。',
  missing: '图片或上传记录不存在，请检查后重试。', conflict: '上传状态冲突，请确认原上传状态后重试。', invalid: '图片或上传信息无效，请检查格式、尺寸和权利声明。',
  tooLarge: '图片超过允许大小，请选择不超过10 MiB的图片。', unsupported: '请选择有效的JPEG、PNG或WebP静态图片。',
  busy: '图片服务正忙，请稍后重试原操作。', unavailable: '图片暂不可用，请稍后重试。', network: '连接中断，操作结果待确认，请保留原上传后重试。', internal: '图片服务暂不可用，请重试；未确认的上传仍保留。',
};

export class AssetTransportError extends Error {
  readonly failure: AssetFailure;
  constructor(kind: AssetFailureKind, readonly identifier: string | null = null) {
    const message = identifier === 'ASSET_UPLOAD_EXPIRED' ? '上传已过期，原操作已停止。请重新选择图片开始新上传。'
      : identifier === 'ASSET_UPLOAD_BUSY' ? '上次图片处理仍占用租约，请稍后重试原操作；原上传命令仍保留。' : text[kind];
    super(message); this.name = 'AssetTransportError'; this.failure = Object.freeze({kind, message});
  }
}
export function assetTransportError(cause: unknown, httpStatus?: number): AssetTransportError {
  if (cause instanceof AssetTransportError) return cause;
  const object = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {};
  const data = object.data && typeof object.data === 'object' ? object.data as Record<string, unknown> : {};
  const status = httpStatus ?? (typeof data.httpStatus === 'number' ? data.httpStatus : undefined);
  const value = typeof object.message === 'string' ? object.message : typeof object.error === 'string' ? object.error : '';
  const code = data.code ?? object.code;
  const protocolShape = httpStatus !== undefined
    ? Object.keys(object).length === 1 && typeof object.error === 'string'
    : !Array.isArray(object.data) && typeof object.message === 'string' && typeof data.httpStatus === 'number'
      && (data.code === undefined || data.code === assetErrorTRPCCode(data.httpStatus));
  const id = protocolShape && assetErrorHTTPStatus(value) === status && status !== undefined ? value : null;
  let kind: AssetFailureKind;
  if (status === 401 || code === 'UNAUTHORIZED' || id === 'LOCAL_SESSION_INVALID') kind = 'session';
  else if (status === 403 || code === 'FORBIDDEN' || id === 'LOCAL_ORIGIN_DENIED') kind = 'forbidden';
  else if (id === 'DATASET_CHANGED') kind = 'datasetChanged';
  else if (status === 412 || code === 'PRECONDITION_FAILED') kind = 'precondition';
  else if (status === 404 || code === 'NOT_FOUND' || ['ASSET_NOT_FOUND','ASSET_UPLOAD_NOT_FOUND','PRIVATE_ASSET_NOT_FOUND'].includes(id ?? '')) kind = 'missing';
  else if (status === 413 || code === 'PAYLOAD_TOO_LARGE' || ['IMAGE_TOO_LARGE','IMAGE_OUTPUT_TOO_LARGE','IMAGE_BODY_TOO_LARGE'].includes(id ?? '')) kind = 'tooLarge';
  else if (status === 415 || code === 'UNSUPPORTED_MEDIA_TYPE' || id === 'UNSUPPORTED_IMAGE_FORMAT') kind = 'unsupported';
  else if (['IMAGE_BODY_BUSY','IMAGE_BODY_TIMEOUT','IMAGE_DECODER_BUSY','IMAGE_PROCESSING_TIMEOUT'].includes(id ?? '')) kind = 'busy';
  else if (status === 503 || code === 'SERVICE_UNAVAILABLE' || id === 'ASSET_UNAVAILABLE') kind = 'unavailable';
  else if (status === 409 || code === 'CONFLICT' || ['ASSET_UPLOAD_BUSY','ASSET_STATE_INVALID','ASSET_LEASE_LOST','ASSET_UPLOAD_EXPIRED','IDEMPOTENCY_CONFLICT'].includes(id ?? '')) kind = 'conflict';
  else if (status === 400 || code === 'BAD_REQUEST' || id !== null) kind = 'invalid';
  else kind = status !== undefined || code === 'INTERNAL_SERVER_ERROR' ? 'internal' : 'network';
  return new AssetTransportError(kind, id);
}
export const aborted = () => new DOMException('Aborted', 'AbortError');
