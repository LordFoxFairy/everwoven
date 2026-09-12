import type {AssetRef} from './asset-ports';
import type {CharacterDTO,CharacterSettings} from '../../../runtime/src/contracts/character-template';
import type {Character} from '../../components/storage';
export type CharacterFields={name:string;portraitAssetId:string|null}&CharacterSettings;
export type CharacterSource={kind:'formal-template';templateId:string;revision:number;datasetId:string;portraitAssetId:string|null};
export type CharacterSelection=Character&{source?:CharacterSource;portraitRef:AssetRef|null};
export type PendingState={dirty:boolean;busy:boolean;unknown?:boolean};
export const emptyCharacterFields:CharacterFields={name:'',personality:'',appearance:'',speakingStyle:'',boundaries:'',portraitAssetId:null};
export const characterFields=(dto:CharacterDTO):CharacterFields=>({name:dto.name,...dto.settings,portraitAssetId:dto.portraitAssetId});
export const characterSelection=(dto:CharacterDTO,datasetId:string):CharacterSelection=>({id:dto.id,name:dto.name,...dto.settings,portraitRef:dto.portraitAssetId?{kind:'formal',datasetId,id:dto.portraitAssetId}:null,source:{kind:'formal-template',templateId:dto.id,revision:dto.revision,datasetId,portraitAssetId:dto.portraitAssetId}});
export const demoCharacterSelection=(c:Character):CharacterSelection=>({...c,portraitRef:c.imageAssetId?{kind:'demo',id:c.imageAssetId}:null});
export const fieldsFromSelection=(c:CharacterSelection):CharacterFields=>({name:c.name,personality:c.personality,appearance:c.appearance??'',speakingStyle:c.speakingStyle??'',boundaries:c.boundaries??'',portraitAssetId:c.portraitRef?.kind==='formal'?c.portraitRef.id:null});
// Exact identifiers emitted by the current character protocol, paired with their tRPC status.
const definitiveErrors=new Map<string,readonly [string,number]>([
 ['INVALID_CHARACTER_COMMAND',['BAD_REQUEST',400]],['INVALID_CHARACTER_QUERY',['BAD_REQUEST',400]],['INVALID_CHARACTER_PORTRAIT',['BAD_REQUEST',400]],
 ['REVISION_CONFLICT',['CONFLICT',409]],['IDEMPOTENCY_CONFLICT',['CONFLICT',409]],['CHARACTER_NOT_DELETED',['CONFLICT',409]],['CHARACTER_NOT_FOUND',['NOT_FOUND',404]],
]);
export function characterFailure(cause:unknown){
 const e=cause&&typeof cause==='object'?cause as Record<string,unknown>:{},data=e.data&&typeof e.data==='object'?e.data as Record<string,unknown>:{};
 const message=typeof e.message==='string'?e.message:'',code=data.code??e.code,status=data.httpStatus??e.status;
 const denied=code==='UNAUTHORIZED'||code==='FORBIDDEN'||status===401||status===403;
 const reset=!denied&&(message==='DATASET_CHANGED'||code==='DATASET_CHANGED');
 const conflict=!denied&&(message==='REVISION_CONFLICT'||code==='REVISION_CONFLICT'||code==='CONFLICT');
 const expected=definitiveErrors.get(message);
 const definitive=!denied&&!reset&&Boolean(expected&&code===expected[0]&&(status===undefined||status===expected[1]));
 return{denied,reset,definitive,conflict,message:reset?'数据已重置，原命令停止重放；文本仍保留。':denied?'连接已失效或请求被拒绝，请重新连接；原命令仍保留。':conflict?'版本冲突。当前输入仍保留，请复制需要的内容后重新载入，人工合并再保存。':definitive?'角色校验未通过，请检查输入或重新载入当前版本。':'请求结果尚未确认，请检查连接后确认原命令。'};
}
