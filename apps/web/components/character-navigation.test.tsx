// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {Platform} from './platform';
import * as sessionContext from '../lib/authoring/session-context';
import * as editorModule from './story-editor';
import {createAuthoringSessionClient} from '../lib/authoring/session-client';
import {createCharacterClient} from '../lib/authoring/character-client';
import type {CharacterDTO} from '../../runtime/src/contracts/character-template';
vi.mock('../lib/authoring/session-client',()=>({createAuthoringSessionClient:vi.fn()}));
vi.mock('../lib/authoring/character-client',()=>({createCharacterClient:vi.fn()}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const datasetId='01994b80-0000-7000-8000-000000000099';
const dto=(name='原角色'):CharacterDTO=>({id:'01994b80-0000-7000-8000-000000000001',name,settings:{personality:'',appearance:'',speakingStyle:'',boundaries:''},portraitAssetId:null,revision:1,schemaVersion:1,createdAt:'2026-09-12T00:00:00.000Z',updatedAt:'2026-09-12T00:00:00.000Z',deletedAt:null,archivedAt:null});
function setup(){const session={session:vi.fn().mockResolvedValue({authenticated:true,datasetId}),connect:vi.fn().mockResolvedValue({authenticated:true,datasetId}),logout:vi.fn()};const client={list:vi.fn().mockResolvedValue({items:[],nextCursor:null,totalMatching:0}),get:vi.fn().mockResolvedValue(dto()),create:vi.fn().mockImplementation(async input=>({data:{...dto(input.name),settings:input.settings},replayed:false})),update:vi.fn(),delete:vi.fn(),restore:vi.fn()};vi.mocked(createAuthoringSessionClient).mockReturnValue(session);vi.mocked(createCharacterClient).mockReturnValue(client);return{session,client};}
const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name}));
const change=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
it('enters original formal characters directly, connects above navigation, and never touches failing browser storage',async()=>{
 const {session,client}=setup();session.session.mockResolvedValueOnce({authenticated:false});session.connect.mockRejectedValueOnce(Error('offline'));const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('no storage');}),write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('no storage');});
 render(<Platform environment="dev" databaseEnabled/>);click('角色库');await screen.findByRole('button',{name:'重新连接'});click('创建角色');change('角色姓名','未连接输入');
 click('重新连接');await screen.findByText('已连接本机');
 expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('未连接输入');click('保存角色模板');await screen.findByText('角色模板已保存到本机 SQLite。');
 expect(client.create).toHaveBeenCalledTimes(1);expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
