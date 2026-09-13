// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Platform} from './platform';
import {createStoryDraftClient} from '../lib/authoring/story-client';
import {storyClient,datasetId,draft} from '../lib/authoring/story-test-fixtures';
import {StoryClientError} from '../lib/authoring/story-ports';
vi.mock('../lib/authoring/story-client',()=>({createStoryDraftClient:vi.fn()}));
vi.mock('../lib/authoring/session-client',()=>({createAuthoringSessionClient:()=>({session:async()=>({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000099'}),connect:async()=>{},logout:async()=>{}})}));
vi.mock('../lib/authoring/character-client',()=>({createCharacterClient:()=>({list:async()=>({items:[],nextCursor:null,totalMatching:0})})}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('original Studio retains its unknown command after exact 400 and blocks leaving, with no browser fallback',async()=>{
 const client=storyClient();vi.mocked(createStoryDraftClient).mockReturnValue(client);client.create.mockRejectedValueOnce(Error('lost')).mockRejectedValueOnce(new StoryClientError('INVALID_STORY_COMMAND',400,'rejected'));
 const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('browser prohibited');});render(<Platform environment="dev" databaseEnabled/>);await screen.findByText('已连接本机');
 fireEvent.click(screen.getByRole('button',{name:'创作一个剧本'}));fireEvent.change(screen.getByLabelText(/剧本名称/),{target:{value:'A'}});fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
 await screen.findByRole('button',{name:'确认上次剧本命令'});fireEvent.change(screen.getByLabelText(/剧本名称/),{target:{value:'B'}});fireEvent.click(screen.getByRole('button',{name:'确认上次剧本命令'}));
 await waitFor(()=>expect(client.create).toHaveBeenCalledTimes(2));await waitFor(()=>expect((screen.getByRole('button',{name:'确认上次剧本命令'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'我的剧本'}));expect(screen.getByRole('button',{name:'确认上次剧本命令'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'确认上次剧本命令'}));await waitFor(()=>expect(client.create).toHaveBeenCalledTimes(3));expect(new Set(client.create.mock.calls.map(([x])=>x.commandId)).size).toBe(1);expect((screen.getByLabelText(/剧本名称/) as HTMLInputElement).value).toBe('B');expect(storage).not.toHaveBeenCalled();
});
it('original library opens the full aggregate, deletes/restores, and preparation never starts demo gameplay',async()=>{
 const client=storyClient();vi.mocked(createStoryDraftClient).mockReturnValue(client);client.list.mockResolvedValue({protocolVersion:1,datasetId,items:[{...draft(),genre:'奇幻',mainCharacterName:'A',coverAssetId:null}],nextCursor:null,totalMatching:1});
 render(<Platform environment="dev" databaseEnabled/>);await screen.findByText('已连接本机');fireEvent.click(screen.getByRole('button',{name:'我的剧本'}));
 fireEvent.click(await screen.findByRole('button',{name:'打开剧本 聚合A'}));await screen.findByDisplayValue('聚合A');fireEvent.click(screen.getByRole('button',{name:/世界与开局/}));expect((screen.getByLabelText('玩家身份') as HTMLTextAreaElement).value).toBe('调查员');
 fireEvent.click(screen.getByRole('button',{name:'保存并进入准备'}));await screen.findByRole('dialog',{name:'正式故事准备'});expect(screen.getByText(/生成尚未接通/)).toBeTruthy();expect(screen.queryByText('开始演练')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'返回编辑'}));fireEvent.click(screen.getByRole('button',{name:'我的剧本'}));
 fireEvent.click(await screen.findByRole('button',{name:'删除剧本 聚合A'}));await waitFor(()=>expect(client.delete).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByRole('button',{name:'回收列表'}));fireEvent.click(await screen.findByRole('button',{name:'恢复剧本 聚合A'}));await waitFor(()=>expect(client.restore).toHaveBeenCalledTimes(1));
});
