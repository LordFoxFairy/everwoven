import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {v7} from 'uuid';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {STORY_MUTATION_MAX_BYTES, type DraftCreate} from 'runtime/contracts/story-draft';
import {parseDraftDTO,parseDraftPage,parseDraftCommandResult} from 'runtime/contracts/story-draft-output';
import {initializeLocalHost,issueConnectionCode} from 'runtime/host';
import {handleLocalSession} from './local-session';
import {handleTRPCRequest} from './api/http';
let parent:string,env:Record<string,string>,cookie:string,datasetId:string;
const origin='http://127.0.0.1:3198';
const headers=()=>({'content-type':'application/json',origin,'x-everwoven-request':'1',cookie});
const assetSlots={cover:null,opening:null,character:null};
const settings={world:'海边',opening:'一封来信',genre:'日常',playerRole:'旅人',worldRules:['尊重选择'],tone:'温柔'};
async function mutation(name:string,input:unknown,override?:Record<string,string>){
 const response=await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.${name}`,{method:'POST',headers:override??headers(),body:JSON.stringify(input)}),env);
 return {status:response.status,body:await response.json()};
}
async function query(name:string,input?:unknown,override?:Record<string,string>){
 const suffix=input===undefined?'':`?input=${encodeURIComponent(JSON.stringify(input))}`;
 const response=await handleTRPCRequest(new Request(`${origin}/api/trpc/storyDrafts.${name}${suffix}`,{headers:override??headers()}),env);
 return {status:response.status,body:await response.json()};
}
beforeAll(async()=>{
 parent=await realpath(await mkdtemp(join(tmpdir(),'everwoven-web-host-')));
 env={APP_ENV:'dev',APP_ORIGIN:origin,RUNTIME_DATA_DIR:join(parent,'host'),EVERWOVEN_LOCAL_LAUNCH:'loopback-v1'};
 datasetId=(await initializeLocalHost(env.RUNTIME_DATA_DIR!,'dev')).datasetId;
},30000);
beforeEach(async()=>{
 const code=await issueConnectionCode(env.RUNTIME_DATA_DIR!,'dev');
 const response=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'POST',headers:{'content-type':'application/json',origin,'x-everwoven-request':'1'},body:JSON.stringify({code})}),env);
 expect(response.status).toBe(200);cookie=response.headers.get('set-cookie')!.split(';')[0]!;
 expect(cookie).toMatch(/^everwoven_local=/);expect(response.headers.get('set-cookie')).toContain('HttpOnly');
 expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
 const body=await response.json(); expect(body).toEqual({authenticated:true,datasetId,expiresAt:expect.any(Number)});
 expect(JSON.stringify(body)).not.toContain(cookie.split('=')[1]!);
});
afterAll(async()=>{if(parent)await rm(parent,{recursive:true,force:true});});
it('executes create/get/update/delete/restore through real authenticated HTTP and a new DB connection each time',async()=>{
 const create:DraftCreate={protocolVersion:1,datasetId,commandId:v7(),title:'正式草稿',settings,mainCharacter:null,assetSlots};
 const a=await mutation('create',create);expect(a.status).toBe(200);const draft=a.body.result.data.data;
 expect(draft.title).toBe(create.title);expect(draft.settings).toEqual(settings);expect(draft).not.toHaveProperty('ownerId');
 expect(parseDraftCommandResult(a.body.result.data).data).toEqual(draft);
 expect(draft).toMatchObject({protocolVersion:1,datasetId,mainCharacter:null,assetSlots,assets:[]});
 expect((await query('get',{protocolVersion:1,datasetId,id:draft.id})).body.result.data).toEqual(draft);
 const replay=await mutation('create',create);expect(replay.body.result.data.replayed).toBe(true);expect(replay.body.result.data.data.id).toBe(draft.id);
 expect((await mutation('create',{...create,title:'换了内容'})).status).toBe(409);
 const updatedSettings={...settings,world:'打磨后的海边',opening:'第二封来信',genre:'奇幻'};
 const changed=await mutation('update',{protocolVersion:1,datasetId,commandId:v7(),id:draft.id,expectedRevision:1,patch:{title:'已打磨',settings:updatedSettings}});expect(changed.status).toBe(200);
 expect(changed.body.result.data.data.settings).toEqual(updatedSettings);
 expect((await mutation('update',{protocolVersion:1,datasetId,commandId:v7(),id:draft.id,expectedRevision:1,patch:{title:'旧窗口'}})).status).toBe(409);
 expect((await mutation('delete',{protocolVersion:1,datasetId,commandId:v7(),id:draft.id,expectedRevision:2})).status).toBe(200);
 expect((await query('get',{protocolVersion:1,datasetId,id:draft.id})).status).toBe(404);
 expect((await mutation('restore',{protocolVersion:1,datasetId,commandId:v7(),id:draft.id,expectedRevision:3})).status).toBe(200);
 expect((await query('get',{protocolVersion:1,datasetId,id:draft.id})).body.result.data).toMatchObject({revision:4,title:'已打磨',settings:updatedSettings,deletedAt:null});
 const page=parseDraftPage((await query('list',{protocolVersion:1,datasetId,q:'已打磨',genre:'奇幻'})).body.result.data);
 expect(page.totalMatching).toBe(1);expect(page.items).toHaveLength(1);
 expect(page.items[0]).toMatchObject({id:draft.id,title:'已打磨',genre:'奇幻',revision:4,mainCharacterName:null,coverAssetId:null});
 expect(page.items[0]).not.toHaveProperty('settings');expect(page.items[0]).not.toHaveProperty('mainCharacter');
});
it('rejects absent/invalid session, injected owner and cross-site mutations',async()=>{
 expect((await query('list',{protocolVersion:1,datasetId},{})).status).toBe(401);
 expect((await query('list',{protocolVersion:1,datasetId},{cookie:'everwoven_local='+'a'.repeat(43)})).status).toBe(401);
 expect((await mutation('create',{protocolVersion:1,datasetId,commandId:v7(),title:'非法',settings,mainCharacter:null,assetSlots,ownerId:v7()})).status).toBe(400);
 expect((await mutation('create',{protocolVersion:1,datasetId,commandId:v7(),title:'非法',settings,mainCharacter:null,assetSlots},{...headers(),origin:'https://evil.example'})).status).toBe(403);
 const missing={...headers()};delete (missing as Record<string,string>).origin;
 expect((await mutation('create',{protocolVersion:1,datasetId,commandId:v7(),title:'非法',settings,mainCharacter:null,assetSlots},missing)).status).toBe(403);
});
it('rejects duplicate connection-code exchange and revokes the cookie on logout',async()=>{
 const code=await issueConnectionCode(env.RUNTIME_DATA_DIR!,'dev');
 const exchange=()=>handleLocalSession(new Request(`${origin}/api/local-session`,{method:'POST',headers:headers(),body:JSON.stringify({code})}),env);
 const results=await Promise.all([exchange(),exchange()]);expect(results.map(x=>x.status).sort()).toEqual([200,401]);
 const logout=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'DELETE',headers:headers()}),env);
 expect(logout.status).toBe(200);expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
 expect((await query('list',{protocolVersion:1,datasetId})).status).toBe(401);
});
it('keeps demo and ordinary launchers closed even when a data path and cookie exist',async()=>{
 const request=()=>new Request(`${origin}/api/trpc/storyDrafts.list?input=${encodeURIComponent(JSON.stringify({protocolVersion:1,datasetId}))}`,{headers:headers()});
 expect((await handleTRPCRequest(request(),{...env,APP_ENV:'demo'})).status).toBe(401);
 expect((await handleTRPCRequest(request(),{...env,EVERWOVEN_LOCAL_LAUNCH:''})).status).toBe(401);
});
it('bounds mutation bodies and does not leak a raw connection code or local path on errors',async()=>{
 const tooBig=await mutation('create',{protocolVersion:1,datasetId,commandId:v7(),title:'x'.repeat(262145),settings,mainCharacter:null,assetSlots});expect(tooBig.status).toBe(400);
 expect(tooBig.body.error.message).toBe('INVALID_STORY_COMMAND');
 const bodyTooBig=await mutation('create',{protocolVersion:1,datasetId,commandId:v7(),title:'x'.repeat(STORY_MUTATION_MAX_BYTES),settings,mainCharacter:null,assetSlots});
 expect(bodyTooBig.status).toBe(413);expect(bodyTooBig.body.error.message).toBe('STORY_REQUEST_TOO_LARGE');
 const code='x'.repeat(43);
 const response=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'POST',headers:headers(),body:JSON.stringify({code})}),env);
 expect(response.status).toBe(401);const text=await response.text();expect(text).not.toContain(code);expect(text).not.toContain(parent);
});

it('returns validation errors and permits explicit deleted-record reads without leaking internal errors',async()=>{
 const legacy={premise:'旧前提',playerRole:'',worldRules:[],tone:''};
 expect((await mutation('create',{protocolVersion:1,datasetId,commandId:v7(),title:'旧格式',settings:legacy,mainCharacter:null,assetSlots})).status).toBe(400);
 expect((await query('get',{protocolVersion:1,datasetId,id:'not-an-id'})).status).toBe(400);
 expect((await query('list',{protocolVersion:1,datasetId,limit:101})).status).toBe(400);
 const created=await mutation('create',{protocolVersion:1,datasetId,commandId:v7(),title:'回收测试',settings,mainCharacter:null,assetSlots});
 const id=created.body.result.data.data.id;
 await mutation('delete',{protocolVersion:1,datasetId,commandId:v7(),id,expectedRevision:1});
 expect((await query('get',{protocolVersion:1,datasetId,id})).status).toBe(404);
 expect((await query('get',{protocolVersion:1,datasetId,id,includeDeleted:true})).body.result.data.deletedAt).not.toBeNull();
});

it('projects authenticated session dataset and unauthenticated false without owner or credentials',async()=>{
 const get=()=>handleLocalSession(new Request(`${origin}/api/local-session`,{headers:headers()}),env);
 expect(await (await get()).json()).toEqual({authenticated:true,datasetId});
 const logout=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'DELETE',headers:headers()}),env);
 expect(await logout.json()).toEqual({authenticated:false});
 expect(await (await get()).json()).toEqual({authenticated:false});
});
it('maps a foreign dataset command to explicit 412 and rejects missing dataset commands',async()=>{
 const input={protocolVersion:1,commandId:v7(),title:'不应写入',settings,mainCharacter:null,assetSlots};
 const missing=await mutation('create',input);expect(missing.status).toBe(400);expect(missing.body.error.message).toBe('INVALID_STORY_COMMAND');
 const response=await mutation('create',{...input,datasetId:v7()});
 expect(response.status).toBe(412);
 expect(response.body.error).toMatchObject({message:'DATASET_CHANGED',data:{code:'PRECONDITION_FAILED'}});
 expect((await query('list',{protocolVersion:1,datasetId})).body.result.data.items.some((item:{title:string})=>item.title===input.title)).toBe(false);
});

it('rejects raw old requests with CLIENT_RELOAD_REQUIRED for all six operations',async()=>{
 const oldCreate={datasetId,commandId:v7(),title:'原始旧请求',settings};
 const oldLifecycle={datasetId,commandId:v7(),id:v7(),expectedRevision:1};
 const responses=[
  await mutation('create',oldCreate),await mutation('update',{...oldLifecycle,patch:{title:'旧修改'}}),
  await mutation('delete',oldLifecycle),await mutation('restore',oldLifecycle),
  await query('get',{id:v7()}),await query('list'),
 ];
 for(const response of responses){expect(response.status).toBe(412);expect(response.body.error).toMatchObject({message:'CLIENT_RELOAD_REQUIRED',data:{code:'PRECONDITION_FAILED'}});}
 const page=parseDraftPage((await query('list',{protocolVersion:1,datasetId,q:oldCreate.title})).body.result.data);
 expect(page.totalMatching).toBe(0);
});

it('distinguishes protocol, dataset and query validation in real authenticated reads',async()=>{
 for(const name of ['get','list']){
  const fields=name==='get'?{id:v7()}:{};
  const missing=await query(name,{protocolVersion:1,...fields});
  expect(missing.status).toBe(400);expect(missing.body.error.message).toBe('INVALID_STORY_QUERY');
  const foreign=await query(name,{protocolVersion:1,datasetId:v7(),...fields});
  expect(foreign.status).toBe(412);expect(foreign.body.error.message).toBe('DATASET_CHANGED');
  const future=await query(name,{protocolVersion:2,datasetId,...fields});
  expect(future.status).toBe(412);expect(future.body.error.message).toBe('CLIENT_RELOAD_REQUIRED');
 }
});

it('roundtrips a complete inline aggregate, preserves fixed versions and survives a fresh Node process',async()=>{
 const create:DraftCreate={protocolVersion:1,datasetId,commandId:v7(),title:'固定角色聚合',settings:{...settings,worldRules:['第一段\n第二段']},assetSlots,mainCharacter:{
  kind:'inline',name:'林舟',settings:{personality:'沉静',appearance:'蓝衬衫',speakingStyle:'慢慢表达',boundaries:'尊重选择'},portraitAssetId:null,
  overrides:{portrait:{mode:'none'},relationship:'初次见面',name:'',settings:{speakingStyle:'简洁'}},
 }};
 const created=await mutation('create',create);expect(created.status).toBe(200);
 const original=parseDraftCommandResult(created.body.result.data).data;
 expect(original.mainCharacter?.version).toMatchObject({name:'林舟',versionNo:1,sourceRevision:1,portraitAssetId:null,schemaVersion:1});
 expect(original.mainCharacter?.effective).toEqual({name:'',settings:{personality:'沉静',appearance:'蓝衬衫',speakingStyle:'简洁',boundaries:'尊重选择'},relationship:'初次见面',portraitAssetId:null});
 expect(original.assetSlots).toEqual(assetSlots);expect(original.assets).toEqual([]);
 expect(parseDraftDTO((await query('get',{protocolVersion:1,datasetId,id:original.id})).body.result.data)).toEqual(original);
 // Start an independent Node 22 process: it authenticates the persisted cookie and
 // opens the actual SQLite file, with no shared JS state or service stub.
 const script=`import {withLocalStories} from 'runtime/host';let input='';for await(const chunk of process.stdin)input+=chunk;const {directory,token,request}=JSON.parse(input);const value=await withLocalStories(directory,'dev',token,(service,owner)=>service.get(owner,request));process.stdout.write(JSON.stringify(value));`;
 const stdout=await new Promise<string>((resolve,reject)=>{
  const child=execFile(process.execPath,['--input-type=module','-e',script],{cwd:fileURLToPath(new URL('..',import.meta.url)),timeout:15000},(error,stdout)=>error?reject(error):resolve(stdout));
  child.stdin!.end(JSON.stringify({directory:env.RUNTIME_DATA_DIR,token:cookie.slice(cookie.indexOf('=')+1),request:{protocolVersion:1,datasetId,id:original.id}}));
 });
 expect(parseDraftDTO(JSON.parse(stdout))).toEqual(original);
 const update=await mutation('update',{protocolVersion:1,datasetId,commandId:v7(),id:original.id,expectedRevision:1,patch:{title:'仅改聚合标题'}});
 expect(update.status).toBe(200);const confirmed=parseDraftCommandResult(update.body.result.data).data;
 expect(confirmed.mainCharacter).toEqual(original.mainCharacter);expect(confirmed.settings.worldRules).toEqual(['第一段\n第二段']);
 expect(confirmed.revision).toBe(2);
 const replay=await mutation('create',create);expect(replay.status).toBe(200);
 expect(parseDraftCommandResult(replay.body.result.data)).toEqual({data:original,replayed:true});
 const deleted=await mutation('delete',{protocolVersion:1,datasetId,commandId:v7(),id:original.id,expectedRevision:2});expect(deleted.status).toBe(200);
 const restored=await mutation('restore',{protocolVersion:1,datasetId,commandId:v7(),id:original.id,expectedRevision:3});expect(restored.status).toBe(200);
 expect(parseDraftCommandResult(restored.body.result.data).data).toMatchObject({revision:4,mainCharacter:original.mainCharacter,assetSlots,assets:[],deletedAt:null});
},30000);

it('sanitizes a real SQLite failure and remains usable after repairing only the disposable fixture',async()=>{
 const database=join(env.RUNTIME_DATA_DIR!,'runtime.db');
 const backup=await readFile(database);
 try{
  await writeFile(database,'not SQLite: private fixture diagnostics');
  const response=await query('list',{protocolVersion:1,datasetId});
  expect(response.status).toBe(500);expect(response.body.error.message).toBe('STORY_INTERNAL_ERROR');
  expect(JSON.stringify(response.body)).not.toMatch(/SQLite|Prisma|diagnostics|stack|cause|runtime\.db/);
  expect(JSON.stringify(response.body)).not.toContain(parent);expect(JSON.stringify(response.body)).not.toContain(cookie.split('=')[1]!);
 }finally{await writeFile(database,backup);}
 expect((await query('list',{protocolVersion:1,datasetId})).status).toBe(200);
});
