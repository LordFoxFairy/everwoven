import {createEntityId} from './id';
export type AssetRole='cover'|'character'|'opening';
export type CharacterTemplate={id:string;name:string;personality:string;appearance?:string;speakingStyle?:string;boundaries?:string;imageAssetId?:string};
export type Story={assets?:Partial<Record<AssetRole,string>>;id:string;title:string;world:string;opening:string;character:string;personality:string;genre:string;image:string;artId?:string;appearance?:string;speakingStyle?:string;relationship?:string;boundaries?:string};
export type Turn={id:string;text:string;status:'recorded-demo';createdAt:string};
export type Save={id:string;story:Story;createdAt:string;turns:Turn[];memories?:{id:string;text:string;createdAt:string}[]};
export function validateDraft(s:Story):string[]{return (['title','world','opening','character'] as const).filter(k=>!s[k].trim()).map(k=>({title:'剧本名称',world:'世界背景',opening:'开局情境',character:'角色姓名'})[k]);}
export function newSave(story:Story):Save{return {id:createEntityId(),story:structuredClone(story),createdAt:new Date().toISOString(),turns:[]};}
export function appendTurn(save:Save,text:string):Save{if(!text.trim())return save;return {...save,turns:[...save.turns,{id:createEntityId(),text:text.trim(),status:'recorded-demo',createdAt:new Date().toISOString()}]};}

export function pinMemory(save:Save,text:string):Save{if(!text.trim())return save;return {...save,memories:[...(save.memories??[]),{id:createEntityId(),text:text.trim(),createdAt:new Date().toISOString()}]};}
export function editMemory(save:Save,id:string,text:string):Save{if(!text.trim())return save;return {...save,memories:(save.memories??[]).map(m=>m.id===id?{...m,text:text.trim()}:m)};}
export function removeMemory(save:Save,id:string):Save{return {...save,memories:(save.memories??[]).filter(m=>m.id!==id)};}

export function applyCharacterTemplate(story:Story,template:CharacterTemplate):Story{
 return {...story,character:template.name,personality:template.personality,appearance:template.appearance??'',speakingStyle:template.speakingStyle??'',boundaries:template.boundaries??'',artId:undefined,assets:{...story.assets,character:template.imageAssetId}};
}
export function characterTemplateFromStory(story:Story,id:string):CharacterTemplate{
 return {id,name:story.character.trim(),personality:story.personality.trim(),appearance:story.appearance,speakingStyle:story.speakingStyle,boundaries:story.boundaries,imageAssetId:story.assets?.character};
}
