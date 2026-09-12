// Credential input is stdin only; neither argv nor output contains credentials/image bytes.
const host = await import(process.env.HOST_ASSETS_COMPILED === '1' ? '../../../dist/host/index.js' : '../../../src/host/index.ts');
const {createHash} = await import('node:crypto');
let input = ''; for await (const chunk of process.stdin) input += chunk;
try {
  const {directory, token, datasetId, assetId} = JSON.parse(input);
  const result = await host.withLocalAssets(directory, 'dev', token, service => service.getBytes({datasetId, assetId}));
  process.stdout.write(JSON.stringify({ok: true, sha256: createHash('sha256').update(result.bytes).digest('hex'), byteSize: result.bytes.length, mimeType: result.data.mimeType}));
} catch {process.stdout.write(JSON.stringify({ok: false})); process.exitCode = 1;}
