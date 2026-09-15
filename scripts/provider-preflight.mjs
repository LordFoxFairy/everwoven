import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Read-only connectivity check. There is deliberately no generation/credit POST operation here. */
export async function providerPreflight(config, fetchImpl = fetch) {
 const base = config.POLLO_BASE;
 if (!['https://test123.pollo.ai/api/platform', 'https://pollo.ai/api/platform'].includes(base)) throw Error('PREFLIGHT_ENDPOINT_INVALID');
 for (const key of ['OPENROUTER_API_KEY', 'POLLO_API_KEY'])
  if (typeof config[key] !== 'string' || !config[key].trim() || /[\r\n]/.test(config[key]) || config[key].length > 4096) throw Error('PREFLIGHT_CREDENTIAL_INVALID');
 const basic = config.POLLO_SERVICE_BASIC_AUTH_KEY, userAgent = config.POLLO_SERVICE_UA ?? 'HIX.AI WEBBOT Request';
 if ((basic !== undefined && (!/^Basic [A-Za-z0-9+/]+=*$/.test(basic) || basic.length > 4096)) ||
  typeof userAgent !== 'string' || !userAgent.trim() || /[\r\n]/.test(userAgent) || userAgent.length > 512) throw Error('PREFLIGHT_CREDENTIAL_INVALID');
 async function check(provider, url, headers) {
  try {
   const response = await fetchImpl(url, {method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000), headers});
   const status = response.status;
   if (status >= 300 && status < 400) {
    await response.body?.cancel().catch(() => {});
    return {provider, httpStatus: status, result: 'gateway-redirect', followedRedirect: false};
   }
   if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {}); return {provider, httpStatus: status, result: 'non-api-response'};
   }
   // JSON content type alone never proves model access or a successful generation.
   await response.body?.cancel().catch(() => {});
   return {provider, httpStatus: status, result: status === 401 || status === 403 ? 'authentication-rejected' : response.ok ? 'api-response' : 'api-error'};
  } catch {return {provider, result: 'transport-unavailable'};}
 }
 const results = await Promise.all([
  check('openrouter', 'https://openrouter.ai/api/v1/key', {Authorization: `Bearer ${config.OPENROUTER_API_KEY.trim()}`}),
  check('pollo', `${base}/generation/everwoven-preflight-no-task`, {'x-api-key': config.POLLO_API_KEY.trim(),
   'User-Agent': userAgent, ...(base === 'https://test123.pollo.ai/api/platform' && basic ? {Authorization: basic} : {})}),
 ]);
 return {generatedTasks: 0, paidRequests: 0, generationReady: false, results};
}

async function main() {
 const file = process.argv[2];
 if (!file || !isAbsolute(file) || process.argv.length !== 3) throw Error('Usage: node scripts/provider-preflight.mjs /absolute/private/provider-secrets.json');
 const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
 let config;
 try {
  const before = await handle.stat();
  if (!before.isFile() || before.uid !== process.getuid?.() || (before.mode & 0o7777) !== 0o600 || before.nlink !== 1 || before.size > 16384) throw Error('PREFLIGHT_PRIVATE_FILE_INVALID');
  const bytes = Buffer.alloc(16385), {bytesRead} = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
  if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw Error('PREFLIGHT_PRIVATE_FILE_INVALID');
  config = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, bytesRead)));
 } finally {await handle.close();}
 console.log(JSON.stringify(await providerPreflight(config), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 main().catch(() => {console.error('Provider preflight failed; verify private file permissions and configuration.'); process.exitCode = 1;});
}
