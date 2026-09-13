import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {expect} from '@playwright/test';
import {withLocalBrowser,fillConnectionCode} from './local-browser-harness.mjs';

// Actual original-page interaction, not an API-seeded portrait demonstration.
process.env.SMOKE_PORT ??= '3195';
const requireRuntime = createRequire(new URL('../../apps/runtime/package.json', import.meta.url));
const sharp = requireRuntime('sharp');
const picture = async (name, color) => ({name, mimeType: 'image/png',
  buffer: await sharp({create: {width: 512, height: 320, channels: 3, background: color}}).png().toBuffer()});
const first = await picture('sky-first.png', '#a9c9ed');
const second = await picture('sky-second.png', '#c8b4e7');
const third = await picture('sky-story-copy.png', '#e9c2de');

await withLocalBrowser(async ({page, origin, datasetId, connectionCode, restart}) => {
  page.setDefaultTimeout(15000);
  const mutations = [], boundaryErrors = [], commands = new Map();
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const url = new URL(request.url()), names = url.pathname.split('/api/trpc/')[1]?.split(',') ?? [];
    if (!names.some(name => name.startsWith('assets.'))) return;
    try {
      const body = request.postDataJSON();
      names.forEach((name, index) => {
        if (!name.startsWith('assets.')) return;
        const input = url.searchParams.get('batch') === '1' ? body[String(index)] : body;
        assert.equal(input.datasetId, datasetId);
        const payload = JSON.stringify(input);
        if (commands.has(input.commandId)) assert.equal(commands.get(input.commandId), payload, 'Image confirmation must preserve the original command');
        commands.set(input.commandId, payload);
        mutations.push({name, input});
      });
    } catch (error) {boundaryErrors.push(error.message);}
  });
  // Prove formal image reads/writes never need the demo database or browser drafts.
  await page.addInitScript(() => {
    Storage.prototype.getItem = function () {throw Error('test storage unavailable');};
    Storage.prototype.setItem = function () {throw Error('test storage unavailable');};
    IDBFactory.prototype.open = function () {throw Error('test IndexedDB unavailable');};
  });
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await fillConnectionCode(page.getByLabel('本机连接码', {exact: true}), connectionCode);
  await page.getByRole('button', {name: '连接本机', exact: true}).click();
  await page.getByRole('status').filter({hasText: '已连接本机'}).waitFor();
  await page.getByRole('button', {name: '创建角色', exact: true}).click();
  const name = '原图片控件持久化验收';
  await page.getByLabel('角色姓名').fill(name);
  const editor = page.getByRole('form', {name: '角色编辑', exact: true});

  async function result(response) {
    assert.equal(response.status(), 200);
    const body = await response.json();
    return (Array.isArray(body) ? body[0] : body).result.data;
  }
  async function mutation(button, operation) {
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`/api/trpc/${operation}`));
    const [, response] = await Promise.all([button.click(), pending]);
    return result(response);
  }
  async function upload(file, loseStage, scope = editor) {
    const before = mutations.length;
    await scope.getByLabel('选择角色参考', {exact: true}).setInputFiles(file);
    const rights = scope.getByRole('checkbox', {name: '我确认有权使用这张图片', exact: true});
    assert.equal(await rights.evaluate(input => getComputedStyle(input.closest('label')).flexDirection), 'row', 'Rights checkbox and label stay on one readable row');
    assert.equal(await rights.isChecked(), false, 'Every image needs a fresh affirmative declaration');
    assert.equal(await scope.getByRole('button', {name: '上传图片', exact: true}).isDisabled(), true);
    assert.equal(mutations.length, before, 'Choosing a file alone must not send an upload intent');
    await rights.check();
    let lostAssetId;
    if (loseStage) await page.route(`**/api/trpc/assets.${loseStage}*`, async route => {
      const response = await route.fetch(), saved = await result(response);
      lostAssetId = loseStage === 'beginUpload' ? saved.data.assetId : saved.data.id;
      if (loseStage === 'completeUpload') {
        // An intermediary's arbitrary 400 is not proof that the committed write failed.
        const envelope = {error: {message: 'Upstream response unavailable', code: -32600, data: {code: 'BAD_REQUEST', httpStatus: 400}}};
        await route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).searchParams.get('batch') === '1' ? [envelope] : envelope)});
      } else await route.abort('failed'); // Server committed; only the browser response is lost.
    }, {times: 1});
    let completed;
    if (loseStage) {
      await scope.getByRole('button', {name: '上传图片', exact: true}).click();
      const confirm = scope.getByRole('button', {name: '确认上次图片命令', exact: true});
      await confirm.waitFor();
      assert.equal(await scope.getByRole('button', {name: '保存角色模板', exact: true}).isDisabled(), true);
      assert.equal(await scope.getByLabel('选择角色参考', {exact: true}).isDisabled(), true);
      if (loseStage === 'beginUpload') {
        // This confirmation is rejected before receipt lookup; it says nothing about
        // the earlier committed begin whose response was lost.
        await page.route('**/api/trpc/assets.beginUpload*', route => {
          const envelope = {error: {message: 'INVALID_ASSET_COMMAND', code: -32600, data: {code: 'BAD_REQUEST', httpStatus: 400}}};
          return route.fulfill({status: 400, contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).searchParams.get('batch') === '1' ? [envelope] : envelope)});
        }, {times: 1});
        const rejected = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/trpc/assets.beginUpload'));
        const [, response] = await Promise.all([confirm.click(), rejected]);
        assert.equal(response.status(), 400);
      }
      completed = await mutation(confirm, 'assets.completeUpload');
      assert.equal(completed.data.id, lostAssetId);
      if (loseStage === 'completeUpload') assert.equal(completed.replayed, true);
    } else completed = await mutation(scope.getByRole('button', {name: '上传图片', exact: true}), 'assets.completeUpload');
    assert.equal(completed.data.status, 'ready');
    await scope.getByText('图片已保存到本机，保存角色后生效', {exact: true}).waitFor();
    assert.equal(await scope.getByRole('button', {name: '上传图片', exact: true}).isDisabled(), true, 'A completed selection is not uploaded again until a new file is selected');
    assert.equal(await scope.getByLabel('选择角色参考', {exact: true}).isDisabled(), false);
    return completed.data;
  }
  async function verifiedPreview() {
    await editor.locator('img').first().waitFor();
    assert.equal(await editor.locator('img').first().evaluate(async image => {await image.decode(); return image.naturalWidth > 0 && image.naturalHeight > 0;}), true);
  }
  const one = await upload(first, 'beginUpload');
  const created = await mutation(editor.getByRole('button', {name: '保存角色模板', exact: true}), 'characters.create');
  assert.equal(created.data.portraitAssetId, one.id);
  await verifiedPreview();
  await restart();
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await page.getByRole('button', {name: `编辑 ${name}`, exact: true}).click();
  await verifiedPreview();
  const two = await upload(second, 'completeUpload');
  assert.notEqual(two.id, one.id); assert.notEqual(two.sha256, one.sha256);
  const changed = await mutation(editor.getByRole('button', {name: '保存角色模板', exact: true}), 'characters.update');
  assert.equal(changed.data.portraitAssetId, two.id);
  const deleted = await mutation(editor.getByRole('button', {name: '删除角色', exact: true}), 'characters.delete');
  assert.equal(deleted.data.portraitAssetId, two.id); assert(deleted.data.deletedAt);
  const restored = await mutation(editor.getByRole('button', {name: '恢复角色', exact: true}), 'characters.restore');
  assert.equal(restored.data.portraitAssetId, two.id); assert.equal(restored.data.deletedAt, null);
  await verifiedPreview();
  // Existing template provenance must not overwrite the current image selected in Studio.
  await page.getByRole('button', {name: `用 ${name} 创作`, exact: true}).click();
  await page.getByRole('button', {name: /角色配置/}).click();
  const studio = page.getByRole('main');
  await studio.getByRole('textbox', {name: '角色姓名', exact: false}).fill(`${name}的剧本副本`);
  const three = await upload(third, undefined, studio);
  const copied = await mutation(studio.getByRole('button', {name: '另存为角色模板', exact: true}), 'characters.create');
  assert.notEqual(copied.data.id, created.data.id);
  assert.equal(copied.data.portraitAssetId, three.id);
  assert.notEqual(three.id, two.id);
  const originalResponse = await page.request.get(`${origin}/api/trpc/characters.get?input=${encodeURIComponent(JSON.stringify({id: created.data.id}))}`);
  assert.equal((await result(originalResponse)).portraitAssetId, two.id, 'Saving a Studio copy must not mutate its source template');
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await expect(page.getByRole('button', {name: '我的剧本', exact: true})).toHaveAttribute('aria-current', 'page');
  // Hold an actual server response, not a mocked list. A background story list
  // read must not silently consume the user's request to return to characters.
  let releaseList;
  const listReleased = new Promise(resolve => {releaseList = resolve;});
  await page.route('**/api/trpc/storyDrafts.list*', async route => {
    const response = await route.fetch();
    await listReleased;
    await route.fulfill({response});
  }, {times: 1});
  try {
    await page.getByRole('button', {name: '刷新剧本', exact: true}).click();
    await expect(page.getByRole('status').filter({hasText: '正在读取剧本列表'})).toBeVisible();
    await page.getByRole('button', {name: '角色库', exact: true}).click();
    await expect(page.getByRole('button', {name: '角色库', exact: true})).toHaveAttribute('aria-current', 'page');
  } finally {releaseList();}
  await page.getByRole('button', {name: `编辑 ${name}`, exact: true}).click();
  await editor.getByRole('button', {name: '清除选择', exact: true}).click();
  const cleared = await mutation(editor.getByRole('button', {name: '保存角色模板', exact: true}), 'characters.update');
  assert.equal(cleared.data.portraitAssetId, null);
  for (const asset of [one, two, three]) {
    const response = await page.request.get(`${origin}/api/local-assets/${asset.id}?datasetId=${datasetId}`);
    assert.equal(response.status(), 200, 'Unlinking or soft deleting a role must not delete a shared asset');
  }
  assert.deepEqual(boundaryErrors, []);
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({path: process.env.SMOKE_SCREENSHOT, fullPage: true});
  console.log('Original image UI smoke passed: file selection, explicit rights, lost begin/complete response reconciliation, saved portrait, disabled browser persistence, restart/readback, replacement, soft delete/restore, Studio copy with changed portrait, and unlink without asset deletion. No model calls.');
});
