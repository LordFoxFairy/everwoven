import {afterEach, expect, it, vi} from 'vitest';
const handlers = vi.hoisted(() => ({handleAssetUpload: vi.fn(), handleAssetBytes: vi.fn()}));
vi.mock('./local-assets-http', () => handlers);
import * as uploadRoute from '../app/api/local-assets/uploads/[uploadId]/route';
import * as assetRoute from '../app/api/local-assets/[assetId]/route';
afterEach(() => {vi.clearAllMocks();});
it('both Next routes stay thin Node/dynamic delegates with resolved route identities', async () => {
  expect(uploadRoute.runtime).toBe('nodejs'); expect(assetRoute.runtime).toBe('nodejs');
  expect(uploadRoute.dynamic).toBe('force-dynamic'); expect(assetRoute.dynamic).toBe('force-dynamic');
  const request = new Request('http://127.0.0.1:3196/api/local-assets/fixture'), response = new Response('fixture');
  handlers.handleAssetUpload.mockResolvedValue(response); handlers.handleAssetBytes.mockResolvedValue(response);
  expect(await uploadRoute.PUT(request, {params: Promise.resolve({uploadId: 'upload-fixture'})})).toBe(response);
  expect(handlers.handleAssetUpload).toHaveBeenCalledWith(request, 'upload-fixture', process.env);
  expect(await assetRoute.GET(request, {params: Promise.resolve({assetId: 'asset-fixture'})})).toBe(response);
  expect(handlers.handleAssetBytes).toHaveBeenCalledWith(request, 'asset-fixture', process.env);
});
it('every Next-supported method reaches our handler for uniform 405/Allow/security headers', () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const) {
    expect(typeof uploadRoute[method]).toBe('function'); expect(typeof assetRoute[method]).toBe('function');
  }
});
