import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SegmentedStage, type SegmentedStageProps} from './segmented-stage';

const props: SegmentedStageProps = {
  title: '我的世界', context: '用户定义的开场', phase: 'watching',
  media: {kind: 'reference', url: '/art/linzhou-v1.png'}, simulated: true,
  choices: [{id: 'one', title: '打个招呼', text: '你好'}],
  onEnded: vi.fn(), onRespond: () => true, onExit: vi.fn(), onRetry: vi.fn(), onFail: vi.fn(),
};
describe('one segmented stage', () => {
  it('renders a restored unsent draft without submitting it', () => {
    const respond = vi.fn(() => true);
    const html = renderToStaticMarkup(<SegmentedStage {...props} phase="awaiting" initialResponseDraft="尚未发送的草稿" onRespond={respond}/>);
    expect(html).toContain('尚未发送的草稿');
    expect(html).toContain('<textarea');
    expect(respond).not.toHaveBeenCalled();
  });
  it.each(['generating', 'watching', 'failed'] as const)('hides all responses during %s', phase => {
    const html = renderToStaticMarkup(<SegmentedStage {...props} phase={phase}/>);
    expect(html).not.toContain('打个招呼');
    expect(html).not.toContain('<textarea');
  });
  it('shows contextual suggestions and free-response entry after completion', () => {
    const html = renderToStaticMarkup(<SegmentedStage {...props} phase="awaiting"/>);
    expect(html).toContain('打个招呼');
    expect(html).toContain('自己回应');
    expect(html).toContain('静态参考');
    expect(html).not.toContain('<video');
  });
  it('uses one video and excludes rehearsal controls for real media', () => {
    const html = renderToStaticMarkup(<SegmentedStage {...props} simulated={false} media={{kind: 'video', url: '/media/result.mp4'}}/>);
    expect(html.match(/<video/g)).toHaveLength(1);
    expect(html).not.toContain('模拟片段结束');
    expect(html).not.toContain('模拟失败');
    expect(html).not.toContain('静态参考');
  });
});
