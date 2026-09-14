import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {prepare,dispose} from './fixtures/story-aggregate/setup.js';
import {setup} from './fixtures/generation/setup.js';
import {createPlaybackSessions} from '../src/application/playback-sessions.js';
import {createGenerationPlayback} from '../src/application/generation-playback.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
beforeAll(prepare);afterAll(dispose);
async function readyFixture(){
 const f=await setup(),quote=await f.generation.quote(f.quoteInput),turn=await f.generation.accept(f.acceptInput(quote.data.id));
 const media={id:v7(),sha256:'a'.repeat(64),byteSize:'1000',duration:5,durationMs:5000,width:1366,height:768,codec:'h264',mimeType:'video/mp4'};
 const result={summary:'两人在雨后的天台说话。',choices:[{id:'ask',title:'问候',text:'你好'},{id:'look',title:'看向天空',text:'我抬头看向天空'}]};
 await f.db.generationTurn.update({where:{id:turn.data.id},data:{status:'ready',media,result}});
 await f.db.experience.update({where:{id:f.opening.id},data:{status:'playing',schedulingPaused:true}});
 const verify=vi.fn(async()=>{}),playback=createPlaybackSessions(f.db,f.owner,f.authority,f.services,verify);
 const input={...f.protocol,experienceId:f.opening.id,turnId:turn.data.id,mediaId:media.id,expectedExperienceRevision:2,commandId:v7()};
 return {...f,media,result,verify,playback,input,turn:turn.data};
}
it('verifies the private file before issuing a session; reading or bare ended creates no savepoint',async()=>{
 const f=await readyFixture();try{
  await f.generation.get({...f.protocol,experienceId:f.opening.id});expect(await f.db.playbackSession.count()).toBe(0);
  await expect(f.generation.completePlayback(f.input)).rejects.toThrow('PLAYBACK_COVERAGE_INCOMPLETE');expect(await f.db.savepoint.count()).toBe(0);
  f.verify.mockRejectedValueOnce(Error('PRIVATE_VIDEO_HASH_MISMATCH'));await expect(f.playback.beginPlayback(f.input)).rejects.toThrow('PRIVATE_VIDEO_HASH_MISMATCH');expect(await f.db.playbackSession.count()).toBe(0);
  const session=await f.playback.beginPlayback(f.input);expect(f.verify).toHaveBeenCalledWith(f.media);expect(session).toMatchObject({coveredMs:0,sequence:0,status:'active'});
  expect(await f.playback.beginPlayback(f.input)).toEqual(session);expect(await f.db.playbackSession.count()).toBe(1);
 }finally{await f.close();}
});
it('rejects instant-end, wrong owner/dataset/media, sequence gaps and clock rollback without increasing coverage',async()=>{
 const f=await readyFixture();try{
  const session=await f.playback.beginPlayback(f.input),progress={...f.protocol,experienceId:f.opening.id,playbackSessionId:session.id,commandId:v7(),sequence:1,positionMs:5000,coveredMs:5000};
  await expect(f.playback.reportPlayback(progress)).rejects.toThrow('PLAYBACK_COVERAGE_INCOMPLETE');
  f.tick(1000);await expect(f.playback.reportPlayback({...progress,sequence:2,positionMs:1000,coveredMs:1000})).rejects.toThrow('PLAYBACK_PROGRESS_CONFLICT');
  await expect(f.playback.reportPlayback({...progress,datasetId:v7()})).rejects.toThrow('DATASET_CHANGED');
  await expect(f.playback.reportPlayback({...progress,playbackSessionId:v7()})).rejects.toThrow('PLAYBACK_SESSION_UNAVAILABLE');
  const valid={...progress,positionMs:1000,coveredMs:1000};const first=await f.playback.reportPlayback(valid);expect(first.coveredMs).toBe(1000);
  expect(await f.playback.reportPlayback(valid)).toEqual(first);
  await expect(f.playback.reportPlayback({...valid,coveredMs:1100})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  f.tick(-100);await expect(f.playback.reportPlayback({...valid,commandId:v7(),sequence:2})).rejects.toThrow('PLAYBACK_COVERAGE_INCOMPLETE');
  expect((await f.db.playbackSession.findUniqueOrThrow({where:{id:session.id}})).coveredMs).toBe(1000);
 }finally{await f.close();}
});
it('consumes complete evidence and writes snapshot, savepoint, decision and original receipt atomically once',async()=>{
 const f=await readyFixture();try{
  await f.view(f.input);const result=await f.generation.completePlayback(f.input);
  const points=await f.db.savepoint.findMany();expect(points).toHaveLength(1);expect(points[0]).toMatchObject({ownerId:f.owner.ownerId,sourceTurnId:f.turn.id,kind:'played_segment',parentSavepointId:null,interactionEventId:result.data.interaction!.id});
  const snapshot=await f.db.stateSnapshot.findUniqueOrThrow({where:{id:points[0]!.stateSnapshotId}});expect(snapshot.state).toMatchObject({storyVersionId:f.opening.story.id,sourceTurnId:f.turn.id,media:f.media,result:f.result});
  expect(await f.generation.completePlayback(f.input)).toEqual({...result,replayed:true});expect(await f.db.stateSnapshot.count()).toBe(1);
  expect((await f.db.playbackSession.findUniqueOrThrow({where:{id:points[0]!.playbackSessionId!}})).status).toBe('consumed');
 }finally{await f.close();}
});
it('accepts valid coverage when network jitter bunches successive progress reports together',async()=>{
 const f=await readyFixture();try{
  const session=await f.playback.beginPlayback(f.input),base={...f.protocol,experienceId:f.opening.id,playbackSessionId:session.id};
  f.tick(1900);await f.playback.reportPlayback({...base,commandId:v7(),sequence:1,positionMs:1000,coveredMs:1000});
  f.tick(200);expect(await f.playback.reportPlayback({...base,commandId:v7(),sequence:2,positionMs:2000,coveredMs:2000})).toMatchObject({coveredMs:2000,status:'active'});
  f.tick(2900);expect(await f.playback.reportPlayback({...base,commandId:v7(),sequence:3,positionMs:5000,coveredMs:5000})).toMatchObject({status:'complete'});
  expect((await f.generation.completePlayback({...f.input,commandId:v7()})).data.status).toBe('awaiting');
 }finally{await f.close();}
});
it('rolls all playback facts back if snapshot insertion fails',async()=>{
 const f=await readyFixture();try{
  await f.view(f.input);const occupied=v7(),now=f.services.clock.now();await f.db.stateSnapshot.create({data:{id:occupied,ownerId:f.owner.ownerId,datasetId:f.owner.datasetId,state:{},contentHash:'a'.repeat(64),createdAt:now}});
  const ids=[v7(),occupied];const service=createGenerationPlayback(f.db,f.owner,f.authority,{...f.services,ids:{next:()=>ids.shift()??v7()}});
  await expect(service.completePlayback(f.input)).rejects.toThrow();expect(await f.db.savepoint.count()).toBe(0);expect((await f.generation.get({...f.protocol,experienceId:f.opening.id})).status).toBe('playing');
  expect(await f.db.interactionEvent.count({where:{kind:'decision'}})).toBe(0);expect(await f.db.playbackSession.count({where:{status:'complete'}})).toBe(1);
 }finally{await f.close();}
});
it('resumes progress after SQLite reopen and keeps the media/scope evidence bound',async()=>{
 const f=await readyFixture();let db;try{
  const start=await f.playback.beginPlayback(f.input);f.tick(2000);await f.playback.reportPlayback({...f.protocol,experienceId:f.opening.id,playbackSessionId:start.id,commandId:v7(),sequence:1,positionMs:2000,coveredMs:2000});
  const files=await f.db.$queryRawUnsafe<Array<{file:string}>>('PRAGMA database_list');await f.db.$disconnect();db=await openRuntimeDatabase(files[0]!.file);
  const sessions=createPlaybackSessions(db,f.owner,f.authority,f.services);f.tick(3000);const complete=await sessions.reportPlayback({...f.protocol,experienceId:f.opening.id,playbackSessionId:start.id,commandId:v7(),sequence:2,positionMs:5000,coveredMs:5000});expect(complete.status).toBe('complete');
  const result=await createGenerationPlayback(db,f.owner,f.authority,f.services).completePlayback({...f.input,commandId:v7()});expect(result.data.status).toBe('awaiting');expect(await db.savepoint.count()).toBe(1);
 }finally{await db?.$disconnect();await f.close();}
});
