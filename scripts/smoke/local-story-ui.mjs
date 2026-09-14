import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium, expect} from '@playwright/test';
import {withLocalBrowser} from './local-browser-harness.mjs';

// Original Studio only. This gate deliberately rejects the temporary root panel.
process.env.SMOKE_PORT ??= '3198';
const requireRuntime = createRequire(new URL('../../apps/runtime/package.json', import.meta.url));
const sharp = requireRuntime('sharp');
const picture = async (name, color) => ({name, mimeType: 'image/png',
  buffer: await sharp({create: {width: 512, height: 320, channels: 3, background: color}}).png().toBuffer()});
const reference = await picture('story-source.png', '#a6c5ef');
const portrait = await picture('story-person.png', '#c5b1eb');
const cover = await picture('story-cover.png', '#eaceb7');
const opening = await picture('story-opening.png', '#b3ded4');
await withLocalBrowser(async ({page, origin, datasetId, restart}) => {
  page.setDefaultTimeout(15000);
  const commands = new Map(), boundaryErrors = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const url = new URL(request.url()), names = url.pathname.split('/api/trpc/')[1]?.split(',') ?? [];
    if (!names.some(name => name.startsWith('storyDrafts.'))) return;
    try {
      const body = request.postDataJSON();
      names.forEach((name, index) => {
        if (!name.startsWith('storyDrafts.')) return;
        const input = url.searchParams.get('batch') === '1' ? body[String(index)] : body;
        assert.equal(input.protocolVersion, 1);
        assert.equal(input.datasetId, datasetId);
        const payload = JSON.stringify(input);
        if (commands.has(input.commandId)) assert.equal(commands.get(input.commandId), payload);
        commands.set(input.commandId, payload);
      });
    } catch (error) {boundaryErrors.push(error.message);}
  });
  await page.addInitScript(() => {
    Storage.prototype.getItem = function () {throw Error('test storage unavailable');};
    Storage.prototype.setItem = function () {throw Error('test storage unavailable');};
    IDBFactory.prototype.open = function () {throw Error('test IndexedDB unavailable');};
  });
  async function mutation(button, operation) {
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes(`/api/trpc/${operation}`));
    const [, response] = await Promise.all([button.click(), pending]);
    assert.equal(response.status(), 200);
    const body = await response.json();
    return (Array.isArray(body) ? body[0] : body).result.data;
  }
  async function upload(title, file) {
    const scope = page.locator('section').filter({has: page.getByRole('heading', {name: title, exact: true})});
    await scope.getByLabel(`选择${title}`, {exact: true}).setInputFiles(file);
    const rights = scope.getByRole('checkbox', {name: '我确认有权使用这张图片', exact: true});
    assert.equal(await rights.isChecked(), false);
    await rights.check();
    const saved = await mutation(scope.getByRole('button', {name: '上传图片', exact: true}), 'assets.completeUpload');
    await scope.locator('img').evaluate(async image => {await image.decode(); if (!image.naturalWidth) throw Error('Image did not decode');});
    return saved.data.id;
  }
  async function query(operation, input) {
    const response = await page.request.get(`${origin}/api/trpc/${operation}?input=${encodeURIComponent(JSON.stringify(input))}`, {headers: {'x-everwoven-request': '1'}});
    assert.equal(response.status(), 200);
    return (await response.json()).result.data;
  }
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await page.getByRole('status').filter({hasText: '已连接本机'}).waitFor();
  assert.equal(await page.getByLabel('本机连接码').count(), 0);
  await page.getByRole('button', {name: '创建角色', exact: true}).click();
  const characterName = '原Studio聚合验收角色';
  await page.getByLabel('角色姓名').fill(characterName);
  await page.getByRole('textbox', {name: '性格与背景', exact: true}).fill('原角色的固定背景。');
  const referenceId = await upload('角色参考', reference);
  const source = await mutation(page.getByRole('button', {name: '保存角色模板', exact: true}), 'characters.create');
  assert.equal(source.data.portraitAssetId, referenceId);
  await page.getByRole('button', {name: `用 ${characterName} 创作`, exact: true}).click();
  let title = '原Studio完整聚合验收';
  await page.getByLabel('剧本名称').fill(title);
  await page.getByLabel('故事题材').selectOption('奇幻');
  await page.getByRole('button', {name: /世界与开局/}).click();
  await page.getByLabel('世界背景').fill('天空很近的小镇；选择由玩家决定。');
  await page.getByLabel('开局情境').fill('角色递来一封未寄出的信，等待回应。');
  const save = page.getByRole('button', {name: '保存草稿', exact: true});
  assert.equal(await save.isDisabled(), false, 'Original Studio must save the formal aggregate, not only a temporary root form');
  await page.getByLabel('玩家身份', {exact: true}).fill('刚回到小镇的旅人');
  await page.getByLabel('世界规则（每行一条）', {exact: true}).fill('玩家自行决定回应\n角色记住真实发生的事件');
  await page.getByLabel('叙事语气', {exact: true}).fill('晴朗，克制，有留白');
  await page.getByRole('button', {name: /角色配置/}).click();
  const relationship = '多年未见的朋友';
  await page.getByLabel('你们的初始关系').fill(relationship);
  await page.getByRole('textbox', {name: '性格与背景', exact: true}).fill('只属于这个故事的角色设定。');
  const portraitId = await upload('角色参考', portrait);
  await page.getByRole('button', {name: /画面与素材/}).click();
  const coverId = await upload('剧本封面', cover);
  const openingId = await upload('开场画面', opening);
  let committed;
  await page.route('**/api/trpc/storyDrafts.create*', async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    committed = (await response.json()).result.data;
    await route.abort('failed');
  }, {times: 1});
  await save.click();
  const confirm = page.getByRole('button', {name: '确认上次剧本命令', exact: true});
  await confirm.waitFor();
  await page.getByRole('button', {name: /基础信息/}).click();
  title += '·后续文字';
  await page.getByLabel('剧本名称').fill(title);
  await page.route('**/api/trpc/storyDrafts.create*', route => route.fulfill({
    status: 400, contentType: 'application/json',
    body: JSON.stringify({error: {message: 'INVALID_STORY_COMMAND', code: -32600, data: {code: 'BAD_REQUEST', httpStatus: 400}}}),
  }), {times: 1});
  const rejected = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/trpc/storyDrafts.create'));
  const [, rejectedResponse] = await Promise.all([confirm.click(), rejected]);
  assert.equal(rejectedResponse.status(), 400);
  const confirmed = await mutation(confirm, 'storyDrafts.create');
  assert.equal(confirmed.replayed, true);
  assert.deepEqual(confirmed.data, committed.data);
  assert.equal(await page.getByLabel('剧本名称').inputValue(), title, 'Confirmation must not erase the later working text');
  const created = await mutation(save, 'storyDrafts.update');
  assert.equal(created.data.id, committed.data.id);
  assert.equal(created.data.revision, 2);
  assert.equal(created.data.title, title);
  assert.equal(created.data.protocolVersion, 1);
  assert.equal(created.data.datasetId, datasetId);
  assert.deepEqual(created.data.settings, {
    world: '天空很近的小镇；选择由玩家决定。', opening: '角色递来一封未寄出的信，等待回应。',
    genre: '奇幻', playerRole: '刚回到小镇的旅人',
    worldRules: ['玩家自行决定回应', '角色记住真实发生的事件'], tone: '晴朗，克制，有留白',
  });
  assert.equal(created.data.mainCharacter.version.characterTemplateId, source.data.id);
  assert.equal(created.data.mainCharacter.version.sourceRevision, source.data.revision);
  assert.equal(created.data.mainCharacter.version.settings.personality, '原角色的固定背景。');
  assert.equal(created.data.mainCharacter.version.portraitAssetId, referenceId);
  assert.equal(created.data.mainCharacter.effective.settings.personality, '只属于这个故事的角色设定。');
  assert.equal(created.data.mainCharacter.effective.relationship, relationship);
  assert.equal(created.data.mainCharacter.effective.portraitAssetId, portraitId);
  assert.deepEqual(created.data.assetSlots, {cover: coverId, opening: openingId, character: portraitId});
  assert.deepEqual(created.data.assets.map(view => view.data.id).sort(), [referenceId, portraitId, coverId, openingId].sort());
  await restart();
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await page.getByRole('button', {name: `打开剧本 ${title}`, exact: true}).click();
  await page.getByRole('button', {name: /世界与开局/}).click();
  for (const [label, value] of [
    ['世界背景', created.data.settings.world], ['开局情境', created.data.settings.opening],
    ['玩家身份', created.data.settings.playerRole], ['世界规则（每行一条）', created.data.settings.worldRules.join('\n')], ['叙事语气', created.data.settings.tone],
  ]) assert.equal(await page.getByLabel(label).inputValue(), value);
  await page.getByRole('button', {name: /角色配置/}).click();
  assert.equal(await page.getByLabel('你们的初始关系').inputValue(), relationship);
  assert.equal(await page.getByRole('textbox', {name: '性格与背景', exact: true}).inputValue(), created.data.mainCharacter.effective.settings.personality);
  const detail = await query('storyDrafts.get', {protocolVersion: 1, datasetId, id: created.data.id});
  assert.deepEqual(detail, created.data, 'Restart reads the complete database aggregate, never browser defaults');
  assert.deepEqual((await query('characters.get', {id: source.data.id})), source.data, 'Editing the story must not update its source template');
  // Updating the library source after the story was saved must not drift its fixed version.
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await page.getByRole('button', {name: `编辑 ${characterName}`, exact: true}).click();
  await page.getByRole('textbox', {name: '性格与背景', exact: true}).fill('角色库的新修订，不追溯修改已保存故事。');
  const changedSource = await mutation(page.getByRole('button', {name: '保存角色模板', exact: true}), 'characters.update');
  assert.equal(changedSource.data.revision, 2);
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await page.getByRole('button', {name: `打开剧本 ${title}`, exact: true}).click();
  const afterSourceChange = await query('storyDrafts.get', {protocolVersion: 1, datasetId, id: created.data.id});
  assert.deepEqual(afterSourceChange.mainCharacter, created.data.mainCharacter);
  await page.getByRole('button', {name: /世界与开局/}).click();
  await page.getByLabel('世界背景').fill('第二版世界：未来仍由玩家决定。');
  await page.route('**/api/trpc/storyDrafts.update*', async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('failed');
  }, {times: 1});
  await save.click();
  await confirm.waitFor();
  await page.getByLabel('世界背景').fill('第三版世界：未知结果确认后仍保留这段新文字。');
  const confirmedUpdate = await mutation(confirm, 'storyDrafts.update');
  assert.equal(confirmedUpdate.replayed, true);
  assert.equal(confirmedUpdate.data.revision, 3);
  assert.equal(confirmedUpdate.data.settings.world, '第二版世界：未来仍由玩家决定。');
  assert.equal(await page.getByLabel('世界背景').inputValue(), '第三版世界：未知结果确认后仍保留这段新文字。');
  const updated = await mutation(save, 'storyDrafts.update');
  assert.equal(updated.data.revision, 4);
  assert.deepEqual(updated.data.mainCharacter.version, created.data.mainCharacter.version);
  assert.deepEqual(updated.data.assetSlots, created.data.assetSlots);
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  const removed = await mutation(page.getByRole('button', {name: `删除剧本 ${title}`, exact: true}), 'storyDrafts.delete');
  assert.equal(removed.data.revision, 5);
  assert(removed.data.deletedAt);
  await page.getByRole('button', {name: '回收列表', exact: true}).click();
  const restored = await mutation(page.getByRole('button', {name: `恢复剧本 ${title}`, exact: true}), 'storyDrafts.restore');
  assert.equal(restored.data.revision, 6);
  assert.equal(restored.data.deletedAt, null);
  assert.deepEqual(restored.data.mainCharacter, updated.data.mainCharacter);
  assert.deepEqual(restored.data.assetSlots, updated.data.assetSlots);
  const pageOfStories = await query('storyDrafts.list', {protocolVersion: 1, datasetId, q: '原Studio完整聚合验收'});
  assert.equal(pageOfStories.totalMatching, 1, 'Unknown create must not produce another story');
  assert.equal(pageOfStories.items[0].id, created.data.id);
  const foreign = await page.request.get(`${origin}/api/trpc/storyDrafts.get?input=${encodeURIComponent(JSON.stringify({protocolVersion: 1, datasetId: '018e0000-0000-7000-8000-000000000099', id: created.data.id}))}`, {headers: {'x-everwoven-request': '1'}});
  assert.equal(foreign.status(), 412);
  assert.equal((await foreign.json()).error.message, 'DATASET_CHANGED');
  const intact = await query('storyDrafts.get', {protocolVersion: 1, datasetId, id: created.data.id});
  assert.deepEqual(intact, restored.data);
  for (const id of [referenceId, portraitId, coverId, openingId]) {
    const response = await page.request.get(`${origin}/api/local-assets/${id}?datasetId=${datasetId}`);
    assert.equal(response.status(), 200, 'Story lifecycle must preserve each underlying image');
  }
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await page.getByRole('button', {name: '创作中的故事', exact: true}).click();
  await page.getByRole('button', {name: `打开剧本 ${title}`, exact: true}).click();
  const prepare = page.getByRole('button', {name: '保存并进入准备', exact: true});
  await prepare.click();
  const dialog = page.getByRole('dialog', {name: '正式故事准备', exact: true});
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /查看费用并确认生成/);
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Focus stays in the preparation dialog');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({state: 'hidden'});
  await expect(prepare, 'Closing preparation restores focus to its trigger').toBeFocused();
  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({path: process.env.SMOKE_SCREENSHOT, fullPage: true});
  assert.deepEqual(boundaryErrors, []);
  assert.equal(commands.size, 7);
  // A process restart in the same tab is not a browser restart. Close the
  // first Chromium process, open a separate clean one and connect automatically without a code.
  const persisted = await query('storyDrafts.get', {protocolVersion: 1, datasetId, id: created.data.id});
  assert.equal(persisted.revision, 7);
  await page.context().browser().close();
  const freshBrowser = await chromium.launch({...process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}});
  try {
    const fresh = await freshBrowser.newPage({viewport: {width: 1440, height: 1000}});
    const freshErrors = [], freshWrites = [];
    fresh.on('pageerror', error => freshErrors.push(error.message));
    fresh.on('request', request => {if (request.method() === 'POST' && !request.url().includes('/api/local-session')) freshWrites.push(new URL(request.url()).pathname);});
    await fresh.addInitScript(() => {
      Storage.prototype.getItem = function () {throw Error('test storage unavailable');};
      Storage.prototype.setItem = function () {throw Error('test storage unavailable');};
      IDBFactory.prototype.open = function () {throw Error('test IndexedDB unavailable');};
    });
    await fresh.goto(origin, {waitUntil: 'networkidle'});
    await expect(fresh.getByRole('status').filter({hasText: '已连接本机'})).toBeVisible();
    await expect(fresh.getByLabel('本机连接码')).toHaveCount(0);
    await fresh.getByRole('button', {name: '我的剧本', exact: true}).click();
    await fresh.getByRole('button', {name: `打开剧本 ${title}`, exact: true}).click();
    await expect(fresh.getByLabel('剧本名称')).toHaveValue(persisted.title);
    const reopened = await fresh.request.get(`${origin}/api/trpc/storyDrafts.get?input=${encodeURIComponent(JSON.stringify({protocolVersion: 1, datasetId, id: persisted.id}))}`, {headers: {'x-everwoven-request': '1'}});
    assert.equal(reopened.status(), 200);
    assert.deepEqual((await reopened.json()).result.data, persisted, 'A fresh browser receives the same entire stored aggregate');
    await fresh.getByRole('button', {name: /世界与开局/}).click();
    await expect(fresh.getByLabel('世界背景')).toHaveValue(persisted.settings.world);
    await expect(fresh.getByLabel('开局情境')).toHaveValue(persisted.settings.opening);
    await expect(fresh.getByRole('textbox', {name: '玩家身份', exact: true})).toHaveValue(persisted.settings.playerRole);
    await expect(fresh.getByRole('textbox', {name: '叙事语气', exact: true})).toHaveValue(persisted.settings.tone);
    await expect(fresh.getByRole('textbox', {name: '世界规则（每行一条）', exact: true})).toHaveValue(persisted.settings.worldRules.join('\n'));
    await fresh.getByRole('button', {name: /角色配置/}).click();
    await expect(fresh.getByLabel('你们的初始关系')).toHaveValue(relationship);
    await expect(fresh.getByRole('textbox', {name: '性格与背景', exact: true})).toHaveValue(persisted.mainCharacter.effective.settings.personality);
    for (const [label, key] of [['外貌与穿着', 'appearance'], ['表达习惯', 'speakingStyle'], ['相处边界', 'boundaries']]) {
      await expect(fresh.getByRole('textbox', {name: label, exact: true})).toHaveValue(persisted.mainCharacter.effective.settings[key]);
    }
    await fresh.getByRole('button', {name: /画面与素材/}).click();
    for (const slot of ['剧本封面', '开场画面']) {
      const picker = fresh.locator('section').filter({has: fresh.getByRole('heading', {name: slot, exact: true})});
      await expect(picker.locator('img')).toBeVisible();
      await picker.locator('img').evaluate(async image => {await image.decode(); if (!image.naturalWidth) throw Error('Reopened image did not decode');});
    }
    assert.deepEqual(freshErrors, []);
    assert.deepEqual(freshWrites, [], 'Reopening must not create or rewrite the persisted aggregate');
  } finally {await freshBrowser.close();}
  console.log('Original Studio smoke passed: complete settings, fixed character, four actual images, unknown command and pre-receipt 400 reconciliation, preserved edits, server restart and separate cold browser reconnection/readback, source independence, update/delete/restore and dataset isolation. No model calls.');
});
