import {writeFileSync} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {openRuntimeDatabase} from '../../../src/infrastructure/db/client.js';
import {createAssetCleanupCoordinator} from '../../../src/infrastructure/db/prisma-asset-cleanup-coordinator.js';
import {createPrivateAssetStore} from '../../../src/infrastructure/media/private-asset-store.js';
import {issueDeletionPermitForDeleting} from '../../../src/infrastructure/media/private-asset-deletion.js';
const c=JSON.parse(process.argv[2]!) as {dbPath:string;host:string;ownerId:string;datasetId:string;assetId:string;mode:string;tag:string;control:string};
const mark=(event:string)=>writeFileSync(join(c.control,`${c.tag}-${event}.json`),JSON.stringify({time:Date.now()}),{mode:0o600});
const db=await openRuntimeDatabase(c.dbPath),binding={ownerId:c.ownerId,datasetId:c.datasetId};
const coordinator=createAssetCleanupCoordinator(db,binding);
const store=await createPrivateAssetStore({target:{directory:c.host,parent:dirname(c.host),parentIdentity:await lstat(dirname(c.host))},identity:await lstat(c.host),manifest:{...binding,version:1,environment:'dev',createdAt:'2026-09-12T00:00:00.000Z'}},binding,{runExclusive:(scope,work)=>coordinator.runExclusive(scope,()=>{mark('critical-entered');const result=work();mark('finished');return result;})},{cleanupCheckpoint:phase=>{
 mark(phase);
 if(c.mode===phase)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);
 if(c.mode==='slow'&&phase==='before-unlink'){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3400);}
}});
process.send?.({event:'ready'});await new Promise(resolve=>process.once('message',resolve));
for(let attempt=0;attempt<60;attempt++){
 try {const result=await store.removeDeletingCandidate(c.assetId,issueDeletionPermitForDeleting({...binding,assetId:c.assetId,status:'deleting'}));process.send?.({event:'done',result});break;}
 catch(error){const code=error instanceof Error?error.message:'UNKNOWN';process.send?.({event:'busy',code});if(c.mode!=='retry')break;await new Promise(r=>setTimeout(r,100));}
}
await db.$disconnect();process.disconnect();
