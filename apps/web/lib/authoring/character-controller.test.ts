import {describe, expect, it, vi} from 'vitest';
import type {CharacterClient} from './character-client';
import type {CharacterDTO} from '../../../runtime/src/contracts/character-template';
const datasetId='01994b80-0000-7000-8000-000000000099', other='01994b80-0000-7000-8000-000000000098';
const dto=(name='A'):CharacterDTO=>({id:'01994b80-0000-7000-8000-000000000001',name,settings:{personality:'',appearance:'',speakingStyle:'',boundaries:''},portraitAssetId:null,schemaVersion:1,revision:1,createdAt:'2026-09-12T00:00:00.000Z',updatedAt:'2026-09-12T00:00:00.000Z',deletedAt:null,archivedAt:null});
function deferred<T>(){let resolve!:(x:T)=>void,reject!:(x:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function client(){return {create:vi.fn<CharacterClient['create']>().mockImplementation(async input=>({data:{...dto(input.name),settings:input.settings,portraitAssetId:input.portraitAssetId},replayed:false})),update:vi.fn<CharacterClient['update']>().mockImplementation(async input=>({data:{...dto(),...input.patch,revision:input.expectedRevision+1},replayed:false})),delete:vi.fn<CharacterClient['delete']>(),restore:vi.fn<CharacterClient['restore']>(),get:vi.fn<CharacterClient['get']>().mockResolvedValue(dto()),list:vi.fn<CharacterClient['list']>().mockResolvedValue({items:[],nextCursor:null,totalMatching:0})};}
async function setup(){const m=await import('./character-controller').catch(()=>null);expect(m,'controller must exist').not.toBeNull();const c=client(),controller=new m!.CharacterController();const binding={client:c,connected:true,datasetId,invalidate:vi.fn()};controller.bind(binding);return{controller,c,binding};}
describe('formal character controller',()=>{
 it('submits A once, preserves B and binds only confirmed identity/baseline',async()=>{
  const {controller,c}=await setup(),pending=deferred<{data:CharacterDTO;replayed:boolean}>();c.create.mockReturnValueOnce(pending.promise);
  controller.newDraft();controller.field('name','A');const saving=controller.save();const duplicate=controller.save();
  controller.field('name','B');expect(c.create).toHaveBeenCalledTimes(1);expect(controller.getSnapshot().busy).toBe(true);
  pending.resolve({data:dto('A'),replayed:false});await saving;await duplicate;
  expect(controller.getSnapshot().fields.name).toBe('B');expect(controller.getSnapshot().confirmed?.id).toBe(dto().id);expect(controller.getSnapshot().dirty).toBe(true);
  await controller.save();expect(c.update.mock.calls[0]![0]).toMatchObject({id:dto().id,expectedRevision:1,datasetId,patch:{name:'B'}});
 });
 it.each([401,403,412])('retains immutable unknown through %s and same-dataset reconnect',async status=>{
  const {controller,c,binding}=await setup();controller.newDraft();controller.field('name','A');c.create.mockRejectedValueOnce(Error('lost'));
  await expect(controller.save()).rejects.toThrow();const original=c.create.mock.calls[0]![0];controller.field('name','B');
  c.create.mockRejectedValueOnce({message:'refused',status});await expect(controller.confirm()).rejects.toBeTruthy();expect(controller.getSnapshot().unknown).toBe(true);
  controller.bind({...binding,connected:false});controller.bind({...binding,invalidate:vi.fn()});
  await controller.confirm();expect(c.create.mock.calls.map(([x])=>x)).toEqual([original,original,original]);expect(controller.getSnapshot().fields.name).toBe('B');
 });
 it.each([true,false])('reset preserves text with unknown=%s and requires explicit fresh command',async unknown=>{
  const {controller,c,binding}=await setup();await controller.open(dto().id);controller.field('name','保留');
  if(unknown){c.update.mockRejectedValueOnce(Error('lost'));await expect(controller.save()).rejects.toThrow();}
  controller.bind({...binding,datasetId:other,invalidate:vi.fn()});
  expect(controller.getSnapshot()).toMatchObject({datasetChanged:true,confirmed:null,fields:{name:'保留'},items:[],cursor:null});
  await expect(controller.save()).rejects.toBeTruthy();expect(c.create).not.toHaveBeenCalled();
  controller.fromRetained();await controller.save();expect(c.create.mock.calls[0]![0]).toMatchObject({datasetId:other,name:'保留'});expect(c.create.mock.calls[0]![0]).not.toHaveProperty('id');
 });
 it('does not turn list failure into an empty success or replace successful pages',async()=>{
  const {controller,c}=await setup();c.list.mockResolvedValueOnce({items:[dto()],nextCursor:'next',totalMatching:8});await controller.load();
  c.list.mockRejectedValueOnce(Error('offline'));await controller.load('q','only');expect(controller.getSnapshot()).toMatchObject({listStatus:'error',items:[dto()],total:8,cursor:'next'});
 });
 it.each(['list','get','write'] as const)('ignores late old %s and never invalidates a new session',async action=>{
  const {controller,c,binding}=await setup(),late=deferred<any>();let request:Promise<unknown>;
  if(action==='list'){c.list.mockReturnValueOnce(late.promise);request=controller.load();}
  else if(action==='get'){c.get.mockReturnValueOnce(late.promise);request=controller.open(dto().id);}
  else{controller.newDraft();controller.field('name','A');c.create.mockReturnValueOnce(late.promise);request=controller.save().catch(()=>{});}
  const next=client(),invalidate=vi.fn();controller.bind({...binding,client:next,datasetId:other,invalidate});controller.fromRetained();controller.field('name','新命令');next.create.mockRejectedValueOnce(Error('lost'));await expect(controller.save()).rejects.toThrow();
  late.reject({status:401});await request;expect(invalidate).not.toHaveBeenCalled();expect(binding.invalidate).not.toHaveBeenCalled();expect(controller.getSnapshot()).toMatchObject({unknown:true,fields:{name:'新命令'}});
 });
 it('recognizes explicit DATASET_CHANGED, preserving unknown and clearing old identity',async()=>{
  const {controller,c,binding}=await setup();await controller.open(dto().id);controller.field('name','保留');c.update.mockRejectedValueOnce({message:'DATASET_CHANGED',data:{code:'PRECONDITION_FAILED'}});
  await expect(controller.save()).rejects.toBeTruthy();expect(controller.getSnapshot()).toMatchObject({datasetChanged:true,confirmed:null,fields:{name:'保留'}});expect(binding.invalidate).toHaveBeenCalledOnce();
 });
});
it('explicit editor copy creates a new command rather than updating the previously selected template',async()=>{
 const {controller,c}=await setup();await controller.open(dto().id);
 await controller.saveCopy({...controller.getSnapshot().fields,name:'另存副本'});
 expect(c.create).toHaveBeenCalledTimes(1);expect(c.update).not.toHaveBeenCalled();expect(c.create.mock.calls[0]![0]).not.toHaveProperty('id');
});
it.each(['delete','restore'] as const)('confirms only the original unknown %s command and keeps later text',async action=>{
 const {controller,c}=await setup();c.get.mockResolvedValue({...dto(),deletedAt:action==='restore'?'2026-09-12T01:00:00.000Z':null});await controller.open(dto().id);
 c[action].mockRejectedValueOnce(Error('lost')).mockResolvedValueOnce({data:{...dto(),revision:2,deletedAt:action==='delete'?'2026-09-12T01:00:00.000Z':null},replayed:true});
 await expect(controller.lifecycle(action)).rejects.toThrow();controller.field('name','后来输入');await controller.confirm();expect(c[action].mock.calls[1]![0]).toEqual(c[action].mock.calls[0]![0]);expect(controller.getSnapshot().fields.name).toBe('后来输入');
});
it('an in-flight previous-client list cannot overwrite the new successful page',async()=>{
 const {controller,c,binding}=await setup(),late=deferred<any>();c.list.mockReturnValueOnce(late.promise);const old=controller.load();
 const next=client();next.list.mockResolvedValue({items:[dto('新库')],nextCursor:'new',totalMatching:9});controller.bind({...binding,client:next,datasetId:other,invalidate:vi.fn()});await controller.load();late.resolve({items:[dto('旧库')],nextCursor:'old',totalMatching:1});await old;
 expect(controller.getSnapshot()).toMatchObject({items:[dto('新库')],cursor:'new',total:9});
});
it('a synchronous transport throw does not leave the save ref lock permanently held',async()=>{
 const {controller,c}=await setup();controller.newDraft();controller.field('name','A');c.create.mockImplementationOnce(()=>{throw Error('sync failure');});await expect(controller.save()).rejects.toThrow('sync failure');
 await controller.confirm();expect(c.create).toHaveBeenCalledTimes(2);expect(controller.getSnapshot().unknown).toBe(false);
});
it('same-dataset new session epoch cannot be invalidated by a late previous epoch rejection',async()=>{
 const {controller,c,binding}=await setup(),late=deferred<any>();controller.newDraft();controller.field('name','A');c.create.mockReturnValueOnce(late.promise);const old=controller.save().catch(()=>{});
 const invalidate=vi.fn();controller.bind({...binding,invalidate});c.create.mockRejectedValueOnce(Error('new unknown'));await expect(controller.confirm()).rejects.toThrow('new unknown');late.reject({status:401});await old;
 expect(invalidate).not.toHaveBeenCalled();expect(controller.getSnapshot().unknown).toBe(true);await controller.confirm();expect(c.create.mock.calls[2]![0]).toEqual(c.create.mock.calls[0]![0]);
});
it('loads client validators through the compiled runtime package export, not TypeScript source imports',async()=>{
 const {readFileSync}=await import('node:fs');
 const {createRequire}=await import('node:module');
 const source=readFileSync(new URL('./character-controller.ts',import.meta.url),'utf8');
 expect(source).toMatch(/import\s*\{\s*parseCreate\s*,\s*parseUpdate\s*\}\s*from\s*['"]runtime\/contracts\/character-template-validation['"]/);
 const resolved=createRequire(import.meta.url).resolve('runtime/contracts/character-template-validation');
 expect(resolved).toMatch(/\/dist\/contracts\/character-template-validation\.js$/);
 const validators=await import('runtime/contracts/character-template-validation');
 expect(validators.parseCreate).toBeTypeOf('function');expect(validators.parseUpdate).toBeTypeOf('function');
});
it.each([true,false])('retained text clears the portrait only across datasets (changed=%s)',async changed=>{
 const {controller,c,binding}=await setup();const portraitAssetId='01994b80-0000-7000-8000-000000000077';c.get.mockResolvedValue({...dto(),portraitAssetId});await controller.open(dto().id);controller.field('name','保留文字');controller.field('boundaries','保留边界');
 c.update.mockRejectedValueOnce(Error('lost'));await expect(controller.save()).rejects.toThrow();const original=c.update.mock.calls[0]![0];
 controller.bind({...binding,connected:false});controller.bind({...binding,datasetId:changed?other:datasetId,invalidate:vi.fn()});
 if(changed){controller.fromRetained();await controller.save();expect(c.create).toHaveBeenCalledTimes(1);expect(c.create.mock.calls[0]![0]).toMatchObject({datasetId:other,name:'保留文字',settings:{boundaries:'保留边界'},portraitAssetId:null});expect(c.update).toHaveBeenCalledTimes(1);}
 else{await controller.confirm();expect(c.create).not.toHaveBeenCalled();expect(c.update.mock.calls[1]![0]).toEqual(original);expect(c.update.mock.calls[1]![0].patch.portraitAssetId).toBe(portraitAssetId);expect(controller.getSnapshot().fields.portraitAssetId).toBe(portraitAssetId);}
});
it.each(['get','list','write'] as const)('DATASET_CHANGED fences late %s immediately before any hook bind',async action=>{
 const {controller,c,binding}=await setup();await controller.open(dto().id);controller.field('name','保留B');
 const late=deferred<any>();let old:Promise<unknown>;
 if(action==='get'){c.get.mockReturnValueOnce(late.promise);old=controller.open(dto().id);}
 else if(action==='list'){c.list.mockReturnValueOnce(late.promise);old=controller.load();}
 else{c.update.mockReturnValueOnce(late.promise);old=controller.save().catch(error=>error);controller.field('name','后来C');}
 const resetError={message:'DATASET_CHANGED',data:{code:'PRECONDITION_FAILED'}};
 if(action==='list'){c.get.mockRejectedValueOnce(resetError);await controller.open(dto().id);}
 else{c.list.mockRejectedValueOnce(resetError);await controller.load();}
 // invalidate is a spy: React has not rebound the controller to another epoch.
 expect(binding.invalidate).toHaveBeenCalledTimes(1);const resetState=controller.getSnapshot();
 const requestCounts=[c.get.mock.calls.length,c.list.mock.calls.length,c.update.mock.calls.length];
 late.resolve(action==='get'?dto('旧身份'):action==='list'?{items:[dto('旧列表')],nextCursor:'old',totalMatching:9}:{data:{...dto('旧回执'),revision:2},replayed:false});await old;
 expect(controller.getSnapshot()).toMatchObject({datasetChanged:true,connected:false,confirmed:null,items:[],cursor:null,total:0,message:'',listStatus:'idle',fields:{name:action==='write'?'后来C':'保留B'},unknown:action==='write',busy:false,saving:false,reading:false,listBusy:false});
 expect(resetState).toMatchObject({busy:false,saving:false,reading:false,listBusy:false,unknown:action==='write'});
 expect([c.get.mock.calls.length,c.list.mock.calls.length,c.update.mock.calls.length]).toEqual(requestCounts);
 await expect(controller.confirm()).rejects.toThrow('原命令暂不可确认');expect(c.create).not.toHaveBeenCalled();
});
it.each([false,true])('changing dataset with no pending or working content clears caches without a recovery lock (empty form=%s)',async emptyForm=>{
 const {controller,c,binding}=await setup();c.list.mockResolvedValue({items:[dto()],nextCursor:'old',totalMatching:9});await controller.load();if(emptyForm)controller.newDraft();
 controller.bind({...binding,datasetId:other,invalidate:vi.fn()});expect(controller.getSnapshot()).toMatchObject({datasetChanged:false,unknown:false,dirty:false,confirmed:null,items:[],cursor:null,total:0,busy:false});expect(c.create).not.toHaveBeenCalled();
});
it('portrait selection is dataset-bound, dirty-only, and cannot alter an immutable unknown command',async()=>{
 const {controller,c,binding}=await setup();controller.newDraft();controller.field('name','有图角色');
 const portrait={kind:'formal' as const,datasetId,id:'01994b80-0000-7000-8000-000000000077'};
 expect(controller).toHaveProperty('selectPortrait');controller.selectPortrait(portrait);
 expect(controller.getSnapshot()).toMatchObject({dirty:true,fields:{portraitAssetId:portrait.id}});expect(c.create).not.toHaveBeenCalled();
 c.create.mockRejectedValueOnce(Error('lost'));await expect(controller.save()).rejects.toThrow();const command=c.create.mock.calls[0]![0];
 controller.selectPortrait(null);expect(controller.getSnapshot().fields.portraitAssetId).toBe(portrait.id);
 await controller.confirm();expect(c.create.mock.calls[1]![0]).toEqual(command);
 controller.selectPortrait(null);expect(controller.getSnapshot().fields.portraitAssetId).toBeNull();expect(controller.getSnapshot().dirty).toBe(true);
 controller.selectPortrait({...portrait,datasetId:other});expect(controller.getSnapshot().fields.portraitAssetId).toBeNull();
 controller.bind({...binding,connected:false});controller.selectPortrait(portrait);expect(controller.getSnapshot().fields.portraitAssetId).toBeNull();
});
it('editing instance changes for explicit open/new/recovery, not the first server create acknowledgement',async()=>{
 const {controller}=await setup();controller.newDraft();controller.field('name','创建');const first=controller.getSnapshot().editInstance;
 expect(first).toBeTypeOf('string');await controller.save();expect(controller.getSnapshot().editInstance).toBe(first);
 await controller.open(dto().id);const opened=controller.getSnapshot().editInstance;expect(opened).not.toBe(first);
 controller.newDraft();expect(controller.getSnapshot().editInstance).not.toBe(opened);
});
it('saveCopy uses current portrait selection rather than immutable source portrait',async()=>{
 const {fieldsFromSelection,characterSelection}=await import('./character-viewmodel');
 const original='01994b80-0000-7000-8000-000000000077',selected='01994b80-0000-7000-8000-000000000078';
 const selection=characterSelection({...dto('源角色'),portraitAssetId:original},datasetId);
 expect(selection).toHaveProperty('portraitRef',{kind:'formal',datasetId,id:original});
 const changed={...selection,portraitRef:{kind:'formal' as const,datasetId,id:selected}};
 const {controller,c}=await setup();await controller.saveCopy(fieldsFromSelection(changed));
 expect(c.create.mock.calls[0]![0].portraitAssetId).toBe(selected);expect(changed.source?.portraitAssetId).toBe(original);expect(c.update).not.toHaveBeenCalled();
 expect(fieldsFromSelection({...changed,portraitRef:null}).portraitAssetId).toBeNull();
});

it('retained portrait keeps its original read namespace until explicit cross-dataset recovery',async()=>{
 const {controller,c,binding}=await setup();c.get.mockResolvedValue({...dto(),portraitAssetId:'01994b80-0000-7000-8000-000000000077'});await controller.open(dto().id);
 expect(controller.getSnapshot().portraitDatasetId).toBe(datasetId);controller.bind({...binding,datasetId:other});expect(controller.getSnapshot().portraitDatasetId).toBe(datasetId);
 controller.fromRetained();expect(controller.getSnapshot()).toMatchObject({portraitDatasetId:null,fields:{portraitAssetId:null}});
});
