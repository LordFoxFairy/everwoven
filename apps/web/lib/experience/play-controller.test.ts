import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {PlayController} from './play-controller';
import {PlaybackClientError,type GenerationClient} from './playback-client';
import type {PlayDTO,QuoteDTO,ResponseDraftDTO} from 'runtime/contracts/generation';
const datasetId=v7(),experienceId=v7(),turnId=v7(),mediaId=v7(),interactionEventId=v7();
const query={protocolVersion:1 as const,datasetId,experienceId};
function fixture(){
 let play:PlayDTO={...query,title:'我的故事',revision:1,status:'preparing',turn:null,interaction:null};
 let draft:ResponseDraftDTO={...query,interactionEventId,text:'',revision:1};
 const quote:QuoteDTO={...query,id:v7(),experienceRevision:1,profileId:v7(),maxCostMicros:'100',currency:'USD',expiresAt:new Date(Date.now()+300000).toISOString(),createdAt:new Date().toISOString(),summary:{title:play.title,prompt:'用户的开场',modelId:'fixture',region:'cn',duration:5,resolution:'768P',ratio:'16:9',audio:'silent',inputAssetIds:[]}};
 const client={get:vi.fn(async()=>structuredClone(play)),getQuote:vi.fn<GenerationClient['getQuote']>(async()=>({quote,acceptedTurnId:null})),getDraft:vi.fn(async()=>structuredClone(draft)),
  saveDraft:vi.fn<GenerationClient['saveDraft']>(async input=>{draft={...query,interactionEventId,text:input.text,revision:input.expectedDraftRevision+1};return draft;}),
  quote:vi.fn<GenerationClient['quote']>(async input=>({data:{...quote,id:v7(),experienceRevision:input.expectedExperienceRevision,summary:{...quote.summary,prompt:input.kind==='response'?input.text:'用户的开场'}},replayed:false})),
  accept:vi.fn<GenerationClient['accept']>(async input=>{play={...play,status:'generating',revision:input.expectedExperienceRevision+1,interaction:null,turn:{id:turnId,status:'queued',media:null,errorCode:null}};return {data:{...query,id:turnId,quoteId:input.quoteId,status:'queued',createdAt:quote.createdAt},replayed:false};}),
  completePlayback:vi.fn<GenerationClient['completePlayback']>(async()=>{play={...play,revision:play.revision+1,status:'awaiting',turn:{id:turnId,status:'viewed',media:{id:mediaId,duration:5},errorCode:null},interaction:{id:interactionEventId,summary:'故事继续',choices:[{id:'ask',title:'问候',text:'你好'},{id:'leave',title:'走向门口',text:'我走向门口'}]}};return {data:play,replayed:false};})};
 const route=vi.fn(),controller=new PlayController(route),invalidate=vi.fn();controller.bind({client,connected:true,datasetId,invalidate});
 return {controller,client,route,quote,setPlay:(p:PlayDTO)=>{play=p;},getPlay:()=>play,bind:()=>controller.bind({client,connected:true,datasetId,invalidate}),playing:()=>{play={...play,status:'playing',turn:{id:turnId,status:'ready',media:{id:mediaId,duration:5},errorCode:null}};}};
}
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
it('opens without generating, quotes, accepts once, plays, then saves response before quoting next scene',async()=>{
 const f=fixture();await f.controller.open(experienceId);expect(f.client.quote).not.toHaveBeenCalled();expect(f.client.accept).not.toHaveBeenCalled();
 await f.controller.quote();expect(f.controller.getSnapshot().quote).not.toBeNull();await f.controller.accept();
 expect(f.controller.getSnapshot().play?.status).toBe('generating');expect(f.client.accept.mock.calls[0]![0].commandId).toBe(f.client.accept.mock.calls[0]![0].quoteId);
 f.playing();await f.controller.refresh();expect(f.controller.getSnapshot().play?.interaction).toBeNull();
 await f.controller.ended(turnId,mediaId);expect(f.controller.getSnapshot().play?.interaction?.choices).toHaveLength(2);
 await f.controller.quote('你好');expect(f.client.saveDraft).toHaveBeenCalledOnce();expect(f.client.quote.mock.calls[1]![0]).toMatchObject({kind:'response',text:'你好',interactionEventId});
 expect(f.client.accept).toHaveBeenCalledOnce();
});
it('same-frame double accept and old video completion cannot create additional operations',async()=>{
 const f=fixture();await f.controller.open(experienceId);await f.controller.quote();const pending=deferred<Awaited<ReturnType<GenerationClient['accept']>>>();f.client.accept.mockReturnValueOnce(pending.promise);
 const a=f.controller.accept(),b=f.controller.accept();expect(f.client.accept).toHaveBeenCalledOnce();expect(await b).toBe(false);
 pending.reject(new PlaybackClientError('PLAYBACK_NETWORK_ERROR',null,'unknown'));await a;
 expect(await f.controller.ended(v7(),v7())).toBe(false);expect(f.client.completePlayback).not.toHaveBeenCalled();
});
it('unknown accept retains exact command and URL identity; restore is read-only until explicit retry',async()=>{
 const f=fixture();await f.controller.open(experienceId);await f.controller.quote();const quote=f.controller.getSnapshot().quote!;
 f.client.accept.mockRejectedValueOnce(new PlaybackClientError('PLAYBACK_NETWORK_ERROR',null,'unknown'));await f.controller.accept();
 expect(f.controller.getSnapshot().acceptUnknown).toBe(true);expect(f.controller.getSnapshot().error).not.toBe('');
 const route=f.route.mock.calls.at(-1)![0];expect(route).toMatchObject({quoteId:quote.id,confirming:true});
 const g=fixture();g.client.getQuote.mockResolvedValue({quote,acceptedTurnId:null});await g.controller.open(experienceId,route);expect(g.client.accept).not.toHaveBeenCalled();
 await g.controller.accept();expect(g.client.accept.mock.calls[0]![0]).toEqual(f.client.accept.mock.calls[0]![0]);
});
it('same-revision late reads are ignored and closing during GET does not reopen scene',async()=>{
 const f=fixture();await f.controller.open(experienceId);const late=deferred<PlayDTO>();f.client.get.mockReturnValueOnce(late.promise);
 const read=f.controller.refresh();f.playing();await f.controller.refresh();late.resolve({...f.getPlay(),status:'generating',turn:{id:turnId,status:'polling',media:null,errorCode:null}});await read;
 expect(f.controller.getSnapshot().play?.status).toBe('playing');
 const next=deferred<PlayDTO>();f.client.get.mockReturnValueOnce(next.promise);const more=f.controller.refresh();await f.controller.close();next.resolve(f.getPlay());await more;expect(f.controller.getSnapshot().visible).toBe(false);
});
it('restores persisted response and saves before leaving; unknown draft retry uses original command',async()=>{
 const f=fixture();await f.controller.open(experienceId);f.playing();await f.controller.refresh();await f.controller.ended(turnId,mediaId);
 f.controller.draft('还没说完');f.client.saveDraft.mockRejectedValueOnce(new PlaybackClientError('PLAYBACK_NETWORK_ERROR',null,'unknown'));
 expect(await f.controller.close()).toBe(false);expect(f.controller.getSnapshot().draft).toBe('还没说完');expect(f.controller.getSnapshot().draftUnknown).toBe(true);
 expect(await f.controller.close()).toBe(true);expect(f.client.saveDraft.mock.calls[1]![0]).toEqual(f.client.saveDraft.mock.calls[0]![0]);
 const g=fixture();g.setPlay(f.getPlay());g.client.getDraft.mockResolvedValue({...query,interactionEventId,revision:2,text:'还没说完'});await g.controller.open(experienceId);expect(g.controller.getSnapshot().draft).toBe('还没说完');expect(g.client.quote).not.toHaveBeenCalled();
});
it('configuration rejection is shown even if subsequent GET succeeds',async()=>{
 const f=fixture();await f.controller.open(experienceId);await f.controller.quote();f.client.accept.mockRejectedValue(new PlaybackClientError('GENERATION_RUNTIME_UNAVAILABLE',503,'rejected'));
 await f.controller.accept();expect(f.controller.getSnapshot()).toMatchObject({acceptUnknown:false});expect(f.controller.getSnapshot().error).toContain('配置尚未就绪');
});
it('draft conflict reloads revision, keeps input, and requires a decision before overwrite',async()=>{
 const f=fixture();await f.controller.open(experienceId);f.playing();await f.controller.refresh();await f.controller.ended(turnId,mediaId);f.controller.draft('我的新回应');
 f.client.saveDraft.mockRejectedValueOnce(new PlaybackClientError('REVISION_CONFLICT',409,'rejected'));
 f.client.getDraft.mockResolvedValue({...query,interactionEventId,revision:3,text:'另一个窗口的回应'});
 expect(await f.controller.saveDraft()).toBe(false);expect(f.controller.getSnapshot().draft).toBe('我的新回应');expect(f.controller.getSnapshot().draftConflict?.revision).toBe(3);
 expect(await f.controller.close()).toBe(false);expect(f.client.saveDraft).toHaveBeenCalledOnce();
 f.controller.resolveDraftConflict(true);expect(await f.controller.saveDraft()).toBe(true);expect(f.client.saveDraft.mock.calls[1]![0]).toMatchObject({expectedDraftRevision:3,text:'我的新回应'});
});
it('an uncertain but never accepted expired quote releases its lock only after authoritative lookup',async()=>{
 const f=fixture();await f.controller.open(experienceId);await f.controller.quote();const quote=f.controller.getSnapshot().quote!;
 f.client.accept.mockRejectedValueOnce(new PlaybackClientError('PLAYBACK_NETWORK_ERROR',null,'unknown'));await f.controller.accept();
 f.client.getQuote.mockResolvedValue({quote:{...quote,expiresAt:new Date(Date.now()-1000).toISOString()},acceptedTurnId:null});
 f.client.accept.mockRejectedValueOnce(new PlaybackClientError('GENERATION_QUOTE_EXPIRED',409,'rejected'));await f.controller.accept();
 expect(f.controller.getSnapshot().acceptUnknown).toBe(false);expect(f.controller.getSnapshot().quote).toBeNull();expect(await f.controller.quote()).toBe(true);
});

it('reload reconciles a quote already accepted on the server without resending accept',async()=>{
 const f=fixture();f.client.getQuote.mockResolvedValue({quote:f.quote,acceptedTurnId:turnId});f.setPlay({...f.getPlay(),revision:2,status:'generating',turn:{id:turnId,status:'queued',media:null,errorCode:null}});
 await f.controller.open(experienceId,{datasetId,experienceId,quoteId:f.quote.id,confirming:true});
 expect(f.controller.getSnapshot()).toMatchObject({acceptUnknown:false,quote:null,play:{status:'generating'}});expect(f.client.accept).not.toHaveBeenCalled();
});
