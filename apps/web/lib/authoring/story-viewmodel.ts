import type {CharacterSelection} from './character-viewmodel';
import {StoryClientError} from './story-ports';
import type {CharacterVersionDTO,DraftDTO,MainCharacterInput,PortraitOverride,StoryAssetSlots,StoryAssetView,StorySettings} from '../../../runtime/src/contracts/story-draft';
export type StorySource={kind:'library';templateId:string;revision:number;datasetId:string;portraitAssetId:string|null}|{kind:'bound';version:CharacterVersionDTO}|null;
/** Complete formal work copy; intentionally independent from the lossy demo Story. */
export type StoryFields=StorySettings&{title:string;character:string;personality:string;appearance:string;speakingStyle:string;boundaries:string;relationship:string;source:StorySource;portrait:PortraitOverride;assetSlots:StoryAssetSlots;assetViews:StoryAssetView[]};
export function emptyStoryFields():StoryFields{return{title:'',world:'',opening:'',genre:'浪漫',playerRole:'',worldRules:[],tone:'',character:'',personality:'',appearance:'',speakingStyle:'',boundaries:'',relationship:'',source:null,portrait:{mode:'inherit'},assetSlots:{cover:null,opening:null,character:null},assetViews:[]};}
export function storyFields(dto:DraftDTO):StoryFields{const main=dto.mainCharacter;return{...emptyStoryFields(),...structuredClone(dto.settings),title:dto.title,...(main?{character:main.effective.name,...main.effective.settings,relationship:main.effective.relationship,source:{kind:'bound' as const,version:structuredClone(main.version)},portrait:structuredClone(main.overrides.portrait)}:{}),assetSlots:{...dto.assetSlots},assetViews:structuredClone(dto.assets)};}
export const storyFingerprint=({assetViews:_,...fields}:StoryFields)=>JSON.stringify(fields);
export function withCharacter(fields:StoryFields,c:CharacterSelection):StoryFields{
 if(!c.source)throw Error('请选择当前正式角色库中的角色。');
 return{...fields,character:c.name,personality:c.personality,appearance:c.appearance??'',speakingStyle:c.speakingStyle??'',boundaries:c.boundaries??'',source:{kind:'library',templateId:c.source.templateId,revision:c.source.revision,datasetId:c.source.datasetId,portraitAssetId:c.source.portraitAssetId},portrait:{mode:'inherit'},assetSlots:{...fields.assetSlots,character:null}};
}
export function storyPayload(f:StoryFields):{title:string;settings:StorySettings;mainCharacter:MainCharacterInput|null;assetSlots:StoryAssetSlots}{
 if(!f.title.trim()||[...f.title].length>120)throw Error('请填写剧本名称，最多120个字符。');
 const limits={world:12000,opening:12000,genre:80,playerRole:4000,tone:500,character:120,personality:8000,appearance:4000,speakingStyle:2000,boundaries:4000,relationship:4000};
 if(Object.entries(limits).some(([key,max])=>[...f[key as keyof typeof limits]].length>max)||f.worldRules.length>30||f.worldRules.some(x=>[...x].length>1000))throw Error('文字超过长度上限；输入已保留，请调整后保存。');
 const characterSettings={personality:f.personality,appearance:f.appearance,speakingStyle:f.speakingStyle,boundaries:f.boundaries};
 const hasCharacter=Boolean(f.source||[f.character,...Object.values(characterSettings),f.relationship].some(Boolean)||f.portrait.mode==='asset');
 if(hasCharacter&&!f.source&&!f.character.trim())throw Error('角色草稿已有内容，请填写角色姓名；或明确清除角色后再保存。');
 const overrides={name:f.character,settings:characterSettings,relationship:f.relationship,portrait:structuredClone(f.portrait)};
 const mainCharacter:MainCharacterInput|null=!hasCharacter?null:f.source?.kind==='library'?{kind:'library',templateId:f.source.templateId,expectedTemplateRevision:f.source.revision,overrides}:f.source?.kind==='bound'?{kind:'bound',characterVersionId:f.source.version.id,overrides}:{kind:'inline',name:f.character,settings:characterSettings,portraitAssetId:null,overrides};
 const {world,opening,genre,playerRole,worldRules,tone}=f;
 return{title:f.title,settings:{world,opening,genre,playerRole,worldRules:[...worldRules],tone},mainCharacter,assetSlots:{...f.assetSlots,character:mainCharacter&&f.portrait.mode==='asset'?f.portrait.assetId:null}};
}
export function storyFailure(cause:unknown){
 const trusted=cause instanceof StoryClientError,code=trusted?cause.code:null;
 const denied=code==='LOCAL_SESSION_INVALID'||code==='LOCAL_ORIGIN_DENIED',reset=code==='DATASET_CHANGED',reload=code==='CLIENT_RELOAD_REQUIRED';
 return{denied,reset,reload,definitive:trusted&&cause.outcome==='rejected'&&!denied&&!reset,
 message:reset?'数据集已更换，旧命令停止重放；请从保留文本新建。':reload?'客户端协议需要更新；输入与原命令仍保留，请先确认处理，不会自动刷新。':denied?'本机连接失效，请重连后确认原命令。':code==='REVISION_CONFLICT'||code==='TEMPLATE_REVISION_CONFLICT'?'版本冲突，当前输入仍保留；请保留修改并重新载入后人工合并。':trusted&&cause.outcome==='rejected'?'剧本校验未通过；输入仍保留，请检查字段、角色和图片。':'剧本命令结果尚未确认，请确认原命令。'};
}
export function effectivePortrait(fields:StoryFields):string|null{return fields.portrait.mode==='asset'?fields.portrait.assetId:fields.portrait.mode==='none'?null:fields.source?.kind==='bound'?fields.source.version.portraitAssetId:fields.source?.portraitAssetId??null;}
