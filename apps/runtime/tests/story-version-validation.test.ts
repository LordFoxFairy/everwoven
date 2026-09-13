import {expect,it} from 'vitest';
import {v7} from 'uuid';
import {parseFreezeStory,parseStoryVersionDTO} from '../src/contracts/story-version-validation.js';
const command=()=>({protocolVersion:1,datasetId:v7(),storyDraftId:v7(),expectedRevision:1});
it('accepts a normalized explicit source revision without authority or fee fields',()=>{
 const input=command();expect(parseFreezeStory(input)).toEqual(input);
});
it.each(['ownerId','providerId','budget','commandId','force'])('rejects extra %s',key=>{
 expect(()=>parseFreezeStory({...command(),[key]:'injected'})).toThrow();
});
it.each([0,-1,1.5,2147483648,'1',null])('rejects invalid revision %s',expectedRevision=>{
 expect(()=>parseFreezeStory({...command(),expectedRevision})).toThrow();
});
it('rejects old protocol, non-v7 identities and unsealed DTOs',()=>{
 expect(()=>parseFreezeStory({...command(),protocolVersion:0})).toThrow('CLIENT_RELOAD_REQUIRED');
 expect(()=>parseFreezeStory({...command(),storyDraftId:'old'})).toThrow();
 expect(()=>parseStoryVersionDTO({sealedAt:null})).toThrow('INVALID_STORY_VERSION_DTO');
});
