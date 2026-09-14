import {beforeAll,afterAll,afterEach,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {prepare,dispose} from '../../runtime/tests/fixtures/story-aggregate/setup';
import {setup} from '../../runtime/tests/fixtures/generation/setup';
import {createGenerationWorker,type GenerationExecutor} from '../../runtime/src/application/generation-worker';
import {createMiniMaxVideoJobs} from '../../runtime/src/providers/minimax-jobs';
import {PlayController} from '../lib/experience/play-controller';
import {createGenerationClient} from '../lib/experience/playback-client';
import {handleTRPCRequest} from './api/http';
const host=vi.hoisted(()=>({withLocalGeneration:vi.fn(),withLocalGenerationPlayback:vi.fn()}));
vi.mock('runtime/host',()=>host);
beforeAll(prepare);afterAll(dispose);afterEach(()=>vi.unstubAllGlobals());
it('original HTTP/client/controller completes two SQLite turns with supplier fixtures, restores drafts and never auto-generates',async()=>{
 const f=await setup();
 const origin='http://127.0.0.1:3100',env={APP_ORIGIN:origin,APP_ENV:'dev',EVERWOVEN_LOCAL_LAUNCH:'loopback-v1',RUNTIME_DATA_DIR:'/tmp/test-boundary-only'};
 host.withLocalGeneration.mockImplementation((_d,_e,_t,work)=>work(f.generation,f.owner));
 host.withLocalGenerationPlayback.mockImplementation((_d,_e,_t,work)=>work(f.generation,f.owner));
 const fetch=vi.fn<typeof globalThis.fetch>(async(url,init)=>{
  const parsed=new URL(String(url),origin);if(parsed.origin!==origin)throw Error('EXTERNAL_NETWORK_FORBIDDEN');
  const headers=new Headers(init?.headers);headers.set('origin',origin);headers.set('cookie',`everwoven_local=${'a'.repeat(43)}`);
  return handleTRPCRequest(new Request(parsed,{...init,headers}),env);
 });vi.stubGlobal('fetch',fetch);
 const transport=vi.fn<typeof globalThis.fetch>(async(_url,init)=>Response.json(init?.method==='POST'?{task_id:'fixture-task'}:{task:{id:'fixture-task',model:'MiniMax-H3-Max',status:'succeeded',task_type:'generation',modality:'video',ratio:'16:9',resolution:'768P',duration:5,content:{url:'https://media.example/fixture.mp4'}}}));
 const executor:GenerationExecutor={assertProfile:()=>{},plan:async context=>({prompt:context.action||'两人看向天空'}),jobs:binding=>createMiniMaxVideoJobs(binding,{apiKey:'TEST_ONLY',fetchImpl:transport}),
  materialize:async()=>({id:v7(),sha256:'a'.repeat(64),duration:5}),validate:async()=>({summary:'两人在天台说话',choices:[{id:'ask',title:'问问对方',text:'你在看什么？'},{id:'watch',title:'一起看看',text:'我看向天空。'}]})};
 const worker=createGenerationWorker(f.db,f.owner,f.authority,executor,f.services),client=createGenerationClient(),controller=new PlayController(vi.fn());
 controller.bind({client,connected:true,datasetId:f.owner.datasetId,invalidate:vi.fn()});
 try{
  expect(await controller.open(f.opening.id)).toBe(true);expect(await f.db.generationTurn.count()).toBe(0);
  for(let n=0;n<2;n++){
   expect(await controller.quote(n?'你在看什么？':undefined)).toBe(true);
   const quote=controller.getSnapshot().quote!;expect((await client.getQuote({...f.protocol,experienceId:f.opening.id,quoteId:quote.id})).quote).toEqual(quote);
   expect(await controller.accept()).toBe(true);
   for(let stage=0;stage<5;stage++)expect(await worker.tick()).toBe(true);
   await controller.refresh();expect(controller.getSnapshot().play?.status).toBe('playing');expect(controller.getSnapshot().play?.interaction).toBeNull();
   const {turn}=controller.getSnapshot().play!;expect(await controller.ended(turn!.id,turn!.media!.id)).toBe(true);
   expect(controller.getSnapshot().play?.interaction?.choices).toHaveLength(2);
   expect(await worker.tick()).toBe(false); // User decides; no autonomous third scene.
   if(n===0){controller.draft('尚未发送');expect(await controller.saveDraft()).toBe(true);const restored=new PlayController(vi.fn());restored.bind({client,connected:true,datasetId:f.owner.datasetId,invalidate:vi.fn()});await restored.open(f.opening.id);expect(restored.getSnapshot().draft).toBe('尚未发送');}
  }
  const turns=await f.db.generationTurn.findMany({orderBy:{createdAt:'asc'}});expect(turns).toHaveLength(2);expect(turns[1]!.parentTurnId).toBe(turns[0]!.id);
  expect(transport.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(2);expect(await f.db.budgetReservation.count()).toBe(2);
  expect(fetch.mock.calls.every(c=>String(c[0]).startsWith('/api/trpc/generation.'))).toBe(true);
 }finally{await f.close();}
},30000);
