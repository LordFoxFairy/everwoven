import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createAuthoringSessionClient} from './session-client';
const datasetId='01994b80-0000-7000-8000-000000000099';
afterEach(()=>vi.unstubAllGlobals());
it('uses the public compiled validator with native Node ESM .js dependency resolution',()=>{
 const source=readFileSync(new URL('./session-client.ts',import.meta.url),'utf8');
 expect(source).toMatch(/import\s*\{\s*parseId\s*\}\s*from\s*['"]runtime\/contracts\/story-draft-validation['"]/);
 expect(source).not.toMatch(/runtime\/src\//);
 expect(createRequire(import.meta.url).resolve('runtime/contracts/story-draft-validation')).toMatch(/\/dist\/contracts\/story-draft-validation\.js$/);
 // Native Node, without Vitest transforms or aliases, must follow the published .js graph.
 const result=spawnSync(process.execPath,['--input-type=module','--eval',`import {parseId} from 'runtime/contracts/story-draft-validation'; if(parseId('${datasetId}')!=='${datasetId}')throw Error('INVALID_RESULT');`],{cwd:fileURLToPath(new URL('../..',import.meta.url)),encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);
});
it('accepts a UUIDv7 dataset through the published validator',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({authenticated:true,datasetId})});vi.stubGlobal('fetch',fetch);
 await expect(createAuthoringSessionClient().session()).resolves.toEqual({authenticated:true,datasetId});
 expect(fetch).toHaveBeenCalledWith('/api/local-session',expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store'}));
});
it.each([undefined,null,42,'not-an-id','550e8400-e29b-41d4-a716-446655440000'])('sanitizes an invalid authenticated dataset %s',async value=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({authenticated:true,datasetId:value})}));
 await expect(createAuthoringSessionClient().session()).rejects.toThrow('本机连接失败，请重试');
});
it('keeps the disconnected response independent of dataset validation',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({authenticated:false})}));
 await expect(createAuthoringSessionClient().session()).resolves.toEqual({authenticated:false});
});
it('establishes a local session without a code and returns only the verified dataset',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({authenticated:true,datasetId})});vi.stubGlobal('fetch',fetch);
 await expect(createAuthoringSessionClient().connect()).resolves.toEqual({authenticated:true,datasetId});
 expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/local-session',{
  method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
  headers:{'content-type':'application/json','x-everwoven-request':'1'},body:JSON.stringify({mode:'local'}),
 });
});
it.each([{authenticated:false},{authenticated:true},{authenticated:true,datasetId:'invalid'}])('rejects invalid local establishment response %j without retry',async data=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>data});vi.stubGlobal('fetch',fetch);
 await expect(createAuthoringSessionClient().connect()).rejects.toThrow('本机连接失败，请重试');expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps GET read-only and DELETE bodyless, preserves request headers, and hides transport errors',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({authenticated:false})});vi.stubGlobal('fetch',fetch);
 const client=createAuthoringSessionClient();await client.session();await client.logout();
 for(const [index,method] of ['GET','DELETE'].entries())expect(fetch.mock.calls[index]?.[1]).toEqual({method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-everwoven-request':'1'}});
 fetch.mockRejectedValue(Error('TOKEN /private/path'));await expect(client.connect()).rejects.toThrow(/^本机连接失败，请重试$/);expect(fetch).toHaveBeenCalledTimes(3);
});
