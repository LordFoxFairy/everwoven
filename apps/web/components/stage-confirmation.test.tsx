// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {StrictMode, useRef, useState} from 'react';
import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {StageConfirmation} from './stage-confirmation';
import {SegmentedStage} from './segmented-stage';

afterEach(cleanup);

function Harness({confirm = vi.fn(), cancel = vi.fn(), escape = vi.fn()}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  return <main data-testid="stage" onKeyDown={event => {if (event.key === 'Escape') escape();}}>
    <button onClick={() => setOpen(true)}>打开确认</button>
    <div ref={host}/>
    {open && <StageConfirmation title="保留你的草稿" description="确认后才替换" cancelLabel="保留原稿" confirmLabel="采用建议"
      portalContainer={host.current} onCancel={() => {cancel();setOpen(false);}} onConfirm={() => {confirm();setOpen(false);}}/>}
  </main>;
}

describe('shadcn in-stage confirmation', () => {
  it('has accessible alertdialog semantics, stage portal, and defaults to the safe action', async () => {
    const confirm = vi.fn(), cancel = vi.fn();render(<Harness confirm={confirm} cancel={cancel}/>);
    const user = userEvent.setup();await user.click(screen.getByText('打开确认'));
    const dialog = screen.getByRole('alertdialog', {name: '保留你的草稿'});
    expect(screen.getByTestId('stage').contains(dialog)).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText('保留原稿'));
    expect(confirm).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();
  });
  it('delegates focus trapping to the primitive, including reverse Tab', async () => {
    render(<Harness/>);const user = userEvent.setup();await user.click(screen.getByText('打开确认'));
    await user.tab({shift:true});expect(document.activeElement).toBe(screen.getByText('采用建议'));
    await user.tab();expect(document.activeElement).toBe(screen.getByText('保留原稿'));
  });
  it('Escape cancels once without reaching the stage and returns focus to the opener', async () => {
    const cancel = vi.fn(), escape = vi.fn();render(<Harness cancel={cancel} escape={escape}/>);
    const user = userEvent.setup();const opener = screen.getByText('打开确认');await user.click(opener);await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalledTimes(1);expect(escape).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(opener));expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('only explicit confirmation executes the action once', async () => {
    const confirm = vi.fn(), cancel = vi.fn();render(<Harness confirm={confirm} cancel={cancel}/>);const user=userEvent.setup();await user.click(screen.getByText('打开确认'));
    await user.click(screen.getByText('采用建议'));expect(confirm).toHaveBeenCalledTimes(1);expect(cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('retains a draft on cancel and replaces it only after confirmation without sending', async () => {
    const respond=vi.fn(() => true), change=vi.fn();
    render(<SegmentedStage title="测试世界" context="等待你" phase="awaiting" media={{kind:'reference',url:''}} simulated
      choices={[{id:'one',title:'看看画册',text:'我想看看画册。'}]} initialResponseDraft="我自己的回应"
      onEnded={vi.fn()} onRespond={respond} onExit={vi.fn()} onRetry={vi.fn()} onDraftChange={change}/>);
    const user=userEvent.setup();await user.click(screen.getByText('返回建议'));
    await user.click(screen.getByRole('button',{name:'修改：看看画册'}));
    await user.click(screen.getByText('保留原稿'));expect(change).not.toHaveBeenCalled();expect(respond).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'修改：看看画册'}));
    await user.click(within(screen.getByRole('alertdialog')).getByText('采用建议'));
    expect(change).toHaveBeenCalledWith('我想看看画册。');expect(respond).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('我想看看画册。');
  });
});


it('does not fall back to document.body when the stage portal is not ready', () => {
  render(<StageConfirmation title="保护草稿" description="稍候" cancelLabel="取消" confirmLabel="确认" portalContainer={null} onCancel={vi.fn()} onConfirm={vi.fn()}/>);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
it('StrictMode keeps callbacks single and releases background isolation on unmount', async () => {
  const confirm=vi.fn(), cancel=vi.fn();const before=document.body.style.pointerEvents;
  const view=render(<StrictMode><Harness confirm={confirm} cancel={cancel}/></StrictMode>);const user=userEvent.setup();
  await user.click(screen.getByText('打开确认'));
  expect(document.body.style.pointerEvents).toBe('none');
  expect(confirm).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();
  view.unmount();await waitFor(() => expect(document.body.style.pointerEvents).toBe(before));
  expect(document.querySelector('[data-aria-hidden="true"]')).toBeNull();
});
it('a failed suggested response keeps the attempted text and focuses the editor', async () => {
  const respond=vi.fn(() => false);
  render(<SegmentedStage title="测试" context="等待" phase="awaiting" media={{kind:'reference',url:''}} simulated
    choices={[{id:'one',title:'看看画册',text:'我想看看画册。'}]} initialResponseDraft="原来的草稿"
    onEnded={vi.fn()} onRespond={respond} onExit={vi.fn()} onRetry={vi.fn()}/>);
  const user=userEvent.setup();await user.click(screen.getByText('返回建议'));await user.click(screen.getByRole('button',{name:/^看看画册/}));
  await user.click(screen.getByText('改用建议并继续'));
  expect(respond).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('我想看看画册。');
  expect(screen.getByRole('alert').textContent).toContain('内容已保留');
});
