import {libraryStorageKey,type AppEnvironment} from '../lib/environment/config';
import type {Story,Save,CharacterTemplate} from '../../../packages/domain/src/story';
import {validDemoCheckpoint, type DemoCheckpoint} from '../mocks/session';
export type RehearsalSave = Save & {mockSession?: DemoCheckpoint};
export type Character=CharacterTemplate;
export type Library={drafts:Story[];saves:RehearsalSave[];characters:Character[]};
export const emptyLibrary:Library={drafts:[],saves:[],characters:[]};
function record(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x);}
function strings(x:Record<string,unknown>,keys:string[]){return keys.every(k=>typeof x[k]==='string');}
function optionalStrings(x:Record<string,unknown>,keys:string[]){return keys.every(k=>x[k]===undefined||typeof x[k]==='string');}
function isStory(x:unknown):boolean{return record(x)&&strings(x,['id','title','world','opening','character','personality','genre','image'])&&optionalStrings(x,['artId','appearance','speakingStyle','relationship','boundaries'])&&(x.assets===undefined||record(x.assets)&&optionalStrings(x.assets,['cover','character','opening']));}
function isCharacter(x:unknown):boolean{return record(x)&&strings(x,['id','name','personality'])&&optionalStrings(x,['appearance','speakingStyle','boundaries','imageAssetId']);}
const observed=new Map<string,string|null>();
export function readLibrary(environment:AppEnvironment='demo'):Library {
 const key=libraryStorageKey(environment);
 const raw=localStorage.getItem(key);observed.set(key,raw);if(!raw)return emptyLibrary;
 const data=JSON.parse(raw);
 if(!data||!Array.isArray(data.drafts)||!Array.isArray(data.saves)||!Array.isArray(data.characters))throw Error('存档格式异常');
 if(!data.drafts.every(isStory)||!data.saves.every((s:any)=>record(s)&&typeof s.id==='string' && typeof s.createdAt==='string' && isStory(s.story) && Array.isArray(s.turns) && s.turns.every((t:any)=>record(t)&&typeof t.id==='string' && typeof t.text==='string'))||!data.characters.every(isCharacter))throw Error('存档内容异常');
 if(!data.saves.every((s:RehearsalSave)=>s.mockSession===undefined||validDemoCheckpoint(s.mockSession,s.turns.length)))throw Error('演练恢复数据异常');
 return data;
}
export function writeLibrary(data:Library,environment:AppEnvironment='demo'){const key=libraryStorageKey(environment);if(localStorage.getItem(key)!==(observed.get(key)??null))throw Error('其他标签页已更新存档，请先复制未保存内容再刷新。');const next=JSON.stringify(data);localStorage.setItem(key,next);observed.set(key,next);}
