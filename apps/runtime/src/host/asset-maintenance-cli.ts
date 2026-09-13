import {isAbsolute} from 'node:path';
import type {Readable} from 'node:stream';
import {parseAssetMaintenanceInput} from '../application/asset-maintenance.js';
import {exchangeConnectionCode,maintainLocalAssets,revokeSession,type LocalEnvironment} from './index.js';

/** EOF-delimited one-time code only: 43 ASCII characters + optional LF/CRLF.
 * No unbounded line collector, argv secret, TTY echo helper or persistent credential. */
export function readMaintenanceCode(input:Readable,timeoutMs=10_000):Promise<string>{
 return new Promise((resolve,reject)=>{
  let bytes=Buffer.alloc(0),settled=false;
  const finish=(error?:Error)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   input.off('data',data);input.off('end',end);input.pause();
   if(error){bytes.fill(0);reject(Error('LOCAL_HOST_COMMAND_FAILED'));input.destroy();}
   else{
    const code=bytes.toString('utf8').replace(/\r?\n$/,'');bytes.fill(0);
    if(!/^[A-Za-z0-9_-]{43}$/.test(code)||Buffer.from(code,'base64url').toString('base64url')!==code)reject(Error('LOCAL_HOST_COMMAND_FAILED'));
    else resolve(code);
   }
  };
  const data=(chunk:Buffer|string)=>{
   const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
   if(bytes.length+value.length>45){finish(Error());return;}
   const next=Buffer.concat([bytes,value]);bytes.fill(0);bytes=next;
  };
  const end=()=>finish();const error=()=>finish(Error());
  const close=()=>{finish(Error());input.off('error',error);input.off('close',close);};
  const timer=setTimeout(error,timeoutMs);
  input.on('error',error);input.once('close',close);input.on('data',data);input.once('end',end);
  if(input.destroyed||input.readableEnded)finish(Error());
 });
}

export async function runAssetMaintenanceCLI(args:string[],input:Readable):Promise<void>{
 const values=new Map<string,string>();let apply=false;
 for(let i=0;i<args.length;i++){
  const key=args[i]!;
  if(key==='--apply'){if(apply)throw Error();apply=true;continue;}
  if(!['--directory','--environment','--dataset','--limit','--cursor'].includes(key)||values.has(key))throw Error();
  const value=args[++i];if(value===undefined||value.startsWith('--'))throw Error();values.set(key,value);
 }
 const directory=values.get('--directory'),environment=values.get('--environment'),limit=values.get('--limit');
 if(!directory||!isAbsolute(directory)||(environment!=='dev'&&environment!=='prod')||(limit!==undefined&&!/^[1-9][0-9]{0,2}$/.test(limit)))throw Error();
 const query=parseAssetMaintenanceInput({datasetId:values.get('--dataset')!,apply,...(limit===undefined?{}:{limit:Number(limit)}),...(values.has('--cursor')?{cursor:values.get('--cursor')!}:{})});
 const code=await readMaintenanceCode(input);
 const session=await exchangeConnectionCode(directory,environment as LocalEnvironment,code);
 let report;
 try{report=await maintainLocalAssets(directory,environment,session.token,query);}
 finally{await revokeSession(directory,environment,session.token);}
 // Publish only after successful revocation. Never stringify thrown objects or credentials.
 process.stdout.write(JSON.stringify(report)+'\n');
 if(report.items.some(item=>item.outcome==='error'))process.exitCode=2;
}
