import {describe,it,expect,vi} from 'vitest';
import {createOfficialVideoJobs,OfficialJobError} from './minimax-jobs';
import {resolveVideoConfiguration} from '../catalog';
const selection={providerId:'minimax',modelId:'minimax-h3-max'} as const;
const input={prompt:'用户本次选择的行动',resolution:'480P',duration:5} as const;
const key='TEST_ONLY_NEVER_REAL';
function setup(){const fetchImpl=vi.fn<typeof fetch>();return{fetchImpl,jobs:createOfficialVideoJobs(selection,{apiKey:key,fetchImpl})};}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const task=(status='running',extra:Record<string,unknown>={})=>({task:{id:'task-1',model:'MiniMax-H3-Max',status,...extra}});
describe('official task adapter: not a realtime session',()=>{
 it('routes to the official create endpoint and never switches suppliers',async()=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockResolvedValue(json({task_id:'task-1'}));
  expect(await jobs.submit(input)).toEqual({taskId:'task-1'});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url,request]=fetchImpl.mock.calls[0];
  expect(url).toBe('https://api.minimax.cn/v2/video_generation');
  expect(request).toMatchObject({method:'POST',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'}});
  expect(JSON.parse(request!.body as string)).toMatchObject({model:'MiniMax-H3-Max',ratio:'16:9',duration:5});
  expect(jobs.mode).toBe('job');
  expect(JSON.stringify(jobs)).not.toContain(key);
 });
 it('keeps realtime start disabled even when a job adapter and key exist',()=>{
  expect(resolveVideoConfiguration({VIDEO_PROVIDER:'minimax',VIDEO_MODEL:'minimax-h3-max',MINIMAX_API_KEY:key})).toMatchObject({available:false,reason:'not-live'});
 });
 it('rejects another supplier before creating transport',()=>{
  expect(()=>createOfficialVideoJobs({providerId:'fal',modelId:'h3-max-director'},{apiKey:key})).toThrow();
  expect(()=>createOfficialVideoJobs(selection,{apiKey:'  '})).toThrow();
 });
 it('validates inputs without issuing a paid request',async()=>{
  const {jobs,fetchImpl}=setup();await expect(jobs.submit({...input,duration:60})).rejects.toThrow();expect(fetchImpl).not.toHaveBeenCalled();
 });
 it('does not send an already-aborted action',async()=>{
  const {jobs,fetchImpl}=setup();const c=new AbortController();c.abort();
  await expect(jobs.submit(input,c.signal)).rejects.toMatchObject({code:'not-submitted',submission:'not-submitted'});
  expect(fetchImpl).not.toHaveBeenCalled();
 });
 it('treats network failure as unknown submission and never blindly retries',async()=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockRejectedValue(Error(`transport accidentally echoed ${key}`));
  const error=await jobs.submit(input).catch(e=>e);
  expect(error).toBeInstanceOf(OfficialJobError);expect(error).toMatchObject({code:'submission-unknown',submission:'unknown'});
  expect(String(error)).not.toContain(key);expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('a create 5xx is uncertain, not proof that no billable job exists',async()=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockResolvedValue(json({error:{message:key}},503));
  await expect(jobs.submit(input)).rejects.toMatchObject({submission:'unknown',httpStatus:503});
  expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('sanitizes a documented request rejection',async()=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockResolvedValue(json({error:{message:key}},402));
  const error=await jobs.submit(input).catch(e=>e);
  expect(error).toMatchObject({code:'request-rejected',submission:'rejected',httpStatus:402});expect(String(error)).not.toContain(key);
 });
 it.each([{}, {task_id:123}, {task_id:'../other'}, {task_id:''}])('rejects invalid create acknowledgments without resubmitting: %j',async body=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockResolvedValue(json(body));
  await expect(jobs.submit(input)).rejects.toMatchObject({submission:'unknown'});expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it.each(['queued','running','failed','cancelled'])('reads %s without inventing video or progress',async status=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockResolvedValue(json(task(status)));
  expect(await jobs.read('task-1')).toEqual({taskId:'task-1',status});
  expect(fetchImpl.mock.calls[0][0]).toBe('https://api.minimax.cn/v2/query/video_generation/task-1');
  expect(fetchImpl.mock.calls[0][1]?.method).toBe('GET');expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('preserves actual output dimensions and usage without declaring playback',async()=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockResolvedValue(json(task('succeeded',{
   content:{url:'https://media.example/result.mp4'},ratio:'9:16',resolution:'768P',duration:5,
   usage:{output_seconds:5,total_seconds:5},
  })));
  expect(await jobs.read('task-1')).toEqual({taskId:'task-1',status:'succeeded',video:{url:'https://media.example/result.mp4',ratio:'9:16',resolution:'768P',duration:5},usage:{outputSeconds:5,totalSeconds:5}});
 });
 it.each([
  task('running',{status:['succeeded']}),
  task('succeeded',{content:{url:'https://media.example/result.mp4'},ratio:['16:9'],resolution:'768P',duration:5}),
  task('succeeded',{content:{url:'https://media.example/result.mp4'},ratio:'16:9',resolution:['768P'],duration:5}),
  task('unknown'),{task:{id:'other',model:'MiniMax-H3-Max',status:'running'}},
  {task:{id:'task-1',model:'MiniMax-H3',status:'running'}},
  task('succeeded'),task('succeeded',{content:{url:'javascript:alert(1)'}}),
  task('succeeded',{content:{url:'https://media.example/result.mp4'},ratio:'16:10',resolution:'768P',duration:5}),
 ])('fails closed on malformed or mismatched task results',async body=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockResolvedValue(json(body));
  await expect(jobs.read('task-1')).rejects.toMatchObject({code:'invalid-response'});
 });
 it('does not turn read failure into a failed generation or retry it',async()=>{
  const {jobs,fetchImpl}=setup();fetchImpl.mockRejectedValue(Error(key));
  await expect(jobs.read('task-1')).rejects.toMatchObject({code:'query-unavailable'});expect(fetchImpl).toHaveBeenCalledTimes(1);
 });
 it('rejects a task identifier with path injection before transport',async()=>{
  const {jobs,fetchImpl}=setup();await expect(jobs.read('../task')).rejects.toThrow();expect(fetchImpl).not.toHaveBeenCalled();
 });
 it('has no cancel/delete shortcut or automatic live open',()=>{
  const {jobs}=setup();expect('cancel' in jobs).toBe(false);expect('delete' in jobs).toBe(false);expect('open' in jobs).toBe(false);
 });
});
