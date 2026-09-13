import assert from 'node:assert/strict';
import {withLocalBrowser,fillConnectionCode} from './local-browser-harness.mjs';

await withLocalBrowser(async({page,origin,datasetId,connectionCode,restart})=>{
 page.setDefaultTimeout(15000);
 const writes=new Map(),boundaryErrors=[];
 page.on('request',request=>{
  if(request.method()!=='POST')return;
  const url=new URL(request.url()),names=url.pathname.split('/api/trpc/')[1]?.split(',')??[];
  try{
   const body=request.postDataJSON();
   names.forEach((name,index)=>{
    if(!/^characters\.(create|update|delete|restore)$/.test(name))return;
    const input=url.searchParams.get('batch')==='1'?body[String(index)]:body;
    assert.equal(input.datasetId,datasetId);
    const key=input.commandId,payload=JSON.stringify(input);
    if(writes.has(key))assert.equal(writes.get(key),payload,'Confirmation must replay an immutable command');
    writes.set(key,payload);
   });
  }catch(error){boundaryErrors.push(error.message);}
 });
 const read=async(q)=>{
  const response=await page.request.get(`${origin}/api/trpc/characters.list?input=${encodeURIComponent(JSON.stringify({q}))}`,{headers:{'x-everwoven-request':'1'}});
  assert.equal(response.status(),200);return (await response.json()).result.data;
 };
 async function clickMutation(button,operation){
  const pending=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes(`/api/trpc/characters.${operation}`));
  const [,response]=await Promise.all([button.click(),pending]);assert.equal(response.status(),200);
  const payload=await response.json();return (Array.isArray(payload)?payload[0]:payload).result.data;
 }
 // Formal authoring must work even when the browser refuses all persistent storage.
 await page.addInitScript(()=>{
  Storage.prototype.getItem=function(){throw Error('test storage unavailable');};
  Storage.prototype.setItem=function(){throw Error('test storage unavailable');};
  IDBFactory.prototype.open=function(){throw Error('test IndexedDB unavailable');};
 });
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'角色库',exact:true}).click();
 await fillConnectionCode(page.getByLabel('本机连接码',{exact:true}),connectionCode);
 await page.getByRole('button',{name:'连接本机',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已连接本机'}).waitFor();
 await page.getByRole('button',{name:'创建角色',exact:true}).click();
 const name='原角色页完整验收';
 await page.getByLabel('角色姓名').fill(name);
 const created=await clickMutation(page.getByRole('button',{name:'保存角色模板',exact:true}),'create');
 assert.equal(created.data.name,name);assert.equal(created.data.settings.personality,'');
 const expected={personality:'记得所有未寄出的信',appearance:'蓝白衬衫，短发',speakingStyle:'慢慢说，先听你说完',boundaries:'不替玩家做决定'};
 for(const [label,key] of [['性格与背景','personality'],['外貌与穿着','appearance'],['表达习惯','speakingStyle'],['相处边界','boundaries']])await page.getByRole('textbox',{name:label,exact:true}).fill(expected[key]);
 const updated=await clickMutation(page.getByRole('button',{name:'保存角色模板',exact:true}),'update');
 assert.equal(updated.data.id,created.data.id);assert.deepEqual(updated.data.settings,expected);
 const deleted=await clickMutation(page.getByRole('button',{name:'删除角色',exact:true}),'delete');assert(deleted.data.deletedAt);
 const restored=await clickMutation(page.getByRole('button',{name:'恢复角色',exact:true}),'restore');assert.equal(restored.data.deletedAt,null);assert.equal(restored.data.revision,4);
 await page.getByRole('button',{name:'创建角色',exact:true}).click();
 await page.getByLabel('角色姓名').fill('未知角色 A');
 let lostId;
 await page.route('**/api/trpc/characters.create*',async route=>{
  const response=await route.fetch();assert.equal(response.status(),200);
  const body=await response.json();lostId=(Array.isArray(body)?body[0]:body).result.data.data.id;
  await route.abort('failed');
 },{times:1});
 await page.getByRole('button',{name:'保存角色模板',exact:true}).click();
 await page.getByRole('button',{name:'确认上次角色命令',exact:true}).waitFor();
 await page.getByLabel('角色姓名').fill('未知角色 B');
 // A later confirmation can be rejected before receipt lookup. That rejection
 // must not erase the original command whose server-side commit was observed.
 await page.route('**/api/trpc/characters.create*',route=>{
  const envelope={error:{message:'INVALID_CHARACTER_COMMAND',code:-32600,data:{code:'BAD_REQUEST',httpStatus:400}}};
  return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).searchParams.get('batch')==='1'?[envelope]:envelope)});
 },{times:1});
 const rejected=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes('/api/trpc/characters.create'));
 const [,rejection]=await Promise.all([page.getByRole('button',{name:'确认上次角色命令',exact:true}).click(),rejected]);
 assert.equal(rejection.status(),400);
 const confirmed=await clickMutation(page.getByRole('button',{name:'确认上次角色命令',exact:true}),'create');
 assert.equal(confirmed.replayed,true);assert.equal(confirmed.data.id,lostId);
 assert.equal(await page.getByLabel('角色姓名').inputValue(),'未知角色 B');
 const savedB=await clickMutation(page.getByRole('button',{name:'保存角色模板',exact:true}),'update');assert.equal(savedB.data.id,lostId);
 const one=await read('未知角色');assert.equal(one.totalMatching,1);assert.equal(one.items[0].name,'未知角色 B');
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'角色库',exact:true}).click();
 const afterReload=await read(name);assert.equal(afterReload.totalMatching,1);assert.deepEqual(afterReload.items[0].settings,expected);
 await restart();await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'角色库',exact:true}).click();
 const afterRestart=await read(name);assert.equal(afterRestart.totalMatching,1);assert.deepEqual(afterRestart.items[0].settings,expected);
 await page.getByRole('button',{name:`编辑 ${name}`,exact:true}).click();
 for(const [label,key] of [['性格与背景','personality'],['外貌与穿着','appearance'],['表达习惯','speakingStyle'],['相处边界','boundaries']])assert.equal(await page.getByRole('textbox',{name:label,exact:true}).inputValue(),expected[key]);
 assert.equal(await page.getByLabel('选择角色参考',{exact:true}).count(),1,'Original formal role exposes the authenticated asset picker; IndexedDB remains disabled');
 if(process.env.SMOKE_SCREENSHOT)await page.screenshot({path:process.env.SMOKE_SCREENSHOT,fullPage:true});
 assert.deepEqual(boundaryErrors,[]);assert(writes.size>=6);
 console.log('Original character library smoke passed: direct host connection, name-only draft, all-field update, delete/restore, lost-response and pre-receipt 400 immutable replay, preserved newer input, unavailable browser storage, refresh and process restart. No model calls.');
});
