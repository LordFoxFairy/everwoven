import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {v7} from 'uuid';
import {initializeLocalHost,issueConnectionCode} from 'runtime/host';
import {handleLocalSession} from './local-session';
import {handleTRPCRequest} from './api/http';
let parent:string,env:Record<string,string>,cookie:string,datasetId:string;
const origin='http://127.0.0.1:3198';
const headers=()=>({'content-type':'application/json',origin,'x-everwoven-request':'1',cookie});
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
 const create={datasetId,commandId:v7(),title:'正式草稿',settings};
 const a=await mutation('create',create);expect(a.status).toBe(200);const draft=a.body.result.data.data;
 expect(draft.title).toBe(create.title);expect(draft.settings).toEqual(settings);expect(draft).not.toHaveProperty('ownerId');
 expect((await query('get',{id:draft.id})).body.result.data).toEqual(draft);
 const replay=await mutation('create',create);expect(replay.body.result.data.replayed).toBe(true);expect(replay.body.result.data.data.id).toBe(draft.id);
 expect((await mutation('create',{...create,title:'换了内容'})).status).toBe(409);
 const updatedSettings={...settings,world:'打磨后的海边',opening:'第二封来信',genre:'奇幻'};
 const changed=await mutation('update',{datasetId,commandId:v7(),id:draft.id,expectedRevision:1,patch:{title:'已打磨',settings:updatedSettings}});expect(changed.status).toBe(200);
 expect(changed.body.result.data.data.settings).toEqual(updatedSettings);
 expect((await mutation('update',{datasetId,commandId:v7(),id:draft.id,expectedRevision:1,patch:{title:'旧窗口'}})).status).toBe(409);
 expect((await mutation('delete',{datasetId,commandId:v7(),id:draft.id,expectedRevision:2})).status).toBe(200);
 expect((await query('get',{id:draft.id})).status).toBe(404);
 expect((await mutation('restore',{datasetId,commandId:v7(),id:draft.id,expectedRevision:3})).status).toBe(200);
 expect((await query('get',{id:draft.id})).body.result.data).toMatchObject({revision:4,title:'已打磨',settings:updatedSettings,deletedAt:null});
 expect((await query('list')).body.result.data.items.some((x:{id:string})=>x.id===draft.id)).toBe(true);
});
it('rejects absent/invalid session, injected owner and cross-site mutations',async()=>{
 expect((await query('list',undefined,{})).status).toBe(401);
 expect((await query('list',undefined,{cookie:'everwoven_local='+'a'.repeat(43)})).status).toBe(401);
 expect((await mutation('create',{datasetId,commandId:v7(),title:'非法',settings,ownerId:v7()})).status).toBe(400);
 expect((await mutation('create',{datasetId,commandId:v7(),title:'非法',settings},{...headers(),origin:'https://evil.example'})).status).toBe(403);
 const missing={...headers()};delete (missing as Record<string,string>).origin;
 expect((await mutation('create',{datasetId,commandId:v7(),title:'非法',settings},missing)).status).toBe(403);
});
it('rejects duplicate connection-code exchange and revokes the cookie on logout',async()=>{
 const code=await issueConnectionCode(env.RUNTIME_DATA_DIR!,'dev');
 const exchange=()=>handleLocalSession(new Request(`${origin}/api/local-session`,{method:'POST',headers:headers(),body:JSON.stringify({code})}),env);
 const results=await Promise.all([exchange(),exchange()]);expect(results.map(x=>x.status).sort()).toEqual([200,401]);
 const logout=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'DELETE',headers:headers()}),env);
 expect(logout.status).toBe(200);expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
 expect((await query('list')).status).toBe(401);
});
it('keeps demo and ordinary launchers closed even when a data path and cookie exist',async()=>{
 const request=()=>new Request(`${origin}/api/trpc/storyDrafts.list`,{headers:headers()});
 expect((await handleTRPCRequest(request(),{...env,APP_ENV:'demo'})).status).toBe(401);
 expect((await handleTRPCRequest(request(),{...env,EVERWOVEN_LOCAL_LAUNCH:''})).status).toBe(401);
});
it('bounds mutation bodies and does not leak a raw connection code or local path on errors',async()=>{
 const tooBig=await mutation('create',{datasetId,commandId:v7(),title:'x'.repeat(262145),settings});expect(tooBig.status).toBe(400);
 const code='x'.repeat(43);
 const response=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'POST',headers:headers(),body:JSON.stringify({code})}),env);
 expect(response.status).toBe(401);const text=await response.text();expect(text).not.toContain(code);expect(text).not.toContain(parent);
});

it('returns validation errors and permits explicit deleted-record reads without leaking internal errors',async()=>{
 const legacy={premise:'旧前提',playerRole:'',worldRules:[],tone:''};
 expect((await mutation('create',{datasetId,commandId:v7(),title:'旧格式',settings:legacy})).status).toBe(400);
 expect((await query('get',{id:'not-an-id'})).status).toBe(400);
 expect((await query('list',{limit:101})).status).toBe(400);
 const created=await mutation('create',{datasetId,commandId:v7(),title:'回收测试',settings});
 const id=created.body.result.data.data.id;
 await mutation('delete',{datasetId,commandId:v7(),id,expectedRevision:1});
 expect((await query('get',{id})).status).toBe(404);
 expect((await query('get',{id,includeDeleted:true})).body.result.data.deletedAt).not.toBeNull();
});

it('projects authenticated session dataset and unauthenticated false without owner or credentials',async()=>{
 const get=()=>handleLocalSession(new Request(`${origin}/api/local-session`,{headers:headers()}),env);
 expect(await (await get()).json()).toEqual({authenticated:true,datasetId});
 const logout=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'DELETE',headers:headers()}),env);
 expect(await logout.json()).toEqual({authenticated:false});
 expect(await (await get()).json()).toEqual({authenticated:false});
});
it('maps a foreign dataset command to explicit 412 and rejects missing dataset commands',async()=>{
 const input={commandId:v7(),title:'不应写入',settings};
 expect((await mutation('create',input)).status).toBe(400);
 const response=await mutation('create',{...input,datasetId:v7()});
 expect(response.status).toBe(412);
 expect(response.body.error).toMatchObject({message:'DATASET_CHANGED',data:{code:'PRECONDITION_FAILED'}});
 expect((await query('list')).body.result.data.items.some((item:{title:string})=>item.title===input.title)).toBe(false);
});
