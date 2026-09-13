import assert from 'node:assert/strict';
import {writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {withLocalBrowser} from './local-browser-harness.mjs';
const {v7} = createRequire(new URL('../../apps/runtime/package.json', import.meta.url))('uuid');
process.env.SMOKE_PORT ??= '3197';
await withLocalBrowser(async ({page, origin, directory, datasetId, restart}) => {
  const protocol = {protocolVersion: 1, datasetId}, headers = {Origin: origin, 'x-everwoven-request': '1'};
  const config = {schemaVersion: 1, connections: [{id: 'test-international', providerId: 'minimax', region: 'international', accountScopeId: 'test-account-one', credentialRef: 'env:UNUSED_SMOKE_KEY'}],
    bindings: [{bindingKey: 'video', versionNo: 1, connectionId: 'test-international', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}}]};
  const providerPath = path.join(directory, 'providers.json');
  async function query(method, input = protocol) {
    return page.request.get(`${origin}/api/trpc/${method}?input=${encodeURIComponent(JSON.stringify(input))}`, {headers});
  }
  async function mutation(method, input) {return page.request.post(`${origin}/api/trpc/${method}`, {headers, data: input});}
  async function data(response) {assert.equal(response.status(), 200, await response.text()); return (await response.json()).result.data;}
  assert.equal((await query('openings.bindings')).status(), 401);
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('status').filter({hasText: '已连接本机'}).waitFor();
  assert.equal(await page.getByLabel('本机连接码').count(), 0);
  // Unload dev HMR before intentional process shutdowns; the context retains its real session cookie.
  await page.goto('about:blank');
  assert.equal((await data(await query('openings.bindings'))).status, 'empty');
  await writeFile(providerPath, JSON.stringify(config), {mode: 0o600});
  assert.equal((await data(await query('openings.bindings'))).status, 'empty', 'Requests must not re-read new config');
  await restart();
  const bindings = await data(await query('openings.bindings'));
  assert.equal(bindings.status, 'ready', 'Compiled launcher and Next routes must share the startup instance');
  assert.equal(bindings.items[0].region, 'international');
  assert(!JSON.stringify(bindings).match(/credentialRef|test-account-one|UNUSED_SMOKE_KEY|https:/));
  const story = await data(await mutation('storyDrafts.create', {...protocol, commandId: v7(), title: 'HTTP opening fixture',
    settings: {world: 'user world', opening: 'user opening', genre: '', playerRole: '', worldRules: [], tone: ''},
    mainCharacter: null, assetSlots: {cover: null, opening: null, character: null}}));
  const command = {...protocol, commandId: v7(), storyDraftId: story.data.id, expectedStoryRevision: 1, bindingKey: 'video', expectedBindingVersion: 1,
    budget: {limitMicros: '0', currency: 'USD'}};
  const opening = await data(await mutation('openings.create', command));
  assert.equal(opening.replayed, false); assert.equal(opening.data.canDispatch, false); assert.equal(opening.data.media, null);
  assert.equal(opening.data.binding.modelId, 'MiniMax-H3-Max');
  await unlink(providerPath);
  assert.equal((await data(await query('openings.bindings'))).status, 'ready');
  await restart();
  assert.equal((await data(await query('openings.bindings'))).status, 'empty');
  const emptyRejected = await mutation('openings.create', {...command, commandId: v7()});
  assert.equal(emptyRejected.status(), 404);
  assert.equal((await emptyRejected.json()).error.message, 'PROVIDER_BINDING_NOT_REGISTERED');
  assert.deepEqual(await data(await mutation('openings.create', command)), {...opening, replayed: true});
  assert.deepEqual(await data(await query('openings.getPreparing', {...protocol, id: opening.data.id})), opening.data);
  await writeFile(providerPath, '{broken', {mode: 0o600}); await restart();
  assert.equal((await data(await query('openings.bindings'))).status, 'unavailable');
  assert.deepEqual(await data(await mutation('openings.create', command)), {...opening, replayed: true});
  assert.deepEqual(await data(await query('openings.getPreparing', {...protocol, id: opening.data.id})), opening.data);
  assert.equal((await query('storyDrafts.get', {...protocol, id: story.data.id})).status(), 200);
  const rejected = await mutation('openings.create', {...command, commandId: v7()}); assert.equal(rejected.status(), 503);
  assert.equal((await rejected.json()).error.message, 'PROVIDER_CONFIGURATION_UNAVAILABLE');
  config.connections[0].accountScopeId = 'test-account-two';
  await writeFile(providerPath, JSON.stringify(config), {mode: 0o600}); await restart();
  const changed = await mutation('openings.create', {...command, commandId: v7()});
  assert.equal(changed.status(), 409); assert.equal((await changed.json()).error.message, 'PROVIDER_BINDING_CONFLICT');
  assert.deepEqual(await data(await mutation('openings.create', command)), {...opening, replayed: true});
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await page.getByText('HTTP opening fixture', {exact: true}).first().waitFor();
  console.log(`Opening HTTP smoke passed (${process.env.SMOKE_DEV === 'true' ? 'dev' : 'production'}): authenticated compiled Host/Next shared startup, no request-time reload, atomic zero-budget preparation, restart replay/readback with missing/broken/changed provider config; original authoring usable, no model requests.`);
});
