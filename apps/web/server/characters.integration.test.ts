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
const settings={personality:'',appearance:'银色头发',speakingStyle:'轻声',boundaries:'尊重玩家'};
async function request(name:string,input:unknown,write=false,override?:Record<string,string>){
 const suffix=write||input===undefined?'':`?input=${encodeURIComponent(JSON.stringify(input))}`;
 const response=await handleTRPCRequest(new Request(`${origin}/api/trpc/characters.${name}${suffix}`,{method:write?'POST':'GET',headers:override??headers(),...(write?{body:JSON.stringify(input)}:{})}),env);
 return {status:response.status,body:await response.json()};
}
beforeAll(async()=>{
 parent=await realpath(await mkdtemp(join(tmpdir(),'everwoven-character-http-')));
 env={APP_ENV:'dev',APP_ORIGIN:origin,RUNTIME_DATA_DIR:join(parent,'host'),EVERWOVEN_LOCAL_LAUNCH:'loopback-v1'};
 datasetId=(await initializeLocalHost(env.RUNTIME_DATA_DIR!,'dev')).datasetId;
},30000);
beforeEach(async()=>{
 const code=await issueConnectionCode(env.RUNTIME_DATA_DIR!,'dev');
 const response=await handleLocalSession(new Request(`${origin}/api/local-session`,{method:'POST',headers:{origin,'content-type':'application/json','x-everwoven-request':'1'},body:JSON.stringify({code})}),env);
 expect(response.status).toBe(200);cookie=response.headers.get('set-cookie')!.split(';')[0]!;
});
afterAll(async()=>{if(parent)await rm(parent,{recursive:true,force:true});});
it('round-trips every character field across six HTTP operations and fresh DB connections',async()=>{
 const input={datasetId,commandId:v7(),name:'尚未写完的人',settings,portraitAssetId:null};
 const created=await request('create',input,true);expect(created.status).toBe(200);
 const dto=created.body.result.data.data;
 expect(dto).toMatchObject({name:input.name,settings,portraitAssetId:null,revision:1,schemaVersion:1});
 expect(dto).not.toHaveProperty('ownerId');expect(dto).not.toHaveProperty('scope');
 expect((await request('get',{id:dto.id})).body.result.data).toEqual(dto);
 const replay=await request('create',input,true);expect(replay.body.result.data).toEqual({data:dto,replayed:true});
 expect((await request('create',{...input,name:'不同内容'},true)).status).toBe(409);
 const nextSettings={personality:'重新定义',appearance:'新的外貌',speakingStyle:'慢慢说',boundaries:'先询问'};
 const changed=await request('update',{datasetId,commandId:v7(),id:dto.id,expectedRevision:1,patch:{name:'定稿前',settings:nextSettings}},true);
 expect(changed.status).toBe(200);expect(changed.body.result.data.data).toMatchObject({name:'定稿前',settings:nextSettings,revision:2});
 expect((await request('update',{datasetId,commandId:v7(),id:dto.id,expectedRevision:1,patch:{name:'过期窗口'}},true)).status).toBe(409);
 expect((await request('delete',{datasetId,commandId:v7(),id:dto.id,expectedRevision:2},true)).status).toBe(200);
 expect((await request('get',{id:dto.id})).status).toBe(404);
 expect((await request('list',{deleted:'only',q:'定稿前'})).body.result.data.items.map((x:{id:string})=>x.id)).toContain(dto.id);
 expect((await request('restore',{datasetId,commandId:v7(),id:dto.id,expectedRevision:3},true)).status).toBe(200);
 expect((await request('get',{id:dto.id})).body.result.data).toMatchObject({revision:4,settings:nextSettings,deletedAt:null});
});
it('allows duplicate names and counts the filtered collection rather than the page length',async()=>{
 const name='重名-'+v7();for(let i=0;i<3;i++)expect((await request('create',{datasetId,commandId:v7(),name,settings,portraitAssetId:null},true)).status).toBe(200);
 const page=(await request('list',{q:name,limit:2})).body.result.data;
 expect(page.items).toHaveLength(2);expect(page.totalMatching).toBe(3);expect(page.nextCursor).toEqual(expect.any(String));
 const next=(await request('list',{q:name,limit:2,cursor:page.nextCursor})).body.result.data;
 expect(next.items).toHaveLength(1);expect(next.totalMatching).toBe(3);
 expect(new Set([...page.items,...next.items].map((x:{id:string})=>x.id)).size).toBe(3);
});
it('rejects anonymous reads, missing markers, injected fields and cross-dataset commands without writes',async()=>{
 expect((await request('list',undefined,false,{})).status).toBe(401);
 const input={datasetId,commandId:v7(),name:'禁止落库-'+v7(),settings,portraitAssetId:null};
 const missing={...headers()};delete (missing as Record<string,string>)['x-everwoven-request'];
 expect((await request('create',input,true,missing)).status).toBe(403);
 for(const extra of [{ownerId:v7()},{scope:'story'},{createdAt:new Date().toISOString()}])expect((await request('create',{...input,...extra},true)).status).toBe(400);
 const changed=await request('create',{...input,datasetId:v7()},true);
 expect(changed.status).toBe(412);expect(changed.body.error.message).toBe('DATASET_CHANGED');
 expect((await request('list',{q:input.name})).body.result.data.totalMatching).toBe(0);
});
it('returns a clear validation failure for an unavailable portrait instead of a private internal error',async()=>{
 const response=await request('create',{datasetId,commandId:v7(),name:'缺失头像',settings,portraitAssetId:v7()},true);
 expect(response.status).toBe(400);expect(JSON.stringify(response.body)).not.toContain(parent);
});
