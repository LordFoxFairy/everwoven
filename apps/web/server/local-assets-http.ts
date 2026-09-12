import type {ImageBodySource} from 'runtime/host';
import {IMAGE_LIMITS} from 'runtime/contracts/asset';
import {parseGetUpload, parseGetAsset, parseUploadIntentDTO, parseAssetDTO} from 'runtime/contracts/asset-validation';
import {localAssetAccess, ASSET_DATASET_HEADER} from './local-assets';
import {assetJSON, assetErrorResponse, assetSecurityHeaders} from './asset-errors';
import {assetOutput} from './asset-responses';

type Env = Record<string, string | undefined>;
export async function handleAssetUpload(request: Request, uploadId: string, env: Env): Promise<Response> {
  if (request.method !== 'PUT') return assetJSON({error: 'METHOD_NOT_ALLOWED'}, 405, {Allow: 'PUT'});
  try {
    return await localAssetAccess(request, env)(async assets => {
      try {
        if ([...new URL(request.url).searchParams].length) throw Error('INVALID_ASSET_QUERY');
        const input = parseGetUpload({uploadId, datasetId: request.headers.get(ASSET_DATASET_HEADER)});
        const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (type && !['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp'].includes(type)) throw Error('ASSET_MEDIA_TYPE_UNSUPPORTED');
        const declared = request.headers.get('content-length');
        if (declared !== null) {
          if (!/^[0-9]+$/.test(declared)) throw Error('ASSET_CONTENT_LENGTH_INVALID');
          if (Number(declared) > IMAGE_LIMITS.inputBytes) throw Error('IMAGE_BODY_TOO_LARGE');
        }
        // Do not touch request.body, getReader, formData or arrayBuffer until service admission.
        const source: ImageBodySource = {openBody: () => request.body, signal: request.signal};
        const data = assetOutput(parseUploadIntentDTO, await assets.process(input, source));
        if (data.status !== 'published' || data.id !== input.uploadId || data.datasetId !== input.datasetId) throw Error('ASSET_RESPONSE_INVALID');
        return assetJSON(data);
        // HTTP-only validation identifiers must not pass through the Host domain whitelist.
      } catch (error) {return assetErrorResponse(error);}
    });
  } catch (error) {return assetErrorResponse(error);}
}
export async function handleAssetBytes(request: Request, assetId: string, env: Env): Promise<Response> {
  if (request.method !== 'GET') return assetJSON({error: 'METHOD_NOT_ALLOWED'}, 405, {Allow: 'GET'});
  try {
    return await localAssetAccess(request, env)(async assets => {
      try {
        const entries = [...new URL(request.url).searchParams];
        if (entries.length !== 1 || entries[0]![0] !== 'datasetId') throw Error('INVALID_ASSET_QUERY');
        const input = parseGetAsset({assetId, datasetId: entries[0]![1]});
        const result = await assets.getBytes(input), data = assetOutput(parseAssetDTO, result.data);
        if (data.id !== input.assetId || data.datasetId !== input.datasetId || data.status !== 'ready' || data.deletedAt !== null ||
          !Buffer.isBuffer(result.bytes) || String(result.bytes.length) !== data.byteSize) throw Error('ASSET_RESPONSE_INVALID');
        // Range is deliberately ignored: only a complete verified 200 response, never redirects/partial reads.
        return new Response(result.bytes as unknown as BodyInit, {status: 200, headers: {...assetSecurityHeaders, 'Content-Type': 'image/webp', 'Content-Length': String(result.bytes.length)}});
      } catch (error) {return assetErrorResponse(error);}
    });
  } catch (error) {return assetErrorResponse(error);}
}
