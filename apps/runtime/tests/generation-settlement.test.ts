import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {v7} from 'uuid';
import {prepare,dispose} from './fixtures/story-aggregate/setup.js';
import {setup} from './fixtures/generation/setup.js';
import {sceneArtifacts} from '../src/application/scene-artifacts.js';
import {generationBindingHash} from '../src/application/generation.js';
import {createPersistedGenerationExecutor} from '../src/composition/generation-executor.js';
import {createGenerationWorker} from '../src/application/generation-worker.js';
import {createMiniMaxVideoJobs} from '../src/providers/minimax-jobs.js';
import {settleTurnCost} from '../src/application/generation-settlement.js';
import {withOwnerWrite} from '../src/infrastructure/db/write-gate.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import {costMicros} from '../src/contracts/account-cost.js';
beforeAll(prepare);afterAll(dispose);
async function fixture(options:{missing?:boolean;overrun?:boolean;zero?:boolean;fraction?:boolean;partialOverrun?:boolean;validatorOverrun?:boolean}={}){
 const f=await setup();const artifacts=sceneArtifacts();Object.assign(f.evidence.profile,{graph:artifacts.graph});Object.assign(f.evidence.profile.planner,artifacts.planner);Object.assign(f.evidence.profile.validator,artifacts.validator);
 const quote=(await f.generation.quote(f.quoteInput)).data,turn=(await f.generation.accept(f.acceptInput(quote.id))).data,media={id:v7(),sha256:'b'.repeat(64),duration:5};
 const fetchImpl=vi.fn<typeof fetch>(async(_url,init)=>Response.json(init?.method==='POST'?{task_id:'cost-task'}:{task:{id:'cost-task',model:'MiniMax-H3-Max',status:'succeeded',task_type:'generation',modality:'video',ratio:'16:9',resolution:'768P',duration:5,content:{url:'https://fixture.example/video'},usage:{output_seconds:options.partialOverrun?200:options.zero?0:options.fraction?4.999:5,...(options.partialOverrun?{}:{input_image_count:0})}}}));
 const invoke=vi.fn(async(binding:typeof f.evidence.profile.planner.binding)=>({value:binding.bindingKey==='planner'?{prompt:'角色站到窗前。'}:{verdict:'confirmed',summary:'角色站在窗前。',choices:[{id:'ask',title:'问一句',text:'在想什么？'},{id:'look',title:'看看',text:'我望向天空。'}],evidenceFrameIndices:[0]},observation:{providerId:binding.providerId,modelId:binding.modelId,bindingHash:generationBindingHash(binding),responseId:`cost-${binding.bindingKey}`,usage:{inputTokens:20,outputTokens:10},...(!options.missing?{accountCost:{currency:'USD' as const,amount:options.zero?'0':(options.overrun||options.validatorOverrun&&binding.bindingKey==='validator')?'0.1':'0.0000301'}}:{})}}));
 const executor=createPersistedGenerationExecutor(f.db,f.owner,f.authority,{text:binding=>({bindingHash:generationBindingHash(binding),invoke:async()=>invoke(binding)}),assertVideoProfile(){},jobs:binding=>createMiniMaxVideoJobs(binding,{apiKey:'TEST_ONLY',fetchImpl}),materialize:async()=>media,sample:async()=>({mediaId:media.id,mediaSha256:media.sha256,frames:[{atMs:0,jpeg:Uint8Array.from([255,216,255,217])}]})},f.services);
 const worker=createGenerationWorker(f.db,f.owner,f.authority,executor,f.services);
 return{...f,quote,turn,fetchImpl,invoke,worker};
}
it('preserves three stage evidences, settles actual amounts once and releases unused shared reservation after tariff expiration',async()=>{
 const f=await fixture({fraction:true});let reopened:Awaited<ReturnType<typeof openRuntimeDatabase>>|undefined;
 try{
  // Historical accepted tariff, not today's catalog, determines settlement.
  f.tick(3600001);for(let i=0;i<5;i++)expect(await f.worker.tick()).toBe(true);
  expect((await f.db.generationTurn.findUniqueOrThrow({where:{id:f.turn.id}})).status).toBe('ready');
  const rows=await f.db.stageCostEvidence.findMany({orderBy:{stage:'asc'}});expect(rows).toHaveLength(3);
  expect(rows.map(r=>r.amountMicros)).toEqual([31n,31n,500n]);
  expect(rows.find(r=>r.stage==='video')?.evidence).toMatchObject({snapshot:{usage:{output_seconds:4.999}}});
  expect(JSON.stringify(rows.map(r=>r.evidence))).not.toContain('https://');
  const reservation=await f.db.budgetReservation.findUniqueOrThrow({where:{id:f.turn.id}});expect(reservation).toMatchObject({reservedMicros:0n,settledMicros:562n,status:'settled',reviewRequired:false});
  await Promise.all([1,2].map(()=>withOwnerWrite(f.db,f.owner.ownerId,tx=>settleTurnCost(tx,f.owner,f.authority,f.turn.id,f.services))));
  const dbPath=(await f.db.$queryRawUnsafe<Array<{file:string}>>('PRAGMA database_list'))[0]!.file;
  await f.db.experience.update({where:{id:f.opening.id},data:{deletedAt:new Date()}});await f.db.$disconnect();reopened=await openRuntimeDatabase(dbPath);
  await withOwnerWrite(reopened,f.owner.ownerId,tx=>settleTurnCost(tx,f.owner,f.authority,f.turn.id,f.services));
  expect(await reopened.budgetReservation.findUniqueOrThrow({where:{id:f.turn.id}})).toEqual(reservation);
  expect(await reopened.stageCostEvidence.findMany({orderBy:{stage:'asc'}})).toEqual(rows);expect(f.invoke).toHaveBeenCalledTimes(2);expect(f.fetchImpl).toHaveBeenCalledTimes(2);
 }finally{await reopened?.$disconnect();await f.close();}
});
it('keeps missing account charge held, distinct from explicit zero',async()=>{
 for(const missing of [true,false]){const f=await fixture(missing?{missing}:{zero:true});try{
  for(let i=0;i<5;i++)await f.worker.tick();
  const r=await f.db.budgetReservation.findUniqueOrThrow({where:{id:f.turn.id}});
  expect(r).toMatchObject({status:missing?'held':'released',reservedMicros:missing?BigInt(f.quote.maxCostMicros):0n,settledMicros:0n});
  expect(await f.db.stageCostEvidence.count()).toBe(3);
 }finally{await f.close();}}
});
it('records an above-bound provider charge without clipping it and stops subsequent paid stages',async()=>{
 const f=await fixture({overrun:true});try{
  await f.worker.tick();expect(await f.worker.tick()).toBe(false);
  expect(await f.db.budgetReservation.findUniqueOrThrow({where:{id:f.turn.id}})).toMatchObject({status:'held',reviewRequired:true,reservedMicros:100000n,settledMicros:0n});
  expect((await f.db.stageCostEvidence.findFirstOrThrow()).amountMicros).toBe(100000n);expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.fetchImpl).not.toHaveBeenCalled();
  expect((await f.db.generationTurn.findUniqueOrThrow({where:{id:f.turn.id}})).status).toBe('unknown');
 }finally{await f.close();}
});
it('rolls back settlement and ready transition together when reservation persistence fails',async()=>{
 const f=await fixture();try{
  for(let i=0;i<5;i++)await f.worker.tick();
  await f.db.generationTurn.update({where:{id:f.turn.id},data:{status:"checking"}});
  await f.db.budgetReservation.update({where:{id:f.turn.id},data:{status:"held",reservedMicros:BigInt(f.quote.maxCostMicros),settledMicros:0n}});
  // Keep the real director/observation path; fail the terminal reservation update only.
  const failing=f.db.$extends({query:{budgetReservation:{async update({args,query}){if(args.data.status==='settled')throw Error('FIXTURE_SETTLEMENT_DISK_FAILURE');return query(args);}}}});
  // Simulate the terminal transaction itself; ready must roll back along with money.
  await expect(withOwnerWrite(failing as typeof f.db,f.owner.ownerId,async tx=>{
   await tx.generationTurn.update({where:{id:f.turn.id},data:{status:'ready'}});
   await settleTurnCost(tx,f.owner,f.authority,f.turn.id,f.services);
  })).rejects.toThrow('FIXTURE_SETTLEMENT_DISK_FAILURE');
  expect((await f.db.generationTurn.findUniqueOrThrow({where:{id:f.turn.id}})).status).toBe('checking');
  expect((await f.db.budgetReservation.findUniqueOrThrow({where:{id:f.turn.id}})).status).toBe('held');
 }finally{await f.close();}
});
it('uses decimal BigInt rounding and rejects negative/overflow amounts',()=>{
 expect(costMicros('3.01e-5')).toBe(31n);expect(costMicros('0')).toBe(0n);expect(costMicros('0.00000001')).toBe(1n);expect(costMicros('9007199254.740993')).toBe(9007199254740993n);
 for(const value of ['-1','NaN','Infinity','1e100','01'])expect(()=>costMicros(value)).toThrow();
});

