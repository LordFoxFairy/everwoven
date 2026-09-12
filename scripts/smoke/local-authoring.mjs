import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, chmod, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '@playwright/test';

// Isolated host and browser. Never use the developer's running app/data directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.SMOKE_PORT ?? 3198);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
const origin = `http://127.0.0.1:${port}`;
// Refuse to attach to or terminate another service.
try {await fetch(origin, {signal: AbortSignal.timeout(1000)}); throw Error('Smoke port is occupied');}
catch (error) {if (error.message === 'Smoke port is occupied') throw error;}
const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'everwoven-browser-')));
await chmod(parent, 0o700);
const directory = path.join(parent, 'host');
const env = {...process.env, APP_ENV: 'dev', RUNTIME_DATA_DIR: directory, APP_ORIGIN: origin, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1'};
let server, browser, page, output = '';
function cli(command) {
  return execFileSync('pnpm', ['--filter', 'runtime', 'exec', 'tsx', 'src/host/cli.ts', command,
    '--directory', directory, '--environment', 'dev'], {cwd: root, env, encoding: 'utf8', timeout: 90000}).trim();
}
async function start() {
  output = '';
  server = spawn(process.execPath, ['apps/web/scripts/local-start.mjs', '--production'], {cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']});
  server.stdout.on('data', data => {output += data.toString();});
  server.stderr.on('data', data => {output += data.toString();});
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error(`Local launcher exited: ${output}`);
    try {if ((await fetch(origin, {signal: AbortSignal.timeout(1000)})).ok) return;} catch {}
    await delay(500);
  }
  throw Error(`Local launcher timed out: ${output}`);
}
async function stop() {
  const child = server;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const killed = setTimeout(() => child.kill('SIGKILL'), 10000);
  await exited; clearTimeout(killed); server = undefined;
}
try {
  cli('init');
  // Raw code stays in memory; never print, save, or put it in a URL.
  const code = cli('connect');
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  await start();
  if (process.platform === 'darwin') {
    const listening = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {encoding: 'utf8'});
    assert(listening.includes(`127.0.0.1:${port}`) && !listening.includes(`*:${port}`), 'Listener must be loopback-only');
  }
  browser = await chromium.launch({...process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}});
  page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin, {waitUntil: 'networkidle'});
  async function openLibrary() {
    await page.getByRole('button', {name: '我的剧本', exact: true}).click();
    await page.getByRole('button', {name: '本机数据库', exact: true}).click();
  }
  await openLibrary();
  await page.getByLabel('一次性连接码', {exact: true}).fill(code);
  await page.getByRole('button', {name: '连接', exact: true}).click();
  await page.getByRole('button', {name: '新建数据库草稿'}).click();
  const title = '浏览器闭环验收';
  await page.getByLabel('标题', {exact: true}).fill(title);
  await page.getByLabel('世界背景', {exact: true}).fill('海边小镇，潮汐记录每一次选择。');
  await page.getByLabel('开局情境', {exact: true}).fill('从一封尚未寄出的信开始，用户决定下一幕。');
  await page.getByLabel('故事题材', {exact: true}).fill('日常');
  await page.getByLabel('玩家身份', {exact: true}).fill('刚回到海边小镇的旅人');
  await page.getByLabel('世界规则（每行一条）', {exact: true}).fill('选择会留下分支\n角色记住已发生的事');
  await page.getByLabel('语气', {exact: true}).fill('明亮、克制');
  await page.getByRole('button', {name: '创建草稿', exact: true}).click();
  await page.getByText('已保存 · 修订 1', {exact: true}).waitFor();
  await page.getByLabel('世界背景', {exact: true}).fill('第二版：这个世界等待玩家回应。');
  await page.getByLabel('开局情境', {exact: true}).fill('第二版：旅人收到一封信。');
  await page.getByLabel('故事题材', {exact: true}).fill('奇幻');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await page.getByText('已保存 · 修订 2', {exact: true}).waitFor();
  await page.getByRole('button', {name: '删除草稿', exact: true}).click();
  await page.getByText('已删除 · 修订 3', {exact: true}).waitFor();
  await page.getByRole('button', {name: '恢复草稿', exact: true}).click();
  await page.getByText('已保存 · 修订 4', {exact: true}).waitFor();
  // Submit to the actual server, then lose only the response. A retry must
  // reconcile the original receipt rather than create another root or lose edits.
  async function loseNextResponse(operation) {
    await page.route(`**/api/trpc/storyDrafts.${operation}*`, async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    }, {times: 1});
  }
  await page.getByRole('button', {name: '新建数据库草稿', exact: true}).click();
  await page.getByLabel('标题', {exact: true}).fill('未知结果 A');
  await loseNextResponse('create');
  await page.getByRole('button', {name: '创建草稿', exact: true}).click();
  await page.getByRole('button', {name: '确认上次保存', exact: true}).waitFor();
  await page.getByLabel('标题', {exact: true}).fill('未知结果 B');
  await page.getByRole('button', {name: '确认上次保存', exact: true}).click();
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await page.getByText('已保存 · 修订 2', {exact: true}).waitFor();
  await page.getByLabel('标题', {exact: true}).fill('未知结果 C');
  await loseNextResponse('update');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await page.getByRole('button', {name: '确认上次保存', exact: true}).waitFor();
  await page.getByLabel('标题', {exact: true}).fill('未知结果 B');
  await page.getByRole('button', {name: '确认上次保存', exact: true}).click();
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await page.getByText('已保存 · 修订 4', {exact: true}).waitFor();
  await page.getByRole('button', {name: '刷新列表', exact: true}).click();
  await page.getByRole('button', {name: '编辑 未知结果 B', exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: /^编辑 未知结果/}).count(), 1, 'Lost response must not create a duplicate');
  await page.reload({waitUntil: 'networkidle'});
  await openLibrary();
  await page.getByRole('button', {name: `编辑 ${title}`, exact: true}).click();
  async function assertSettings() {
    const expected = [
      ['世界背景', '第二版：这个世界等待玩家回应。'],
      ['开局情境', '第二版：旅人收到一封信。'],
      ['故事题材', '奇幻'],
      ['玩家身份', '刚回到海边小镇的旅人'],
      ['世界规则（每行一条）', '选择会留下分支\n角色记住已发生的事'],
      ['语气', '明亮、克制'],
    ];
    for (const [label, value] of expected) assert.equal(await page.getByLabel(label, {exact: true}).inputValue(), value);
  }
  await assertSettings();
  await stop(); await start();
  await page.reload({waitUntil: 'networkidle'});
  await openLibrary();
  await page.getByRole('button', {name: `编辑 ${title}`, exact: true}).click();
  await page.getByText('已保存 · 修订 4', {exact: true}).waitFor();
  await assertSettings();
  const cookies = await page.context().cookies();
  assert(cookies.some(cookie => cookie.name === 'everwoven_local' && cookie.httpOnly && cookie.sameSite === 'Strict'));
  await page.getByRole('button', {name: '退出连接', exact: true}).click();
  await page.getByLabel('一次性连接码', {exact: true}).waitFor();
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  console.log('Local authoring smoke passed: loopback launcher, one-use login, SQLite CRUD/delete/restore, refresh, process restart, lost-response reconciliation, logout; no model calls.');
} catch (error) {
  if (page) console.error((await page.locator('body').innerText()).slice(-12000));
  throw error;
} finally {
  await browser?.close(); await stop(); await rm(parent, {recursive: true, force: true});
}
