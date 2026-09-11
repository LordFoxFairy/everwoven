import {describe,it,expect} from 'vitest';
import {newSave,appendTurn,validateDraft} from './story';
const draft={id:'a',title:'自定义故事',world:'海边小镇',opening:'初次相遇',character:'林舟',personality:'耐心',genre:'浪漫',image:'sea'};
describe('story isolation',()=>{
 it('snapshots settings when starting a save',()=>{const s=newSave(draft);draft.world='另一个世界';expect(s.story.world).toBe('海边小镇');});
 it('isolates two saves and never mutates source',()=>{const a=newSave(draft),b=newSave(draft);const changed=appendTurn(a,'去海边');expect(changed.turns).toHaveLength(1);expect(a.turns).toHaveLength(0);expect(b.turns).toHaveLength(0);expect(a.id).not.toBe(b.id);});
 it('rejects whitespace-only required fields',()=>{expect(validateDraft({...draft,title:'  '})).toContain('剧本名称');});
 it('ignores empty player input',()=>{const s=newSave(draft);expect(appendTurn(s,'  ').turns).toHaveLength(0);});
});

import {pinMemory,editMemory,removeMemory} from './story';
it('keeps character configuration in the play snapshot',()=>{
 const configured={...draft,appearance:'深色短发',speakingStyle:'直接而温和',relationship:'初次见面',boundaries:'不代替玩家做决定',artId:'linzhou'};
 const save=newSave(configured);configured.relationship='熟识';expect(save.story.relationship).toBe('初次见面');
});
it('lets the player save, correct and remove a memory without inventing events',()=>{
 const save=newSave(draft);const pinned=pinMemory(save,'第一次一起看海');
 expect(save.memories).toBeUndefined();expect(pinned.memories).toHaveLength(1);
 const changed=editMemory(pinned,pinned.memories![0].id,'约好下次一起看海');
 expect(changed.memories![0].text).toBe('约好下次一起看海');expect(pinned.memories![0].text).toBe('第一次一起看海');
 expect(removeMemory(changed,changed.memories![0].id).memories).toHaveLength(0);
 expect(pinMemory(save,' ').memories).toBeUndefined();
});
