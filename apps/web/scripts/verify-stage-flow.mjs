import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test'),{v7}=createRequire(new URL('../package.json',import.meta.url))('uuid');
const origin='http://127.0.0.1:3100',experienceId=v7(),profileId=v7(),storyId=v7();let datasetId,turnId,mediaId,interactionId,quotes=0,accepts=0,acks=0,draftRevision=1,draft='',current='preparing',revision=1,quote;
const fixtureDirectory=await mkdtemp(join(tmpdir(),'everwoven-stage-browser-')),moviePath=join(fixtureDirectory,'fixture.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=960x540:rate=24','-t','5','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',moviePath]);
const movie=await readFile(moviePath);
const browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const projection=()=>({protocolVersion:1,datasetId,experienceId,title:'浏览器流程验收',revision,status:current,turn:current==='preparing'?null:{id:turnId,status:{generating:'queued',playing:'ready',awaiting:'viewed'}[current],media:current==='generating'?null:{id:mediaId,duration:5},errorCode:null},interaction:current==='awaiting'?{id:interactionId,summary:'你们看向天空。',choices:[{id:'ask',title:'问问对方',text:'你在想什么？'},{id:'look',title:'一起看看',text:'我看向天空。'}]}:null});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const ok=data=>route.fulfill({json:{result:{data}},headers:{'cache-control':'no-store'}});
  if(path.includes('/local-generation-media/')){
   const match=/bytes=(\d+)-(\d*)/.exec(request.headers()['range']||'');
   if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),movie.length-1):movie.length-1;await route.fulfill({status:206,body:movie.subarray(start,end+1),headers:{'content-type':'video/mp4','accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${movie.length}`}});}else await route.fulfill({body:movie,contentType:'video/mp4'});return;
  }
  if(path==='/api/trpc/openings.list'){
   datasetId=JSON.parse(url.searchParams.get('input')).datasetId;
   return ok({protocolVersion:1,datasetId,nextCursor:null,items:[{id:experienceId,storyVersionId:storyId,title:'浏览器流程验收',sourceRevision:1,status:current,schedulingPaused:current!=='generating',modelId:'fixture-video',region:'cn',budget:{limitMicros:'1000000',currency:'USD'},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]});
  }
  if(path.startsWith('/api/trpc/generation.')){
   const action=path.split('.').at(-1),input=request.method()==='GET'?JSON.parse(url.searchParams.get('input')):request.postDataJSON();
   if(action==='get')return ok(projection());
   if(action==='getDraft')return ok({...input,text:draft,revision:draftRevision});
   if(action==='saveDraft'){draft=input.text;draftRevision=input.expectedDraftRevision+1;return ok({protocolVersion:1,datasetId,experienceId,interactionEventId:interactionId,text:draft,revision:draftRevision});}
   if(action==='quote'){quotes++;quote={protocolVersion:1,datasetId,experienceId,id:v7(),experienceRevision:revision,profileId,maxCostMicros:'10000',currency:'USD',expiresAt:new Date(Date.now()+300000).toISOString(),createdAt:new Date().toISOString(),summary:{title:'浏览器流程验收',prompt:input.text||'在用户设定的世界相遇',modelId:'fixture-video',region:'cn',duration:5,resolution:'768P',ratio:'16:9',audio:'silent',inputAssetIds:[]}};return ok({data:quote,replayed:false});}
   if(action==='getQuote')return ok({quote,acceptedTurnId:current==='preparing'?null:turnId});
   if(action==='accept'){accepts++;current='generating';revision++;turnId=v7();mediaId=v7();return ok({data:{protocolVersion:1,datasetId,experienceId,id:turnId,quoteId:quote.id,status:'queued',createdAt:new Date().toISOString()},replayed:false});}
   if(action==='completePlayback'){acks++;current='awaiting';revision++;interactionId=v7();draft='';draftRevision=1;return ok({data:projection(),replayed:false});}
   throw Error('Unexpected generation method '+action);
  }
  if(request.method()==='POST'&&path!=='/api/local-session')throw Error('Unexpected business write '+path);
  return route.continue();
 });
 await page.goto(origin,{waitUntil:'networkidle'});await expect(page.getByRole('status').filter({hasText:'已连接本机'})).toBeVisible();
 await page.getByRole('button',{name:'我的游玩',exact:true}).click();await page.getByRole('button',{name:'进入故事 浏览器流程验收',exact:true}).click();
 await expect(page.getByText('故事已准备好',{exact:true})).toBeVisible();assert.equal(accepts,0);
 await page.getByRole('button',{name:'查看生成费用',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();assert.equal(accepts,0);
 await page.getByRole('button',{name:'确认并生成',exact:true}).click();await expect(page.getByText('下一幕正在生成',{exact:true})).toBeVisible();assert.equal(accepts,1);
 assert.equal(await page.locator('textarea').count(),0);await page.reload({waitUntil:'networkidle'});await expect(page.getByText('下一幕正在生成',{exact:true})).toBeVisible();assert.equal(accepts,1);
 current='playing';await expect(page.locator('video')).toBeVisible({timeout:10000});assert.equal(await page.getByRole('region',{name:'这一刻的回应'}).count(),0);
 await page.locator('video').evaluate(v=>v.play());await expect(page.getByText('你想如何回应？',{exact:true})).toBeVisible({timeout:10000});assert.equal(acks,1);
 const bounds=await page.getByRole('main',{name:'分段互动现场'}).boundingBox();assert.equal(bounds.width,1440);assert.equal(bounds.height,900);assert.equal(await page.locator('video').count(),1);
 await page.getByRole('button',{name:'自己回应',exact:true}).click();await page.getByLabel('说一句话，或描述你想做的事').fill('我想先听听你的故事。');
 await expect.poll(()=>draft).toBe('我想先听听你的故事。');await page.reload({waitUntil:'networkidle'});
 await expect(page.getByLabel('说一句话，或描述你想做的事')).toHaveValue('我想先听听你的故事。');assert.equal(accepts,1);
 await page.getByRole('button',{name:'回应并继续',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();assert.equal(accepts,1);
 await page.getByRole('button',{name:'确认并生成',exact:true}).click();await expect(page.getByText('下一幕正在生成',{exact:true})).toBeVisible();assert.equal(accepts,2);assert.equal(quotes,2);
 assert.deepEqual(errors,[]);
 await page.request.delete(`${origin}/api/local-session`,{headers:{Origin:origin,'x-everwoven-request':'1'}});
 console.log('PASS original 3100: start, quote, explicit accept, reload without resend, natural MP4 playback, choices only after ended, persisted response restore, second scene; one viewport-sized video. Browser-only fixtures; no user business writes or paid API calls.');
}finally{await browser.close();await rm(fixtureDirectory,{recursive:true,force:true});}
