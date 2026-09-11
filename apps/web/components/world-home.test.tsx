import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorldHome} from './world-home';
import {recentlyOpened, rehearsalResumeCopy} from '../lib/presentation/rehearsal-resume';
import {emptyLibrary, type RehearsalSave} from './storage';
import {blankStory} from '../lib/presentation/new-story';

const story = {...blankStory(), id: 'own-story', title: '我的海岛', character: '自己设定的角色'};
const makeSave = (id: string, createdAt = '2026-09-10T10:00:00Z'): RehearsalSave => ({id, createdAt, story, turns: [], mockSession: {version: 1, state: {phase: 'awaiting', turn: 0}, responseDraft: ''}});
const callbacks = () => ({onCreate: vi.fn(), onExplore: vi.fn(), onResume: vi.fn(), onEdit: vi.fn(), onLibrary: vi.fn(), onSaves: vi.fn()});

describe('personal entry uses actual local records', () => {
  it('does not fabricate activity when empty or start any actions on render', () => {
    const events = callbacks();
    const html = renderToStaticMarkup(<WorldHome library={emptyLibrary} {...events}/>);
    expect(html).toContain('创建我的世界');
    expect(html).not.toContain('最近开启');
    expect(html).not.toContain('继续回应');
    expect(html).not.toContain('<textarea');
    Object.values(events).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });
  it('treats unreadable storage as unavailable, never as a first-time empty library', () => {
    const html = renderToStaticMarkup(<WorldHome library={emptyLibrary} loadError="本地数据读取失败" {...callbacks()}/>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('本地数据读取失败');
    expect(html).not.toContain('创建我的世界');
    expect(html).not.toContain('从一个念头');
  });
  it('selects by creation time without changing storage order or record identity', () => {
    const older = makeSave('old', '2026-09-01T00:00:00Z'), newer = makeSave('new');
    const saves = [older, newer];
    expect(recentlyOpened(saves)).toBe(newer);
    expect(saves).toEqual([older, newer]);
    expect(recentlyOpened([])).toBeUndefined();
  });
  it('handles legacy invalid dates without pretending to know activity time', () => {
    const unknown = makeSave('unknown', 'bad-date'), valid = makeSave('valid');
    expect(recentlyOpened([unknown, valid])).toBe(valid);
    expect(recentlyOpened([unknown])).toBe(unknown);
  });
  it('exposes saved unsent draft status, not invented AI memory', () => {
    const save = makeSave('resume');
    save.mockSession!.responseDraft = '还没说完';
    const html = renderToStaticMarkup(<WorldHome library={{...emptyLibrary, saves: [save]}} {...callbacks()}/>);
    expect(html).toContain('继续写完回应');
    expect(html).toContain('未发送');
    expect(html).toContain('我的海岛');
    expect(html).toContain('静态参考');
    expect(html).not.toContain('关系值');
    expect(html).not.toContain('<video');
  });
  it('shows only user-owned drafts and does not invent community content', () => {
    const html = renderToStaticMarkup(<WorldHome library={{...emptyLibrary, drafts: [story]}} {...callbacks()}/>);
    expect(html).toContain('继续创作');
    expect(html).toContain('我的海岛');
    expect(html).not.toContain('热门');
  });
  it.each([
    ['generating', '继续演练准备'], ['watching', '回到参考画面'],
    ['awaiting', '继续回应'], ['failed', '查看并重试'],
  ] as const)('has an honest action for %s', (phase, action) => {
    const save = makeSave('status'); save.mockSession!.state.phase = phase;
    expect(rehearsalResumeCopy(save).action).toBe(action);
  });
  it('does not claim a restored video for a legacy record without checkpoint', () => {
    const save = makeSave('legacy'); delete save.mockSession;
    const copy = rehearsalResumeCopy(save);
    expect(copy.action).toBe('重新进入演练');
    expect(copy.description).toContain('没有场景恢复点');
  });
});
