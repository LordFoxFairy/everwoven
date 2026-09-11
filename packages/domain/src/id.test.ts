import {webcrypto} from 'node:crypto';
import {createEntityId} from './id';
import {afterEach,expect,it,vi} from 'vitest';
import {newSave,appendTurn,pinMemory} from './story';
import {blankStory} from '../../../apps/web/lib/presentation/new-story';
afterEach(()=>vi.unstubAllGlobals());
it('creates story/save/turn/memory IDs on HTTP where randomUUID is absent',()=>{
 vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>{for(let i=0;i<bytes.length;i++)bytes[i]=i;return bytes;}});
 const story=blankStory();const save=newSave(story);const turn=appendTurn(save,'你好');const memory=pinMemory(save,'记得这里');
 const v4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 for(const id of [story.id,save.id,turn.turns[0]!.id,memory.memories![0]!.id])expect(id).toMatch(v4);
});

it('prefers native UUID with its crypto receiver',()=>{
 const native={randomUUID(){expect(this).toBe(native);return 'native-id';}};
 vi.stubGlobal('crypto',native);expect(createEntityId()).toBe('native-id');
});
it('encodes version and variant bits using secure random bytes',()=>{
 vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>bytes.fill(255)});
 expect(createEntityId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
});
it('produces distinct fallback IDs with real secure randomness',()=>{
 vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)});
 expect(new Set(Array.from({length:1000},()=>createEntityId())).size).toBe(1000);
});
it('reports missing secure randomness rather than using Math.random',()=>{
 vi.stubGlobal('crypto',undefined);expect(()=>createEntityId()).toThrow('安全随机数');
});
