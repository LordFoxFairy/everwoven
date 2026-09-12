// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {DraftDTO, DraftPage, DraftCommandResult} from '../../runtime/src/contracts/story-draft';
import {DatabaseDrafts} from './database-drafts';
import type {DatabaseDraftsClient} from '../lib/authoring/ports';

const datasetId = '01994b80-0000-7000-8000-000000000099';
const draft = (overrides: Partial<DraftDTO> = {}): DraftDTO => ({
  id: '01994b80-0000-7000-8000-000000000001', title: '海岛来信',
  settings: {world: '潮汐中的小岛', opening: '一封来信', genre: '日常', playerRole: '旅人', worldRules: ['每晚涨潮'], tone: '温柔'},
  schemaVersion: 1, revision: 1, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
  deletedAt: null, archivedAt: null, ...overrides,
});
const result = (data = draft()): DraftCommandResult => ({data, replayed: false});
function port() {
  return {
    session: vi.fn<DatabaseDraftsClient['session']>().mockResolvedValue({authenticated: true, datasetId}),
    connect: vi.fn<DatabaseDraftsClient['connect']>().mockResolvedValue(undefined),
    logout: vi.fn<DatabaseDraftsClient['logout']>().mockResolvedValue(undefined),
    list: vi.fn<DatabaseDraftsClient['list']>().mockResolvedValue({items: [draft()], nextCursor: null}),
    get: vi.fn<DatabaseDraftsClient['get']>().mockResolvedValue(draft()),
    create: vi.fn<DatabaseDraftsClient['create']>().mockImplementation(async input => result(draft({title: input.title, settings: input.settings}))),
    update: vi.fn<DatabaseDraftsClient['update']>().mockImplementation(async input => result(draft({...input.patch, revision: input.expectedRevision + 1}))),
    delete: vi.fn<DatabaseDraftsClient['delete']>().mockImplementation(async input => result(draft({revision: input.expectedRevision + 1, deletedAt: '2026-09-12T01:00:00Z'}))),
    restore: vi.fn<DatabaseDraftsClient['restore']>().mockImplementation(async input => result(draft({revision: input.expectedRevision + 1}))),
  } satisfies DatabaseDraftsClient;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
const button = (name: string) => screen.getByRole('button', {name});
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), {target: {value}});
const value = (label = '标题') => (screen.getByLabelText(label) as HTMLInputElement).value;
async function edit(client = port(), onPendingChange = vi.fn()) {
  const view = render(<DatabaseDrafts client={client} onPendingChange={onPendingChange}/>);
  fireEvent.click(await screen.findByRole('button', {name: '编辑 海岛来信'}));
  await waitFor(() => expect(value()).toBe('海岛来信'));
  return {client, onPendingChange, ...view};
}
afterEach(() => {cleanup(); vi.restoreAllMocks();});

