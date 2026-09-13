import {vi} from 'vitest';
import type {DraftDTO, MainCharacterInput, CharacterVersionDTO} from '../../../runtime/src/contracts/story-draft';
import type {StoryDraftClient} from './story-ports';
export const datasetId='01994b80-0000-7000-8000-000000000099',otherDataset='01994b80-0000-7000-8000-000000000098',rootId='01994b80-0000-7000-8000-000000000001',assetId='01994b80-0000-7000-8000-000000000077';
export const settings={world:'世界',opening:'开局',genre:'奇幻',playerRole:'调查员',worldRules:['规则一','规则二'],tone:'安静'};
export const version:CharacterVersionDTO={id:'01994b80-0000-7000-8000-000000000002',characterTemplateId:'01994b80-0000-7000-8000-000000000003',versionNo:1,sourceRevision:3,name:'A',settings:{personality:'性格',appearance:'外貌',speakingStyle:'表达',boundaries:'边界'},portraitAssetId:assetId,schemaVersion:1,createdAt:'2026-09-12T00:00:00.000Z'};
export function main(input:MainCharacterInput|null):DraftDTO['mainCharacter']{
 if(!input)return null;const v=input.kind==='inline'?{...version,name:input.name,settings:input.settings,portraitAssetId:input.portraitAssetId}:version;
 const overrides=input.overrides;return{version:v,overrides,effective:{name:overrides.name??v.name,settings:{...v.settings,...overrides.settings},relationship:overrides.relationship,portraitAssetId:overrides.portrait.mode==='asset'?overrides.portrait.assetId:overrides.portrait.mode==='none'?null:v.portraitAssetId}};
}
export function draft(patch:Partial<DraftDTO>={}):DraftDTO{return{protocolVersion:1,datasetId,id:rootId,title:'聚合A',settings:{...settings},mainCharacter:main({kind:'bound',characterVersionId:version.id,overrides:{portrait:{mode:'inherit'},relationship:'旧友'}}),assetSlots:{cover:assetId,opening:null,character:null},assets:[{state:'missing',id:assetId,datasetId}],schemaVersion:1,revision:1,createdAt:version.createdAt,updatedAt:version.createdAt,deletedAt:null,archivedAt:null,...patch};}
export function storyClient(){return{
 create:vi.fn<StoryDraftClient['create']>().mockImplementation(async x=>({data:draft({...x,mainCharacter:main(x.mainCharacter)}),replayed:false})),
 update:vi.fn<StoryDraftClient['update']>().mockImplementation(async x=>({data:draft({...x.patch,mainCharacter:main(x.patch.mainCharacter??null),revision:x.expectedRevision+1}),replayed:false})),
 get:vi.fn<StoryDraftClient['get']>().mockResolvedValue(draft()),list:vi.fn<StoryDraftClient['list']>().mockResolvedValue({protocolVersion:1,datasetId,items:[],nextCursor:null,totalMatching:0}),
 delete:vi.fn<StoryDraftClient['delete']>().mockResolvedValue({data:draft({revision:2,deletedAt:version.createdAt}),replayed:false}),restore:vi.fn<StoryDraftClient['restore']>().mockResolvedValue({data:draft({revision:3}),replayed:false}),
};}
export function deferred<T>(){let resolve!:(x:T)=>void,reject!:(x:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
