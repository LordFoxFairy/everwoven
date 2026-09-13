import {afterAll,beforeAll,expect,it} from 'vitest';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeLocalHost,authenticateSession} from 'runtime/host';
import {handleLocalSession} from './local-session';
let parent:string,datasetId:string,env:Record<string,string>;
const origin='http://127.0.0.1:3198';
const headers={'content-type':'application/json',origin,'x-everwoven-request':'1','sec-fetch-site':'same-origin'};
const request=(body:unknown={mode:'local'},overrides:Record<string,string>={})=>new Request(`${origin}/api/local-session`,{method:'POST',headers:{...headers,...overrides},body:JSON.stringify(body)});
beforeAll(async()=>{parent=await realpath(await mkdtemp(join(tmpdir(),'everwoven-auto-session-')));env={APP_ENV:'dev',APP_ORIGIN:origin,RUNTIME_DATA_DIR:join(parent,'host'),EVERWOVEN_LOCAL_LAUNCH:'loopback-v1'};datasetId=(await initializeLocalHost(env.RUNTIME_DATA_DIR!,'dev')).datasetId;},30000);
afterAll(async()=>{if(parent)await rm(parent,{recursive:true,force:true});});
it('connects a same-origin local browser without sending a credential in JSON',async()=>{
 const response=await handleLocalSession(request(),env);expect(response.status).toBe(200);
 const cookie=response.headers.get('set-cookie')!;expect(cookie).toContain('HttpOnly; SameSite=Strict;');expect(response.headers.get('cache-control')).toBe('no-store');
 const token=cookie.split(';')[0]!.split('=')[1]!;
 expect(await response.json()).toEqual({authenticated:true,datasetId,expiresAt:expect.any(Number)});
 expect((await authenticateSession(env.RUNTIME_DATA_DIR!,'dev',token)).datasetId).toBe(datasetId);
 const reused=await handleLocalSession(request({mode:'local'},{cookie:cookie.split(';')[0]!}),env);
 expect(reused.status).toBe(200);expect(reused.headers.get('set-cookie')).toBeNull();expect(await reused.json()).toEqual({authenticated:true,datasetId});
});
it.each(['cross-site','same-site','none',''])('rejects automatic pairing with fetch metadata %s',async site=>{
 const response=await handleLocalSession(request({mode:'local'},{'sec-fetch-site':site}),env);expect(response.status).toBe(403);expect(response.headers.get('set-cookie')).toBeNull();
});
const untrustedHeaders:Record<string,string>[]=[{origin:'https://evil.example'},{host:'evil.example'},{'x-everwoven-request':'0'},{origin:''}];
it.each(untrustedHeaders)('rejects untrusted automatic bootstrap headers %j',async bad=>{
 expect((await handleLocalSession(request({mode:'local'},bad),env)).status).toBe(403);
});
it.each([{mode:'local',code:'x'},{mode:'local',ownerId:'other'},{mode:'unknown'},{}])('rejects ambiguous bootstrap payload %j',async body=>{
 expect((await handleLocalSession(request(body),env)).status).toBe(400);
});
it('never exposes local bootstrap in demo, ordinary Web or uninitialized hosts',async()=>{
 for(const config of [{...env,APP_ENV:'demo'},{...env,EVERWOVEN_LOCAL_LAUNCH:''},{...env,APP_ORIGIN:'https://example.com'}])expect((await handleLocalSession(request(),config)).status).toBe(404);
 const response=await handleLocalSession(request(),{...env,RUNTIME_DATA_DIR:join(parent,'missing')});expect(response.status).toBe(503);expect(await response.text()).not.toContain(parent);
});
it('GET stays read-only: it does not bootstrap an anonymous browser',async()=>{
 const response=await handleLocalSession(new Request(`${origin}/api/local-session`,{headers}),env);expect(await response.json()).toEqual({authenticated:false});expect(response.headers.get('set-cookie')).toBeNull();
});
