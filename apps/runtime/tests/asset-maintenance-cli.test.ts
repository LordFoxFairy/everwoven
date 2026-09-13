import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {access,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {v7} from 'uuid';
import {issueConnectionCode,withLocalAssets} from '../src/host/index.js';
import {prepare,dispose,fixture,type Fixture} from './fixtures/host-assets/setup.js';
let f:Fixture;beforeAll(prepare,30000);afterAll(dispose);beforeEach(async()=>{f=await fixture();});afterEach(async()=>{await f.close();});
const cli=fileURLToPath(new URL('../src/host/cli.ts',import.meta.url)),tsx=createRequire(import.meta.url).resolve('tsx');
function child(args:string[],input:string){
 const proc=spawn(process.execPath,['--import',tsx,cli,...args],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';proc.stdout.on('data',c=>stdout+=c);proc.stderr.on('data',c=>stderr+=c);proc.stdin.on('error',()=>{});
 const timer=setTimeout(()=>proc.kill('SIGKILL'),15000);
 const end=new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{proc.on('error',reject);proc.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});});proc.stdin.end(input);return end;
}
function args(extra:string[]=[]){return ['maintain-assets','--directory',f.directory,'--environment','dev','--dataset',f.manifest.datasetId,...extra];}
const sessions=()=>readdir(join(f.directory,'security/sessions'));
async function candidate(){const upload=await withLocalAssets(f.directory,'dev',f.token,async s=>(await s.begin(f.input())).data);await f.database(db=>db.assetUpload.update({where:{id:upload.id},data:{status:'failed'}}));return upload;}
it('real connect stdout pipes one-time code to maintain preview, consumes code and revokes only temporary session',async()=>{
 await candidate();const before=await sessions();const connect=await child(['connect','--directory',f.directory,'--environment','dev'],'');expect(connect.code).toBe(0);
 const result=await child(args(),connect.stdout);expect(result.code).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout)).toMatchObject({mode:'preview',examined:1,items:[{outcome:'preview'}]});
 expect(result.stdout+result.stderr).not.toContain(connect.stdout.trim());expect(await sessions()).toEqual(before);await expect(access(f.assetsPath)).rejects.toMatchObject({code:'ENOENT'});
 const replay=await child(args(),connect.stdout);expect(replay).toEqual({code:1,stdout:'',stderr:'LOCAL_HOST_COMMAND_FAILED\n'});expect(await sessions()).toEqual(before);
});
it('apply runs only with flag, reports absent and a new process can retry deleting',async()=>{
 const upload=await candidate(),before=await sessions();
 for(let i=0;i<2;i++){
  const code=await issueConnectionCode(f.directory,'dev'),result=await child(args(['--apply']),code+'\n');expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({mode:'apply',items:[{uploadId:upload.id,outcome:'absent'}]});expect(result.stdout+result.stderr).not.toContain(code);expect(await sessions()).toEqual(before);
 }
});
it('dataset mismatch and cursor errors after exchange revoke the temporary session without public details',async()=>{
 const before=await sessions();
 for(const extra of [['--cursor','not-a-cursor'],[]]){
  const a=args(extra);if(extra.length===0)a[a.length-1]=v7();const code=await issueConnectionCode(f.directory,'dev');
  const result=await child(a,code);expect(result).toEqual({code:1,stdout:'',stderr:'LOCAL_HOST_COMMAND_FAILED\n'});expect(await sessions()).toEqual(before);
 }
 await expect(access(f.assetsPath)).rejects.toMatchObject({code:'ENOENT'});
});
it.each([['--token','PRIVATE'],['--apply','--apply'],['--limit','101'],['--limit','0'],['--limit','2junk']])('rejects invalid argv %s without echo or code exchange',async(...extra)=>{
 const before=await sessions(),code=await issueConnectionCode(f.directory,'dev');const result=await child(args(extra),code);
 expect(result).toEqual({code:1,stdout:'',stderr:'LOCAL_HOST_COMMAND_FAILED\n'});expect(await sessions()).toEqual(before);
 expect((await child(args(),code)).code).toBe(0);
});
it('requires expected dataset and rejects oversized/multiple stdin secrets without echo or session creation',async()=>{
 const before=await sessions(),code=await issueConnectionCode(f.directory,'dev');
 for(const input of [code+'\n'+code,code+'a'.repeat(4096),'',code+'\nextra']){
  const result=await child(args(),input);expect(result).toEqual({code:1,stdout:'',stderr:'LOCAL_HOST_COMMAND_FAILED\n'});expect(await sessions()).toEqual(before);
 }
 expect((await child(args().slice(0,-2),code)).code).toBe(1);expect((await child(args(),code)).code).toBe(0);
});
it('real CLI removes published failed bytes, then another process retries absent without touching receipts',async()=>{
 const upload=await withLocalAssets(f.directory,'dev',f.token,async s=>{const r=(await s.begin(f.input())).data;await s.process(f.query(r.id),{openBody:()=>new ReadableStream({start(c){c.enqueue(f.bytes);c.close();}})});return r;});
 await f.database(db=>db.assetUpload.update({where:{id:upload.id},data:{status:'failed'}}));
 for(const outcome of ['removed','absent']){
  const code=await issueConnectionCode(f.directory,'dev'),result=await child(args(['--apply']),code);expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).items).toEqual([{uploadId:upload.id,outcome}]);
 }
 await expect(access(f.candidate(upload.assetId))).rejects.toMatchObject({code:'ENOENT'});
 expect(await f.database(db=>db.commandReceipt.count())).toBe(1);
});
it('real CLI error occupies limit, exits 2, next page succeeds; cursor from another dataset rejects',async()=>{
 const a=await candidate(),b=await candidate();await f.database(async db=>{const r=await db.assetUpload.findUniqueOrThrow({where:{id:a.id}});await db.assetUpload.create({data:{...r,id:v7(),ownerId:v7()}});});
 const before=await sessions(),code=await issueConnectionCode(f.directory,'dev');const first=await child(args(['--apply','--limit','1']),code);
 expect(first.code).toBe(2);expect(first.stderr).toBe('');const page=JSON.parse(first.stdout);expect(page.examined).toBe(1);expect(page.items[0]).toEqual({uploadId:a.id,outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'});expect(await sessions()).toEqual(before);
 const second=await child(args(['--apply','--limit','1','--cursor',page.nextCursor]),await issueConnectionCode(f.directory,'dev'));
 expect(second.code).toBe(0);expect(JSON.parse(second.stdout).items).toEqual([{uploadId:b.id,outcome:'absent'}]);
 const other=await fixture();try{
  const result=await child(['maintain-assets','--directory',other.directory,'--environment','dev','--dataset',other.manifest.datasetId,'--cursor',page.nextCursor],await issueConnectionCode(other.directory,'dev'));
  expect(result).toEqual({code:1,stdout:'',stderr:'LOCAL_HOST_COMMAND_FAILED\n'});expect(await readdir(join(other.directory,'security/sessions'))).toHaveLength(1);
 }finally{await other.close();}
});
it('compiled-dist entrypoint uses the same default preview and ephemeral credential cleanup',async()=>{
 const before=await sessions(),code=await issueConnectionCode(f.directory,'dev');
 const proc=spawn(process.execPath,[fileURLToPath(new URL('../dist/host/cli.js',import.meta.url)),...args()],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';proc.stdout.on('data',c=>stdout+=c);proc.stderr.on('data',c=>stderr+=c);
 const exited=new Promise<number|null>((resolve,reject)=>{proc.on('error',reject);proc.on('close',resolve);});proc.stdin.end(code+'\r\n');
 expect(await exited).toBe(0);expect(stderr).toBe('');expect(JSON.parse(stdout)).toMatchObject({mode:'preview',examined:0});expect(stdout).not.toContain(code);expect(await sessions()).toEqual(before);
});

it('real stdin deadline exits without exchange and live process argv contains no code',async()=>{
 const before=await sessions(),code=await issueConnectionCode(f.directory,'dev');
 const proc=spawn(process.execPath,['--import',tsx,cli,...args()],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';proc.stdout.on('data',c=>stdout+=c);proc.stderr.on('data',c=>stderr+=c);proc.stdin.on('error',()=>{});
 const ended=new Promise<number|null>((resolve,reject)=>{proc.on('error',reject);proc.on('close',resolve);});
 const timeout=setTimeout(()=>proc.kill('SIGKILL'),14000);
 try{
  proc.stdin.write(code); // Deliberately no EOF; a code prefix is not a complete frame.
  const argv=execFileSync('ps',['-p',String(proc.pid),'-o','command='],{encoding:'utf8'});
  expect(argv).toContain('maintain-assets');expect(argv).not.toContain(code);
  expect(await ended).toBe(1);expect({stdout,stderr}).toEqual({stdout:'',stderr:'LOCAL_HOST_COMMAND_FAILED\n'});expect(await sessions()).toEqual(before);
  expect((await child(args(),code)).code).toBe(0);
 }finally{clearTimeout(timeout);if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');}
},20000);
