import {isDeepStrictEqual} from 'node:util';
import type {Prisma,Experience} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {currentGenerationTurn} from './generation-current.js';
import {readInputScene,readForkBase} from './saved-scene.js';
export async function currentResponseInput(tx:Prisma.TransactionClient,owner:InternalOwnerContext,root:Experience,eventId:string){
 if(root.status!=='awaiting'||!root.schedulingPaused)throw Error('GENERATION_NOT_AWAITING');
 const event=await tx.interactionEvent.findFirst({where:{id:eventId,ownerId:owner.ownerId,experienceId:root.id,kind:'decision',experienceRevision:root.revision,schemaVersion:1}});
 if(!event)throw Error('GENERATION_NOT_AWAITING');
 const parent=await currentGenerationTurn(tx,owner.datasetId,root);
 const point=parent?await tx.savepoint.findUnique({where:{sourceTurnId:parent.id}}):(await readForkBase(tx,owner,root)).base;
 if((parent&&parent.status!=='viewed')||!point||point.interactionEventId!==event.id)throw Error('GENERATION_NOT_AWAITING');
 const scene=await readInputScene(tx,owner,root,point.id);
 if(point.kind==='fork_base'&&!isDeepStrictEqual((event.options as Array<{title:string;text:string}>).map(({title,text})=>({title,text})),scene.state.result.choices.map(({title,text})=>({title,text}))))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 return{...scene,parentTurnId:parent?.id??null};
}
