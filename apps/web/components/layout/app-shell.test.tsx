// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AppShell} from './app-shell';
afterEach(cleanup);
it('keeps brand, scrollable navigation, and account as separate sidebar regions', () => {
  render(<AppShell view="library" draftCount={2} onNavigate={vi.fn()} onCreate={vi.fn()}><h1>页面内容</h1></AppShell>);
  const sidebar=screen.getByRole('complementary',{name:'应用导航'}), nav=screen.getByRole('navigation',{name:'主要导航'});
  expect(sidebar.contains(nav)).toBe(true);
  expect(nav.parentElement?.getAttribute('data-sidebar-scroll')).toBe('');
  expect(nav.contains(screen.getByLabelText('未完 · 返回我的世界'))).toBe(false);
  expect(nav.contains(screen.getByText('故事创作者'))).toBe(false);
  expect(sidebar.querySelector('.brand-mark')?.textContent).toBe('w.');
  expect(screen.getByText('STORIES, STILL BECOMING')).toBeTruthy();
  expect(screen.getByRole('button',{name:'我的剧本'}).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('main').textContent).toContain('页面内容');
});
it('delegates navigation and creation to the owner without writing data', async () => {
  const navigate=vi.fn(),create=vi.fn();const user=userEvent.setup();
  render(<AppShell view="home" draftCount={0} onNavigate={navigate} onCreate={create}>内容</AppShell>);
  await user.click(screen.getByRole('button',{name:'角色库'}));expect(navigate).toHaveBeenCalledWith('characters');
  await user.click(screen.getByRole('button',{name:'创作一个剧本'}));expect(create).toHaveBeenCalledTimes(1);
});