describe('DatabaseDrafts injected port', () => {
  it('loads, edits, saves and reloads all six StorySettings fields without splitting untouched rules', async () => {
    const settings = {world: '海岛', opening: '来信', genre: '日常', playerRole: '旅人', worldRules: ['一条规则\n第二行'], tone: '平静'};
    const client = port(); client.get.mockResolvedValue(draft({settings}));
    await edit(client);
    const fields = [
      ['世界背景', 'world', '新的世界', 12000],
      ['开局情境', 'opening', '新的开局', 12000],
      ['故事题材', 'genre', '奇幻', 80],
      ['玩家身份', 'playerRole', '邮差', 4000],
      ['语气', 'tone', '轻快', 500],
    ] as const;
    for (const [label, key, next, limit] of fields) {
      expect(value(label)).toBe(settings[key]);
      expect(screen.getByLabelText(label).getAttribute('maxlength')).toBe(String(limit));
      change(label, next);
    }
    const expected = {...settings, world: '新的世界', opening: '新的开局', genre: '奇幻', playerRole: '邮差', tone: '轻快'};
    fireEvent.click(button('保存')); await screen.findByText('已保存 · 修订 2');
    expect(client.update.mock.calls[0][0].patch.settings).toEqual(expected);
    const reloaded = {...expected, opening: '服务端新开局'};
    client.get.mockResolvedValue(draft({settings: reloaded, revision: 3}));
    await waitFor(() => expect((button('重新载入草稿') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button('重新载入草稿'));
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(value('开局情境')).toBe(reloaded.opening));
    for (const [label, key] of fields) expect(value(label)).toBe(reloaded[key]);
    expect(value('世界规则（每行一条）')).toBe('一条规则\n第二行');
    expect(screen.queryByLabelText('故事前提')).toBeNull();
  });

  it('connects with a one-time code without persisting credentials or offering play/import', async () => {
    const client = port();
    client.session.mockResolvedValueOnce({authenticated: false});
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<DatabaseDrafts client={client}/>);
    await screen.findByLabelText('一次性连接码');
    expect(client.list).not.toHaveBeenCalled();
    expect(screen.getByText(/目前仅支持世界设定/)).toBeTruthy();
    expect(screen.getByText(/浏览器草稿另行保留.*不自动导入/)).toBeTruthy();
    change('一次性连接码', 'one-time-code'); fireEvent.click(button('连接'));
    await screen.findByRole('button', {name: '编辑 海岛来信'});
    expect(client.connect).toHaveBeenCalledWith('one-time-code');
    expect(storage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name: /游玩|导入/})).toBeNull();
  });

  it('retains failed save input, surfaces the error and retries with exactly the same UUID v7 command', async () => {
    const {client} = await edit();
    client.update.mockRejectedValueOnce(new Error('网络暂时中断'));
    change('标题', '未送达的信'); change('世界规则（每行一条）', '潮汐有记忆\n灯塔从不熄灭');
    fireEvent.click(button('保存'));
    expect((await screen.findByRole('alert')).textContent).toContain('网络暂时中断');
    expect(value()).toBe('未送达的信');
    const first = client.update.mock.calls[0][0];
    expect(first.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.patch.settings?.worldRules).toEqual(['潮汐有记忆', '灯塔从不熄灭']);
    fireEvent.click(button('确认上次保存'));
    await screen.findByText('已保存 · 修订 2');
    expect(client.update.mock.calls[1][0]).toEqual(first);
    change('语气', '明快'); fireEvent.click(button('保存'));
    await screen.findByText('已保存 · 修订 3');
    expect(client.update.mock.calls[2][0].expectedRevision).toBe(2);
  });

  it('blocks double submission synchronously and reports busy through completion', async () => {
    const {client, onPendingChange} = await edit();
    const pending = deferred<DraftCommandResult>(); client.update.mockReturnValueOnce(pending.promise);
    change('标题', '新的标题');
    const form = screen.getByRole('form', {name: '世界设定'});
    act(() => {fireEvent.submit(form); fireEvent.submit(form);});
    expect(client.update).toHaveBeenCalledTimes(1);
    expect((button('保存中…') as HTMLButtonElement).disabled).toBe(true);
    expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: true});
    await act(async () => pending.resolve(result(draft({title: '新的标题', revision: 2}))));
    expect(onPendingChange).toHaveBeenLastCalledWith({dirty: false, busy: false});
  });

  it('allocates a new command ID after a definitively rejected payload is edited', async () => {
    const {client} = await edit(); client.update.mockRejectedValue(Object.assign(new Error('字段校验失败'), {data: {code: 'BAD_REQUEST'}}));
    change('标题', '版本 A'); fireEvent.click(button('保存')); await screen.findByRole('alert');
    const first = client.update.mock.calls[0][0].commandId;
    change('标题', '版本 B'); fireEvent.click(button('保存'));
    await waitFor(() => expect(client.update).toHaveBeenCalledTimes(2));
    expect(client.update.mock.calls[1][0].commandId).not.toBe(first);
    expect(client.update.mock.calls[1][0].patch.title).toBe('版本 B');
  });

  it('creates via the port and preserves the create receipt key after a lost response', async () => {
    const client = port(); client.create.mockRejectedValueOnce(new Error('响应丢失'));
    render(<DatabaseDrafts client={client}/>);
    fireEvent.click(await screen.findByRole('button', {name: '新建数据库草稿'}));
    change('标题', '新世界'); change('世界背景', '雨后'); change('开局情境', '清晨来信'); change('故事题材', '日常'); change('玩家身份', '邮差'); change('语气', '轻快');
    fireEvent.click(button('创建草稿')); await screen.findByRole('alert');
    expect(value()).toBe('新世界');
    fireEvent.click(button('确认上次保存')); await screen.findByText('已保存 · 修订 1');
    expect(client.create.mock.calls[1][0]).toEqual(client.create.mock.calls[0][0]);
    expect(client.create.mock.calls[0][0].settings).toEqual({world: '雨后', opening: '清晨来信', genre: '日常', playerRole: '邮差', worldRules: [], tone: '轻快'});
    expect(client.update).not.toHaveBeenCalled();
  });

  it('never refreshes or overwrites a CAS conflict without explicit discard confirmation', async () => {
    const {client} = await edit();
    client.update.mockRejectedValueOnce(new Error('REVISION_CONFLICT'));
    change('标题', '我的未保存版本'); fireEvent.click(button('保存'));
    expect((await screen.findByRole('alert')).textContent).toContain('版本冲突');
    expect(value()).toBe('我的未保存版本'); expect(client.get).toHaveBeenCalledTimes(1);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(button('重新载入草稿'));
    expect(confirm).toHaveBeenCalled(); expect(client.get).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true); client.get.mockResolvedValue(draft({title: '服务器版本', revision: 7}));
    fireEvent.click(button('重新载入草稿'));
    await waitFor(() => expect(value()).toBe('服务器版本'));
    change('标题', '人工合并'); fireEvent.click(button('保存'));
    await screen.findByText('已保存 · 修订 8');
    expect(client.update.mock.calls[1][0].expectedRevision).toBe(7);
  });

  it('reconnects an expired session without losing input or the pending command ID', async () => {
    const {client} = await edit();
    client.update.mockRejectedValueOnce(Object.assign(new Error('登录已过期'), {data: {code: 'UNAUTHORIZED', httpStatus: 401}}));
    change('标题', '等待重连的世界'); fireEvent.click(button('保存'));
    await screen.findByLabelText('一次性连接码');
    expect((await screen.findByRole('alert')).textContent).toContain('会话');
    const first = client.update.mock.calls[0][0];
    change('一次性连接码', 'replacement'); fireEvent.click(button('连接'));
    await waitFor(() => expect((button('保存') as HTMLButtonElement).disabled).toBe(false));
    expect(value()).toBe('等待重连的世界');
    fireEvent.click(button('保存')); await screen.findByText('已保存 · 修订 2');
    expect(client.update.mock.calls[1][0]).toEqual(first);
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when session discovery fails and clears a submitted connection code', async () => {
    const client = port(); client.session.mockRejectedValueOnce(new Error('网络故障')).mockResolvedValue({authenticated: false});
    client.connect.mockRejectedValueOnce(new Error('连接码无效'));
    render(<DatabaseDrafts client={client}/>);
    expect((await screen.findByRole('alert')).textContent).toContain('网络故障');
    fireEvent.click(button('重新检查会话')); await screen.findByLabelText('一次性连接码');
    change('一次性连接码', 'expired-code'); fireEvent.click(button('连接'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('连接码无效'));
    expect(value('一次性连接码')).toBe('');
  });

  it('appends cursor pages without duplicates and keeps the cursor after failure', async () => {
    const client = port(); const second = draft({id: 'second', title: '林间来信'});
    client.list.mockResolvedValueOnce({items: [draft()], nextCursor: 'cursor-2'})
      .mockRejectedValueOnce(new Error('分页失败'))
      .mockResolvedValueOnce({items: [draft(), second], nextCursor: null});
    render(<DatabaseDrafts client={client}/>);
    fireEvent.click(await screen.findByRole('button', {name: '加载更多'})); await screen.findByRole('alert');
    expect(screen.getByRole('button', {name: '编辑 海岛来信'})).toBeTruthy();
    fireEvent.click(button('加载更多')); await screen.findByRole('button', {name: '编辑 林间来信'});
    expect(screen.getAllByRole('button', {name: '编辑 海岛来信'})).toHaveLength(1);
    expect(client.list.mock.calls[1][0]).toMatchObject({cursor: 'cursor-2', deleted: 'exclude'});
    expect(client.list.mock.calls[2][0]).toEqual(client.list.mock.calls[1][0]);
    expect(screen.queryByRole('button', {name: '加载更多'})).toBeNull();
  });

  it('preserves delete/restore keys on retry and uses returned revisions for the next lifecycle action', async () => {
    const {client} = await edit(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    client.delete.mockRejectedValueOnce(new Error('删除响应丢失'));
    fireEvent.click(button('删除草稿')); await screen.findByRole('alert');
    fireEvent.click(button('确认上次删除')); await screen.findByText('已删除 · 修订 2');
    expect(client.delete.mock.calls[1][0]).toEqual(client.delete.mock.calls[0][0]);
    expect(screen.queryByRole('button', {name: '编辑 海岛来信'})).toBeNull();
    client.restore.mockRejectedValueOnce(new Error('恢复响应丢失'));
    fireEvent.click(button('恢复草稿')); await screen.findByRole('alert');
    fireEvent.click(button('确认上次恢复')); await screen.findByText('已保存 · 修订 3');
    expect(client.restore.mock.calls[1][0]).toEqual(client.restore.mock.calls[0][0]);
    expect(client.restore.mock.calls[0][0].expectedRevision).toBe(2);
    expect(client.restore.mock.calls[0][0].commandId).not.toBe(client.delete.mock.calls[0][0].commandId);
    fireEvent.click(button('删除草稿')); await screen.findByText('已删除 · 修订 4');
    expect(client.delete.mock.calls[2][0].expectedRevision).toBe(3);
  });

  it('filters deleted records, reads a record before editing and restores it out of the deleted list', async () => {
    const client = port(); const deleted = draft({deletedAt: '2026-09-12T01:00:00Z', revision: 4});
    client.list.mockResolvedValueOnce({items: [], nextCursor: null}).mockResolvedValueOnce({items: [deleted], nextCursor: null});
    client.get.mockResolvedValue(deleted);
    render(<DatabaseDrafts client={client}/>);
    fireEvent.click(await screen.findByRole('button', {name: '已删除'}));
    fireEvent.click(await screen.findByRole('button', {name: '查看 海岛来信'}));
    await screen.findByText('已删除 · 修订 4');
    expect(client.list.mock.calls[1][0]).toMatchObject({deleted: 'only'});
    expect(screen.getByLabelText('标题').matches(':disabled')).toBe(true);
    fireEvent.click(button('恢复草稿')); await screen.findByText('已保存 · 修订 5');
    expect(screen.queryByRole('button', {name: '查看 海岛来信'})).toBeNull();
  });

  it('guards switching, logout and beforeunload and cleans up the external pending signal', async () => {
    const {client, onPendingChange, unmount} = await edit();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    change('标题', '留在这里');
    expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false});
    const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(button('新建数据库草稿')); expect(value()).toBe('留在这里');
    fireEvent.click(button('退出连接')); expect(client.logout).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockReturnValue(true); client.logout.mockRejectedValueOnce(new Error('退出失败'));
    fireEvent.click(button('退出连接')); await screen.findByRole('alert'); expect(value()).toBe('留在这里');
    fireEvent.click(button('退出连接')); await screen.findByLabelText('一次性连接码');
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: false, busy: false}));
    unmount(); expect(onPendingChange).toHaveBeenLastCalledWith({dirty: false, busy: false});
    const after = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('does not discard edits when switching to another record fails', async () => {
    const {client} = await edit(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    change('标题', '保留编辑'); client.get.mockRejectedValueOnce(new Error('读取失败'));
    fireEvent.click(button('编辑 海岛来信')); await screen.findByRole('alert');
    expect(value()).toBe('保留编辑');
  });

  it('keeps a pending request protected from navigation and unload even before any edits', async () => {
    const client = port(); const pending = deferred<DraftPage>(); client.list.mockReturnValueOnce(pending.promise);
    const onPendingChange = vi.fn(); const view = render(<DatabaseDrafts client={client} onPendingChange={onPendingChange}/>);
    await waitFor(() => expect(client.list).toHaveBeenCalled());
    expect(onPendingChange).toHaveBeenLastCalledWith({dirty: false, busy: true});
    const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    view.unmount(); await act(async () => pending.resolve({items: [], nextCursor: null}));
    expect(onPendingChange).toHaveBeenLastCalledWith({dirty: false, busy: false});
  });

  it('reconciles a committed create before saving edited input to the same draft', async () => {
    const client = port(); const receipts = new Map<string, DraftDTO>();
    client.create.mockImplementation(async input => {
      const receipt = receipts.get(input.commandId);
      if (receipt) return {data: receipt, replayed: true};
      receipts.set(input.commandId, draft({title: input.title, settings: input.settings}));
      throw new Error('创建已提交，响应丢失');
    });
    render(<DatabaseDrafts client={client}/>);
    fireEvent.click(await screen.findByRole('button', {name: '新建数据库草稿'}));
    change('标题', '创建 A'); fireEvent.click(button('创建草稿')); await screen.findByRole('alert');
    const original = client.create.mock.calls[0][0];
    change('标题', '继续写 B');
    fireEvent.click(button('确认上次保存'));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((button('保存') as HTMLButtonElement).disabled).toBe(false));
    expect(value()).toBe('继续写 B');
    expect(client.create.mock.calls[1][0]).toEqual(original);
    expect(receipts.size).toBe(1); expect(client.update).not.toHaveBeenCalled();
    fireEvent.click(button('保存')); await screen.findByText('已保存 · 修订 2');
    expect(client.update.mock.calls[0][0]).toMatchObject({id: draft().id, expectedRevision: 1, patch: {title: '继续写 B'}});
    expect(client.update.mock.calls[0][0].commandId).not.toBe(original.commandId);
    expect(client.create).toHaveBeenCalledTimes(2);
  });

  it('protects unknown updates even after reverting to the old baseline and preserves edits on replay', async () => {
    const {client, onPendingChange} = await edit();
    client.update.mockRejectedValueOnce(new Error('更新已提交，响应丢失'))
      .mockResolvedValueOnce({data: draft({title: '提交 B', revision: 2}), replayed: true});
    change('标题', '提交 B'); fireEvent.click(button('保存')); await screen.findByRole('alert');
    const original = client.update.mock.calls[0][0];
    change('标题', '海岛来信');
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true}));
    const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(button('新建数据库草稿')); fireEvent.click(button('重新载入草稿')); fireEvent.click(button('退出连接'));
    expect(value()).toBe('海岛来信'); expect(client.logout).not.toHaveBeenCalled(); expect(client.get).toHaveBeenCalledTimes(1);
    fireEvent.click(button('确认上次保存'));
    await waitFor(() => expect((button('保存') as HTMLButtonElement).disabled).toBe(false));
    expect(value()).toBe('海岛来信');
    expect(client.update.mock.calls[1][0]).toEqual(original);
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false}));
    fireEvent.click(button('保存')); await screen.findByText('已保存 · 修订 3');
    expect(client.update.mock.calls[2][0]).toMatchObject({expectedRevision: 2, patch: {title: '海岛来信'}});
    expect(client.update.mock.calls[2][0].commandId).not.toBe(original.commandId);
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: false, busy: false}));
  });

  it.each([['第一段\n第二段'], ['']])('retains the exact unedited worldRules array: %j', async rule => {
    const client = port(); const worldRules = [rule];
    client.get.mockResolvedValue(draft({settings: {...draft().settings, worldRules}}));
    await edit(client); change('标题', '只改标题'); fireEvent.click(button('保存'));
    await screen.findByText('已保存 · 修订 2');
    expect(client.update.mock.calls[0][0].patch.settings?.worldRules).toEqual(worldRules);
    change('世界规则（每行一条）', '新规则一\n新规则二'); fireEvent.click(button('保存'));
    await screen.findByText('已保存 · 修订 3');
    expect(client.update.mock.calls[1][0].patch.settings?.worldRules).toEqual(['新规则一', '新规则二']);
  });

  it.each(['delete', 'restore'] as const)('protects an unknown %s and confirms only the original command', async action => {
    const client = port(); const isDelete = action === 'delete';
    const initial = draft({deletedAt: isDelete ? null : '2026-09-12T01:00:00Z'});
    client.get.mockResolvedValue(initial);
    const {onPendingChange} = await edit(client);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const settled = draft({revision: 2, deletedAt: isDelete ? '2026-09-12T01:00:00Z' : null});
    const replay = deferred<DraftCommandResult>();
    client[action].mockRejectedValueOnce(new Error('生命周期操作已提交，响应丢失')).mockReturnValueOnce(replay.promise);
    fireEvent.click(button(isDelete ? '删除草稿' : '恢复草稿')); await screen.findByRole('alert');
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true}));
    if (isDelete) change('标题', '删除结果确认前的新输入');
    const retry = button(isDelete ? '确认上次删除' : '确认上次恢复');
    act(() => {fireEvent.click(retry); fireEvent.click(retry);});
    expect(client[action]).toHaveBeenCalledTimes(2);
    await act(async () => replay.resolve({data: settled, replayed: true}));
    expect(client[action].mock.calls[1][0]).toEqual(client[action].mock.calls[0][0]);
    if (isDelete) {
      expect(value()).toBe('删除结果确认前的新输入');
      expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false});
      fireEvent.click(button('恢复草稿'));
      await waitFor(() => expect((button('保存') as HTMLButtonElement).disabled).toBe(false));
      expect(value()).toBe('删除结果确认前的新输入');
      expect(client.restore.mock.calls[0][0].expectedRevision).toBe(2);
    } else {
      expect(onPendingChange).toHaveBeenLastCalledWith({dirty: false, busy: false});
      fireEvent.click(button('删除草稿')); await screen.findByText('已删除 · 修订 3');
      expect(client.delete.mock.calls[0][0].expectedRevision).toBe(2);
    }
  });

  it('retains an earlier unknown command through a 401 replay and reconnect', async () => {
    const {client, onPendingChange} = await edit();
    client.update.mockRejectedValueOnce(new Error('提交后连接中断'))
      .mockRejectedValueOnce(Object.assign(new Error('请重新连接'), {data: {code: 'UNAUTHORIZED'}}))
      .mockResolvedValueOnce({data: draft({title: '已提交 B', revision: 2}), replayed: true});
    change('标题', '已提交 B'); fireEvent.click(button('保存')); await screen.findByRole('alert');
    const original = client.update.mock.calls[0][0];
    change('标题', '海岛来信'); fireEvent.click(button('确认上次保存'));
    await screen.findByLabelText('一次性连接码');
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true}));
    change('一次性连接码', 'new-session'); fireEvent.click(button('连接'));
    const confirm = await screen.findByRole('button', {name: '确认上次保存'});
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    expect(value()).toBe('海岛来信'); fireEvent.click(confirm);
    await waitFor(() => expect((button('保存') as HTMLButtonElement).disabled).toBe(false));
    expect(value()).toBe('海岛来信'); expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.update.mock.calls.map(([input]) => input)).toEqual([original, original, original]);
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false}));
  });

  it.each(['REVISION_CONFLICT', 'INVALID_STORY_COMMAND'])('ends unknown reconciliation on a definitive %s without overwriting input', async rejection => {
    const {client} = await edit();
    client.update.mockRejectedValueOnce(new Error('发送结果未知')).mockRejectedValueOnce(new Error(rejection));
    change('标题', '之前尝试'); fireEvent.click(button('保存')); await screen.findByRole('alert');
    change('标题', '现在的输入'); fireEvent.click(button('确认上次保存'));
    await waitFor(() => expect(screen.queryByRole('button', {name: '确认上次保存'})).toBeNull());
    expect(value()).toBe('现在的输入'); expect(client.get).toHaveBeenCalledTimes(1);
    expect((button('保存') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain(rejection === 'REVISION_CONFLICT' ? '版本冲突' : rejection);
  });

  it.each([
    ['FORBIDDEN', {data: {code: 'FORBIDDEN', httpStatus: 403}}],
    ['HTTP 403 overrides generic BAD_REQUEST', {status: 403, data: {code: 'BAD_REQUEST'}}],
    ['HTTP 403 overrides a business-looking message', {status: 403, message: 'REVISION_CONFLICT'}],
    ['proxy 400', {status: 400, data: {code: 'BAD_REQUEST'}}],
    ['generic 409', {status: 409, data: {code: 'CONFLICT'}}],
    ['generic 422', {status: 422}],
  ])('retains history, input and the original key when reconciliation hits %s', async (_label, denial) => {
    const {client, onPendingChange} = await edit();
    client.update.mockRejectedValueOnce(new Error('原请求提交结果未知'))
      .mockRejectedValueOnce(Object.assign(new Error('请求被代理或权限边界拒绝'), denial))
      .mockResolvedValueOnce({data: draft({title: '之前提交 B', revision: 2}), replayed: true});
    change('标题', '之前提交 B'); fireEvent.click(button('保存')); await screen.findByRole('alert');
    const original = client.update.mock.calls[0][0];
    change('标题', '海岛来信'); fireEvent.click(button('确认上次保存'));
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true}));
    const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(value()).toBe('海岛来信');
    fireEvent.click(button('确认上次保存'));
    await waitFor(() => expect((button('保存') as HTMLButtonElement).disabled).toBe(false));
    expect(value()).toBe('海岛来信');
    expect(client.update.mock.calls.map(([input]) => input)).toEqual([original, original, original]);
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({dirty: true, busy: false}));
  });
});


