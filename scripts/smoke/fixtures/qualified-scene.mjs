// Only used with withLocalBrowser's disposable host. No supplier credentials or requests.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {validatedHost} from '../../../apps/runtime/dist/host/storage.js';
import {acquireLocalStoreAuthority} from '../../../apps/runtime/dist/host/store-epoch.js';
import {openRuntimeDatabase} from '../../../apps/runtime/dist/infrastructure/db/client.js';
import {createStoryDraftService} from '../../../apps/runtime/dist/composition/story-draft-service.js';
import {createExperienceOpeningService} from '../../../apps/runtime/dist/composition/experience-opening-service.js';
import {createVideoBindingRegistry} from '../../../apps/runtime/dist/application/video-binding-registry.js';
import {createGenerationService,generationBindingHash} from '../../../apps/runtime/dist/application/generation.js';
import {parseExecutionProfile} from '../../../apps/runtime/dist/contracts/execution-profile.js';
import {createPrivateVideoStore} from '../../../apps/runtime/dist/infrastructure/media/private-video-store.js';
import {createVideoProbe} from '../../../apps/runtime/dist/infrastructure/media/video-probe.js';
import {sceneArtifacts} from '../../../apps/runtime/dist/application/scene-artifacts.js';
const {v7}=createRequire(new URL('../../../apps/runtime/package.json',import.meta.url))('uuid');
export async function seedQualifiedScene(directory){
 if(!directory.includes('everwoven-character-browser-'))throw Error('Disposable host required');
 const host=await validatedHost(directory,'dev'),owner={ownerId:host.manifest.ownerId,datasetId:host.manifest.datasetId},protocol={protocolVersion:1,datasetId:owner.datasetId};
 const db=await openRuntimeDatabase(join(directory,'runtime.db'));
 try{
  const story=(await createStoryDraftService(db).create(owner,{...protocol,commandId:v7(),title:'完整播放与存档验收',settings:{world:'雨后的窗边',opening:'两人望向天空',genre:'',tone:'',playerRole:'',worldRules:[]},mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}})).data;
  const registry=createVideoBindingRegistry({schemaVersion:1,connections:[{id:'fixture',providerId:'minimax',region:'cn',accountScopeId:'test',credentialRef:'env:TEST_ONLY'}],bindings:[{bindingKey:'video',versionNo:1,connectionId:'fixture',catalogId:'minimax-h3-max',operationKind:'text-to-video',generation:{duration:5,resolution:'768P',ratio:'16:9'}}]});
  const opening=(await createExperienceOpeningService(db,registry).create(owner,{...protocol,commandId:v7(),storyDraftId:story.id,expectedStoryRevision:1,bindingKey:'video',expectedBindingVersion:1,budget:{currency:'USD',limitMicros:'1000000'}})).data;
  const video=registry.resolve(owner,{bindingKey:'video',versionNo:1}),artifacts=sceneArtifacts();
  const text=key=>({...video,bindingKey:key,modelId:'fixture-text',mode:'text',parameters:{...video.parameters,catalogId:'fixture-text',operationKind:'structured-generation',protocolVersion:'text-v1',generation:{inputModalities:['text','image'],maxInputTokens:4096,maxOutputTokens:1024,temperature:.5}}});
  const profile=parseExecutionProfile({schemaVersion:1,ownerId:owner.ownerId,profileKey:'fixture',versionNo:1,currency:'USD',graph:artifacts.graph,
   planner:{binding:text('planner'),...artifacts.planner,maxCalls:1,maxCostMicros:'100000'},video:{binding:video,maxCalls:1,maxCostMicros:'100000'},validator:{binding:text('validator'),...artifacts.validator,maxCalls:1,maxCostMicros:'100000'}});
  const price=binding=>({version:'fixture-only',bindingHash:generationBindingHash(binding),validUntil:new Date(Date.now()+3600000).toISOString(),currency:'USD',inputTokenMicros:'1',outputTokenMicros:'1',perTokens:'1',outputSecondMicros:'100',inputImageMicros:'5',complete:true,adapterReady:true});
  const generation=createGenerationService(db,owner,await acquireLocalStoreAuthority(directory,'dev'),{assertDispatch(){},resolve(){return{profile,prices:{planner:price(profile.planner.binding),video:price(video),validator:price(profile.validator.binding)},audio:'silent',artifactsReady:true,validatorImageLimit:3};}});
  const quote=await generation.quote({...protocol,experienceId:opening.id,commandId:v7(),expectedExperienceRevision:1,kind:'opening'});
  const turn=(await generation.accept({...protocol,experienceId:opening.id,commandId:v7(),expectedExperienceRevision:1,quoteId:quote.data.id,consent:true})).data;
  const filename=join(host.target.parent,'qualified-fixture.mp4');execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=skyblue:s=1366x768:r=24:d=5','-c:v','libx264','-pix_fmt','yuv420p',filename],{timeout:15000,stdio:'pipe'});
  const bytes=await readFile(filename),files=await createPrivateVideoStore(host,owner,{revalidate:async()=>{},probe:createVideoProbe(()=>({width:1366,height:768})),source:{open:async()=>({length:bytes.length,close(){},body:(async function*(){yield bytes;})()})}});
  const media=await files.materialize(turn.id,{url:'https://fixture.example/video',duration:5,resolution:'768P',ratio:'16:9'});
  await db.$transaction(async tx=>{
   await tx.generationTurn.update({where:{id:turn.id},data:{status:'ready',media,result:{summary:'本地测试画面，非模型内容。',choices:[{id:'ask',title:'问一句',text:'你在想什么？'},{id:'look',title:'看向远方',text:'我望向天空。'}]}}});
   await tx.runtimeOutbox.update({where:{id:turn.id},data:{status:'done'}});
   await tx.experience.update({where:{id:opening.id},data:{status:'playing',schedulingPaused:true}});
  });
  return{...protocol,experienceId:opening.id,turnId:turn.id,mediaId:media.id};
 }finally{await db.$disconnect();}
}
