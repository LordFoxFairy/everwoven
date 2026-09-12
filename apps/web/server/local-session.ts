import {
  boundedJSONRequest,
  guardLocalRequest,
  localRuntimeConfig,
  sessionCookie,
  sessionToken,
} from './local-boundary';
const json = (body: unknown, status = 200, extra?: HeadersInit) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
export async function handleLocalSession(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const config = localRuntimeConfig(env);
  if (!config) return json({ error: '本机数据库尚未启用' }, 404);
  try {
    guardLocalRequest(request, config);
  } catch {
    return json({ error: '来源不受信任' }, 403);
  }
  const cookie = (token: string, seconds: number) =>
    `${sessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${config.origin.startsWith('https:') ? '; Secure' : ''}`;
  try {
    const host = await import('runtime/host');
    if (request.method === 'GET') {
      try {
        await host.authenticateSession(config.directory, config.environment, sessionToken(request));
        return json({ authenticated: true });
      } catch {
        return json({ authenticated: false });
      }
    }
    if (request.method === 'DELETE') {
      await host.revokeSession(config.directory, config.environment, sessionToken(request));
      return json({ authenticated: false }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    if (request.method !== 'POST')
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST, DELETE' });
    let body: unknown;
    try {
      body = await (await boundedJSONRequest(request, 1024)).json();
    } catch {
      return json({ error: '连接请求格式无效' }, 400);
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('code' in body) ||
      typeof body.code !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.code)
    )
      return json({ error: '连接码格式无效' }, 400);
    let issued: { token: string; expiresAt: number };
    try {
      issued = await host.exchangeConnectionCode(config.directory, config.environment, body.code);
    } catch {
      return json({ error: '连接码无效、已使用或已过期，请在本机重新获取' }, 401);
    }
    return json({ authenticated: true, expiresAt: issued.expiresAt }, 200, {
      'Set-Cookie': cookie(issued.token, Math.max(0, Math.floor((issued.expiresAt - Date.now()) / 1000))),
    });
  } catch {
    return json({ error: '本机数据暂不可用，请检查宿主状态' }, 503);
  }
}
