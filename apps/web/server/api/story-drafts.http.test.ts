import {expect,it} from 'vitest';
import {handleTRPCRequest} from './http';
it('registers story CRUD behind authentication, even without configured storage',async()=>{
 const r=await handleTRPCRequest(new Request('http://127.0.0.1:3100/api/trpc/storyDrafts.list'),{});
 expect(r.status).toBe(401);
 expect(await r.text()).not.toContain('Prisma');
});
it('rejects write requests without Origin before dispatch',async()=>{
 const r=await handleTRPCRequest(new Request('http://127.0.0.1:3100/api/trpc/storyDrafts.create',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{});
 expect(r.status).toBe(403);
});

it('maps revision conflicts to the public conflict code without database details',async()=>{
 const {appRouter}=await import('./root');
 const id='01993ce0-0000-7000-8000-000000000001';
 const caller=appRouter.createCaller({env:{},withStories:async work=>work({
  create:async()=>{throw Error('unused');},get:async()=>{throw Error('unused');},list:async()=>({items:[],nextCursor:null}),
  update:async()=>{throw Error('REVISION_CONFLICT');},delete:async()=>{throw Error('unused');},restore:async()=>{throw Error('unused');},
 },{ownerId:id,datasetId:id})});
 await expect(caller.storyDrafts.update({datasetId:id,id,commandId:id,expectedRevision:1,patch:{title:'世界'}})).rejects.toMatchObject({code:'CONFLICT',message:'REVISION_CONFLICT'});
});

it('preserves the dataset reset reason as PRECONDITION_FAILED',async()=>{
 const {localError}=await import('../local-runtime');
 expect(localError(new Error('DATASET_CHANGED'))).toMatchObject({code:'PRECONDITION_FAILED',message:'DATASET_CHANGED'});
});
