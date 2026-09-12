import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {withLocalBrowser} from './local-browser-harness.mjs';

// Production HTTP and browser decoding evidence, not an implemented upload UI.
// The shared harness owns only a temporary Host/server; it never touches port 3100.
process.env.SMOKE_PORT ??= '3196';
const requireRuntime = createRequire(new URL('../../apps/runtime/package.json', import.meta.url));
const sharp = requireRuntime('sharp');
const {v7} = requireRuntime('uuid');
const png = await sharp({create: {width: 512, height: 320, channels: 3, background: '#a9c9ed'}}).png().toBuffer();

await withLocalBrowser(async ({page, origin, datasetId, connectionCode, restart}) => {
  page.setDefaultTimeout(15000);
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await page.getByLabel('本机连接码', {exact: true}).fill(connectionCode);
  await page.getByRole('button', {name: '连接本机', exact: true}).click();
  await page.getByRole('status').filter({hasText: '已连接本机'}).waitFor();

  function headers(response) {
    assert.equal(response.headers()['cache-control'], 'no-store');
    assert.equal(response.headers()['x-content-type-options'], 'nosniff');
  }
  async function command(name, input) {
    const response = await page.request.post(`${origin}/api/trpc/${name}`, {
      headers: {Origin: origin, 'x-everwoven-request': '1'}, data: input,
    });
    assert.equal(response.status(), 200, `${name} must be served by the production router`);
    headers(response);
    return (await response.json()).result.data;
  }
  const begin = {datasetId, commandId: v7(), inputSha256: createHash('sha256').update(png).digest('hex'),
    inputByteSize: String(png.length), originalName: 'generated-sky.png', rightsDeclaration: 'Generated test image; no user media.'};
  // Deliberately discard one confirmed response, then replay the original command.
  await command('assets.beginUpload', begin);
  const replay = await command('assets.beginUpload', begin);
  assert.equal(replay.replayed, true);
  const upload = replay.data;
  assert.equal(upload.status, 'reserved');
  const uploaded = await page.request.put(`${origin}/api/local-assets/uploads/${upload.id}`, {
    headers: {Origin: origin, 'x-everwoven-request': '1', 'x-everwoven-dataset-id': datasetId, 'Content-Type': 'image/png'}, data: png,
  });
  assert.equal(uploaded.status(), 200); headers(uploaded);
  assert.equal((await uploaded.json()).status, 'published');
  const complete = {datasetId, commandId: v7(), uploadId: upload.id};
  await command('assets.completeUpload', complete);
  const confirmed = await command('assets.completeUpload', complete);
  assert.equal(confirmed.replayed, true);
  const asset = confirmed.data;
  assert.equal(asset.id, upload.assetId); assert.equal(asset.status, 'ready');
  assert.equal(asset.mimeType, 'image/webp');
  for (const key of ['ownerId', 'storageKey', 'processingToken', 'leaseExpiresAt', 'path']) assert(!(key in asset));
  const character = await command('characters.create', {datasetId, commandId: v7(), name: 'HTTP素材持久化验收',
    settings: {personality: '', appearance: '', speakingStyle: '', boundaries: ''}, portraitAssetId: asset.id});
  assert.equal(character.data.portraitAssetId, asset.id);
  const url = `${origin}/api/local-assets/${asset.id}?datasetId=${datasetId}`;
  async function verifyImage() {
    const response = await page.request.get(url); // Ordinary GET without Origin is supported.
    assert.equal(response.status(), 200); headers(response);
    assert.equal(response.headers()['content-type'], 'image/webp');
    const bytes = await response.body();
    assert.equal(String(bytes.length), asset.byteSize);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    const dimensions = await page.evaluate(async url => {
      const img = new Image(); img.src = url;
      await img.decode();
      return {width: img.naturalWidth, height: img.naturalHeight};
    }, url);
    assert.deepEqual(dimensions, {width: asset.width, height: asset.height});
  }
  await verifyImage();
  await restart();
  await verifyImage();
  const read = await page.request.get(`${origin}/api/trpc/characters.get?input=${encodeURIComponent(JSON.stringify({id: character.data.id}))}`);
  assert.equal(read.status(), 200);
  assert.equal((await read.json()).result.data.portraitAssetId, asset.id);
  const wrongDataset = await page.request.get(`${origin}/api/local-assets/${asset.id}?datasetId=${v7()}`);
  assert.equal(wrongDataset.status(), 412); headers(wrongDataset);
  const foreign = await page.request.get(url, {headers: {Origin: 'https://invalid.example'}});
  assert.equal(foreign.status(), 403); headers(foreign);
  // Keep the credential in memory only: clearing the cookie jar does not prove revocation.
  const savedCookies = await page.context().cookies(origin);
  assert(savedCookies.length > 0, 'Authenticated cookie must exist before logout');
  const oldCookie = savedCookies.map(({name, value}) => `${name}=${value}`).join('; ');
  const logout = await page.request.delete(`${origin}/api/local-session`, {headers: {Origin: origin, 'x-everwoven-request': '1'}});
  assert.equal(logout.status(), 200);
  const revoked = await page.request.get(url);
  assert.equal(revoked.status(), 401); headers(revoked);
  assert(!revoked.headers()['content-type']?.startsWith('image/'));
  const staleCredential = await page.request.get(url, {headers: {Cookie: oldCookie}});
  assert.equal(staleCredential.status(), 401, 'The original credential must be revoked server-side');
  headers(staleCredential);
  assert(!staleCredential.headers()['content-type']?.startsWith('image/'));
  console.log('Asset production HTTP smoke passed: real upload, durable completion, immutable replay, browser WebP decoding, portrait binding, server restart and revoked access. Upload UI remains a separate milestone; no model calls.');
});
