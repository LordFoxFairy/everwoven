import {afterEach, describe, expect, it, vi} from 'vitest';
import {listExampleStories} from './catalog';
import {recordDemoIntent} from './intent';
import {readLibrary, writeLibrary} from '../components/storage';

afterEach(() => vi.unstubAllGlobals());

describe('frontend-owned mock data', () => {
  it('round-trips the response and mock checkpoint together without seeding other content', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value)});
    readLibrary();
    const library = {drafts: [], characters: [], saves: [{id: 'rehearsal', story: listExampleStories()[0]!, createdAt: '2026-09-10T00:00:00.000Z', turns: [],
      mockSession: {version: 1 as const, state: {phase: 'awaiting' as const, turn: 0}, responseDraft: '尚未发送'}}]};
    writeLibrary(library);
    expect(readLibrary()).toEqual(library);
    expect(map.size).toBe(1);
    const corrupt = JSON.stringify({...library, saves: [{...library.saves[0], mockSession: {version: 999}}]});
    map.set('weiwan.prototype.v1', corrupt);
    expect(() => readLibrary()).toThrow('演练恢复数据异常');
    expect(map.get('weiwan.prototype.v1')).toBe(corrupt);
  });
  it('returns independent copies so editing never changes a fixture', () => {
    const first = listExampleStories();
    expect(first.length).toBeGreaterThan(0);
    const original = first[0]!.title;
    first[0]!.title = 'user edit';
    expect(listExampleStories()[0]!.title).toBe(original);
  });

  it('does not read or write user storage and never calls the network', async () => {
    const fetch = vi.fn(() => {throw Error('network forbidden');});
    const getItem = vi.fn(() => {throw Error('user storage forbidden');});
    const setItem = vi.fn(() => {throw Error('user storage forbidden');});
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', {getItem, setItem});
    listExampleStories();
    expect(await recordDemoIntent({inputId: 'intent-1', text: '去窗边'})).toEqual({
      inputId: 'intent-1', state: 'recorded-demo', videoChanged: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('rejects blank mock responses instead of presenting a successful turn', async () => {
    await expect(recordDemoIntent({inputId: 'i', text: '  '})).rejects.toThrow();
  });
});
