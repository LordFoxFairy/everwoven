import assert from 'node:assert/strict';
import {join} from 'node:path';
import {expect} from '@playwright/test';
import {withLocalBrowser} from './local-browser-harness.mjs';
import {seedQualifiedScene} from './fixtures/qualified-scene.mjs';
import {openRuntimeDatabase} from '../../apps/runtime/dist/infrastructure/db/client.js';
process.env.SMOKE_PORT??='3192';
await withLocalBrowser(async({page,origin,directory,restart})=>{
 const scene=await seedQualifiedScene(directory),requests=[];
 page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname);});
 await page.goto(origin,{waitUntil:'networkidle'});await page.getByRole('status').filter({hasText:'已连接本机'}).waitFor();
 await page.getByRole('button',{name:'我的游玩',exact:true}).click();await page.getByRole('button',{name:'进入故事 完整播放与存档验收',exact:true}).click();
 await page.locator('video').waitFor();await page.locator('video').evaluate(async v=>{v.muted=true;try{await v.play();}catch(error){if(error.name!=='AbortError')throw error;}});
 await expect(page.getByText('你想如何回应？',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('button',{name:'自己回应',exact:true}).click();await page.getByLabel('说一句话，或描述你想做的事').fill('原路线的回应留在原处');
 await page.getByRole('button',{name:'故事足迹',exact:true}).click();
 await page.getByRole('button').filter({hasText:'本地测试画面，非模型内容。'}).click();
 await expect(page.locator('video')).toHaveCount(1);
 await page.getByRole('button',{name:'从这里另开路线',exact:true}).click();
 // Commit the real transaction, deliberately lose its response, then recover by GET after restart.
 await page.route('**/api/trpc/history.fork',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
 await page.getByRole('button',{name:'创建新路线',exact:true}).click();await expect(page.getByRole('button',{name:'核对原分支',exact:true})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('结果待核对');
 const before=await openRuntimeDatabase(join(directory,'runtime.db'));let child,base;
 try{const origins=await before.experienceFork.findMany();assert.equal(origins.length,1);child=origins[0].id;base=origins[0].initialSavepointId;const point=await before.savepoint.findUniqueOrThrow({where:{sourceTurnId:scene.turnId}});assert.equal((await before.responseDraft.findFirstOrThrow({where:{experienceId:scene.experienceId,interactionEventId:point.interactionEventId}})).text,'原路线的回应留在原处');await before.experience.update({where:{id:scene.experienceId},data:{deletedAt:new Date()}});assert.equal(await before.generationTurn.count({where:{experienceId:child}}),0);}finally{await before.$disconnect();}
 await restart();await page.reload({waitUntil:'networkidle'});
 await expect(page.getByRole('button',{name:'核对原分支',exact:true})).toBeVisible();assert.equal(requests.filter(x=>x.endsWith('/history.fork')).length,1);
 await page.getByRole('button',{name:'核对原分支',exact:true}).click();await expect(page.getByRole('button',{name:'从这里继续',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'从这里继续',exact:true}).click();await expect(page.getByText('你想如何回应？',{exact:true})).toBeVisible();
 await expect(page.locator('video')).toHaveCount(1);
 const after=await openRuntimeDatabase(join(directory,'runtime.db'));
 try{assert.equal(await after.experienceFork.count(),1);assert.equal((await after.experience.findUniqueOrThrow({where:{id:child}})).status,'awaiting');assert.equal((await after.savepoint.findUniqueOrThrow({where:{id:base}})).kind,'fork_base');assert.equal(await after.generationTurn.count({where:{experienceId:child}}),0);assert.equal(await after.budgetScope.count(),1);}finally{await after.$disconnect();}
 assert(!requests.some(x=>/generation\.(quote|accept)$/.test(x)));
 console.log('Original UI + real Host/SQLite: natural video -> history on same video -> independent fork -> lost response -> process restart -> read-only original receipt recovery -> explicit child resume; source draft preserved, shared budget, zero model calls.');
});
