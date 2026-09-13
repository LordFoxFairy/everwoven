import {createServer} from 'node:http';
import {connect} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {expect, test} from 'vitest';
import {createLocalShutdown} from './local-shutdown.mjs';

async function fixture(work, closeApp = async () => {}, handler = (_request, response) => response.end('ok')) {
  const server = createServer((request, response) => {
    void shutdown.track(() => handler(request, response)).catch(() => response.destroy());
  });
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (_request, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n'));
  const exits = [];
  const shutdown = createLocalShutdown(server, closeApp, {exit: code => exits.push(code), graceMs: 30, timeoutMs: 150});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = connect(server.address().port, '127.0.0.1');
  socket.on('error', () => {});
  await once(socket, 'connect');
  try { await work({socket, shutdown, exits}); }
  finally { socket.destroy(); for (const peer of sockets) peer.destroy(); server.close(); }
}

test.each(['partial request', 'upgraded stream'])('shutdown drains a stuck %s and is idempotent', async kind => {
  let closes = 0;
  await fixture(async ({socket, shutdown, exits}) => {
    if (kind === 'upgraded stream') {
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n');
      await once(socket, 'data');
    } else socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
    const first = shutdown();
    const second = shutdown();
    expect(await Promise.race([first, delay(350, 'hung')])).toBe(0);
    expect(await second).toBe(0);
    expect(closes).toBe(1);
    expect(exits).toEqual([0]);
  }, async () => { closes++; });
});

test('hung application cleanup is bounded and exits unsuccessfully', async () => {
  await fixture(async ({socket, shutdown, exits}) => {
    socket.end();
    expect(await Promise.race([shutdown(), delay(350, 'hung')])).toBe(1);
    expect(exits).toEqual([1]);
  }, () => new Promise(() => {}));
});

test.each([true, false])('in-flight business work must settle before successful shutdown (settles=%s)', async settles => {
  let entered, complete;
  const started = new Promise(resolve => { entered = resolve; });
  const work = new Promise(resolve => { complete = resolve; });
  let completed = false, cleanups = 0;
  await fixture(async ({socket, shutdown, exits}) => {
    socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await started;
    const stopped = shutdown();
    await delay(65); // After socket drain, before the hard deadline.
    expect(exits).toEqual([]);
    expect(cleanups).toBe(0);
    if (settles) complete();
    expect(await stopped).toBe(settles ? 0 : 1);
    expect(completed).toBe(settles);
    expect(exits).toEqual([settles ? 0 : 1]);
    complete();
  }, async () => { cleanups++; }, async (_request, response) => {
    entered(); await work; completed = true; response.end('saved');
  });
});
