// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {CharacterLibrary} from './character-library';
import {CharacterController} from '../lib/authoring/character-controller';
import type {CharacterClient} from '../lib/authoring/character-client';
import type {CharacterDTO} from '../../runtime/src/contracts/character-template';
vi.mock('./story-assets',()=>({CharacterPortrait:({assetRef}:any)=> <div data-testid={assetRef?.kind==='formal'?'formal-portrait':'browser-portrait'}/>,useImageUpload:()=>({state:{busy:false,unknown:false,datasetChanged:false},controller:{getSnapshot:()=>({busy:false,unknown:false,datasetChanged:false}),subscribe:()=>()=>{},discardForDatasetChange:()=>true}}),ImageAssetPicker:({onBusyChange}:any)=><button type="button" onClick={()=>onBusyChange(false)}>图片完成</button>}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const datasetId='01994b80-0000-7000-8000-000000000099';
const dto=(name='A'):CharacterDTO=>({id:'01994b80-0000-7000-8000-000000000001',name,settings:{personality:'',appearance:'',speakingStyle:'',boundaries:''},portraitAssetId:'01994b80-0000-7000-8000-000000000002',revision:1,schemaVersion:1,createdAt:'2026-09-12T00:00:00.000Z',updatedAt:'2026-09-12T00:00:00.000Z',deletedAt:null,archivedAt:null});
const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name}));
const name=()=>screen.getByLabelText(/角色姓名/) as HTMLInputElement;
function setup(){const client={create:vi.fn(),get:vi.fn().mockResolvedValue(dto()),list:vi.fn().mockResolvedValue({items:[dto()],nextCursor:null,totalMatching:1}),update:vi.fn(),delete:vi.fn(),restore:vi.fn()} satisfies CharacterClient;
 const controller=new CharacterController();controller.bind({client,connected:true,datasetId,invalidate:vi.fn()});return {client,controller};}
