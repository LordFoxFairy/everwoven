import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

// Map a non-localhost HTTP origin to the local test server. No browser security bypass.
const port = Number(process.env.SMOKE_PORT ?? 3100);
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid SMOKE_PORT');
const browser = await chromium.launch({...process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}, args: ['--host-resolver-rules=MAP everwoven.test 127.0.0.1', '--no-proxy-server']});
try {
  const page = await browser.newPage();
  const errors = [];
  const formalWrites = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/trpc/characters.')) formalWrites.push(request.url());
  });
  const response = await page.goto(`http://everwoven.test:${port}`, {waitUntil: 'networkidle'});
  assert.equal(response?.status(), 200);
  const context = await page.evaluate(() => ({secure: isSecureContext, uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues}));
  assert.deepEqual(context, {secure: false, uuid: 'undefined', random: 'function'});
  await page.getByRole('heading', {name: /让想象发生/}).waitFor();
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await page.getByRole('button', {name: '新建剧本', exact: true}).click();
  await page.getByRole('button', {name: '保存草稿', exact: true}).waitFor();
  await page.getByRole('button', {name: '我的剧本', exact: true}).click();
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await page.getByRole('button', {name: '创建角色', exact: true}).click();
  await page.getByRole('textbox', {name: '角色姓名', exact: true}).fill('HTTP 兼容验收');
  await page.getByRole('textbox', {name: '性格与背景', exact: true}).fill('此角色只存在于自动化测试的临时浏览器中。');
  await page.getByRole('button', {name: '保存角色模板', exact: true}).click();
  await page.getByRole('status').filter({hasText: '角色模板已保存到当前浏览器；后续修改仍需保存。'}).waitFor();
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await page.getByRole('heading', {name: 'HTTP 兼容验收', exact: true}).waitFor();
  await page.getByRole('button', {name: '编辑 HTTP 兼容验收', exact: true}).click();
  assert.equal(await page.getByRole('textbox', {name: '性格与背景', exact: true}).inputValue(), '此角色只存在于自动化测试的临时浏览器中。');
  assert.deepEqual(formalWrites, [], 'Demo must not write formal characters');
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  console.log('HTTP browser smoke passed: insecure origin, home, story editor, character creation and persistence.');
} finally {
  await browser.close();
}
