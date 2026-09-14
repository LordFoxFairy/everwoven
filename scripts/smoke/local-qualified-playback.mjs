import assert from 'node:assert/strict';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {expect} from '@playwright/test';
import {withLocalBrowser} from './local-browser-harness.mjs';
import {seedQualifiedScene} from './fixtures/qualified-scene.mjs';
import {openRuntimeDatabase} from '../../apps/runtime/dist/infrastructure/db/client.js';
const {v7}=createRequire(new URL('../../apps/runtime/package.json',import.meta.url))('uuid');
process.env.SMOKE_PORT??='3193';
await withLocalBrowser(async({page,origin,directory,restart})=>{
 const scene=await seedQualifiedScene(directory),writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST')writes.push(new URL(r.url()).pathname);});
 await page.goto(origin,{waitUntil:'networkidle'});await page.getByRole('status').filter({hasText:'已连接本机'}).waitFor();
 const forged=await page.request.post(`${origin}/api/trpc/generation.completePlayback`,{headers:{Origin:origin,'x-everwoven-request':'1'},data:{...scene,expectedExperienceRevision:2,commandId:v7()}});assert.equal(forged.status(),409);assert.equal((await forged.json()).error.message,'PLAYBACK_COVERAGE_INCOMPLETE');
 await page.getByRole('button',{name:'我的游玩',exact:true}).click();await page.getByRole('button',{name:'进入故事 完整播放与存档验收',exact:true}).click();
 await page.locator('video').waitFor();await page.locator('video').evaluate(async v=>{v.muted=true;try{await v.play();}catch(error){if(error.name!=='AbortError')throw error;}});
 await expect(page.getByText('你想如何回应？',{exact:true})).toBeVisible({timeout:20000});
 const db=await openRuntimeDatabase(join(directory,'runtime.db'));
 let snapshot;
 try{const points=await db.savepoint.findMany({where:{experienceId:scene.experienceId}});assert.equal(points.length,1);snapshot=await db.stateSnapshot.findUniqueOrThrow({where:{id:points[0].stateSnapshotId}});assert.equal(snapshot.state.sourceTurnId,scene.turnId);assert.equal(await db.playbackSession.count({where:{turnId:scene.turnId,status:'consumed'}}),1);}finally{await db.$disconnect();}
 await page.getByRole('button',{name:'自己回应',exact:true}).click();await page.getByLabel('说一句话，或描述你想做的事').fill('先把这一刻留住。');
 await expect.poll(async()=>{const db=await openRuntimeDatabase(join(directory,'runtime.db'));try{return(await db.responseDraft.findFirst({where:{experienceId:scene.experienceId,text:'先把这一刻留住。'}}))?.text;}finally{await db.$disconnect();}}).toBe('先把这一刻留住。');
 await restart();await page.reload({waitUntil:'networkidle'});await expect(page.getByLabel('说一句话，或描述你想做的事')).toHaveValue('先把这一刻留住。');
 const reopened=await openRuntimeDatabase(join(directory,'runtime.db'));try{assert.equal(await reopened.savepoint.count({where:{experienceId:scene.experienceId}}),1);assert.deepEqual(await reopened.stateSnapshot.findUniqueOrThrow({where:{id:snapshot.id}}),snapshot);}finally{await reopened.$disconnect();}
 assert(!writes.some(p=>/generation\.(quote|accept)$/.test(p)));assert.deepEqual(errors,[]);
 console.log('Original app + real host/SQLite/private MP4: bare ended rejected; server-timed playback, atomic snapshot/savepoint, response draft and process restart passed. Local media fixture, zero supplier calls.');
});
