import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';

// Test compiled ESM in a real Node process: the parent runner must not mask unhandled rejections.
// Run `pnpm --filter runtime build` before this regression suite.
it.each([
 ['wrapped rejected Promise', "Promise.reject(Error('FIXTURE_ASYNC_HOOK_FAILURE'))"],
 ['rejecting thenable', "({then(_resolve,reject){globalThis.fixtureThenConsumed=true;reject(Error('FIXTURE_ASYNC_HOOK_FAILURE'));}})"],
 ['throwing thenable accessor', "({get then(){globalThis.fixtureThenConsumed=true;throw Error('FIXTURE_ASYNC_HOOK_FAILURE');}})"],
] as const)('compiled cleanup hook consumes %s rejection while still rejecting synchronously',(_name,expression)=>{
 const moduleURL=new URL('../dist/infrastructure/media/private-asset-deletion.js',import.meta.url).href;
 const script=`import {runCleanupCheckpoint} from ${JSON.stringify(moduleURL)};
 let caught=false;
 try {runCleanupCheckpoint(()=>${expression},'before-unlink','00000000-0000-7000-8000-000000000001');}
 catch(error){if(error.code!=='PRIVATE_ASSET_INVALID_ARGUMENT'||error.message!=='PRIVATE_ASSET_INVALID_ARGUMENT'||error.cause!==undefined)throw error;caught=true;}
 if(!caught)throw Error('EXPECTED_SYNCHRONOUS_REJECTION');
 setImmediate(()=>{if(${_name!=='wrapped rejected Promise'}&&globalThis.fixtureThenConsumed!==true)throw Error('THENABLE_NOT_CONSUMED');process.stdout.write('caught-synchronously;process-survived');});
 `;
 const result=spawnSync(process.execPath,['--unhandled-rejections=strict','--input-type=module','-e',script],{encoding:'utf8',env:{},timeout:4000});
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);expect(result.signal).toBeNull();expect(result.stdout).toBe('caught-synchronously;process-survived');expect(result.stderr).toBe('');
});
