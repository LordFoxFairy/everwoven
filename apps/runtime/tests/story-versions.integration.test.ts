import {beforeAll,afterAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {prepare,dispose,fixture,overrides,type Fixture} from './fixtures/story-aggregate/setup.js';
import {freezeStoryInScope,readStoryVersionInScope} from '../src/application/story-versions.js';
import {PrismaStoryVersionStore} from '../src/infrastructure/db/prisma-story-version-store.js';
import {openRuntimeDatabase} from '../src/infrastructure/db/client.js';
import {parseStoryVersionDTO} from '../src/contracts/story-version-validation.js';
let f:Fixture,store:PrismaStoryVersionStore;
beforeAll(prepare,30000);afterAll(dispose);
beforeEach(async()=>{f=await fixture();store=new PrismaStoryVersionStore(f.db);});
afterEach(async()=>{vi.restoreAllMocks();await f.close();});
const input=(id:string,revision=1)=>({...f.protocol,storyDraftId:id,expectedRevision:revision});
const freeze=(id:string,revision=1)=>store.write(f.owner.ownerId,scope=>freezeStoryInScope(scope,f.owner,input(id,revision)));
const read=(id:string)=>store.read(f.owner.ownerId,scope=>readStoryVersionInScope(scope,f.owner,id));
it('seals once per source revision without mutating the draft or creating calls/experiences',async()=>{
 const draft=(await f.service.create(f.owner,f.create())).data;
 const a=await freeze(draft.id),b=await freeze(draft.id);
 expect(a).toEqual(b);expect(parseStoryVersionDTO(a)).toEqual(a);
 expect(a).toMatchObject({storyDraftId:draft.id,sourceRevision:1,versionNo:1,title:draft.title,settings:draft.settings});
 expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/);expect(await read(a.id)).toEqual(a);
 expect((await f.service.get(f.owner,f.get(draft.id))).revision).toBe(1);
 expect(await f.db.storyVersion.count()).toBe(1);expect(await f.db.experience.count()).toBe(0);
});
it('freezes every character override and image slot, independent of later source edits and process connection',async()=>{
 const portrait=await f.asset(),cover=await f.asset(),opening=await f.asset(),override=await f.asset();
 const t=await f.template(portrait.id);
 const draft=(await f.service.create(f.owner,{...f.create(),mainCharacter:{kind:'library',templateId:t.id,expectedTemplateRevision:1,overrides:{...overrides,name:'in story',relationship:'trust',portrait:{mode:'asset',assetId:override.id}}},assetSlots:{cover:cover.id,opening:opening.id,character:override.id}})).data;
 const a=await freeze(draft.id);
 expect(a.mainCharacter).toEqual(draft.mainCharacter);expect(a.assetSlots).toEqual(draft.assetSlots);
 expect(await f.db.storyVersionCast.count()).toBe(1);expect(await f.db.storyVersionAsset.count()).toBe(3);
 await f.db.characterTemplate.update({where:{id:t.id},data:{name:'later',revision:2,deletedAt:f.now}});
 await f.service.update(f.owner,{...f.change(draft.id,1),patch:{title:'later',mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}}});
 expect(await read(a.id)).toEqual(a);
 const b=await freeze(draft.id,2);expect(b.id).not.toBe(a.id);expect(b.versionNo).toBe(2);expect(b.mainCharacter).toBeNull();
 const [info]=await f.db.$queryRawUnsafe<Array<{file:string}>>('PRAGMA database_list');
 const reopened=await openRuntimeDatabase(info!.file);
 try{expect(await new PrismaStoryVersionStore(reopened).read(f.owner.ownerId,scope=>readStoryVersionInScope(scope,f.owner,a.id))).toEqual(a);}finally{await reopened.$disconnect();}
});
it('rejects stale revision, cross owner, cross dataset, deleted and archived sources',async()=>{
 const d=(await f.service.create(f.owner,f.create())).data;
 await expect(freeze(d.id,2)).rejects.toThrow('REVISION_CONFLICT');
 await expect(store.write(f.owner.ownerId,scope=>freezeStoryInScope(scope,f.owner,{...input(d.id),datasetId:v7()}))).rejects.toThrow('DATASET_CHANGED');
 const other={ownerId:v7(),datasetId:v7()};await f.db.localProfile.create({data:{id:other.ownerId,displayName:'other',createdAt:f.now,updatedAt:f.now}});
 await expect(store.write(other.ownerId,scope=>freezeStoryInScope(scope,other,{...input(d.id),datasetId:other.datasetId}))).rejects.toThrow('STORY_NOT_FOUND');
 await f.db.storyDraft.update({where:{id:d.id},data:{archivedAt:f.now}});await expect(freeze(d.id)).rejects.toThrow('STORY_ARCHIVED');
 await f.db.storyDraft.update({where:{id:d.id},data:{archivedAt:null,deletedAt:f.now}});await expect(freeze(d.id)).rejects.toThrow('STORY_NOT_FOUND');
 expect(await f.db.storyVersion.count()).toBe(0);
});
it.each(['unavailable','deleted','missing'])('requires current ready references for new openings (%s)',async kind=>{
 const asset=await f.asset();const d=(await f.service.create(f.owner,{...f.create(),assetSlots:{cover:asset.id,opening:null,character:null}})).data;
 const sealed=await freeze(d.id);
 if(kind==='missing')await f.db.asset.delete({where:{id:asset.id}});
 else await f.db.asset.update({where:{id:asset.id},data:kind==='deleted'?{deletedAt:f.now}:{status:'unavailable'}});
 expect(await read(sealed.id)).toEqual(sealed);
 await expect(freeze(d.id)).rejects.toThrow('STORY_ASSET_NOT_READY');
 expect(await f.db.storyVersion.count()).toBe(1);
});
it.each(['children','seal','outer'])('rolls the complete version back if %s fails',async stage=>{
 const asset=await f.asset();const d=(await f.service.create(f.owner,{...f.create(),assetSlots:{cover:asset.id,opening:null,character:null}})).data;
 await expect(store.write(f.owner.ownerId,async scope=>{
  if(stage==='children'){const insert=scope.insertStoryAssets;scope.insertStoryAssets=async(...args)=>{await insert(...args);throw Error('fault');};}
  if(stage==='seal')scope.sealStoryVersion=async()=>0;
  await freezeStoryInScope(scope,f.owner,input(d.id));
  if(stage==='outer')throw Error('fault');
 })).rejects.toThrow();
 expect(await f.db.storyVersion.count()).toBe(0);expect(await f.db.storyVersionAsset.count()).toBe(0);expect(await f.db.storyVersionCast.count()).toBe(0);
});
it.each(['body','hash','unsealed','child','character','same-source'])('detects corrupted %s rather than repairing or reusing it',async kind=>{
 const t=await f.template();const d=(await f.service.create(f.owner,{...f.create(),mainCharacter:{kind:'library',templateId:t.id,expectedTemplateRevision:1,overrides}})).data;
 const sealed=await freeze(d.id);
 if(kind==='body')await f.db.storyVersion.update({where:{id:sealed.id},data:{title:'corrupt'}});
 if(kind==='hash')await f.db.storyVersion.update({where:{id:sealed.id},data:{contentHash:'0'.repeat(64)}});
 if(kind==='unsealed')await f.db.storyVersion.update({where:{id:sealed.id},data:{sealedAt:null}});
 if(kind==='child')await f.db.storyVersionCast.updateMany({data:{ownerId:v7()}});
 if(kind==='character')await f.db.characterVersion.updateMany({data:{name:'corrupt'}});
 if(kind==='same-source')await f.db.storyDraft.update({where:{id:d.id},data:{title:'unversioned edit'}});
 await expect(freeze(d.id)).rejects.toThrow('STORED_STORY_VERSION_INVALID');
 expect(await f.db.storyVersion.count()).toBe(1);
});
it('does not let an owner-scoped transaction be reused with a different owner context',async()=>{
 const d=(await f.service.create(f.owner,f.create())).data;
 await expect(store.write(f.owner.ownerId,scope=>freezeStoryInScope(scope,{...f.owner,ownerId:v7()},input(d.id)))).rejects.toThrow('OWNER_UNAVAILABLE');
 expect(await f.db.storyVersion.count()).toBe(0);
});
it('read and reuse reject foreign owner, source identity and version metadata corruption',async()=>{
 const d=(await f.service.create(f.owner,f.create())).data;
 const a=await freeze(d.id);
 await f.db.storyVersion.update({where:{id:a.id},data:{ownerId:v7()}});
 await expect(read(a.id)).rejects.toThrow('STORY_VERSION_NOT_FOUND');
 await expect(freeze(d.id)).rejects.toThrow('STORED_STORY_VERSION_INVALID');
 await f.db.storyVersion.update({where:{id:a.id},data:{ownerId:f.owner.ownerId,versionNo:0}});
 await expect(read(a.id)).rejects.toThrow('STORED_STORY_VERSION_INVALID');
});
it('checks inherited portraits too, allows equal titles and allocates only server UUIDs',async()=>{
 const asset=await f.asset(),t=await f.template(asset.id);
 const draft=await f.service.create(f.owner,{...f.create('same'),mainCharacter:{kind:'library',templateId:t.id,expectedTemplateRevision:1,overrides}});
 await f.db.asset.update({where:{id:asset.id},data:{deletedAt:f.now}});
 await expect(freeze(draft.data.id)).rejects.toThrow('STORY_ASSET_NOT_READY');
 const b=await f.service.create(f.owner,f.create('same'));
 const c=await f.service.create(f.owner,f.create('same'));
 expect((await freeze(b.data.id)).id).not.toBe((await freeze(c.data.id)).id);
 await expect(store.write(f.owner.ownerId,scope=>freezeStoryInScope(scope,f.owner,input(draft.data.id),{ids:{next:()=>v7()},clock:{now:()=>new Date(NaN)}}))).rejects.toThrow('STORY_ASSET_NOT_READY');
});
it('rejects invalid runtime services and exhausted version numbering without partial headers',async()=>{
 const d=(await f.service.create(f.owner,f.create())).data;
 await expect(store.write(f.owner.ownerId,scope=>freezeStoryInScope(scope,f.owner,input(d.id),{ids:{next:()=>v7()},clock:{now:()=>new Date(NaN)}}))).rejects.toThrow('CLOCK_INVALID');
 await expect(store.write(f.owner.ownerId,scope=>freezeStoryInScope(scope,f.owner,input(d.id),{ids:{next:()=> 'not-a-business-id'},clock:{now:()=>f.now}}))).rejects.toThrow('ID_FACTORY_INVALID');
 await expect(store.write(f.owner.ownerId,scope=>{scope.nextStoryVersionNo=async()=>2147483648;return freezeStoryInScope(scope,f.owner,input(d.id));})).rejects.toThrow('REVISION_EXHAUSTED');
 expect(await f.db.storyVersion.count()).toBe(0);
});
it('mutating the returned DTO cannot mutate sealed rows and deleted source does not erase historical reading',async()=>{
 const d=(await f.service.create(f.owner,f.create())).data,a=await freeze(d.id),original=structuredClone(a);
 a.settings.world='client edit';
 await f.service.delete(f.owner,f.change(d.id,1));
 expect(await read(a.id)).toEqual(original);
 await expect(freeze(d.id)).rejects.toThrow('STORY_NOT_FOUND');
});
it('the write port rejects appending children to a sealed or foreign header',async()=>{
 const asset=await f.asset(),t=await f.template();
 const source=(await f.service.create(f.owner,{...f.create(),mainCharacter:{kind:'library',templateId:t.id,expectedTemplateRevision:1,overrides}})).data;
 const empty=(await f.service.create(f.owner,f.create())).data,sealed=await freeze(empty.id);
 await expect(store.write(f.owner.ownerId,scope=>scope.insertStoryAssets(sealed.id,[{id:v7(),assetId:asset.id,slotKey:'cover',createdAt:new Date(sealed.createdAt)}]))).rejects.toThrow('STORY_VERSION_SEALED');
 await expect(store.write(f.owner.ownerId,scope=>scope.insertStoryCast(sealed.id,{id:v7(),characterVersionId:source.mainCharacter!.version.id,overrides,createdAt:new Date(sealed.createdAt)}))).rejects.toThrow('STORY_VERSION_SEALED');
 await expect(store.write(f.owner.ownerId,scope=>scope.insertStoryAssets(v7(),[{id:v7(),assetId:asset.id,slotKey:'cover',createdAt:new Date(sealed.createdAt)}]))).rejects.toThrow('STORY_VERSION_NOT_FOUND');
 expect(await f.db.storyVersionAsset.count()).toBe(0);expect(await f.db.storyVersionCast.count()).toBe(0);
 expect(await read(sealed.id)).toEqual(sealed);
});
