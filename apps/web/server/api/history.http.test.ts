import {beforeEach,expect,it,vi} from 'vitest';
import {handleTRPCRequest} from './http';
const host=vi.hoisted(()=>({withLocalHistory:vi.fn()}));vi.mock('runtime/host',()=>host);
const id='01994b80-0000-7000-8000-000000000001',other='01994b80-0000-7000-8000-000000000002',protocol={protocolVersion:1,datasetId:id};
const origin='http://127.0.0.1:3100',env={APP_ORIGIN:origin,APP_ENV:'dev',EVERWOVEN_LOCAL_LAUNCH:'loopback-v1',RUNTIME_DATA_DIR:'/tmp/history-http-not-opened'};
const headers={origin,'content-type':'application/json','x-everwoven-request':'1',cookie:`everwoven_local=${'a'.repeat(43)}`};
const command={...protocol,experienceId:id,savepointId:other,commandId:other,expectedSnapshotHash:'a'.repeat(64),branchBudgetLimitMicros:'100',currency:'USD'};
const result={data:{...protocol,experienceId:other,rootExperienceId:id,sourceExperienceId:id,sourceSavepointId:other,initialSavepointId:other,initialInteractionEventId:other,budgetScopeId:id,acceptedAt:new Date().toISOString()},replayed:false};
const service={list:vi.fn(),get:vi.fn(),fork:vi.fn(),recover:vi.fn(),resume:vi.fn()};
beforeEach(()=>{vi.resetAllMocks();service.fork.mockResolvedValue(result);service.recover.mockResolvedValue({...result,replayed:true});service.list.mockResolvedValue({...protocol,experienceId:id,items:[],nextBeforeId:null});host.withLocalHistory.mockImplementation((_d,_e,_t,work)=>work(service,{ownerId:other,datasetId:id}));});
function request(name:string,input:unknown,method='POST',override:HeadersInit={}){const h=new Headers(headers);new Headers(override).forEach((v,k)=>h.set(k,v));return new Request(`${origin}/api/trpc/history.${name}${method==='GET'?`?input=${encodeURIComponent(JSON.stringify(input))}`:''}`,{method,headers:h,...(method==='POST'?{body:JSON.stringify(input)}:{})});}
it('history and fork recovery are authenticated reads; fork is the sole explicit route creation',async()=>{
 expect((await handleTRPCRequest(request('list',{...protocol,experienceId:id},'GET'),env)).status).toBe(200);
 const response=await handleTRPCRequest(request('fork',command),env);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(service.fork).toHaveBeenCalledOnce();
 expect((await handleTRPCRequest(request('recover',{...protocol,experienceId:id,commandId:other},'GET'),env)).status).toBe(200);expect(service.fork).toHaveBeenCalledOnce();
 service.recover.mockResolvedValue(null);expect((await(await handleTRPCRequest(request('recover',{...protocol,experienceId:id,commandId:other},'GET'),env)).json()).result.data).toBeNull();
});
it('rejects forged owner, dataset, snapshot and untrusted origin before any fork',async()=>{
 for(const [patch,status] of [[{ownerId:other},400],[{datasetId:other},412],[{expectedSnapshotHash:'invalid'},400],[{savepointId:'bad'},400]] as const)expect((await handleTRPCRequest(request('fork',{...command,...patch}),env)).status).toBe(status);
 expect((await handleTRPCRequest(request('fork',command,'POST',{origin:'https://untrusted.invalid'}),env)).status).toBe(403);
 expect((await handleTRPCRequest(request('fork',command,'POST',{'x-everwoven-request':''}),env)).status).toBe(403);
 expect((await handleTRPCRequest(request('fork',command,'POST',{cookie:''}),env)).status).toBe(401);expect(service.fork).not.toHaveBeenCalled();
});
it('rejects mixed batches and does not disclose arbitrary server errors or miscorrelated fork receipts',async()=>{
 const mixed=new Request(`${origin}/api/trpc/history.fork,generation.accept?batch=1`,{method:'POST',headers,body:JSON.stringify(command)});expect((await handleTRPCRequest(mixed,env)).status).toBe(400);expect(service.fork).not.toHaveBeenCalled();
 service.fork.mockRejectedValueOnce(Error('private/path/key'));const failed=await handleTRPCRequest(request('fork',command),env);expect(failed.status).toBe(500);expect(await failed.text()).not.toContain('private/path/key');
 service.fork.mockResolvedValue({...result,data:{...result.data,sourceSavepointId:id}});expect((await handleTRPCRequest(request('fork',command),env)).status).toBe(500);
});