describe('dataset reset boundaries', () => {
  it.each(['create', 'update', 'delete', 'restore'] as const)('freezes %s pending dataset, blocks foreign replay, and explicitly copies retained input', async action => {
    const client = port(), pending = vi.fn();
    const originalRules = ['一条规则\n仍是同一条', ''];
    client.get.mockResolvedValue(draft({settings: {...draft().settings, worldRules: originalRules},
      ...(action === 'restore' ? {deletedAt: '2026-09-12T01:00:00Z'} : {})}));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await edit(client, pending);
    if (action === 'create') {fireEvent.click(button('新建数据库草稿')); change('标题', '保留输入');}
    else if (action !== 'restore') change('标题', '保留输入');
    client[action].mockRejectedValueOnce(new Error('response lost'));
    fireEvent.click(button(action === 'create' ? '创建草稿' : action === 'update' ? '保存' : action === 'delete' ? '删除草稿' : '恢复草稿'));
    await screen.findByText(/上次操作结果待确认/);
    const original = client[action].mock.calls[0][0];
    expect(original.datasetId).toBe(datasetId);
    client[action].mockRejectedValueOnce(Object.assign(new Error('expired'), {status: 401}));
    fireEvent.click(button(action === 'delete' ? '确认上次删除' : action === 'restore' ? '确认上次恢复' : '确认上次保存'));
    await screen.findByLabelText('一次性连接码');
    const next = '01994b80-0000-7000-8000-000000000098';
    client.session.mockResolvedValue({authenticated: true, datasetId: next});
    client.list.mockResolvedValue({items: [], nextCursor: null});
    change('一次性连接码', 'new-code'); fireEvent.click(button('连接'));
    await screen.findByText(/数据已重置/);
    expect(client[action]).toHaveBeenCalledTimes(2);
    expect(client[action].mock.calls[1][0]).toEqual(original);
    expect(screen.queryByRole('button', {name: '重新载入草稿'})).toBeNull();
    expect(screen.queryByRole('button', {name: '编辑 海岛来信'})).toBeNull();
    expect(value()).toBe(action === 'restore' ? '海岛来信' : '保留输入');
    await waitFor(() => expect(pending).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true}));
    fireEvent.click(button('从保留文本新建草稿'));
    await waitFor(() => expect(pending).toHaveBeenLastCalledWith({dirty: true, busy: false}));
    expect(client[action]).toHaveBeenCalledTimes(2);
    fireEvent.click(button('创建草稿')); await screen.findByText(/已保存/);
    const fresh = client.create.mock.calls.at(-1)![0];
    expect(fresh.datasetId).toBe(next); expect(fresh.commandId).not.toBe(original.commandId);
    expect(fresh).not.toHaveProperty('id'); expect(fresh).not.toHaveProperty('expectedRevision');
    expect(fresh.settings.worldRules).toEqual(action === 'create' ? [] : originalRules);
  });

  it('retains dirty text without unknown across dataset change and requires explicit new creation', async () => {
    const first = port(), next = port();
    const rules = ['one\ntwo', '']; first.get.mockResolvedValue(draft({settings: {...draft().settings, worldRules: rules}}));
    const view = await edit(first); change('标题', '旧草稿新文本');
    next.session.mockResolvedValue({authenticated: true, datasetId: '01994b80-0000-7000-8000-000000000098'});
    next.list.mockResolvedValue({items: [], nextCursor: null});
    view.rerender(<DatabaseDrafts client={next}/>);
    await screen.findByText(/数据已重置/);
    expect(value()).toBe('旧草稿新文本'); expect(next.update).not.toHaveBeenCalled(); expect(next.create).not.toHaveBeenCalled();
    fireEvent.click(button('从保留文本新建草稿')); fireEvent.click(button('创建草稿'));
    await screen.findByText(/已保存/);
    expect(next.create.mock.calls[0][0].settings.worldRules).toEqual(rules);
    expect(next.update).not.toHaveBeenCalled();
  });
});


