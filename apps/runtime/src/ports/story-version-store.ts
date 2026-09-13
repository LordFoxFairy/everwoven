import type {StoryDraftReadScope,StoryCastRecord,StoryAssetSlotRecord} from './story-draft-store.js';
import type {StorySettings,CharacterOverrides} from '../contracts/story-draft.js';
export type StoryVersionRecord={id:string;ownerId:string;storyDraftId:string;sourceRevision:number;versionNo:number;title:string;settings:unknown;schemaVersion:number;createdAt:Date;sealedAt:Date|null;contentHash:string|null};
export type StoryVersionCastRecord=Omit<StoryCastRecord,'storyDraftId'>&{storyVersionId:string};
export type StoryVersionAssetRecord=Omit<StoryAssetSlotRecord,'storyDraftId'>&{storyVersionId:string};
export interface StoryVersionReadScope extends StoryDraftReadScope{
 readonly ownerId:string;
 findStoryVersion(id:string):Promise<StoryVersionRecord|null>;
 findStoryCast(storyVersionId:string):Promise<StoryVersionCastRecord[]>;
 findStorySlots(storyVersionId:string):Promise<StoryVersionAssetRecord[]>;
}
export interface StoryVersionWriteScope extends StoryVersionReadScope{
 findStoryVersionBySource(storyDraftId:string,sourceRevision:number):Promise<StoryVersionRecord|null>;
 nextStoryVersionNo(storyDraftId:string):Promise<number>;
 insertStoryVersion(input:Omit<StoryVersionRecord,'ownerId'|'settings'|'sealedAt'|'contentHash'>&{settings:StorySettings}):Promise<void>;
 insertStoryCast(storyVersionId:string,cast:{id:string;characterVersionId:string;overrides:CharacterOverrides;createdAt:Date}|null):Promise<void>;
 insertStoryAssets(storyVersionId:string,assets:Array<{id:string;assetId:string;slotKey:'cover'|'opening'|'character';createdAt:Date}>):Promise<void>;
 sealStoryVersion(id:string,contentHash:string,sealedAt:Date):Promise<number>;
}
export interface StoryVersionStore{
 read<T>(ownerId:string,work:(scope:StoryVersionReadScope)=>Promise<T>):Promise<T>;
 write<T>(ownerId:string,work:(scope:StoryVersionWriteScope)=>Promise<T>):Promise<T>;
}
