import {isAbsolute} from 'node:path';
import {initializeLocalStoreEpoch} from './store-epoch.js';
import {runAssetMaintenanceCLI} from './asset-maintenance-cli.js';
import {initializeLocalHost, issueConnectionCode, type LocalEnvironment} from './index.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'maintain-assets') {await runAssetMaintenanceCLI(args, process.stdin); return;}
  if ((command !== 'init' && command !== 'connect' && command !== 'init-epoch') || args.length !== 4) throw new Error();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1]!;
    if ((key !== '--directory' && key !== '--environment') || values.has(key)) throw new Error();
    values.set(key, value);
  }
  const directory = values.get('--directory'), environment = values.get('--environment');
  if (!directory || !isAbsolute(directory) || (environment !== 'dev' && environment !== 'prod')) throw new Error();
  if (command === 'init-epoch') {
    await initializeLocalStoreEpoch(directory, environment);
    process.stdout.write('Local generation authority initialized.\n');
  } else if (command === 'init') {
    await initializeLocalHost(directory, environment as LocalEnvironment);
    process.stdout.write('Local host initialized.\n');
  } else {
    // Sole intentional raw-code output. Never log code in errors, argv, URLs or files.
    const code = await issueConnectionCode(directory, environment as LocalEnvironment);
    process.stdout.write(`${code}\n`);
  }
}
main().catch(() => {process.stderr.write('LOCAL_HOST_COMMAND_FAILED\n'); process.exitCode = 1;});
