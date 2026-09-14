// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {createGenerationClient} from '../lib/experience/playback-client';
import {Platform} from './platform';
import {createOpeningClient} from '../lib/experience/opening-client';
import {createStoryDraftClient} from '../lib/authoring/story-client';
import {createAuthoringSessionClient} from '../lib/authoring/session-client';
import {clientFixture, datasetId, source, opening, deferred} from '../lib/experience/opening-test-fixtures';
vi.mock('../lib/experience/playback-client',()=>({createGenerationClient:vi.fn()}));
vi.mock('../lib/experience/opening-client', () => ({createOpeningClient: vi.fn()}));
vi.mock('../lib/authoring/story-client', () => ({createStoryDraftClient: vi.fn()}));
vi.mock('../lib/authoring/session-client', () => ({createAuthoringSessionClient: vi.fn()}));
vi.mock('../lib/authoring/character-client', () => ({createCharacterClient: () => ({list: async () => ({items: [], nextCursor: null, totalMatching: 0})})}));
afterEach(() => {cleanup();window.history.replaceState(null,'','/'); vi.restoreAllMocks();});
it('original editor uses opening workflow; closing unknown retains reentry, navigation never discards command', async () => {
  const client = clientFixture(); vi.mocked(createOpeningClient).mockReturnValue(client);
  vi.mocked(createAuthoringSessionClient).mockReturnValue({session: vi.fn(async () => ({authenticated: true as const, datasetId})), connect: vi.fn(), logout: vi.fn()});
  vi.mocked(createStoryDraftClient).mockReturnValue({create: vi.fn(async input => ({data: {...source, title: input.title, settings: input.settings, assetSlots: input.assetSlots}, replayed: false})),
    list: vi.fn(async () => ({protocolVersion: 1 as const, datasetId, items: [], totalMatching: 0, nextCursor: null})), get: vi.fn(), update: vi.fn(), delete: vi.fn(), restore: vi.fn()});
  render(<Platform environment="dev" databaseEnabled/>); await screen.findByText('已连接本机');
  fireEvent.click(screen.getByRole('button', {name: '创作一个剧本'})); fireEvent.change(screen.getByLabelText(/剧本名称/), {target: {value: '原页面开局'}});
  fireEvent.click(screen.getByRole('button', {name: '保存并进入准备'}));
  const radio = await screen.findByRole('radio', {name: /MiniMax-H3-Max/}); expect(client.create).not.toHaveBeenCalled();
  fireEvent.click(radio); client.create.mockRejectedValueOnce(Error('lost receipt')); fireEvent.click(screen.getByRole('button', {name: '确认开局配置'}));
  await screen.findByRole('button', {name: '确认上次开局请求'}); const original = structuredClone(client.create.mock.calls[0]![0]);
  fireEvent.click(screen.getByRole('button', {name: '返回编辑'})); expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', {name: '继续故事准备'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: '我的剧本'}));
  expect(screen.getByLabelText(/剧本名称/)).toBeTruthy(); expect(screen.getByRole('dialog', {name: '正式故事准备'})).toBeTruthy();
  expect(client.create).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', {name: '确认上次开局请求'}));
  await screen.findByText('开局配置已固定'); expect(client.create.mock.calls[1]![0]).toEqual(original);
  fireEvent.click(screen.getByRole('button', {name: '返回编辑'})); fireEvent.click(screen.getByRole('button', {name: '我的剧本'}));
  await waitFor(() => expect(screen.queryByLabelText(/剧本名称/)).toBeNull());
});
it('a fresh workspace discovers and reenters persisted preparation without a draft save or CREATE', async () => {
  const client = clientFixture(), dto = opening(); dto.budget = {limitMicros: '1234567', currency: 'USD'};
  client.getPreparing.mockResolvedValue(dto);
  client.list.mockResolvedValue({protocolVersion: 1, datasetId, nextCursor: null, items: [{id: dto.id, storyVersionId: dto.story.id, title: dto.story.title, sourceRevision: dto.story.sourceRevision, status: 'preparing', schedulingPaused: true,
    modelId: dto.binding.modelId, region: dto.binding.region, budget: dto.budget, createdAt: dto.createdAt, updatedAt: dto.createdAt}]});
  vi.mocked(createOpeningClient).mockReturnValue(client);
  vi.mocked(createAuthoringSessionClient).mockReturnValue({session: vi.fn(async () => ({authenticated: true as const, datasetId})), connect: vi.fn(), logout: vi.fn()});
  const save = vi.fn(); vi.mocked(createStoryDraftClient).mockReturnValue({create: save, update: save, get: vi.fn(), delete: vi.fn(), restore: vi.fn(),
    list: vi.fn(async () => ({protocolVersion: 1 as const, datasetId, items: [], totalMatching: 0, nextCursor: null}))});
  const get=vi.fn(async()=>({protocolVersion:1 as const,datasetId,experienceId:dto.id,title:dto.story.title,revision:1,status:'preparing',turn:null,interaction:null}));
  vi.mocked(createGenerationClient).mockReturnValue({get,beginPlayback:vi.fn(),reportPlayback:vi.fn(),quote:vi.fn(),accept:vi.fn(),getQuote:vi.fn(),completePlayback:vi.fn(),getDraft:vi.fn(),saveDraft:vi.fn()});
  render(<Platform environment="dev" databaseEnabled/>); await screen.findByText('已连接本机'); fireEvent.click(screen.getByRole('button', {name: '我的游玩'}));
  const entry = await screen.findByRole('button', {name: `进入故事 ${dto.story.title}`}); fireEvent.click(entry);
  await screen.findByText('故事已准备好');expect(get).toHaveBeenCalledOnce();
  expect(client.create).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(document.querySelector('video')).toBeNull();
  expect(window.location.hash).toContain(dto.id);
  fireEvent.click(screen.getByRole('button',{name:'返回我的游玩'}));await screen.findByRole('heading',{name:'我的游玩'});
  expect(window.location.hash).toBe('');
});
