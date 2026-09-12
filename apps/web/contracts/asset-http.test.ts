import {expect, it} from 'vitest';
import {assetErrorHTTPStatus, assetErrorTRPCCode, ASSET_DATASET_HEADER} from './asset-http';
import {assetFailure, assetTRPCError} from '../server/asset-errors';
import {assetTransportError} from '../lib/authoring/asset-failure';
it('keeps the browser-safe dataset header unchanged', () => {expect(ASSET_DATASET_HEADER).toBe('x-everwoven-dataset-id');});
it.each([
  ['LOCAL_SESSION_INVALID', 401, 'UNAUTHORIZED'], ['LOCAL_ORIGIN_DENIED', 403, 'FORBIDDEN'],
  ['INVALID_ASSET_COMMAND', 400, 'BAD_REQUEST'], ['PRIVATE_ASSET_NOT_FOUND', 404, 'NOT_FOUND'],
  ['ASSET_UPLOAD_EXPIRED', 409, 'CONFLICT'], ['DATASET_CHANGED', 412, 'PRECONDITION_FAILED'],
  ['IMAGE_BODY_TOO_LARGE', 413, 'PAYLOAD_TOO_LARGE'], ['UNSUPPORTED_IMAGE_FORMAT', 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ['IMAGE_DECODER_BUSY', 503, 'SERVICE_UNAVAILABLE'],
] as const)('uses one exact public contract for %s, including both boundary consumers', (identifier, status, code) => {
  expect(assetErrorHTTPStatus(identifier)).toBe(status); expect(assetErrorTRPCCode(status)).toBe(code);
  expect(assetFailure(Error(identifier))).toEqual({status, message: identifier}); expect(assetTRPCError(Error(identifier)).code).toBe(code);
  expect(assetTransportError({error: identifier}, status).identifier).toBe(identifier);
  expect(assetTransportError({message: identifier, data: {httpStatus: status, code}}).identifier).toBe(identifier);
  expect(assetTransportError({error: identifier}, status === 400 ? 404 : 400).identifier).toBeNull();
});
it.each(['PRIVATE_ASSET_IO', 'LOCAL_HOST_INVALID', 'PRIVATE_ASSET_NOT_FOUND /private/raw', 'INVALID_ASSET_COMMAND extra', '__proto__', 'toString', ''])('excludes private/unknown/prefix identifiers: %s', identifier => {
  expect(assetErrorHTTPStatus(identifier)).toBeUndefined(); expect(assetFailure(Error(identifier))).toEqual({status: 500, message: '服务暂不可用'});
  expect(assetTransportError({error: identifier}, 400).identifier).toBeNull();
});
it('keeps generic 500 mapping separate from any public identifier', () => {
  expect(assetErrorTRPCCode(500)).toBe('INTERNAL_SERVER_ERROR'); expect(assetErrorTRPCCode(418)).toBeUndefined(); expect(assetErrorHTTPStatus('INTERNAL_SERVER_ERROR')).toBeUndefined();
});
