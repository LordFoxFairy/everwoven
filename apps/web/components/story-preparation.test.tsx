// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useSyncExternalStore} from 'react';
import {StoryPreparation} from './story-preparation';
import {OpeningController} from '../lib/experience/opening-controller';
import {clientFixture, datasetId, source, directory, deferred, opening} from '../lib/experience/opening-test-fixtures';
import type {ExperienceOpeningResult} from 'runtime/contracts/experience-opening';
afterEach(cleanup);
async function setup(ready = true) {
  const client = clientFixture(), c = new OpeningController(); if (!ready) client.bindings.mockResolvedValue({...directory, status: 'empty', items: []});
  c.bind({client, datasetId, connected: true, invalidate: vi.fn()}); c.open(source); await c.load();
  function View() {const state = useSyncExternalStore(c.subscribe, c.getSnapshot); return <StoryPreparation controller={c} state={state} unsavedChanges triggerRef={{current: null}} connectionSlot={null}/>;}
  render(<View/>); return {c, client};
}
it('shows saved revision and unsaved exclusion; explicit model choice and budget, no automatic create', async () => {
  const {client} = await setup(); expect(screen.getByRole('dialog', {name: '正式故事准备'})).toBeTruthy();
  expect(screen.getByText(/修订 3/)).toBeTruthy(); expect(screen.getByText(/不包含尚未保存的修改/)).toBeTruthy();
  expect((screen.getByRole('button', {name: '确认开局配置'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', {name: /MiniMax-H3-Max/}));
  fireEvent.change(screen.getByLabelText('预算上限'), {target: {value: '1.25'}}); fireEvent.change(screen.getByLabelText('预算币种'), {target: {value: 'USD'}});
  expect(client.create).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', {name: '确认开局配置'}));
  await screen.findByText('开局配置已固定'); expect(client.create).toHaveBeenCalledTimes(1);
  expect(client.create.mock.calls[0]![0].budget).toEqual({limitMicros: '1250000', currency: 'USD'});
  expect(screen.queryByRole('button', {name: /开始生成|开始演练/})).toBeNull(); expect(document.querySelector('video')).toBeNull();
});
it('empty directory guides configuration without fake choices; refresh remains read-only', async () => {
  const {client} = await setup(false); expect(screen.getByText(/尚未登记视频模型/)).toBeTruthy(); expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: '刷新模型配置'})); await waitFor(() => expect(client.bindings).toHaveBeenCalledTimes(2)); expect(client.create).not.toHaveBeenCalled();
});
it('close during pending retains original response recovery and restore does not resubmit', async () => {
  const {c, client} = await setup(), pending = deferred<ExperienceOpeningResult>(); client.create.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('radio', {name: /MiniMax-H3-Max/})); fireEvent.click(screen.getByRole('button', {name: '确认开局配置'}));
  fireEvent.click(screen.getByRole('button', {name: '返回编辑'})); expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {pending.reject(Error('lost'));}); act(() => {c.open(source);});
  expect(screen.getByRole('button', {name: '确认上次开局请求'})).toBeTruthy(); expect(client.create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', {name: '确认上次开局请求'})); await screen.findByText('开局配置已固定');
  expect(client.create.mock.calls[0]![0]).toEqual(client.create.mock.calls[1]![0]);
});
it('pending inputs are disabled, same frame doubleclick sends once, completion is not playing', async () => {
  const {client} = await setup(), pending = deferred<ExperienceOpeningResult>(); client.create.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('radio', {name: /MiniMax-H3-Max/})); const button = screen.getByRole('button', {name: '确认开局配置'}); fireEvent.click(button); fireEvent.click(button);
  expect(client.create).toHaveBeenCalledTimes(1); expect((screen.getByLabelText('预算上限') as HTMLInputElement).disabled).toBe(true);
  await act(async () => {pending.resolve({data: opening(client.create.mock.calls[0]![0]), replayed: false});});
  expect(screen.getByText(/尚未报价、尚未生成/)).toBeTruthy();
});
