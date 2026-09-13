import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,chmod,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '@playwright/test';

/** Test-only fixture. Owns exactly one temporary host, browser and child server. */
export async function withLocalBrowser(work){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const port=Number(process.env.SMOKE_PORT??3199);
 assert(Number.isInteger(port)&&port>=1024&&port<=65535);
 const origin=`http://127.0.0.1:${port}`;
 try{await fetch(origin,{signal:AbortSignal.timeout(1000)});throw Error('Smoke port is occupied');}
 catch(error){if(error.message==='Smoke port is occupied')throw error;}
 const parent=await realpath(await mkdtemp(path.join(tmpdir(),'everwoven-character-browser-')));
 await chmod(parent,0o700);
 const directory=path.join(parent,'host');
 const env={...process.env,APP_ENV:'dev',RUNTIME_DATA_DIR:directory,APP_ORIGIN:origin,PORT:String(port),NEXT_TELEMETRY_DISABLED:'1'};
 let server,browser,page,output='';
 function cli(command){return execFileSync('pnpm',['--filter','runtime','exec','tsx','src/host/cli.ts',command,'--directory',directory,'--environment','dev'],{cwd:root,env,encoding:'utf8',timeout:90000}).trim();}
 async function start(){
  output='';server=spawn(process.execPath,['apps/web/scripts/local-start.mjs','--production'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',data=>{output+=data.toString();});server.stderr.on('data',data=>{output+=data.toString();});
  for(let i=0;i<120;i++){
   if(server.exitCode!==null)throw Error(`Local launcher exited: ${output}`);
   try{if((await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
   await delay(500);
  }
  throw Error(`Local launcher timed out: ${output}`);
 }
 async function stop(){
  const child=server;if(!child||child.exitCode!==null)return;
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),12000);const result=await exited;clearTimeout(timer);server=undefined;
  assert.deepEqual(result,{code:0,signal:null},'Local restart must shut down cleanly, not pass through the test SIGKILL watchdog');
 }
 try{
  cli('init');const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  await start();
  const document = await fetch(origin);
  assert.equal(document.headers.get('x-frame-options'), 'DENY');
  assert.equal(document.headers.get('content-security-policy'), "frame-ancestors 'none'");
  browser=await chromium.launch({...process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}});
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await work({page,origin,datasetId:manifest.datasetId,
   async restart(){await stop();await start();assert.equal(JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8')).datasetId,manifest.datasetId);},
  });
  assert.deepEqual(errors,[],'Browser JavaScript errors');
 }catch(error){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-12000));throw error;}
 finally{
  try{await browser?.close();}finally{try{await stop();}finally{await rm(parent,{recursive:true,force:true});}}
 }
}