it('formal original cards preserve server portrait references without mounting browser assets; pending A accepts B without false saved state',async()=>{
 const {client,controller}=setup(),pending=vi.fn();let finish!:(x:any)=>void;client.update.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 render(<CharacterLibrary controller={controller} onUse={vi.fn()} onPendingChange={pending}/>);await act(()=>controller.load());
 expect(screen.queryByTestId('browser-portrait')).toBeNull();click('编辑 A');await screen.findByDisplayValue('A');
 fireEvent.change(name(),{target:{value:'提交A'}});click('保存角色模板');click('保存角色模板');fireEvent.change(name(),{target:{value:'继续B'}});
 expect(client.update).toHaveBeenCalledTimes(1);expect(client.update.mock.calls[0][0].patch.portraitAssetId).toBe(dto().portraitAssetId);
 expect(screen.queryByText(/已保存到本机 SQLite/)).toBeNull();
 await act(async()=>finish({data:{...dto('提交A'),revision:2},replayed:false}));expect(name().value).toBe('继续B');
 await waitFor(()=>expect(pending).toHaveBeenLastCalledWith({dirty:true,busy:false}));
});
it('formal list/read failures stay errors, not empty fallbacks, and read retry keeps original layout',async()=>{
 const {client,controller}=setup();client.list.mockRejectedValueOnce(Error('offline'));render(<CharacterLibrary controller={controller} onUse={vi.fn()} onPendingChange={vi.fn()}/>);
 await act(()=>controller.load());expect(screen.getByRole('alert').textContent).toMatch(/列表读取失败/);expect(screen.queryByText('先认识一个人')).toBeNull();
 click('重试列表');await screen.findByRole('heading',{name:'A'});client.get.mockRejectedValueOnce(Error('offline'));click('编辑 A');await screen.findByText(/角色读取失败/);click('重试读取');await screen.findByDisplayValue('A');
});
it('demo awaits onSave, allows empty personality and does not let image completion unlock an active save',async()=>{
 let finish!:(x:any)=>void;const save=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;})),pending=vi.fn();
 render(<CharacterLibrary characters={[]} onSave={save} onUse={vi.fn()} onPendingChange={pending}/>);click('创建角色');fireEvent.change(name(),{target:{value:'😀'.repeat(120)}});
 click('保存角色模板');click('图片完成');expect(save).toHaveBeenCalledTimes(1);expect((screen.getByRole('button',{name:/保存中/}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(name(),{target:{value:'新输入'}});await act(async()=>finish(save.mock.calls[0][0]));expect(name().value).toBe('新输入');await waitFor(()=>expect(pending).toHaveBeenLastCalledWith({dirty:true,busy:false}));
});
it('uses real filters, cursor/count and lifecycle commands, retaining conflict input until explicit reload',async()=>{
 const {client,controller}=setup();vi.spyOn(window,'confirm').mockReturnValue(true);
 render(<CharacterLibrary controller={controller} onUse={vi.fn()} onPendingChange={vi.fn()}/>);await act(()=>controller.load());
 client.list.mockResolvedValueOnce({items:[dto()],nextCursor:'page-2',totalMatching:2});fireEvent.change(screen.getByLabelText('搜索角色'),{target:{value:'A'}});click('搜索');await screen.findByText('匹配 2 个角色 · 已载入 1 个');
 expect(client.list).toHaveBeenLastCalledWith({q:'A',deleted:'exclude',limit:20});client.list.mockResolvedValueOnce({items:[{...dto('AB'),id:'01994b80-0000-7000-8000-000000000003'}],nextCursor:null,totalMatching:2});click('加载更多角色');await screen.findByText('匹配 2 个角色 · 已载入 2 个');expect(client.list).toHaveBeenLastCalledWith({q:'A',deleted:'exclude',limit:20,cursor:'page-2'});
 click('编辑 A');await screen.findByDisplayValue('A');fireEvent.change(name(),{target:{value:'冲突保留'}});client.update.mockRejectedValueOnce({message:'REVISION_CONFLICT',data:{code:'CONFLICT'}});click('保存角色模板');await screen.findByText(/版本冲突/);expect(name().value).toBe('冲突保留');expect(screen.queryByRole('button',{name:'确认上次角色命令'})).toBeNull();click('重新载入角色');await screen.findByDisplayValue('A');
 const deleted={...dto(),revision:2,deletedAt:'2026-09-12T01:00:00.000Z'};client.delete.mockResolvedValueOnce({data:deleted,replayed:false});client.list.mockResolvedValue({items:[],nextCursor:null,totalMatching:0});click('删除角色');await screen.findByRole('button',{name:'恢复角色'});expect(client.delete).toHaveBeenCalledWith(expect.objectContaining({datasetId,id:dto().id,expectedRevision:1}));
 client.list.mockResolvedValueOnce({items:[deleted],nextCursor:null,totalMatching:1});click('回收站');await screen.findByRole('heading',{name:'A',level:2});expect(client.list).toHaveBeenLastCalledWith({q:'A',deleted:'only',limit:20});client.restore.mockResolvedValueOnce({data:{...dto(),revision:3},replayed:false});click('恢复角色');await screen.findByRole('button',{name:'保存角色模板'});expect(client.restore).toHaveBeenCalledWith(expect.objectContaining({datasetId,id:dto().id,expectedRevision:2}));
});
it('retry reading after a save conflict requires dirty confirmation and preserves B when declined',async()=>{
 const {client,controller}=setup(),confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<CharacterLibrary controller={controller} onUse={vi.fn()} onPendingChange={vi.fn()}/>);await act(()=>controller.load());click('编辑 A');await screen.findByDisplayValue('A');
 fireEvent.change(name(),{target:{value:'用户B'}});client.update.mockRejectedValueOnce({message:'REVISION_CONFLICT',data:{code:'CONFLICT'}});click('保存角色模板');await screen.findByText(/版本冲突/);
 client.get.mockResolvedValue({...dto('服务端C'),revision:3});const reads=client.get.mock.calls.length;click('重试读取');
 expect(confirm).toHaveBeenCalledTimes(1);expect(client.get).toHaveBeenCalledTimes(reads);expect(name().value).toBe('用户B');
 confirm.mockReturnValue(true);click('重试读取');await screen.findByDisplayValue('服务端C');expect(client.get).toHaveBeenCalledTimes(reads+1);
});
it('keeps the required name marker in the same title row and preserves accessible input semantics',()=>{
 const {controller}=setup();controller.newDraft();render(<CharacterLibrary controller={controller} onUse={vi.fn()} onPendingChange={vi.fn()}/>);
 const input=screen.getByRole('textbox',{name:'角色姓名'}) as HTMLInputElement;expect(input.required).toBe(true);
 const label=input.closest('label')!;expect(label.firstElementChild?.tagName).toBe('SPAN');expect(label.firstElementChild?.textContent).toBe('角色姓名 *');
 expect(screen.getByRole('button',{name:'有效角色'}).getAttribute('aria-pressed')).toBe('true');expect(screen.getByRole('button',{name:'回收站'}).getAttribute('aria-pressed')).toBe('false');
});
it('demo opening and saving an existing card becomes clean without serializing presentation references into the draft baseline',async()=>{
 const pending=vi.fn(),save=vi.fn(async c=>c);vi.spyOn(window,'confirm').mockReturnValue(true);
 render(<CharacterLibrary characters={[{id:'demo-character',name:'已有角色',personality:'',imageAssetId:'demo-image'}]} onSave={save} onUse={vi.fn()} onPendingChange={pending}/>);
 click('编辑 已有角色');click('保存角色模板');await screen.findByText(/角色模板已保存到当前浏览器/);
 await waitFor(()=>expect(pending).toHaveBeenLastCalledWith({dirty:false,busy:false}));
});
