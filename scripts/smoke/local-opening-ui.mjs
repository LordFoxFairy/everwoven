import assert from 'node:assert/strict';
import {writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {expect, chromium} from '@playwright/test';
import {withLocalBrowser} from './local-browser-harness.mjs';
const {v7} = createRequire(new URL('../../apps/runtime/package.json', import.meta.url))('uuid');
process.env.SMOKE_PORT ??= '3197';
await withLocalBrowser(async ({page, origin, directory, datasetId, restart}) => {
  await writeFile(path.join(directory, 'providers.json'), JSON.stringify({schemaVersion: 1,
    connections: [{id: 'personal', providerId: 'minimax', region: 'international', accountScopeId: 'test-account', credentialRef: 'env:UNUSED_SMOKE_KEY'}],
    bindings: [{bindingKey: 'video', versionNo: 1, connectionId: 'personal', catalogId: 'minimax-h3-max', operationKind: 'text-to-video', generation: {duration: 5, resolution: '768P', ratio: '16:9'}}],
  }), {mode: 0o600});
  await restart();
  await page.addInitScript(() => {
    Storage.prototype.getItem = Storage.prototype.setItem = () => {throw Error('Business storage is disabled');};
    IDBFactory.prototype.open = () => {throw Error('IndexedDB is disabled');};
  });
  const commands = []; let accepted;
  await page.route('**/api/trpc/openings.create', async route => {
    const input = route.request().postDataJSON(); commands.push(input);
    const response = await route.fetch(); assert.equal(response.status(), 200); const data = await response.json();
    if (!accepted) {accepted = data.result.data; await route.fulfill({status: 200, contentType: 'application/json', body: '{lost-response'});}
    else {assert.equal(data.result.data.replayed, true); assert.equal(data.result.data.data.id, accepted.data.id); await route.fulfill({response});}
  });
  await page.goto(origin, {waitUntil: 'networkidle'}); await page.getByRole('status').filter({hasText: '已连接本机'}).waitFor();
  await page.getByRole('button', {name: '创作一个剧本', exact: true}).click();
  await page.getByLabel(/剧本名称/).fill('海边的下一句话');
  await page.getByRole('button', {name: /世界与开局/}).click();
  await page.getByLabel(/世界背景/).fill('雨后的海边画室，你是刚刚推门而入的来访者。');
  await page.getByLabel(/开局情境/).fill('窗外的雨停了，画架旁的人转过身，看向你。');
  await page.getByRole('button', {name: '保存并进入准备', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '正式故事准备', exact: true}); await dialog.waitFor();
  const model = dialog.getByRole('radio', {name: /MiniMax-H3-Max/}); await model.waitFor();
  assert.equal(commands.length, 0); await expect(dialog.getByRole('button', {name: '确认开局配置', exact: true})).toBeDisabled();
  await model.check(); await dialog.getByLabel('预算币种').selectOption('USD'); await dialog.getByLabel('预算上限').fill('0');
  await page.setViewportSize({width: 1024, height: 768});
  const box = await dialog.boundingBox();
  assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1024 && box.y + box.height <= 768, 'Preparation remains inside a desktop window');
  await page.setViewportSize({width: 1440, height: 1000});
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({path: process.env.SMOKE_SCREENSHOT});
  await dialog.getByRole('button', {name: '确认开局配置', exact: true}).click();
  await dialog.getByRole('button', {name: '确认上次开局请求', exact: true}).waitFor();
  assert.equal(commands.length, 1); assert.equal(accepted.data.media, null); assert.equal(accepted.data.budget.limitMicros, '0');
  await dialog.getByRole('button', {name: '返回编辑', exact: true}).click(); await expect(dialog).toBeHidden();
  await page.getByRole('button', {name: '继续故事准备', exact: true}).waitFor();
  await page.getByRole('button', {name: '我的剧本', exact: true}).click(); await dialog.waitFor();
  assert.equal(commands.length, 1);
  // Real server restart; this intentionally keeps the same browser's in-memory unknown intent.
  // This step retains the original unknown intent; the later cold-browser check only discovers committed records.
  await restart();
  await dialog.getByRole('button', {name: '确认上次开局请求', exact: true}).click();
  await dialog.getByText('开局配置已固定', {exact: true}).waitFor();
  assert.deepEqual(commands, [commands[0], commands[0]]); assert.equal(await page.locator('video').count(), 0);
  await dialog.getByRole('button', {name: '读取准备状态', exact: true}).click();
  await expect(dialog.getByText('下面的记录仅代表最初确认，请读取当前准备状态。', {exact: true})).toBeHidden();
  const response = await page.request.get(`${origin}/api/trpc/openings.getPreparing?input=${encodeURIComponent(JSON.stringify({protocolVersion: 1, datasetId, id: accepted.data.id}))}`, {headers: {Origin: origin, 'x-everwoven-request': '1'}});
  assert.equal(response.status(), 200); assert.deepEqual((await response.json()).result.data, accepted.data);
  assert.equal(accepted.data.story.settings.opening, '窗外的雨停了，画架旁的人转过身，看向你。');
  await dialog.getByRole('button', {name: '返回编辑', exact: true}).click();
  const protocol = {protocolVersion: 1, datasetId}, headers = {Origin: origin, 'x-everwoven-request': '1'};
  async function mutate(method, data) {const response = await page.request.post(`${origin}/api/trpc/${method}`, {headers, data}); assert.equal(response.status(), 200); return (await response.json()).result.data;}
  const changed = await mutate('storyDrafts.update', {...protocol, commandId: v7(), id: accepted.data.story.storyDraftId, expectedRevision: 1, patch: {title: '原草稿后来改名'}});
  await mutate('storyDrafts.delete', {...protocol, commandId: v7(), id: changed.data.id, expectedRevision: changed.data.revision});
  await unlink(path.join(directory, 'providers.json')); await restart();
  await page.context().browser().close();
  const fresh = await chromium.launch({...process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}});
  try {
    const cold = await fresh.newPage({viewport: {width: 1440, height: 1000}}), writes = [], bindings = [], errors = [];
    cold.on('pageerror', error => errors.push(error.message));
    cold.on('request', request => {if (request.method() === 'POST' && !request.url().includes('/api/local-session')) writes.push(request.url()); if (request.url().includes('/openings.bindings')) bindings.push(request.url());});
    await cold.addInitScript(() => {Storage.prototype.getItem = Storage.prototype.setItem = () => {throw Error('Business storage disabled');}; IDBFactory.prototype.open = () => {throw Error('IndexedDB disabled');};});
    await cold.goto(origin, {waitUntil: 'networkidle'}); await cold.getByRole('status').filter({hasText: '已连接本机'}).waitFor();
    await cold.getByRole('button', {name: '我的游玩', exact: true}).click();
    const entry = cold.getByRole('button', {name: '查看准备 海边的下一句话', exact: true}); await entry.waitFor();
    if (process.env.SMOKE_LIBRARY_SCREENSHOT) await cold.screenshot({path: process.env.SMOKE_LIBRARY_SCREENSHOT});
    await entry.click(); const reopened = cold.getByRole('dialog', {name: '正式故事准备', exact: true}); await reopened.waitFor();
    await reopened.getByText('窗外的雨停了，画架旁的人转过身，看向你。', {exact: true}).waitFor();
    await reopened.getByText('0 USD', {exact: true}).waitFor(); assert.equal(await reopened.getByRole('button', {name: '确认开局配置', exact: true}).count(), 0);
    await reopened.getByRole('button', {name: '返回我的游玩', exact: true}).click(); await expect(entry).toBeFocused();
    assert.deepEqual(writes, []); assert.deepEqual(bindings, []); assert.deepEqual(errors, []);
  } finally {await fresh.close();}
  console.log('Original preparation UI smoke passed: saved story -> authenticated provider choices -> explicit zero-budget opening -> committed/lost response -> close/reentry/navigation guard -> process restart -> exact original command replay -> separate current-state read. No browser business storage, no model request or fake video.');
  console.log('Cold-browser experience reentry passed: original My Play library finds sealed preparation after source rename/deletion and provider config removal; exact world/budget, read-only reentry and focus return, zero CREATE or provider-directory requests.');
});