it('keeps unknown mounted across sidebar/Create/onUse, reconnects same dataset and confirms the exact command',async()=>{
 const {session,client}=setup();client.list.mockResolvedValue({items:[dto()],nextCursor:null,totalMatching:1});
 const receipts=new Map<string,ReturnType<typeof dto>>();let writes=0,requests=0;
 client.create.mockImplementation(async input=>{requests++;if(requests===2)throw {status:401};let saved=receipts.get(input.commandId);if(!saved){saved={...dto(input.name),settings:input.settings};receipts.set(input.commandId,saved);writes++;}if(requests===1)throw Error('response lost after write');return {data:saved,replayed:requests>1};});
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
 render(<Platform environment="dev" databaseEnabled/>);click('角色库');await screen.findByText('已连接本机');click('创建角色');change('角色姓名','原提交');click('保存角色模板');await screen.findByRole('button',{name:'确认上次角色命令'});
 for(const target of ['我的剧本','创作一个剧本','用 原角色 创作']){click(target);expect(screen.getByRole('button',{name:'确认上次角色命令'})).toBeTruthy();}expect(confirm).not.toHaveBeenCalled();
 click('确认上次角色命令');await screen.findByRole('button',{name:'重新连接'});change('角色姓名','后来输入');click('重新连接');await screen.findByText('已连接本机');
 click('确认上次角色命令');await screen.findByText('原命令已确认；后续修改尚需保存。');expect(client.create.mock.calls[0][0]).toEqual(client.create.mock.calls[2][0]);expect(writes).toBe(1);expect(receipts.size).toBe(1);expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('后来输入');
});
it('demo edits use browser only and issue no formal session/character requests',async()=>{
 const {session,client}=setup();render(<Platform environment="demo"/>);await screen.findByRole('button',{name:'角色库'});click('角色库');click('创建角色');change('角色姓名','演练');click('保存角色模板');await screen.findByText(/角色模板已保存到当前浏览器/);
 expect(session.session).not.toHaveBeenCalled();expect(client.create).not.toHaveBeenCalled();expect(client.list).not.toHaveBeenCalled();
});
it('different-dataset reconnect retains original input and requires explicit new creation without retargeting the pending command',async()=>{
 const {session,client}=setup();client.create.mockRejectedValueOnce(Error('lost')).mockRejectedValueOnce({status:401});render(<Platform environment="dev" databaseEnabled/>);click('角色库');await screen.findByText('已连接本机');click('创建角色');change('角色姓名','旧输入');change('相处边界','边界文本');click('保存角色模板');await screen.findByRole('button',{name:'确认上次角色命令'});const original=client.create.mock.calls[0][0];
 click('确认上次角色命令');await screen.findByRole('button',{name:'重新连接'});session.session.mockResolvedValue({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000098'});click('重新连接');await screen.findByRole('button',{name:'从保留文本新建角色'});
 expect(client.create).toHaveBeenCalledTimes(2);expect(client.create.mock.calls[1][0]).toEqual(original);expect(screen.queryByRole('button',{name:'确认上次角色命令'})).toBeNull();expect((screen.getByLabelText('相处边界') as HTMLTextAreaElement).value).toBe('边界文本');
 click('从保留文本新建角色');click('保存角色模板');await screen.findByText('角色模板已保存到本机 SQLite。');expect(client.create.mock.calls[2][0]).toMatchObject({datasetId:'01994b80-0000-7000-8000-000000000098',name:'旧输入'});expect(client.create.mock.calls[2][0].commandId).not.toBe(original.commandId);
});
it('onUse carries a formal editable source, never writes a story or reads browser portraits, and Editor saves a new character copy',async()=>{
 const {client}=setup();client.list.mockResolvedValue({items:[dto()],nextCursor:null,totalMatching:1});const write=vi.spyOn(Storage.prototype,'setItem');
 render(<Platform environment="dev" databaseEnabled/>);click('角色库');await screen.findByRole('button',{name:'用 原角色 创作'});click('用 原角色 创作');
 expect((screen.getByRole('button',{name:'保存草稿'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByRole('button',{name:'保存并进入准备'}) as HTMLButtonElement).disabled).toBe(false);
 click('03角色配置');change('角色姓名 *','编辑器副本');click('另存为角色模板');await screen.findByText(/角色模板已保存。此剧本仍是编辑副本/);
 expect(client.create.mock.calls[0][0].name).toBe('编辑器副本');expect(client.update).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(screen.getByLabelText('选择角色参考')).toBeTruthy();expect(screen.getByRole('checkbox',{name:'我确认有权使用这张图片'})).toBeTruthy();expect((screen.getByRole('button',{name:'上传图片'}) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps connection controls inside the shell content and the mounted Editor content',async()=>{
 const {session}=setup();session.session.mockResolvedValue({authenticated:false});session.connect.mockRejectedValueOnce(Error('offline'));render(<Platform environment="dev" databaseEnabled/>);
 const retry=await screen.findByRole('button',{name:'重新连接'});expect(retry.closest('main')?.id).toBe('main');click('创作一个剧本');
 expect(screen.getByRole('button',{name:'重新连接'}).closest('main')?.className).toBe('editor-main');click('03角色配置');change('角色姓名 *','连接中保留');
 session.session.mockResolvedValue({authenticated:true,datasetId});click('重新连接');await screen.findByText('已连接本机');expect((screen.getByLabelText('角色姓名 *') as HTMLInputElement).value).toBe('连接中保留');
});
it('first sidebar click enters characters while the connected home background list is pending',async()=>{
 const {client}=setup();let resolve!:(value:unknown)=>void;client.list.mockReturnValueOnce(new Promise(r=>{resolve=r;}));render(<Platform environment="dev" databaseEnabled/>);await screen.findByText('已连接本机');
 expect(client.list).toHaveBeenCalledTimes(1);click('角色库');expect(screen.getByRole('heading',{name:'角色库'})).toBeTruthy();expect(screen.getByText('正在读取角色列表…')).toBeTruthy();
 click('我的世界');expect(screen.getByRole('heading',{name:'让想象发生。让故事，属于你。'})).toBeTruthy();await act(async()=>resolve({items:[],nextCursor:null,totalMatching:0}));
});
it('a pending write still blocks sidebar and Create navigation until its acknowledgement',async()=>{
 const {client}=setup();let resolve!:(value:unknown)=>void;client.create.mockReturnValueOnce(new Promise(r=>{resolve=r;}));render(<Platform environment="dev" databaseEnabled/>);click('角色库');await screen.findByText('已连接本机');click('创建角色');change('角色姓名','等待写入');click('保存角色模板');
 for(const target of ['我的世界','创作一个剧本']){click(target);expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('等待写入');}await act(async()=>resolve({data:dto('等待写入'),replayed:false}));click('我的世界');expect(screen.getByRole('heading',{name:'让想象发生。让故事，属于你。'})).toBeTruthy();
});
it.each(['','B'.repeat(121)])('Editor confirms immutable unknown A even when current name is invalid (%s)',async invalidName=>{
 const {client}=setup();client.create.mockRejectedValueOnce(Error('response lost'));
 render(<Platform environment="dev" databaseEnabled/>);await screen.findByText('已连接本机');click('创作一个剧本');click('03角色配置');change('角色姓名 *','提交A');click('另存为角色模板');await screen.findByText(/角色另存失败/);
 const original=client.create.mock.calls[0][0];change('角色姓名 *',invalidName);click('确认上次角色命令');
 await screen.findByText(/已确认提交的角色；当前角色还有未另存的修改/);expect(client.create).toHaveBeenCalledTimes(2);expect(client.create.mock.calls[1][0]).toEqual(original);expect((screen.getByLabelText('角色姓名 *') as HTMLInputElement).value).toBe(invalidName);expect(client.update).not.toHaveBeenCalled();
});
it('home reconnects A to B without ever editing characters and can navigate immediately',async()=>{
 const {session,client}=setup();client.list.mockRejectedValueOnce({status:401});render(<Platform environment="dev" databaseEnabled/>);await screen.findByRole('button',{name:'重新连接'});
 session.session.mockResolvedValue({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000098'});click('重新连接');await screen.findByText('已连接本机');click('角色库');
 expect(screen.getByRole('heading',{name:'角色库'})).toBeTruthy();expect(screen.queryByRole('button',{name:'从保留文本新建角色'})).toBeNull();expect(client.create).not.toHaveBeenCalled();
});
it('a retained character on home can reach only its recovery page after cross-dataset reconnect',async()=>{
 const {session,client}=setup();vi.spyOn(window,'confirm').mockReturnValue(true);render(<Platform environment="dev" databaseEnabled/>);click('角色库');await screen.findByText('已连接本机');click('创建角色');change('角色姓名','保留在首页');change('相处边界','原边界');
 let reject!:(reason:unknown)=>void;client.list.mockReturnValueOnce(new Promise((_,no)=>{reject=no;}));click('刷新角色');click('我的世界');expect(screen.getByRole('heading',{name:'让想象发生。让故事，属于你。'})).toBeTruthy();await act(async()=>reject({status:401}));await screen.findByRole('button',{name:'重新连接'});
 session.session.mockResolvedValue({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000098'});click('重新连接');await screen.findByText('已连接本机');
 for(const target of ['剧本广场','创作一个剧本']){click(target);expect(screen.getByRole('heading',{name:'让想象发生。让故事，属于你。'})).toBeTruthy();}
 click('角色库');expect(screen.getByRole('button',{name:'从保留文本新建角色'})).toBeTruthy();expect((screen.getByLabelText('角色姓名') as HTMLInputElement).value).toBe('保留在首页');expect((screen.getByLabelText('相处边界') as HTMLTextAreaElement).value).toBe('原边界');expect(client.create).not.toHaveBeenCalled();
 click('从保留文本新建角色');click('保存角色模板');await screen.findByText('角色模板已保存到本机 SQLite。');expect(client.create).toHaveBeenCalledTimes(1);expect(client.create.mock.calls[0][0]).toMatchObject({datasetId:'01994b80-0000-7000-8000-000000000098',name:'保留在首页'});
});

it('direct card-to-Editor source from A requires explicit recovery before first save in B, including the Platform callback',async()=>{
 const {session,client}=setup(),portraitAssetId='01994b80-0000-7000-8000-000000000077';
 client.list.mockResolvedValue({items:[{...dto('带头像A'),portraitAssetId}],nextCursor:null,totalMatching:1});
 const useSession=sessionContext.useAuthoringSession,RealEditor=editorModule.Editor;
 let connection!:ReturnType<typeof useSession>,editorProps!:Parameters<typeof RealEditor>[0];
 vi.spyOn(sessionContext,'useAuthoringSession').mockImplementation(()=>{connection=useSession();return connection;});
 vi.spyOn(editorModule,'Editor').mockImplementation(props=>{editorProps=props;return <RealEditor {...props}/>;});
 render(<Platform environment="dev" databaseEnabled/>);click('角色库');await screen.findByRole('button',{name:'用 带头像A 创作'});click('用 带头像A 创作');click('03角色配置');change('角色姓名 *','尚未另存的文本');change('相处边界','保留边界');
 expect(client.get).not.toHaveBeenCalled();expect(client.create).not.toHaveBeenCalled();expect(client.update).not.toHaveBeenCalled();
 session.session.mockResolvedValueOnce({authenticated:false});session.connect.mockRejectedValueOnce(Error('offline'));await act(()=>connection.refresh());await screen.findByRole('button',{name:'重新连接'});session.session.mockResolvedValue({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000098'});click('重新连接');await screen.findByText('已连接本机');
 // Calling the Platform callback directly must also reject, not merely rely on a disabled button.
 await act(async()=>{await expect(editorProps.onSaveCharacter({id:'working-copy',name:'绕过按钮',personality:'',portraitRef:null})).rejects.toThrow('DATASET_CHANGED');});
 expect(client.create).not.toHaveBeenCalled();expect(client.update).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'从保留文本新建剧本'})).toBeTruthy();
 expect((screen.getByRole('button',{name:'确认上次角色命令'}) as HTMLButtonElement).disabled).toBe(true);click('我的剧本');expect((screen.getByLabelText('角色姓名 *') as HTMLInputElement).value).toBe('尚未另存的文本');
 click('从保留文本新建剧本');expect(editorProps.characterSource).toBeUndefined();expect(screen.queryByRole('button',{name:'从保留文本新建剧本'})).toBeNull();expect((screen.getByLabelText('相处边界') as HTMLTextAreaElement).value).toBe('保留边界');click('另存为角色模板');await screen.findByText(/角色模板已保存。此剧本仍是编辑副本/);
 expect(client.create).toHaveBeenCalledTimes(1);expect(client.create.mock.calls[0][0]).toMatchObject({datasetId:'01994b80-0000-7000-8000-000000000098',name:'尚未另存的文本',settings:{boundaries:'保留边界'},portraitAssetId:null});expect(client.update).not.toHaveBeenCalled();
});
