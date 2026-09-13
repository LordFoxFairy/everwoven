// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {useState,StrictMode} from 'react';
import {webcrypto} from 'node:crypto';
import {v7} from 'uuid';
import {AssetProvider,ImageAssetPicker,useImageUpload,CharacterPortrait} from './story-assets';
import {CharacterLibrary} from './character-library';
import {CharacterController} from '../lib/authoring/character-controller';
import {Editor} from './story-editor';
import {Platform} from './platform';
import * as assetClients from '../lib/authoring/asset-client';
import * as characterClients from '../lib/authoring/character-client';
import * as sessionClients from '../lib/authoring/session-client';
import {blankStory} from '../lib/presentation/new-story';
import type {AssetReadBinding,AssetRef,FormalAssetClient,DemoAssetClient} from '../lib/authoring/asset-ports';
import type {AssetDTO,UploadIntentDTO} from 'runtime/contracts/asset';
import type {CharacterDTO} from '../../runtime/src/contracts/character-template';
import type {CharacterClient} from '../lib/authoring/character-client';
const datasetId='01994b80-0000-7000-8000-000000000099',other='01994b80-0000-7000-8000-000000000098',time='2026-09-12T00:00:00.000Z';
beforeEach(()=>{
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:320,height:256,close:vi.fn()})));
 vi.stubGlobal('crypto',webcrypto);let urls=0;
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>`blob:test-${++urls}`)});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function file(name='fixture.png'){const f=new File(['fixture'],name,{type:'image/png'});Object.defineProperty(f,'arrayBuffer',{value:async()=>new TextEncoder().encode('fixture').buffer});return f;}
function formal(){
 let stored:UploadIntentDTO;const beginReceipts=new Map<string,UploadIntentDTO>();
 const client:FormalAssetClient={kind:'formal',read:vi.fn(async()=>new Blob(['webp'],{type:'image/webp'})),
  beginUpload:vi.fn(async input=>{let data=beginReceipts.get(input.commandId);if(!data){data={id:v7(),datasetId:input.datasetId,assetId:v7(),inputSha256:input.inputSha256,inputByteSize:input.inputByteSize,originalName:input.originalName,rightsDeclaration:input.rightsDeclaration,status:'reserved',outputSha256:null,outputByteSize:null,outputWidth:null,outputHeight:null,createdAt:time,updatedAt:time,expiresAt:'2026-09-13T00:00:00.000Z',revision:1};beginReceipts.set(input.commandId,data);}stored=data;return {data,replayed:false};}),
  getUpload:vi.fn(async()=>stored),process:vi.fn(async()=>{stored={...stored,status:'published',outputSha256:'a'.repeat(64),outputByteSize:'4',outputWidth:320,outputHeight:256,revision:4};return stored;}),
  completeUpload:vi.fn(async()=>({data:{id:stored.assetId,datasetId:stored.datasetId,sha256:'a'.repeat(64),mimeType:'image/webp',byteSize:'4',width:320,height:256,originalName:stored.originalName,rightsDeclaration:stored.rightsDeclaration,status:'ready',deletedAt:null,createdAt:time,updatedAt:time,revision:1} satisfies AssetDTO,replayed:false})),
 };const binding:AssetReadBinding={client,connected:true,datasetId,invalidate:vi.fn()};return {client,binding};
}
function Picker({change=()=>{},editingKey='first'}:{change?:(ref:AssetRef|null)=>void;editingKey?:string}){
 const [ref,setRef]=useState<AssetRef|null>(null);const update=(ref:AssetRef|null)=>{setRef(ref);change(ref);};const upload=useImageUpload(editingKey,update);
 return <ImageAssetPicker role="character" assetRef={ref} upload={upload} onChange={update}/>;
}
const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name}));
async function choose(){await act(async()=>fireEvent.change(screen.getByLabelText('选择角色参考'),{target:{files:[file()]}}));await waitFor(()=>expect((screen.getByRole('checkbox',{name:'我确认有权使用这张图片'}) as HTMLInputElement).disabled).toBe(false));}
async function upload(){await choose();fireEvent.click(screen.getByRole('checkbox',{name:'我确认有权使用这张图片'}));click('上传图片');}
function character(){
 let dto:CharacterDTO={id:v7(),name:'角色',settings:{personality:'',appearance:'',speakingStyle:'',boundaries:''},portraitAssetId:null,schemaVersion:1,revision:1,createdAt:time,updatedAt:time,deletedAt:null,archivedAt:null};
 const client:CharacterClient={create:vi.fn(async input=>{dto={...dto,name:input.name,settings:input.settings,portraitAssetId:input.portraitAssetId};return {data:dto,replayed:false};}),update:vi.fn(),delete:vi.fn(),restore:vi.fn(),get:vi.fn(async()=>dto),list:vi.fn(async()=>({items:[dto],nextCursor:null,totalMatching:1}))};
 const controller=new CharacterController();controller.bind({client,connected:true,datasetId,invalidate:vi.fn()});controller.newDraft();controller.field('name','角色');return {controller,client};
}
it('selecting a file requires separate unchecked rights consent and explicit import before any persistence',async()=>{
 const client:DemoAssetClient={kind:'demo',read:vi.fn(async()=>new Blob(['webp'],{type:'image/webp'})),importImage:vi.fn(async()=>({kind:'demo' as const,id:'browser-image'}))},change=vi.fn();
 render(<AssetProvider binding={{client,connected:true,datasetId:null,invalidate:vi.fn()}}><Picker change={change}/></AssetProvider>);await choose();
 expect(client.importImage).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
 const rights=screen.getByRole('checkbox',{name:'我确认有权使用这张图片'}) as HTMLInputElement;
 expect(rights.checked).toBe(false);expect((screen.getByRole('button',{name:'导入图片'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(rights);click('导入图片');await screen.findByText('图片已导入当前浏览器，保存设定后生效');expect(client.importImage).toHaveBeenCalledOnce();
 await choose();expect(rights.checked).toBe(false);expect(client.importImage).toHaveBeenCalledOnce();
});
it('neutral reference copy does not make unsupported provider capability claims',()=>{
 const {binding}=formal();render(<AssetProvider binding={binding}><Picker/></AssetProvider>);expect(screen.queryByText(/H3 Max 不支持/)).toBeNull();
});
it.each(['formal','demo'] as const)('%s ready disables repeat upload but permits a new file, new consent and clear',async kind=>{
 const formalFixture=formal();
 const demo:DemoAssetClient={kind:'demo',read:vi.fn(async()=>new Blob(['webp'],{type:'image/webp'})),importImage:vi.fn(async()=>({kind:'demo' as const,id:v7()}))};
 const binding:AssetReadBinding=kind==='formal'?formalFixture.binding:{client:demo,connected:true,datasetId:null,invalidate:vi.fn()};
 const persist=kind==='formal'?formalFixture.client.beginUpload:demo.importImage,change=vi.fn();
 const action=kind==='formal'?'上传图片':'导入图片',success=kind==='formal'?'图片已保存到本机，保存角色后生效':'图片已导入当前浏览器，保存设定后生效';
 render(<AssetProvider binding={binding}><Picker change={change}/></AssetProvider>);
 await choose();fireEvent.click(screen.getByRole('checkbox'));click(action);await screen.findByText(success);
 expect((screen.getByRole('button',{name:action}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByLabelText('选择角色参考') as HTMLInputElement).disabled).toBe(false);
 expect((screen.getByRole('button',{name:'清除选择'}) as HTMLButtonElement).disabled).toBe(false);
 click(action);expect(persist).toHaveBeenCalledOnce();
 await act(async()=>fireEvent.change(screen.getByLabelText('选择角色参考'),{target:{files:[file('replacement.png')]}}));
 await waitFor(()=>expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false));
 expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
 expect((screen.getByRole('button',{name:action}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox'));expect((screen.getByRole('button',{name:action}) as HTMLButtonElement).disabled).toBe(false);
 click(action);await screen.findByText(success);expect(persist).toHaveBeenCalledTimes(2);
 expect((screen.getByRole('button',{name:action}) as HTMLButtonElement).disabled).toBe(true);
 click('清除选择');expect(change).toHaveBeenLastCalledWith(null);expect(persist).toHaveBeenCalledTimes(2);
});
it('formal selection sends no begin until consent and upload, completes once in StrictMode and clear only unbinds',async()=>{
 const {client,binding}=formal(),change=vi.fn();render(<StrictMode><AssetProvider binding={binding}><Picker change={change}/></AssetProvider></StrictMode>);await choose();expect(client.beginUpload).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('checkbox',{name:'我确认有权使用这张图片'}));expect(client.beginUpload).not.toHaveBeenCalled();click('上传图片');click('上传图片');
 await screen.findByText('图片已保存到本机，保存角色后生效');expect(client.beginUpload).toHaveBeenCalledOnce();expect(client.process).toHaveBeenCalledOnce();expect(client.completeUpload).toHaveBeenCalledOnce();expect(change).toHaveBeenCalledOnce();
 expect(change).toHaveBeenCalledWith(expect.objectContaining({kind:'formal',datasetId}));
 click('清除选择');expect(change).toHaveBeenLastCalledWith(null);expect(client.completeUpload).toHaveBeenCalledOnce();
});
it('the original character form saves the completed portrait only on explicit character save and cards read it',async()=>{
 const {client,binding}=formal(),c=character();render(<AssetProvider binding={binding}><CharacterLibrary controller={c.controller} onPendingChange={vi.fn()} onUse={vi.fn()}/></AssetProvider>);
 await upload();await screen.findByText('图片已保存到本机，保存角色后生效');expect(c.client.create).not.toHaveBeenCalled();expect(c.controller.getSnapshot().dirty).toBe(true);
 const editInstance=c.controller.getSnapshot().editInstance;click('保存角色模板');await screen.findByText('角色模板已保存到本机 SQLite。');
 expect(c.client.create).toHaveBeenCalledWith(expect.objectContaining({portraitAssetId:expect.any(String)}));expect(c.controller.getSnapshot().editInstance).toBe(editInstance);
 await waitFor(()=>expect(screen.getAllByAltText('角色的参考图')).toHaveLength(1));expect(client.read).toHaveBeenCalledWith(expect.objectContaining({kind:'formal',datasetId}),expect.any(AbortSignal));
});
it('unknown complete keeps its command and blocks replacement/navigation without resending the body',async()=>{
 const {client,binding}=formal(),c=character(),use=vi.fn(),pending=vi.fn(),complete=vi.mocked(client.completeUpload).getMockImplementation()!;
 vi.mocked(client.completeUpload).mockRejectedValueOnce(TypeError('lost')).mockImplementation(complete);
 render(<AssetProvider binding={binding}><CharacterLibrary controller={c.controller} onPendingChange={pending} onUse={use}/></AssetProvider>);await upload();await screen.findByRole('button',{name:'确认上次图片命令'});
 expect((screen.getByLabelText('选择角色参考') as HTMLInputElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'保存角色模板'}) as HTMLButtonElement).disabled).toBe(true);click('创建角色');expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('角色');
 expect(pending).toHaveBeenLastCalledWith(expect.objectContaining({unknown:true}));click('确认上次图片命令');await screen.findByText('图片已保存到本机，保存角色后生效');
 expect(vi.mocked(client.completeUpload).mock.calls[1]![0]).toEqual(vi.mocked(client.completeUpload).mock.calls[0]![0]);expect(client.process).toHaveBeenCalledOnce();
});
it('formal Editor switches configuration tabs during unknown and saves current image rather than source snapshot',async()=>{
 const {client,binding}=formal(),save=vi.fn(async c=>c),back=vi.fn(),source={kind:'formal-template' as const,templateId:v7(),revision:1,datasetId,portraitAssetId:v7()};
 const complete=vi.mocked(client.completeUpload).getMockImplementation()!;vi.mocked(client.completeUpload).mockRejectedValueOnce(TypeError('lost'));
 render(<AssetProvider binding={binding}><Editor initial={{...blankStory(),character:'副本'}} formal characterSource={source} characters={[]} onSave={vi.fn()} onSaveCharacter={save} onBack={back} onPlay={vi.fn()} notice="" dialog={null}/></AssetProvider>);
 click('03角色配置');await upload();await screen.findByRole('button',{name:'确认上次图片命令'});click('01基础信息');click('我的剧本');expect(back).not.toHaveBeenCalled();click('03角色配置');expect(screen.getByRole('button',{name:'确认上次图片命令'})).toBeTruthy();
 vi.mocked(client.completeUpload).mockImplementation(complete);click('确认上次图片命令');await screen.findByText('图片已保存到本机，保存角色后生效');click('另存为角色模板');await screen.findByText(/角色模板已保存。此剧本仍是编辑副本/);
 expect(save.mock.calls[0]![0]).toMatchObject({source,portraitRef:{kind:'formal',datasetId}});expect(save.mock.calls[0]![0].portraitRef.id).not.toBe(source.portraitAssetId);
 click('04画面与素材');expect(screen.getByLabelText('选择剧本封面')).toBeTruthy();expect((screen.getByRole('button',{name:'保存草稿'}) as HTMLButtonElement).disabled).toBe(true);
});
it.each(['missing','error'])('a referenced formal portrait %s never pretends to be an initial-letter or demo image',async kind=>{
 const {client,binding}=formal();vi.mocked(client.read).mockRejectedValue(kind==='missing'?{kind:'missing',message:'图片不存在'}:TypeError('offline'));
 render(<AssetProvider binding={binding}><CharacterPortrait character={{id:'character',name:'角色',personality:''}} assetRef={{kind:'formal',datasetId,id:v7()}}/></AssetProvider>);
 await screen.findByRole('button',{name:'重试图片读取'});expect(screen.queryByText('角')).toBeNull();expect(screen.queryByRole('img')).toBeNull();
});
it('cross-dataset recovery preserves character text and never reads an old portrait through the new namespace',async()=>{
 const {client,binding}=formal(),c=character(),onPending=vi.fn();
 const view=render(<AssetProvider binding={binding}><CharacterLibrary controller={c.controller} onPendingChange={onPending} onUse={vi.fn()}/></AssetProvider>);
 await upload();await screen.findByText('图片已保存到本机，保存角色后生效');const oldId=c.controller.getSnapshot().fields.portraitAssetId!;
 const calls=vi.mocked(client.read).mock.calls.length;
 await act(async()=>{c.controller.bind({client:c.client,connected:true,datasetId:other,invalidate:vi.fn()});view.rerender(<AssetProvider binding={{...binding,datasetId:other,invalidate:vi.fn()}}><CharacterLibrary controller={c.controller} onPendingChange={onPending} onUse={vi.fn()}/></AssetProvider>);});
 expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('角色');
 expect(vi.mocked(client.read).mock.calls.slice(calls).some(([ref])=>ref.id===oldId&&ref.datasetId===other)).toBe(false);
 click('从保留文本新建角色');expect(c.controller.getSnapshot()).toMatchObject({datasetChanged:false,fields:{name:'角色',portraitAssetId:null},portraitDatasetId:null});
});
it('cross-dataset unknown exposes an enabled explicit recovery action and does not replay the old image command',async()=>{
 const {client,binding}=formal(),c=character();vi.mocked(client.beginUpload).mockRejectedValue(TypeError('lost'));
 const view=render(<AssetProvider binding={binding}><CharacterLibrary controller={c.controller} onPendingChange={vi.fn()} onUse={vi.fn()}/></AssetProvider>);
 await upload();await screen.findByRole('button',{name:'确认上次图片命令'});expect(client.beginUpload).toHaveBeenCalledOnce();
 await act(async()=>{c.controller.bind({client:c.client,connected:true,datasetId:other,invalidate:vi.fn()});view.rerender(<AssetProvider binding={{...binding,datasetId:other,invalidate:vi.fn()}}><CharacterLibrary controller={c.controller} onPendingChange={vi.fn()} onUse={vi.fn()}/></AssetProvider>);});
 const reset=screen.getByRole('button',{name:'从保留文本新建角色'}) as HTMLButtonElement;expect(reset.disabled).toBe(false);fireEvent.click(reset);
 expect(screen.queryByRole('button',{name:'确认上次图片命令'})).toBeNull();expect(client.beginUpload).toHaveBeenCalledOnce();expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('角色');
});
it('changing editing instance discards only local file selection and revokes its preview, without beginning upload',async()=>{
 const {client,binding}=formal(),view=render(<AssetProvider binding={binding}><Picker editingKey="A"/></AssetProvider>);await choose();
 fireEvent.click(screen.getByRole('checkbox',{name:'我确认有权使用这张图片'}));expect(screen.getByAltText('角色参考待上传')).toBeTruthy();
 view.rerender(<AssetProvider binding={binding}><Picker editingKey="B"/></AssetProvider>);
 await waitFor(()=>expect(screen.queryByAltText('角色参考待上传')).toBeNull());expect(URL.revokeObjectURL).toHaveBeenCalled();expect(client.beginUpload).not.toHaveBeenCalled();
 expect((screen.getByRole('checkbox',{name:'我确认有权使用这张图片'}) as HTMLInputElement).checked).toBe(false);
});

it('Platform sidebar/Create/onUse cannot unmount an unknown image command; same-dataset reconnect confirms the original',async()=>{
 const {client}=formal(),c=character(),complete=vi.mocked(client.completeUpload).getMockImplementation()!;
 vi.spyOn(assetClients,'createFormalAssetClient').mockReturnValue(client);vi.spyOn(characterClients,'createCharacterClient').mockReturnValue(c.client);
 vi.spyOn(sessionClients,'createAuthoringSessionClient').mockReturnValue({session:async()=>({authenticated:true,datasetId}),connect:async()=>{},logout:async()=>{}});
 vi.mocked(client.completeUpload).mockRejectedValueOnce(TypeError('lost')).mockRejectedValueOnce({message:'LOCAL_SESSION_INVALID',data:{httpStatus:401}}).mockImplementation(complete);
 render(<Platform environment="dev" databaseEnabled/>);await screen.findByText('已连接本机');click('角色库');click('创建角色');fireEvent.change(screen.getByLabelText('角色姓名'),{target:{value:'上传中保留'}});
 await upload();await screen.findByRole('button',{name:'确认上次图片命令'});
 for(const target of ['我的世界','创作一个剧本','用 角色 创作']){click(target);expect(screen.getByRole('button',{name:'确认上次图片命令'})).toBeTruthy();}
 click('确认上次图片命令');await screen.findByLabelText('本机连接码');fireEvent.change(screen.getByLabelText('本机连接码'),{target:{value:'test-code'}});click('连接本机');await screen.findByText('已连接本机');
 click('确认上次图片命令');await screen.findByText('图片已保存到本机，保存角色后生效');expect(client.beginUpload).toHaveBeenCalledOnce();expect(client.process).toHaveBeenCalledOnce();
 const calls=vi.mocked(client.completeUpload).mock.calls;expect(calls[0]![0]).toEqual(calls[2]![0]);expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('上传中保留');
});
it('an active upload survives configuration-tab unmount and applies its result in the owning Editor',async()=>{
 const {client,binding}=formal(),begin=vi.mocked(client.beginUpload).getMockImplementation()!;let finish!:()=>void;
 const gate=new Promise<void>(resolve=>{finish=resolve;});vi.mocked(client.beginUpload).mockImplementation(async input=>{const result=await begin(input);await gate;return result;});
 const save=vi.fn(async c=>c);render(<AssetProvider binding={binding}><Editor initial={{...blankStory(),character:'等待图片'}} formal characters={[]} onSave={vi.fn()} onSaveCharacter={save} onBack={vi.fn()} onPlay={vi.fn()} notice="" dialog={null}/></AssetProvider>);
 click('03角色配置');await upload();await screen.findByText('正在创建上传意图…');click('01基础信息');expect(screen.queryByLabelText('选择角色参考')).toBeNull();
 await act(async()=>finish());click('03角色配置');await screen.findByText('图片已保存到本机，保存角色后生效');click('另存为角色模板');await screen.findByText(/角色模板已保存。此剧本仍是编辑副本/);
 expect(save.mock.calls[0]![0].portraitRef).toMatchObject({kind:'formal',datasetId});expect(client.beginUpload).toHaveBeenCalledOnce();
});
it('Platform use-TA then replace-and-saveCopy submits the current image without updating the source template',async()=>{
 const {client}=formal(),c=character(),original={...await c.client.get('fixture'),portraitAssetId:v7()};
 vi.mocked(c.client.list).mockResolvedValue({items:[original],nextCursor:null,totalMatching:1});
 vi.spyOn(assetClients,'createFormalAssetClient').mockReturnValue(client);vi.spyOn(characterClients,'createCharacterClient').mockReturnValue(c.client);
 vi.spyOn(sessionClients,'createAuthoringSessionClient').mockReturnValue({session:async()=>({authenticated:true,datasetId}),connect:async()=>{},logout:async()=>{}});
 render(<Platform environment="dev" databaseEnabled/>);await screen.findByText('已连接本机');click('角色库');await screen.findByRole('button',{name:'用 角色 创作'});click('用 角色 创作');click('03角色配置');
 await upload();await screen.findByText('图片已保存到本机，保存角色后生效');click('另存为角色模板');await screen.findByText(/角色模板已保存。此剧本仍是编辑副本/);
 expect(c.client.create).toHaveBeenCalledOnce();const submitted=vi.mocked(c.client.create).mock.calls[0]![0];expect(submitted.portraitAssetId).toBeTruthy();expect(submitted.portraitAssetId).not.toBe(original.portraitAssetId);expect(c.client.update).not.toHaveBeenCalled();
});
it('original formal Editor stores three uploaded slots atomically while retaining the fixed base portrait',async()=>{
 const{StoryController}=await import('../lib/authoring/story-controller'),{storyClient,rootId,assetId,version}=await import('../lib/authoring/story-test-fixtures'),{useSyncExternalStore}=await import('react');
 const {binding,client:assets}=formal(),client=storyClient(),controller=new StoryController();controller.bind({client,connected:true,datasetId,invalidate:vi.fn()});await controller.open(rootId);
 function Form(){const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);return <AssetProvider binding={binding}><Editor story={{controller,state}} formal initial={blankStory()} characters={[]} onSave={vi.fn()} onSaveCharacter={vi.fn()} onBack={vi.fn()} onPlay={vi.fn()} notice="" dialog={null}/></AssetProvider>;}
 render(<Form/>);click('03角色配置');
 async function uploadSlot(title:string,slot:'character'|'cover'|'opening'){
  const section=screen.getByRole('heading',{name:title}).closest('section')!;
  await act(async()=>fireEvent.change(within(section).getByLabelText(`选择${title}`),{target:{files:[file(`${slot}.png`)]}}));
  const rights=within(section).getByRole('checkbox',{name:'我确认有权使用这张图片'}) as HTMLInputElement;await waitFor(()=>expect(rights.disabled).toBe(false));fireEvent.click(rights);fireEvent.click(within(section).getByRole('button',{name:'上传图片'}));
  await waitFor(()=>expect(controller.getSnapshot().fields.assetSlots[slot]).not.toBeNull());
  await waitFor(()=>expect(within(section).getByText('图片已保存到本机，保存角色后生效')).toBeTruthy());
 }
 await uploadSlot('角色参考','character');click('04画面与素材');await uploadSlot('剧本封面','cover');await uploadSlot('开场画面','opening');
 expect(client.update).not.toHaveBeenCalled();click('保存草稿');await waitFor(()=>expect(client.update).toHaveBeenCalledTimes(1));const input=client.update.mock.calls[0]![0];
 expect(new Set(Object.values(input.patch.assetSlots!)).size).toBe(3);expect(Object.values(input.patch.assetSlots!)).not.toContain(null);
 expect(input.patch.mainCharacter).toMatchObject({kind:'bound',characterVersionId:version.id,overrides:{relationship:'旧友',portrait:{mode:'asset',assetId:input.patch.assetSlots!.character}}});
 expect(controller.getSnapshot().fields.source).toMatchObject({kind:'bound',version:{portraitAssetId:assetId}});expect(assets.beginUpload).toHaveBeenCalledTimes(3);
});
