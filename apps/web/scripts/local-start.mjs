import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {createRequire} from 'node:module';
import next from 'next';
import {createLocalShutdown} from './local-shutdown.mjs';

// The only supported formal local-host launcher. Never listen on all interfaces.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--production') || args.length > 1)
  throw Error('Usage: pnpm local [--production]');
const production = args.includes('--production');
const port = Number(process.env.PORT ?? 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error('PORT must be between 1024 and 65535');
if (!process.env.RUNTIME_DATA_DIR || !path.isAbsolute(process.env.RUNTIME_DATA_DIR))
  throw Error('RUNTIME_DATA_DIR must be an explicit absolute local directory');
const origin = `http://127.0.0.1:${port}`;
if (process.env.APP_ORIGIN && process.env.APP_ORIGIN !== origin)
  throw Error('APP_ORIGIN must match the local listener');
process.env.APP_ENV ??= production ? 'prod' : 'dev';
if (!['dev', 'prod'].includes(process.env.APP_ENV))
  throw Error('Local database mode requires APP_ENV=dev or prod');
process.env.NODE_ENV = production ? 'production' : 'development';
process.env.APP_ORIGIN = origin;
process.env.EVERWOVEN_LOCAL_LAUNCH = 'loopback-v1';
// Use the exact compiled external consumed by Next routes. Configuration failure
// stays provider-local. Generation credentials load only during explicit launcher initialization; accepted jobs start after listen.
const host = createRequire(import.meta.url)('runtime/host');
await host.initializeLocalVideoProviders(process.env.RUNTIME_DATA_DIR, process.env.APP_ENV);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = next({ dev: !production, webpack: true, dir, hostname: '127.0.0.1', port });
try {
  await app.prepare();
  await host.initializeLocalGeneration(process.env.RUNTIME_DATA_DIR, process.env.APP_ENV);
} catch (error) {await host.stopLocalGeneration();await app.close();throw error;}
const handle = app.getRequestHandler();
const server = http.createServer((request, response) => {
  // Automatic local access must not make the private workspace embeddable in
  // an unrelated website. These apply to the document, not just JSON responses.
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  void shutdown.track(() => handle(request, response)).catch(() => {
    response.statusCode = 500;
    response.end('服务暂不可用');
  });
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE' ? '本机端口已被占用，请停止旧服务或选择其他端口。' : '本机服务启动失败。',
  );
  process.exitCode = 1;
  void host.stopLocalGeneration().then(() => app.close());
});
const shutdown = createLocalShutdown(server, async () => {await host.stopLocalGeneration();await app.close();}, {
  onStopping: () => host.stopLocalGeneration(), timeoutMs: 25000,
});
server.listen(port, '127.0.0.1', () => {host.startLocalGeneration();console.log(`Everwoven local ready: ${origin}`);});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => { void shutdown(); });