it.each(['partialOverrun','validatorOverrun'] as const)('preserves known liability and blocks %s',async kind=>{
 const f=await fixture({[kind]:true});try{
  for(let i=0;i<5;i++)await f.worker.tick();
  expect((await f.db.generationTurn.findUniqueOrThrow({where:{id:f.turn.id}})).status).toBe('unknown');
  const r=await f.db.budgetReservation.findUniqueOrThrow({where:{id:f.turn.id}});expect(r.reviewRequired).toBe(true);expect(r.status).toBe('held');expect(r.reservedMicros).toBe(kind==='partialOverrun'?20031n:100531n);
  expect(f.invoke).toHaveBeenCalledTimes(kind==='partialOverrun'?1:2);
  if(kind==='partialOverrun')expect((await f.db.stageCostEvidence.findFirstOrThrow({where:{stage:'video'}})).amountMicros).toBeNull();
 }finally{await f.close();}
});
it('recovers complete billing evidence after a crashed paid-stage commit without another provider invocation',async()=>{
 const f=await fixture();try{
  for(let i=0;i<5;i++)await f.worker.tick();
  await f.db.generationTurn.update({where:{id:f.turn.id},data:{status:'validating'}});
  await f.db.experience.update({where:{id:f.opening.id},data:{status:'generating',schedulingPaused:false}});
  await f.db.budgetReservation.update({where:{id:f.turn.id},data:{status:'held',reservedMicros:BigInt(f.quote.maxCostMicros),settledMicros:0n}});
  await f.db.runtimeOutbox.update({where:{id:f.turn.id},data:{status:'leased',leaseToken:v7(),leaseUntil:new Date(f.services.clock.now().getTime()-1)}});
  await f.worker.tick();expect((await f.db.generationTurn.findUniqueOrThrow({where:{id:f.turn.id}})).status).toBe('unknown');
  expect(await f.db.budgetReservation.findUniqueOrThrow({where:{id:f.turn.id}})).toMatchObject({status:'settled',reservedMicros:0n,settledMicros:562n});
  expect(f.invoke).toHaveBeenCalledTimes(2);expect(f.fetchImpl).toHaveBeenCalledTimes(2);
 }finally{await f.close();}
});
