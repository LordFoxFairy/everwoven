import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SkyWelcome} from './sky-welcome';

describe('sky welcome', () => {
  it('prioritizes user creation, with the sample as a separate secondary action', () => {
    const create = vi.fn(), explore = vi.fn();
    const html = renderToStaticMarkup(<SkyWelcome onCreate={create} onExplore={explore}/>);
    expect(html).toContain('创建我的世界');
    expect(html).toContain('探索示例开端');
    expect(html).toContain('前端演练');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<video');
    expect(create).not.toHaveBeenCalled();
    expect(explore).not.toHaveBeenCalled();
  });
});