describe('dataset reconciliation and late responses', () => {
  it.each(['create', 'update', 'delete', 'restore'] as const)('reconnects the same dataset and confirms the exact %s command', async action => {
    const client = port(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    if (action === 'restore') client.get.mockResolvedValue(draft({deletedAt: '2026-09-12T01:00:00Z'}));
    await edit(client);
    if (action === 'create') {fireEvent.click(button('新建数据库草稿')); change('标题', '同库原命令');}
    if (action === 'update') change('标题', '同库原命令');
    client[action].mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce(Object.assign(new Error('expired'), {status: 401}));
    fireEvent.click(button(action === 'create' ? '创建草稿' : action === 'update' ? '保存' : action === 'delete' ? '删除草稿' : '恢复草稿'));
    const confirm = action === 'delete' ? '确认上次删除' : action === 'restore' ? '确认上次恢复' : '确认上次保存';
    fireEvent.click(await screen.findByRole('button', {name: confirm}));
    await screen.findByLabelText('一次性连接码');
    change('一次性连接码', 'same-dataset-code'); fireEvent.click(button('连接'));
    fireEvent.click(await screen.findByRole('button', {name: confirm}));
    await waitFor(() => expect(client[action]).toHaveBeenCalledTimes(3));
    expect(client[action].mock.calls.map(([input]) => input)).toEqual(Array(3).fill(client[action].mock.calls[0][0]));
    expect(client[action].mock.calls[0][0].datasetId).toBe(datasetId);
    await waitFor(() => expect(screen.queryByText(/上次操作结果待确认/)).toBeNull());
    expect(screen.queryByText(/数据已重置/)).toBeNull();
  });

  it.each([
    {message: 'precondition', data: {code: 'PRECONDITION_FAILED', httpStatus: 412}},
    {message: 'DATASET_CHANGED', data: {code: 'UNAUTHORIZED', httpStatus: 401}},
    {message: 'DATASET_CHANGED', data: {code: 'FORBIDDEN', httpStatus: 403}},
  ])('does not settle unknown from generic 412 or access denial: $data.code', async rejection => {
    const client = port(), pending = vi.fn(); await edit(client, pending);
    client.update.mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce(rejection);
    change('标题', '仍未知'); fireEvent.click(button('保存'));
    fireEvent.click(await screen.findByRole('button', {name: '确认上次保存'}));
    await waitFor(() => expect(pending).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true}));
    expect(screen.getByText(/上次操作结果待确认/)).toBeTruthy();
    expect(screen.queryByRole('button', {name: '从保留文本新建草稿'})).toBeNull();
  });

  it('recognizes explicit DATASET_CHANGED on replay and stops further sends until explicit new creation', async () => {
    const client = port(), pending = vi.fn(); await edit(client, pending);
    client.update.mockRejectedValueOnce(new Error('lost')).mockRejectedValueOnce({message: 'DATASET_CHANGED', data: {code: 'PRECONDITION_FAILED', httpStatus: 412}});
    change('标题', '重置时保留'); fireEvent.click(button('保存'));
    fireEvent.click(await screen.findByRole('button', {name: '确认上次保存'}));
    await screen.findByLabelText('一次性连接码');
    await waitFor(() => expect(pending).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true}));
    expect((button('从保留文本新建草稿') as HTMLButtonElement).disabled).toBe(true);
    client.session.mockResolvedValue({authenticated: true, datasetId: '01994b80-0000-7000-8000-000000000098'});
    client.list.mockResolvedValue({items: [], nextCursor: null});
    change('一次性连接码', 'fresh'); fireEvent.click(button('连接'));
    await waitFor(() => expect((button('从保留文本新建草稿') as HTMLButtonElement).disabled).toBe(false));
    expect(value()).toBe('重置时保留'); expect(client.update).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', {name: '确认上次保存'})).toBeNull();
  });

  it.each(['list', 'get', 'write'] as const)('ignores an old dataset late %s response without clearing the new unknown command', async action => {
    const old = port(), next = port(), pending = vi.fn();
    const view = await edit(old, pending);
    change('标题', '保留的文本');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const lateList = deferred<DraftPage>(), lateGet = deferred<DraftDTO>(), lateWrite = deferred<DraftCommandResult>();
    if (action === 'list') {old.list.mockReturnValueOnce(lateList.promise); fireEvent.click(button('刷新列表'));}
    if (action === 'get') {old.get.mockReturnValueOnce(lateGet.promise); fireEvent.click(button('重新载入草稿'));}
    if (action === 'write') {old.update.mockReturnValueOnce(lateWrite.promise); fireEvent.click(button('保存'));}
    next.session.mockResolvedValue({authenticated: true, datasetId: '01994b80-0000-7000-8000-000000000098'});
    next.list.mockResolvedValue({items: [], nextCursor: null}); next.create.mockRejectedValueOnce(new Error('new response lost'));
    view.rerender(<DatabaseDrafts client={next} onPendingChange={pending}/>);
    await screen.findByText(/数据已重置/);
    fireEvent.click(button('从保留文本新建草稿')); change('标题', '新库未确认命令'); fireEvent.click(button('创建草稿'));
    await screen.findByText(/上次操作结果待确认/);
    const original = next.create.mock.calls[0][0];
    await act(async () => {
      if (action === 'list') lateList.resolve({items: [draft({title: '迟到旧实体'})], nextCursor: 'old-cursor'});
      if (action === 'get') lateGet.resolve(draft({title: '迟到旧实体'}));
      if (action === 'write') lateWrite.resolve(result(draft({title: '迟到旧实体'})));
    });
    expect(value()).toBe('新库未确认命令'); expect(screen.queryByRole('button', {name: /迟到旧实体|加载更多/})).toBeNull();
    expect(pending).toHaveBeenLastCalledWith({dirty: true, busy: false, unknown: true});
    fireEvent.click(button('确认上次保存')); await screen.findByText(/已保存/);
    expect(next.create.mock.calls[1][0]).toEqual(original);
    expect(next.update).not.toHaveBeenCalled();
  });
});
