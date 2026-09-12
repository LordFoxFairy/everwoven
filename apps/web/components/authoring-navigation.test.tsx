// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Platform} from './platform';
import {createDatabaseDraftsClient} from '../lib/authoring/database-client';
import type {DatabaseDraftsClient} from '../lib/authoring/ports';
vi.mock('../lib/authoring/database-client',()=>({createDatabaseDraftsClient:vi.fn()}));
afterEach(()=>{cleanup(); localStorage.clear(); vi.restoreAllMocks();});
it('keeps an unknown command mounted across sidebar, storage-tab and create navigation',async()=>{
 const client={
  session:vi.fn().mockResolvedValue({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000099'}),connect:vi.fn(),logout:vi.fn(),
  list:vi.fn().mockResolvedValue({items:[],nextCursor:null}),get:vi.fn(),
  create:vi.fn<DatabaseDraftsClient['create']>().mockRejectedValue(new Error('response lost')),update:vi.fn(),delete:vi.fn(),restore:vi.fn(),
 } satisfies DatabaseDraftsClient;
 vi.mocked(createDatabaseDraftsClient).mockReturnValue(client);
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
 render(<Platform environment="dev" databaseEnabled/>);
 const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'我的剧本'}));
 await user.click(screen.getByRole('button',{name:'本机数据库'}));
 await user.click(await screen.findByRole('button',{name:'新建数据库草稿'}));
 await user.type(screen.getByLabelText('标题',{exact:true}),'等待确认');
 await user.click(screen.getByRole('button',{name:'创建草稿'}));
 await screen.findByRole('button',{name:'确认上次保存'});
 for(const name of ['角色库','浏览器草稿','创作一个剧本']){
  await user.click(screen.getByRole('button',{name}));
  expect(screen.queryByRole('button',{name:'确认上次保存'})).not.toBeNull();
 }
 expect(confirm).not.toHaveBeenCalled();
 expect(client.create).toHaveBeenCalledTimes(1);
 expect((screen.getByLabelText('标题',{exact:true}) as HTMLInputElement).value).toBe('等待确认');
 client.create.mockResolvedValueOnce({data:{id:'01994b80-0000-7000-8000-000000000001',title:'等待确认',settings:{world:'',opening:'',genre:'',playerRole:'',worldRules:[],tone:''},schemaVersion:1,revision:1,createdAt:'2026-09-12T00:00:00.000Z',updatedAt:'2026-09-12T00:00:00.000Z',deletedAt:null,archivedAt:null},replayed:true});
 await user.click(screen.getByRole('button',{name:'确认上次保存'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'确认上次保存'})).toBeNull());
 await user.click(screen.getByRole('button',{name:'角色库'}));
 expect(screen.getByRole('heading',{name:'角色库'})).toBeTruthy();
});
