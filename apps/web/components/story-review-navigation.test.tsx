// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Platform} from './platform';
import {createStoryDraftClient} from '../lib/authoring/story-client';
import {createAuthoringSessionClient} from '../lib/authoring/session-client';
import {storyClient,datasetId,otherDataset,draft} from '../lib/authoring/story-test-fixtures';
import {StoryClientError} from '../lib/authoring/story-ports';
vi.mock('../lib/authoring/story-client',()=>({createStoryDraftClient:vi.fn()}));
vi.mock('../lib/authoring/session-client',()=>({createAuthoringSessionClient:vi.fn()}));
vi.mock('../lib/authoring/character-client',()=>({createCharacterClient:()=>({list:async()=>({items:[],nextCursor:null,totalMatching:0})})}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function setup(){
 const client=storyClient(),session={session:vi.fn().mockResolvedValue({authenticated:true,datasetId}),connect:vi.fn().mockResolvedValue({authenticated:true,datasetId}),logout:vi.fn().mockResolvedValue(undefined)};
 client.get.mockResolvedValue(draft({mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}}));
 client.delete.mockResolvedValue({data:draft({revision:2,deletedAt:'2026-09-12T00:00:00.000Z',mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}}),replayed:false});client.restore.mockResolvedValue({data:draft({revision:3,mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}}),replayed:false});
 client.list.mockImplementation(async input=>({protocolVersion:1,datasetId:input.datasetId,items:input.datasetId===datasetId?[{...draft(),genre:'奇幻',mainCharacterName:null,coverAssetId:null}]:[],nextCursor:null,totalMatching:input.datasetId===datasetId?1:0}));
 vi.mocked(createStoryDraftClient).mockReturnValue(client);vi.mocked(createAuthoringSessionClient).mockReturnValue(session);
 render(<Platform environment="dev" databaseEnabled/>);await screen.findByText('已连接本机');return{client,session};
}
async function reconnect(session:Awaited<ReturnType<typeof setup>>['session']){
 session.session.mockResolvedValue({authenticated:true,datasetId:otherDataset});fireEvent.click(screen.getByRole('button',{name:'重新连接'}));await screen.findByText('已连接本机');
}
it.each(['delete','restore'] as const)('completed list %s does not strand home after 401 and a dataset switch',async kind=>{
 const {client,session}=await setup();fireEvent.click(screen.getByRole('button',{name:'我的剧本'}));if(kind==='restore')fireEvent.click(screen.getByRole('button',{name:'回收列表'}));
 const action=`${kind==='delete'?'删除':'恢复'}剧本 聚合A`;fireEvent.click(await screen.findByRole('button',{name:action}));await waitFor(()=>expect(client[kind]).toHaveBeenCalledTimes(1));await waitFor(()=>expect((screen.getByRole('button',{name:action}) as HTMLButtonElement).disabled).toBe(false));
 client.list.mockRejectedValueOnce(new StoryClientError('LOCAL_SESSION_INVALID',401,'rejected'));fireEvent.click(screen.getByRole('button',{name:'刷新剧本'}));await screen.findByRole('button',{name:'重新连接'});
 fireEvent.click(screen.getByRole('button',{name:'我的世界'}));expect(screen.getByRole('button',{name:'我的世界'}).getAttribute('aria-current')).toBe('page');await reconnect(session);
 fireEvent.click(screen.getByRole('button',{name:'我的剧本'}));expect(await screen.findByRole('heading',{name:'我的剧本'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'从保留文本新建剧本'})).toBeNull();expect(screen.queryByText('上次保存结果待确认，请先确认原命令再离开。')).toBeNull();
 await waitFor(()=>expect(client.list.mock.calls.at(-1)?.[0].datasetId).toBe(otherDataset));expect(client[kind]).toHaveBeenCalledTimes(1);
});
it('a real unknown list command still blocks leaving and only explicit recovery can create in a new dataset',async()=>{
 const {client,session}=await setup();client.delete.mockRejectedValueOnce(Error('lost receipt'));fireEvent.click(screen.getByRole('button',{name:'我的剧本'}));fireEvent.click(await screen.findByRole('button',{name:'删除剧本 聚合A'}));await screen.findByRole('button',{name:'确认上次剧本命令'});
 fireEvent.click(screen.getByRole('button',{name:'我的世界'}));expect(screen.getByRole('heading',{name:'我的剧本'})).toBeTruthy();
 client.list.mockRejectedValueOnce(new StoryClientError('LOCAL_SESSION_INVALID',401,'rejected'));fireEvent.click(screen.getByRole('button',{name:'刷新剧本'}));await screen.findByRole('button',{name:'重新连接'});await reconnect(session);
 expect(screen.queryByRole('button',{name:'确认上次剧本命令'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'我的世界'}));expect(screen.getByRole('heading',{name:'我的剧本'})).toBeTruthy();expect(client.delete).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'从保留文本新建剧本'}));expect((screen.getByLabelText(/剧本名称/) as HTMLInputElement).value).toBe('聚合A');fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
 await waitFor(()=>expect(client.create).toHaveBeenCalledTimes(1));expect(client.create.mock.calls[0]![0]).toMatchObject({datasetId:otherDataset,mainCharacter:null,assetSlots:{cover:null,opening:null,character:null}});expect(client.delete).toHaveBeenCalledTimes(1);
});
it.each(['Escape','返回编辑'])('formal preparation focuses/traps Tab and restores its invoking button after %s',async close=>{
 await setup();const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'创作一个剧本'}));await user.type(screen.getByLabelText(/剧本名称/),'准备A');
 const trigger=screen.getByRole('button',{name:'保存并进入准备'});await user.click(trigger);const dialog=await screen.findByRole('dialog',{name:'正式故事准备'}),back=screen.getByRole('button',{name:'返回编辑'});
 await waitFor(()=>expect(document.activeElement).toBe(back));await user.tab();expect(dialog.contains(document.activeElement)).toBe(true);await user.tab({shift:true});expect(dialog.contains(document.activeElement)).toBe(true);
 if(close==='Escape')await user.keyboard('{Escape}');else await user.click(back);
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'正式故事准备'})).toBeNull());await waitFor(()=>expect(document.activeElement).toBe(trigger));
});
