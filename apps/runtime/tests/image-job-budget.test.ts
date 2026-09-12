import {afterEach, expect, it, vi} from 'vitest';
afterEach(()=>vi.useRealTimers());
const deferred=()=>{let resolve!:(value:string)=>void;const promise=new Promise<string>(yes=>{resolve=yes;});return {promise,resolve};};
async function budget(){const m=await import('../src/infrastructure/media/image-job-budget.js').catch(()=>null);expect(m,'bounded decoder admission must exist').not.toBeNull();return new m!.ImageJobBudget();}
it('timeout rejects the caller but does not release either still-running native slot or admit a queue',async()=>{
 vi.useFakeTimers();const gate=await budget(),one=deferred(),two=deferred(),work=vi.fn(()=>Promise.resolve('new'));
 const first=gate.run(()=>one.promise,10).catch(error=>error),second=gate.run(()=>two.promise,10).catch(error=>error);await vi.advanceTimersByTimeAsync(10);
 expect(await first).toMatchObject({code:'IMAGE_PROCESSING_TIMEOUT',message:'IMAGE_PROCESSING_TIMEOUT'});expect(await second).toMatchObject({code:'IMAGE_PROCESSING_TIMEOUT'});
 await expect(gate.run(work,10)).rejects.toMatchObject({code:'IMAGE_DECODER_BUSY'});expect(work).not.toHaveBeenCalled();one.resolve('late');await Promise.resolve();await Promise.resolve();expect(await gate.run(work,10)).toBe('new');two.resolve('late');await Promise.resolve();
});
it('synchronous native failure releases capacity and never leaks the original decoder error',async()=>{
 const gate=await budget();await expect(gate.run(()=>{throw Error('/private/path decoder detail');},100)).rejects.toMatchObject({code:'INVALID_IMAGE_DATA',message:'INVALID_IMAGE_DATA'});expect(await gate.run(async()=>1,100)).toBe(1);
});
