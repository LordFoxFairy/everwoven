import {createHash} from 'node:crypto';
import {handleLocalSession} from '../local-session.ts';
import {handleAssetBytes} from '../local-assets-http.ts';
try {
  const env = JSON.parse(process.env.ASSET_FIXTURE_ENV!);
  const cookie = process.env.ASSET_FIXTURE_COOKIE!, assetId = process.env.ASSET_FIXTURE_ID!, datasetId = process.env.ASSET_FIXTURE_DATASET!;
  const session = await handleLocalSession(new Request(`${env.APP_ORIGIN}/api/local-session`, {headers: {cookie}}), env);
  const response = await handleAssetBytes(new Request(`${env.APP_ORIGIN}/api/local-assets/${assetId}?datasetId=${datasetId}`, {headers: {cookie}}), assetId, env);
  const bytes = Buffer.from(await response.arrayBuffer());
  process.stdout.write(JSON.stringify({pid: process.pid, session: await session.json(), status: response.status, hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mime: response.headers.get('content-type')}));
} catch {process.stderr.write('ASSET_FIXTURE_RESTART_FAILED'); process.exitCode = 1;}
