// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Editor} from './story-editor';
import {blankStory} from '../lib/presentation/new-story';
vi.mock('./story-assets',()=>({useStoryArtwork:()=>({url:'',missing:false}),ImageAssetPicker:({onBusyChange}:any)=><button type="button" onClick={()=>onBusyChange(false)}>图片完成</button>}));
afterEach(cleanup);
it('awaits confirmed character save, locks same-frame clicks independently of image busy and preserves later input',async()=>{
 let finish!:(x:any)=>void;const save=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;})),back=vi.fn();
 render(<Editor initial={{...blankStory(),character:'A',personality:''}} characters={[]} onSave={()=>false} onSaveCharacter={save} onBack={back} onPlay={vi.fn()} notice="" dialog={null}/>);
 fireEvent.click(screen.getByRole('button',{name:/角色配置/}));const button=screen.getByRole('button',{name:'另存为角色模板'});fireEvent.click(button);fireEvent.click(button);expect(save).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'图片完成'}));expect(screen.queryByText(/角色模板已保存。/)).toBeNull();expect((screen.getByRole('button',{name:'我的剧本'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText(/角色姓名/),{target:{value:'B'}});await act(async()=>finish(save.mock.calls[0][0]));expect((screen.getByLabelText(/角色姓名/) as HTMLInputElement).value).toBe('B');await screen.findByText(/当前角色还有未另存的修改/);
});
it('keeps editor input after a structured failure instead of treating Promise as true',async()=>{
 render(<Editor initial={{...blankStory(),character:'角色'}} characters={[]} onSave={()=>false} onSaveCharacter={vi.fn().mockRejectedValue({data:{code:'CONFLICT'},message:'REVISION_CONFLICT'})} onBack={vi.fn()} onPlay={vi.fn()} notice="" dialog={null}/>);
 fireEvent.click(screen.getByRole('button',{name:/角色配置/}));fireEvent.click(screen.getByRole('button',{name:'另存为角色模板'}));await screen.findByText(/角色另存失败/);expect((screen.getByLabelText(/角色姓名/) as HTMLInputElement).value).toBe('角色');
});
