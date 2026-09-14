import {describe,it,expect,vi} from 'vitest';
import {v7} from 'uuid';
import {createVideoBindingRegistry} from '../src/application/video-binding-registry.js';
import {createMiniMaxVideoJobs} from '../src/providers/minimax-jobs.js';
const input={prompt:'我接过画册，询问画里的海边。',duration:5,resolution:'768P',ratio:'16:9'} as const;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
function setup(region:'cn'|'international'='cn'){
 const owner={ownerId:v7(),datasetId:v7()};
 const registry=createVideoBindingRegistry({schemaVersion:1,connections:[{id:'personal',providerId:'minimax',region,accountScopeId:'one',credentialRef:'env:TEST_ONLY'}],bindings:[{bindingKey:'video',versionNo:1,connectionId:'personal',catalogId:'minimax-h3-max',operationKind:'text-to-video',generation:{duration:5,resolution:'768P',ratio:'16:9'}}]});
 const spec={...registry.resolve(owner,{bindingKey:'video',versionNo:1}),id:v7(),createdAt:new Date()};
 const fetchImpl=vi.fn<typeof fetch>();const jobs=createMiniMaxVideoJobs(spec,{apiKey:'TEST_ONLY',fetchImpl});
 return {spec,fetchImpl,jobs,operationId:v7()};
}
describe('fixed-account official MiniMax job transport',()=>{
 it.each(['cn','international'] as const)('submits exactly once in %s and carries operation/binding/account in the receipt',async region=>{
  const f=setup(region);f.fetchImpl.mockResolvedValue(json({task_id:'task-1'}));
  const ref=await f.jobs.submit(f.operationId,input);
  expect(ref).toMatchObject({taskId:'task-1',operationId:f.operationId,bindingId:f.spec.id,connectionId:f.spec.parameters.connectionId,accountScopeId:f.spec.parameters.providerAccountScopeId,modelId:'MiniMax-H3-Max',region});
  expect(ref.requestHash).toMatch(/^[a-f0-9]{64}$/);expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  expect(f.fetchImpl.mock.calls[0]![0]).toBe(`https://api.minimax.${region==='cn'?'cn':'io'}/v2/video_generation`);
 });
 it.each([400,401,402,422,429,500,503])('keeps HTTP %s as unknown without unproven no-charge assumptions',async status=>{
  const f=setup();f.fetchImpl.mockResolvedValue(json({error:{message:'PRIVATE'}},status));
  await expect(f.jobs.submit(f.operationId,input)).rejects.toMatchObject({code:'submission-unknown',submission:'unknown',httpStatus:status});
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('rejects an unimplemented adapter version before opening transport',()=>{
  const f=setup();expect(()=>createMiniMaxVideoJobs({...f.spec,adapterVersion:'not-installed'},{apiKey:'TEST_ONLY',fetchImpl:f.fetchImpl})).toThrow();
  expect(f.fetchImpl).not.toHaveBeenCalled();
 });
 it('does not send invalid input or a pre-aborted request',async()=>{
  const f=setup();await expect(f.jobs.submit(f.operationId,{...input,duration:60})).rejects.toThrow();
  const abort=new AbortController();abort.abort();await expect(f.jobs.submit(f.operationId,input,abort.signal)).rejects.toMatchObject({submission:'not-submitted'});
  expect(f.fetchImpl).not.toHaveBeenCalled();
 });
 it('preserves all official usage meters and does not make missing usage zero',async()=>{
  const f=setup();f.fetchImpl.mockResolvedValueOnce(json({task_id:'task-1'}));const ref=await f.jobs.submit(f.operationId,input);
  const task={id:ref.taskId,model:'MiniMax-H3-Max',status:'succeeded',task_type:'generation',modality:'video',content:{url:'https://media.example/video.mp4'},ratio:'16:9',resolution:'768P',duration:5};
  f.fetchImpl.mockResolvedValueOnce(json({task:{...task,usage:{output_seconds:5,input_seconds:0,input_image_count:1,input_audio_seconds:2,total_seconds:7,total_tokens:42,prompt_tokens:12,completion_tokens:30}}}));
  const result=await f.jobs.read(ref);expect(result.usage).toEqual({output_seconds:5,input_seconds:0,input_image_count:1,input_audio_seconds:2,total_seconds:7,total_tokens:42,prompt_tokens:12,completion_tokens:30});
  expect(result.video?.url).toBe(task.content.url);
  f.fetchImpl.mockResolvedValueOnce(json({task}));expect((await f.jobs.read(ref)).usage).toBeUndefined();
 });
 it('rejects another fixed account or modified binding when resuming, before transport',async()=>{
  const f=setup();f.fetchImpl.mockResolvedValue(json({task_id:'task-1'}));const ref=await f.jobs.submit(f.operationId,input);f.fetchImpl.mockClear();
  for(const patch of [{accountScopeId:'another'},{bindingId:v7()},{region:'international'},{modelId:'MiniMax-H3'},{connectionId:'another'}]){
   await expect(f.jobs.read({...ref,...patch})).rejects.toThrow('INVALID_PROVIDER_TASK_REFERENCE');
  }
  expect(f.fetchImpl).not.toHaveBeenCalled();
 });
 it('queries the original task after constructing a new transport instance',async()=>{
  const f=setup();f.fetchImpl.mockResolvedValueOnce(json({task_id:'task-1'}));const ref=await f.jobs.submit(f.operationId,input);
  const restarted=createMiniMaxVideoJobs(f.spec,{apiKey:'ROTATED_SAME_ACCOUNT',fetchImpl:f.fetchImpl});
  f.fetchImpl.mockResolvedValue(json({task:{id:'task-1',model:'MiniMax-H3-Max',status:'running',task_type:'generation',modality:'video'}}));
  expect(await restarted.read(ref)).toMatchObject({status:'running'});
  expect(f.fetchImpl.mock.calls[1]![1]?.method).toBe('GET');
 });
 it('blocks mismatched task kind/model/id and distinguishes query failure from generation failure',async()=>{
  const f=setup();f.fetchImpl.mockResolvedValueOnce(json({task_id:'task-1'}));const ref=await f.jobs.submit(f.operationId,input);
  for(const patch of [{id:'other'},{model:'other'},{task_type:'regeneration'},{modality:'audio'}]){
   f.fetchImpl.mockResolvedValue(json({task:{id:'task-1',model:'MiniMax-H3-Max',status:'running',task_type:'generation',modality:'video',...patch}}));
   await expect(f.jobs.read(ref)).rejects.toMatchObject({code:'invalid-response'});
  }
  f.fetchImpl.mockRejectedValue(Error('PRIVATE'));await expect(f.jobs.read(ref)).rejects.toMatchObject({code:'query-unavailable',submission:null});
 });
 it('bounds the response stream, cancels oversize input, and treats a missing acknowledgment as unknown',async()=>{
  const f=setup(),cancel=vi.fn();f.fetchImpl.mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(262145));},cancel})));
  await expect(f.jobs.submit(f.operationId,input)).rejects.toMatchObject({code:'submission-unknown'});expect(cancel).toHaveBeenCalled();
  f.fetchImpl.mockResolvedValue(json({}));await expect(f.jobs.submit(v7(),input)).rejects.toMatchObject({code:'submission-unknown'});
 });
});
