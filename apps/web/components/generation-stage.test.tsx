// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {SegmentedStage,type SegmentedStageProps} from './segmented-stage';
afterEach(cleanup);
const props:SegmentedStageProps={title:'我的故事',context:'等待你的回应',phase:'awaiting',media:{kind:'empty',url:''},simulated:false,managedResponse:true,
 choices:[{id:'ask',title:'问候',text:'你好'}],onEnded:vi.fn(),onRespond:vi.fn(async()=>true),onExit:vi.fn(),onRetry:vi.fn()};
it('all suggestion edits are locked during persistence, including an already open replacement dialog',()=>{
 const change=vi.fn(),view=render(<SegmentedStage {...props} initialResponseDraft="原稿" onDraftChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'返回建议'}));fireEvent.click(screen.getByRole('button',{name:'修改：问候'}));
 expect(screen.getByRole('alertdialog')).toBeTruthy();
 view.rerender(<SegmentedStage {...props} initialResponseDraft="原稿" onDraftChange={change} responsePending/>);
 expect((screen.getByRole('button',{name:'修改：问候',hidden:true}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'采用建议'}));expect(change).not.toHaveBeenCalled();
});
it('formal retry is labeled by the pending operation and locked during a request',()=>{
 render(<SegmentedStage {...props} storageError="原请求待核对" recoveryLabel="核对原确认" responsePending/>);
 expect((screen.getByRole('button',{name:'核对原确认'}) as HTMLButtonElement).disabled).toBe(true);
});
