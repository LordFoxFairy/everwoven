import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

// Map a non-localhost HTTP origin to the local test server. No browser security bypass.
const port = Number(process.env.SMOKE_PORT ?? 3100);
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid SMOKE_PORT');
const browser = await chromium.launch({args: ['--host-resolver-rules=MAP everwoven.test 127.0.0.1', '--no-proxy-server']});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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
  await page.getByPlaceholder('TA 叫什么？').fill('HTTP 兼容验收');
  await page.getByPlaceholder('TA 是怎样的人，有什么经历与愿望？').fill('此角色只存在于自动化测试的临时浏览器中。');
  await page.getByRole('button', {name: '保存角色模板', exact: true}).click();
  await page.getByText('已保存到本机。已有剧本中的角色保持原样。', {exact: true}).waitFor();
  await page.reload({waitUntil: 'networkidle'});
  await page.getByRole('button', {name: '角色库', exact: true}).click();
  await page.getByRole('heading', {name: 'HTTP 兼容验收', exact: true}).waitFor();
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  console.log('HTTP browser smoke passed: insecure origin, home, story editor, character creation and persistence.');
} finally {
  await browser.close();
}
