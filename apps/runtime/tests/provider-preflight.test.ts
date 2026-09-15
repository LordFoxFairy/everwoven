import {describe, it, expect, vi} from 'vitest';
// @ts-expect-error Operational JS script is exercised through its real exported entrypoint.
import {providerPreflight} from '../../../scripts/provider-preflight.mjs';
const config = {POLLO_BASE: 'https://test123.pollo.ai/api/platform', POLLO_API_KEY: 'POLLO_TEST', OPENROUTER_API_KEY: 'OR_TEST'};
describe('zero-generation preflight', () => {
 it('uses GET only, isolates secrets, and exposes a gateway redirect without following it', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('{}', {headers: {'content-type': 'application/json'}}))
   .mockResolvedValueOnce(new Response(null, {status: 302, headers: {location: 'https://accounts.feishu.cn/login?private=value'}}));
  const result = await providerPreflight(config, fetch);
  expect(result).toMatchObject({generatedTasks: 0, paidRequests: 0, generationReady: false, results: [
   {provider: 'openrouter', httpStatus: 200, result: 'api-response'}, {provider: 'pollo', httpStatus: 302, result: 'gateway-redirect', followedRedirect: false}]});
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, options] of fetch.mock.calls) expect(options).toMatchObject({method: 'GET', redirect: 'manual'});
  expect(fetch.mock.calls[0]![1]?.headers).toEqual({Authorization: 'Bearer OR_TEST'});
  expect(fetch.mock.calls[1]![1]?.headers).toEqual({'x-api-key': 'POLLO_TEST', 'User-Agent': 'HIX.AI WEBBOT Request'});
  expect(JSON.stringify(result)).not.toMatch(/OR_TEST|POLLO_TEST|private|feishu/);
 });
 it('rejects endpoint changes and header injection before transport', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const patch of [{POLLO_BASE: 'https://api.minimax.io'}, {POLLO_API_KEY: 'x\ny'}, {POLLO_SERVICE_BASIC_AUTH_KEY: 'Bearer x'}])
   await expect(providerPreflight({...config, ...patch}, fetch)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps the test gateway Basic credential out of production and OpenRouter', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('{}', {headers: {'content-type': 'application/json'}}));
  await providerPreflight({...config, POLLO_BASE: 'https://pollo.ai/api/platform', POLLO_SERVICE_BASIC_AUTH_KEY: 'Basic dGVzdDp0ZXN0'}, fetch);
  expect(fetch.mock.calls[0]![1]?.headers).toEqual({Authorization: 'Bearer OR_TEST'});
  expect(fetch.mock.calls[1]![1]?.headers).toEqual({'x-api-key': 'POLLO_TEST', 'User-Agent': 'HIX.AI WEBBOT Request'});
 });
 it('does not mistake login HTML for API readiness or print transport errors', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response('secret html', {headers: {'content-type': 'text/html'}}))
   .mockRejectedValueOnce(Error('POLLO_TEST'));
  const result = await providerPreflight(config, fetch);
  expect(result.results).toMatchObject([{result: 'non-api-response'}, {result: 'transport-unavailable'}]);
  expect(JSON.stringify(result)).not.toMatch(/secret|POLLO_TEST/);
 });
});
