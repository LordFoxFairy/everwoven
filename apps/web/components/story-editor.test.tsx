// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Editor} from './story-editor';
import {blankStory} from '../lib/presentation/new-story';
vi.mock('./story-assets',()=>({useStoryArtwork:()=>({url:'',missing:false}),useAssetBinding:()=>null,useImageUpload:()=>({state:{busy:false,unknown:false,datasetChanged:false},controller:{getSnapshot:()=>({busy:false,unknown:false,datasetChanged:false}),discardForDatasetChange:()=>true}}),ImageAssetPicker:({onBusyChange}:any)=><button type="button" onClick={()=>onBusyChange(false)}>图片完成</button>}));
afterEach(cleanup);
it('awaits confirmed character save, locks same-frame clicks independently of image busy and preserves later input',async()=>{
 let finish!:(x:any)=>void;const save=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;})),back=vi.fn();
 render(<Editor initial={{...blankStory(),character:'A',personality:''}} characters={[]} onSave={async()=>{throw Error('not saved');}} onSaveCharacter={save} onBack={back} onPlay={vi.fn()} notice="" dialog={null}/>);
 fireEvent.click(screen.getByRole('button',{name:/角色配置/}));const button=screen.getByRole('button',{name:'另存为角色模板'});fireEvent.click(button);fireEvent.click(button);expect(save).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'图片完成'}));expect(screen.queryByText(/角色模板已保存。/)).toBeNull();expect((screen.getByRole('button',{name:'我的剧本'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText(/角色姓名/),{target:{value:'B'}});await act(async()=>finish(save.mock.calls[0][0]));expect((screen.getByLabelText(/角色姓名/) as HTMLInputElement).value).toBe('B');await screen.findByText(/当前角色还有未另存的修改/);
});
it('keeps editor input after a structured failure instead of treating Promise as true',async()=>{
 render(<Editor initial={{...blankStory(),character:'角色'}} characters={[]} onSave={async()=>{throw Error('not saved');}} onSaveCharacter={vi.fn().mockRejectedValue({data:{code:'CONFLICT'},message:'REVISION_CONFLICT'})} onBack={vi.fn()} onPlay={vi.fn()} notice="" dialog={null}/>);
 fireEvent.click(screen.getByRole('button',{name:/角色配置/}));fireEvent.click(screen.getByRole('button',{name:'另存为角色模板'}));await screen.findByText(/角色另存失败/);expect((screen.getByLabelText(/角色姓名/) as HTMLInputElement).value).toBe('角色');
});
it('awaits actual demo save before success/preparation and retains later edits',async()=>{
 let resolve!:(value:any)=>void;const save=vi.fn((_story:import('../../../packages/domain/src/story').Story)=>new Promise<any>(yes=>{resolve=yes;})),play=vi.fn();
 render(<Editor initial={{...blankStory(),title:'A'}} characters={[]} onSave={save} onSaveCharacter={vi.fn()} onBack={vi.fn()} onPlay={play} notice="" dialog={null}/>);
 const button=screen.getByRole('button',{name:'保存并进入准备'});fireEvent.click(button);fireEvent.click(button);expect(save).toHaveBeenCalledTimes(1);expect(play).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText(/剧本名称/),{target:{value:'B'}});await act(async()=>resolve(save.mock.calls[0]![0]));
 expect(play).toHaveBeenCalledTimes(1);expect(play.mock.calls[0]![0].title).toBe('A');expect((screen.getByLabelText(/剧本名称/) as HTMLInputElement).value).toBe('B');
});
it('formal aggregate uses original Editor fields and awaits one complete save',async()=>{
 const {StoryController}=await import('../lib/authoring/story-controller');const{storyClient,datasetId}=await import('../lib/authoring/story-test-fixtures');const{useSyncExternalStore}=await import('react');
 const controller=new StoryController(),client=storyClient();controller.bind({client,connected:true,datasetId,invalidate:vi.fn()});controller.newDraft();
 function Form(){const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);return <Editor story={{controller,state}} formal initial={blankStory()} characters={[]} onSave={vi.fn()} onSaveCharacter={vi.fn()} onBack={vi.fn()} onPlay={vi.fn()} notice="" dialog={null}/>;}
 render(<Form/>);fireEvent.change(screen.getByLabelText(/剧本名称/),{target:{value:'原聚合'}});fireEvent.click(screen.getByRole('button',{name:/世界与开局/}));
 fireEvent.change(screen.getByLabelText('玩家身份'),{target:{value:'调查员'}});fireEvent.change(screen.getByLabelText('世界规则（每行一条）'),{target:{value:'一\n二'}});fireEvent.change(screen.getByLabelText('叙事语气'),{target:{value:'温柔'}});
 fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));await waitFor(()=>expect(client.create).toHaveBeenCalledTimes(1));expect(client.create.mock.calls[0]![0]).toMatchObject({title:'原聚合',settings:{playerRole:'调查员',worldRules:['一','二'],tone:'温柔'},mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}});
});
it('formal title accepts the frozen 120-codepoint budget without a UTF-16 input cap',async()=>{
 const {StoryController}=await import('../lib/authoring/story-controller');const{storyClient,datasetId}=await import('../lib/authoring/story-test-fixtures');const{useSyncExternalStore}=await import('react');
 const controller=new StoryController(),client=storyClient();controller.bind({client,connected:true,datasetId,invalidate:vi.fn()});controller.newDraft();
 function Form(){const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);return <Editor story={{controller,state}} formal initial={blankStory()} characters={[]} onSave={vi.fn()} onSaveCharacter={vi.fn()} onBack={vi.fn()} onPlay={vi.fn()} notice="" dialog={null}/>;}
 render(<Form/>);const input=screen.getByLabelText(/剧本名称/) as HTMLInputElement;
 expect(input.maxLength).toBe(-1);fireEvent.change(input,{target:{value:'🌌'.repeat(120)}});fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
 await waitFor(()=>expect(client.create).toHaveBeenCalledTimes(1));expect(client.create.mock.calls[0]![0].title).toBe('🌌'.repeat(120));
});
it('has one unambiguous original-command confirmation in the assets section',async()=>{
 const {StoryController}=await import('../lib/authoring/story-controller');const{storyClient,datasetId}=await import('../lib/authoring/story-test-fixtures');const{useSyncExternalStore}=await import('react');
 const controller=new StoryController(),client=storyClient();controller.bind({client,connected:true,datasetId,invalidate:vi.fn()});controller.newDraft();controller.field('title','A');client.create.mockRejectedValueOnce(Error('lost'));
 function Form(){const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);return <Editor story={{controller,state}} formal initial={blankStory()} characters={[]} onSave={vi.fn()} onSaveCharacter={vi.fn()} onBack={vi.fn()} onPlay={vi.fn()} notice="" dialog={null}/>;}
 render(<Form/>);fireEvent.click(screen.getByRole('button',{name:/画面与素材/}));fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
 await waitFor(()=>expect(controller.getSnapshot().unknown).toBe(true));expect(screen.getAllByRole('button',{name:'确认上次剧本命令'})).toHaveLength(1);
});
it.each(['resolve','reject'] as const)('same-dataset reconnect releases the old Editor save lock; late %s cannot release a new confirmation',async completion=>{
 const {StoryController}=await import('../lib/authoring/story-controller');const{storyClient,datasetId,deferred,draft}=await import('../lib/authoring/story-test-fixtures');const{useSyncExternalStore}=await import('react');
 const controller=new StoryController(),client=storyClient(),binding={client,connected:true,datasetId,invalidate:vi.fn()},old=deferred<import('runtime/contracts/story-draft').DraftCommandResult>(),confirmation=deferred<import('runtime/contracts/story-draft').DraftCommandResult>();
 controller.bind(binding);controller.newDraft();controller.field('title','A');client.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(confirmation.promise);
 const prepared=vi.fn(),back=vi.fn();
 function Form({epoch}:{epoch:unknown}){const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);return <Editor story={{controller,state}} characterEpoch={epoch} formal initial={blankStory()} characters={[]} onSave={vi.fn()} onSaveCharacter={vi.fn()} onBack={back} onPlay={vi.fn()} onPrepared={prepared} notice="" dialog={null}/>;}
 const ui=render(<Form epoch={binding.invalidate}/>);fireEvent.click(screen.getByRole('button',{name:'保存并进入准备'}));expect(client.create).toHaveBeenCalledTimes(1);const original=structuredClone(client.create.mock.calls[0]![0]);
 const disconnected={...binding,connected:false,invalidate:vi.fn()};act(()=>controller.bind(disconnected));ui.rerender(<Form epoch={disconnected.invalidate}/>);
 const reconnected={...binding,invalidate:vi.fn()};act(()=>controller.bind(reconnected));ui.rerender(<Form epoch={reconnected.invalidate}/>);
 expect(controller.getSnapshot()).toMatchObject({connected:true,saving:false,unknown:true});
 await waitFor(()=>expect((screen.getByRole('button',{name:'确认上次剧本命令'}) as HTMLButtonElement).disabled).toBe(false));
 expect((screen.getByRole('button',{name:'我的剧本'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.click(screen.getByRole('button',{name:'我的剧本'}));expect(back).not.toHaveBeenCalled();expect(client.create).toHaveBeenCalledTimes(1);
 fireEvent.change(screen.getByLabelText(/剧本名称/),{target:{value:'B'}});fireEvent.click(screen.getByRole('button',{name:'确认上次剧本命令'}));expect(client.create).toHaveBeenCalledTimes(2);expect(client.create.mock.calls[1]![0]).toEqual(original);
 const ack={data:draft({title:'A',mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}}),replayed:true};
 await act(async()=>{if(completion==='resolve')old.resolve(ack);else old.reject(Error('late failure'));});
 expect((screen.getByRole('button',{name:'确认上次剧本命令'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'我的剧本'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'确认上次剧本命令'}));expect(client.create).toHaveBeenCalledTimes(2);expect(prepared).not.toHaveBeenCalled();
 await act(async()=>confirmation.resolve(ack));await waitFor(()=>expect((screen.getByRole('button',{name:'保存草稿'}) as HTMLButtonElement).disabled).toBe(false));expect((screen.getByLabelText(/剧本名称/) as HTMLInputElement).value).toBe('B');expect(controller.getSnapshot()).toMatchObject({unknown:false,dirty:true});expect(prepared).not.toHaveBeenCalled();
});
it('an old finally cannot unlock a newer Editor save attempt even without a controller busy flag',async()=>{
 const{deferred}=await import('../lib/authoring/story-test-fixtures');const old=deferred<ReturnType<typeof blankStory>>(),next=deferred<ReturnType<typeof blankStory>>(),initial={...blankStory(),title:'A'},save=vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
 const props={initial,characters:[],onSave:save,onSaveCharacter:vi.fn(),onBack:vi.fn(),onPlay:vi.fn(),notice:'',dialog:null};
 const ui=render(<Editor {...props} characterEpoch={1}/>);fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));ui.rerender(<Editor {...props} characterEpoch={2}/>);
 fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));expect(save).toHaveBeenCalledTimes(2);await act(async()=>old.resolve(initial));
 expect((screen.getByRole('button',{name:'保存草稿'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));expect(save).toHaveBeenCalledTimes(2);
 await act(async()=>next.resolve(initial));expect((screen.getByRole('button',{name:'保存草稿'}) as HTMLButtonElement).disabled).toBe(false);
});
