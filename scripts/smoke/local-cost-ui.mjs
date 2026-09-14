import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {withLocalBrowser} from './local-browser-harness.mjs';
import {seedQualifiedScene} from './fixtures/qualified-scene.mjs';
process.env.SMOKE_PORT??='3191';
await withLocalBrowser(async({page,origin,directory,restart})=>{
 const scene=await seedQualifiedScene(directory,{costEvidence:true}),writes=[];
 page.on('request',request=>{if(request.method()==='POST')writes.push(new URL(request.url()).pathname);});
 await page.goto(origin,{waitUntil:'networkidle'});await page.getByRole('status').filter({hasText:'已连接本机'}).waitFor();
 await page.getByRole('button',{name:'我的游玩',exact:true}).click();await page.getByRole('button',{name:'进入故事 完整播放与存档验收',exact:true}).click();
 await page.locator('video').evaluate(async video=>{video.muted=true;try{await video.play();}catch(error){if(error.name!=='AbortError')throw error;}});
 await expect(page.getByText('你想如何回应？',{exact:true})).toBeVisible({timeout:20000});
 async function inspect(){await page.getByRole('button',{name:'本幕费用',exact:true}).click();const panel=page.getByRole('dialog',{name:'本幕费用',exact:true});await expect(panel.getByText('本幕已结算',{exact:true})).toBeVisible();await expect(panel).toContainText('已结算 USD 0.000562 · 仍预留 USD 0.000000');await expect(panel).toContainText('按供应商用量与原费率核算');await expect(page.locator('video')).toHaveCount(1);await panel.getByRole('button',{name:'收起费用'}).click();}
 await inspect();
 const headers={Origin:origin,'x-everwoven-request':'1'},url=origin+'/api/trpc/generation.cost?input='+encodeURIComponent(JSON.stringify({protocolVersion:1,datasetId:scene.datasetId,experienceId:scene.experienceId,turnId:scene.turnId}));
 const before=await(await page.request.get(url,{headers})).json();assert.equal(before.result.data.settledMicros,'562');
 await restart();await page.reload({waitUntil:'networkidle'});await inspect();
 const after=await(await page.request.get(url,{headers})).json();assert.deepEqual(after,before);
 assert(!writes.some(path=>/generation\.(quote|accept)$/.test(path)));
 console.log('Actual worker and SQLite settlement -> original single-video stage -> read-only cost disclosure -> process restart -> identical persisted costs; test transport only, zero paid calls.');
});
