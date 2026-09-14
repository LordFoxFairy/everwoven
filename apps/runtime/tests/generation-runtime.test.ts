import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeLocalHost} from '../src/host/storage.js';
import {createLocalGenerationRuntime,isSQLiteBusy} from '../src/host/generation-runtime.js';
import {assertGenerationDimensions} from '../src/host/generation-installation.js';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
it('only recognized SQLite contention can retry queue reads',()=>{
 expect(isSQLiteBusy({meta:{driverAdapterError:{cause:{originalCode:'5'}}}})).toBe(true);
 expect(isSQLiteBusy({code:'SQLITE_BUSY'})).toBe(true);expect(isSQLiteBusy(Error('provider timeout'))).toBe(false);expect(isSQLiteBusy({code:'P2028'})).toBe(false);
});
it.each([[8192,4608,'16:9'],[768,1366,'16:9'],[64,64,'bogus']])('rejects impossible configured dimensions before model calls', (w,h,r)=>expect(()=>assertGenerationDimensions(Number(w),Number(h),String(r))).toThrow('GENERATION_CONFIGURATION_UNAVAILABLE'));
it('accepts documented rounded pixels for configured aspect ratio',()=>{expect(()=>assertGenerationDimensions(1366,768,'16:9')).not.toThrow();});
it('missing installation stays unavailable, with no model calls',async()=>{
 const parent=await mkdtemp(join(await realpath(tmpdir()),'runtime-no-generation-'));dirs.push(parent);const dir=join(parent,'host'),manifest=await initializeLocalHost(dir,'dev');
 const runtime=createLocalGenerationRuntime();const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 try{await runtime.initialize(dir,'dev',{});runtime.start();const access=runtime.access(dir,'dev',manifest);expect(access.status().status).toBe('unavailable');expect(()=>access.policy.assertDispatch({} as never)).toThrow('GENERATION_RUNTIME_UNAVAILABLE');expect(network).not.toHaveBeenCalled();await Promise.all([runtime.stop(),runtime.stop()]);}
 finally{network.mockRestore();await runtime.stop();}
});
it('retries queue contention, cancels lifetime, and shares one drain/disconnect on concurrent stops',async()=>{
 const parent=await mkdtemp(join(await realpath(tmpdir()),'runtime-lifecycle-'));dirs.push(parent);const dir=join(parent,'host');await initializeLocalHost(dir,'dev');
 const tick=vi.fn().mockRejectedValueOnce({code:'SQLITE_BUSY'}).mockResolvedValue(false),drain=vi.fn(async()=>{});let signal:AbortSignal|undefined;
 const runtime=createLocalGenerationRuntime(vi.fn(async()=>({policy:{} as never,executor:{} as never})),(...args)=>{signal=args[5];return{tick,drain};});
 await runtime.initialize(dir,'dev',{});runtime.start();await vi.waitFor(()=>expect(tick).toHaveBeenCalledTimes(2),{timeout:3000});
 await Promise.all([runtime.stop(),runtime.stop()]);expect(signal?.aborted).toBe(true);expect(drain).toHaveBeenCalledOnce();
});
