import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {prepare,dispose} from './fixtures/story-aggregate/setup.js';
import {setup} from './fixtures/generation/setup.js';
import {createExperienceHistory} from '../src/application/experience-history.js';
import {createGenerationWorker,type GenerationExecutor} from '../src/application/generation-worker.js';
import {createMiniMaxVideoJobs} from '../src/providers/minimax-jobs.js';
import {openGenerationMedia} from '../src/application/generation-media.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import {createGenerationService} from '../src/application/generation.js';
beforeAll(prepare);afterAll(dispose);
async function fixture(){
 const f=await setup(),files={verifyVideo:vi.fn(async()=>{}),verifyAsset:vi.fn(async()=>{})};
 const history=createExperienceHistory(f.db,f.owner,f.authority,files,f.services);
 const transport=vi.fn<typeof fetch>(async(_url,init)=>new Response(JSON.stringify(init?.method==='POST'?{task_id:'fixture-task'}:{task:{id:'fixture-task',model:'MiniMax-H3-Max',status:'succeeded',task_type:'generation',modality:'video',ratio:'16:9',resolution:'768P',duration:5,content:{url:'https://media.example/fixture.mp4'}}})));
 let label='A';
 const executor:GenerationExecutor={assertProfile:()=>{},plan:vi.fn(async()=>({prompt:'本地测试画面'})),jobs:b=>createMiniMaxVideoJobs(b,{apiKey:'TEST_ONLY',fetchImpl:transport}),materialize:async()=>({id:v7(),sha256:'a'.repeat(64),duration:5,durationMs:5000,byteSize:'1000',width:1366,height:768,codec:'h264',mimeType:'video/mp4'}),validate:async()=>({summary:label,choices:[{id:'ask',title:'问一句',text:'我想问问你'},{id:'look',title:'看看',text:'我望向窗外'}]})};
 const worker=createGenerationWorker(f.db,f.owner,f.authority,executor,f.services);
 async function next(experienceId:string,title:string){
  label=title;const play=await f.generation.get({...f.protocol,experienceId});
  const quote=await f.generation.quote({...f.protocol,experienceId,commandId:v7(),expectedExperienceRevision:play.revision,...(play.status==='preparing'?{kind:'opening' as const}:{kind:'response' as const,interactionEventId:play.interaction!.id,text:'用户选择 '+title})});
  const turn=await f.generation.accept({...f.protocol,experienceId,commandId:v7(),quoteId:quote.data.id,expectedExperienceRevision:play.revision,consent:true});
  for(let i=0;i<5;i++)await worker.tick();
  const ready=await f.generation.get({...f.protocol,experienceId});expect(ready.status).toBe('playing');
  const ended={...f.protocol,experienceId,commandId:v7(),turnId:turn.data.id,mediaId:ready.turn!.media!.id,expectedExperienceRevision:ready.revision};
  await f.view(ended);await f.generation.completePlayback(ended);
  return(await f.db.savepoint.findUniqueOrThrow({where:{sourceTurnId:turn.data.id}}));
 }
 async function fork(point:Awaited<ReturnType<typeof next>>,experienceId=f.opening.id){
  const detail=await history.get({...f.protocol,experienceId,savepointId:point.id});
  const input={...f.protocol,experienceId,savepointId:point.id,commandId:v7(),expectedSnapshotHash:detail.savepoint.snapshotHash,branchBudgetLimitMicros:'1000000',currency:'USD' as const};
  return{input,result:await history.fork(input)};
 }
 return{...f,history,files,executor,worker,transport,next,fork};
}
it('A/B/C -> fork B -> source deletion -> child D inherits A/B only, owns its decision and retains shared budget/media',async()=>{
 const f=await fixture();try{
  const a=await f.next(f.opening.id,'A'),b=await f.next(f.opening.id,'B');await f.next(f.opening.id,'C');
  const original=await f.generation.get({...f.protocol,experienceId:f.opening.id});
  await f.generation.saveDraft({...f.protocol,experienceId:f.opening.id,interactionEventId:original.interaction!.id,commandId:v7(),expectedDraftRevision:1,text:'原路线未发送'});
  const beforeCalls=f.transport.mock.calls.length,{input,result}=await f.fork(b),child=result.data.experienceId;
  expect(f.transport.mock.calls).toHaveLength(beforeCalls);expect(await f.db.generationTurn.count({where:{experienceId:child}})).toBe(0);
  const paused=await f.generation.get({...f.protocol,experienceId:child});expect(paused).toMatchObject({status:'paused',turn:null,interaction:null,inherited:{savepointId:b.id}});
  expect(await f.db.responseDraft.findFirst({where:{experienceId:child}})).toMatchObject({text:'',revision:1});
  expect((await f.generation.get({...f.protocol,experienceId:f.opening.id}))).toEqual(original);
  expect((await f.history.list({...f.protocol,experienceId:child})).items.map(x=>x.id).sort()).toEqual([a.id,b.id].sort());
  const c=(await f.history.list({...f.protocol,experienceId:f.opening.id})).items[0]!;
  await expect(f.history.get({...f.protocol,experienceId:child,savepointId:c.id})).rejects.toThrow('SAVEPOINT_SOURCE_UNAVAILABLE');
  await f.db.experience.update({where:{id:f.opening.id},data:{deletedAt:f.services.clock.now()}});
  expect(await f.history.fork(input)).toEqual({...result,replayed:true});
  await expect(f.history.fork({...input,commandId:v7()})).rejects.toThrow('EXPERIENCE_NOT_FOUND');
  const media=await f.history.get({...f.protocol,experienceId:child,savepointId:b.id});expect(media.canFork).toBe(false);
  const open=vi.fn(async()=>({close:async()=>{}} as never));await openGenerationMedia(f.db,f.owner,{datasetId:f.owner.datasetId,experienceId:child,turnId:media.media.turnId,mediaId:media.media.id},{open},async()=>{});expect(open).toHaveBeenCalledOnce();
  await f.history.resume({...f.protocol,experienceId:child,expectedExperienceRevision:1,commandId:v7()});
  const awaiting=await f.generation.get({...f.protocol,experienceId:child});expect(awaiting.status).toBe('awaiting');expect(awaiting.interaction!.id).not.toBe(original.interaction!.id);
  const d=await f.next(child,'D'),snapshot=await f.db.stateSnapshot.findUniqueOrThrow({where:{id:d.stateSnapshotId}});
  expect((snapshot.state as {confirmedScenes:Array<{summary:string}>}).confirmedScenes.map(x=>x.summary)).toEqual(['A','B','D']);
  expect(d.parentSavepointId).toBe(result.data.initialSavepointId);expect(d.sourceTurnId).not.toBe(b.sourceTurnId);
  const context=vi.mocked(f.executor.plan).mock.calls.at(-1)![0];expect(context.confirmedScenes?.map(x=>x.summary)).toEqual(['A','B']);
  const turn=await f.db.generationTurn.findUniqueOrThrow({where:{id:d.sourceTurnId!}});expect(turn).toMatchObject({parentTurnId:null,inputSavepointId:result.data.initialSavepointId,budgetScopeId:result.data.budgetScopeId});
  expect(await f.db.budgetScope.count()).toBe(1);expect(await f.db.budgetReservation.count()).toBe(4);
 }finally{await f.close();}
});
it('fork checks media, snapshot and lifecycle; failed preflight has no child and same command is idempotent after reopen',async()=>{
 const f=await fixture();let reopened;try{
  const a=await f.next(f.opening.id,'A'),detail=await f.history.get({...f.protocol,experienceId:f.opening.id,savepointId:a.id});
  const input={...f.protocol,experienceId:f.opening.id,savepointId:a.id,commandId:v7(),expectedSnapshotHash:detail.savepoint.snapshotHash,branchBudgetLimitMicros:'0',currency:'USD' as const};
  await expect(f.history.fork({...input,expectedSnapshotHash:'f'.repeat(64)})).rejects.toThrow('SNAPSHOT_MISMATCH');
  f.files.verifyVideo.mockRejectedValueOnce(Error('PLAYBACK_MEDIA_UNAVAILABLE'));await expect(f.history.fork(input)).rejects.toThrow('PLAYBACK_MEDIA_UNAVAILABLE');expect(await f.db.experience.count()).toBe(1);
  const result=await f.history.fork(input);await expect(f.history.fork({...input,branchBudgetLimitMicros:'1'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const paths=await f.db.$queryRawUnsafe<Array<{file:string}>>('PRAGMA database_list');await f.db.$disconnect();reopened=await openRuntimeDatabase(paths[0]!.file);
  const service=createExperienceHistory(reopened,f.owner,f.authority,{verifyAsset:async()=>{throw Error();},verifyVideo:async()=>{throw Error();}},f.services);
  expect(await service.fork(input)).toEqual({...result,replayed:true});
  const generation=createGenerationService(reopened,f.owner,f.authority,f.policy,f.services);expect((await generation.get({...f.protocol,experienceId:result.data.experienceId})).status).toBe('paused');
 }finally{await reopened?.$disconnect();await f.close();}
});
it.each(['queued','prepared','checking'])('unknown scope blocks a child %s paid stage but permits free branching and existing media',async stage=>{
 const f=await fixture();try{
  const a=await f.next(f.opening.id,'A'),branch=await f.fork(a),child=branch.result.data.experienceId;
  await f.history.resume({...f.protocol,experienceId:child,expectedExperienceRevision:1,commandId:v7()});
  const play=await f.generation.get({...f.protocol,experienceId:child}),q=await f.generation.quote({...f.protocol,experienceId:child,commandId:v7(),expectedExperienceRevision:1,kind:'response',interactionEventId:play.interaction!.id,text:'继续'});
  const accepted=await f.generation.accept({...f.protocol,experienceId:child,commandId:v7(),quoteId:q.data.id,expectedExperienceRevision:1,consent:true});
  await f.db.generationTurn.update({where:{id:accepted.data.id},data:{status:stage}});
  const source=await f.generation.get({...f.protocol,experienceId:f.opening.id}),sq=await f.generation.quote({...f.protocol,experienceId:f.opening.id,commandId:v7(),expectedExperienceRevision:source.revision,kind:'response',interactionEventId:source.interaction!.id,text:'原路下一步'});
  const st=await f.generation.accept({...f.protocol,experienceId:f.opening.id,commandId:v7(),quoteId:sq.data.id,expectedExperienceRevision:source.revision,consent:true});
  await f.db.generationTurn.update({where:{id:st.data.id},data:{status:'unknown'}});await f.db.runtimeOutbox.update({where:{id:st.data.id},data:{status:'blocked'}});
  await f.db.experience.update({where:{id:f.opening.id},data:{status:'unknown',schedulingPaused:true}});
  const calls=f.transport.mock.calls.length,plans=vi.mocked(f.executor.plan).mock.calls.length;
  expect(await f.worker.tick()).toBe(true);expect((await f.db.generationTurn.findUniqueOrThrow({where:{id:accepted.data.id}})).status).toBe(stage);
  expect(f.transport.mock.calls).toHaveLength(calls);expect(vi.mocked(f.executor.plan).mock.calls).toHaveLength(plans);
  const free=await f.fork(a);expect(free.result.data.experienceId).not.toBe(child);expect(await f.history.get({...f.protocol,experienceId:child,savepointId:a.id})).toMatchObject({scene:{summary:'A'}});
  const fresh=free.result.data.experienceId;await f.history.resume({...f.protocol,experienceId:fresh,expectedExperienceRevision:1,commandId:v7()});
  const next=await f.generation.get({...f.protocol,experienceId:fresh}),quote=await f.generation.quote({...f.protocol,experienceId:fresh,commandId:v7(),expectedExperienceRevision:1,kind:'response',interactionEventId:next.interaction!.id,text:'尝试生成'});
  await expect(f.generation.accept({...f.protocol,experienceId:fresh,commandId:v7(),quoteId:quote.data.id,expectedExperienceRevision:1,consent:true})).rejects.toThrow('SCOPE_RECONCILIATION_REQUIRED');
 }finally{await f.close();}
});
it('parallel same-command fork creates exactly one child; recover is read-only after source deletion',async()=>{
 const f=await fixture();try{
  const a=await f.next(f.opening.id,'A'),detail=await f.history.get({...f.protocol,experienceId:f.opening.id,savepointId:a.id});
  const input={...f.protocol,experienceId:f.opening.id,savepointId:a.id,commandId:v7(),expectedSnapshotHash:detail.savepoint.snapshotHash,branchBudgetLimitMicros:'1000000',currency:'USD' as const};
  const pair=await Promise.all([f.history.fork(input),f.history.fork(input)]);expect(pair[0].data).toEqual(pair[1].data);expect(await f.db.experienceFork.count()).toBe(1);
  await f.db.experience.update({where:{id:f.opening.id},data:{deletedAt:f.services.clock.now()}});
  const count=await f.db.commandReceipt.count();expect((await f.history.recover({...f.protocol,experienceId:f.opening.id,commandId:input.commandId}))?.data).toEqual(pair[0].data);
  expect(await f.history.recover({...f.protocol,experienceId:f.opening.id,commandId:v7()})).toBeNull();expect(await f.db.commandReceipt.count()).toBe(count);
  await expect(f.history.recover({...f.protocol,experienceId:pair[0].data.experienceId,commandId:input.commandId})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 }finally{await f.close();}
});
it('long confirmed history is rejected before quotation or paid reservation instead of poisoning a scope',async()=>{
 const f=await fixture();try{
  const result={summary:'长'.repeat(2000),choices:[{id:'ask',title:'问',text:'问'},{id:'look',title:'看',text:'看'}]};
  f.executor.validate=async()=>result;
  let limitHit=false;
  for(let i=0;i<35;i++){
   const play=await f.generation.get({...f.protocol,experienceId:f.opening.id}),before=await f.db.generationTurn.count(),quotes=await f.db.generationQuote.count(),reserved=await f.db.budgetReservation.count();
   try{await f.next(f.opening.id,'长'.repeat(1990));}
   catch(error){expect((error as Error).message).toBe('GENERATION_CONTEXT_LIMIT');expect(await f.db.generationTurn.count()).toBe(before);expect(await f.db.generationQuote.count()).toBe(quotes);expect(await f.db.budgetReservation.count()).toBe(reserved);expect(await f.db.generationTurn.count({where:{status:'unknown'}})).toBe(0);expect((await f.generation.get({...f.protocol,experienceId:f.opening.id})).revision).toBe(play.revision);limitHit=true;break;}
  }
  expect(limitHit).toBe(true);
 }finally{await f.close();}
});
