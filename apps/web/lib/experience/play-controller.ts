import {v7} from 'uuid';
import type {PlayDTO, QuoteDTO, AcceptGenerationInput, CompletePlaybackInput, ResponseDraftDTO, SaveResponseDraftInput, PlaybackSessionDTO, PlaybackProgressInput} from 'runtime/contracts/generation';
import {PlaybackClientError, type GenerationClient} from './playback-client';
import type {PlayRoute} from './play-route';

type Binding = {client: GenerationClient; connected: boolean; datasetId: string | null; invalidate: () => void};
export type PlayState = {
 visible: boolean; connected: boolean; datasetChanged: boolean; experienceId: string | null; datasetId: string | null;
 play: PlayDTO | null; quote: QuoteDTO | null; reading: boolean; busy: 'quote' | 'accept' | 'playback' | 'draft' | 'viewing' | 'progress' | null;
 acceptUnknown: boolean; playbackUnknown: boolean; error: string; draft: string; draftRecord: ResponseDraftDTO | null; draftUnknown: boolean; draftConflict: ResponseDraftDTO | null;
 lastMedia: {turnId: string; mediaId: string; duration: number} | null;
};
function message(error: unknown): string {
 const messages: Record<string, string> = {
  GENERATION_CONTEXT_LIMIT:'当前故事的上下文已超过这组模型的输入上限。内容仍保留，本次未提交生成。',
  SCOPE_RECONCILIATION_REQUIRED:'同一故事的费用结果仍待核对，可回看与另开路线，暂不生成新内容。',
  PLAYBACK_COVERAGE_INCOMPLETE:'播放进度尚未完整确认，请重新播放这一幕后继续。',
  PLAYBACK_SESSION_UNAVAILABLE:'播放会话已失效，请重新播放当前片段。',PLAYBACK_MEDIA_UNAVAILABLE:'本机视频暂时不可读，请检查文件后重新播放。',
  GENERATION_RUNTIME_UNAVAILABLE: '视频生成配置尚未就绪。请完成本机供应商与模型配置后重新开始，当前故事已保存。',
  GENERATION_PRICE_UNAVAILABLE: '这组模型的费用信息尚未就绪，暂时不能确认生成。',
  GENERATION_POLICY_UNAVAILABLE: '当前模型配置暂不可用，请检查本机设置。',
  GENERATION_PROFILE_UNAVAILABLE: '这次旅程固定的模型配置未安装，请恢复对应配置后继续。',
  GENERATION_BUDGET_EXCEEDED: '这次生成超过了旅程的剩余额度。回应已保留，未提交视频任务。',
  GENERATION_STAGE_BUDGET_EXCEEDED: '当前模型配置的费用上限不足，回应已保留。',
  GENERATION_QUOTE_EXPIRED: '报价已过期，请重新获取费用。', GENERATION_QUOTE_STALE: '这份报价已失效，请重新获取费用。',
  GENERATION_QUOTE_CONSUMED: '这份报价已被确认，正在核对当前旅程。', REVISION_CONFLICT: '旅程已更新，请读取当前进展后继续。',
  LOCAL_SESSION_INVALID: '本机连接已失效，重连后可以继续核对。', DATASET_CHANGED: '当前连接不是原数据集，原请求已保留。',
  EXPERIENCE_NOT_FOUND: '这段旅程暂时没有找到，请检查当前本机数据。',
 };
 return error instanceof Error && messages[error.message] || '尚未得到可靠确认。当前内容已保留，请重新读取状态。';
}
/** Workspace lifetime; serial commands and read sequences prevent stale network results from replacing the current scene. */
export class PlayController {
 private state: PlayState = {visible: false, connected: false, datasetChanged: false, experienceId: null, datasetId: null, play: null, quote: null,
  reading: false, busy: null, acceptUnknown: false, playbackUnknown: false, error: '', draft: '', draftRecord: null, draftUnknown: false, draftConflict: null, lastMedia: null};
 private binding: Binding | null = null;private epoch = 0;private sequence = 0;private flight: Promise<boolean> | null = null;
 private viewSession:PlaybackSessionDTO|null=null;private lastProgressAt=0;
 private progressCommand:PlaybackProgressInput|null=null;
 private draftCommand: SaveResponseDraftInput | null = null;
 private acceptCommand: AcceptGenerationInput | null = null;private playbackCommand: CompletePlaybackInput | null = null;
 private listeners = new Set<() => void>();
 constructor(private route: (route: PlayRoute | null) => void) {}
 subscribe = (listener: () => void) => {this.listeners.add(listener);return () => {this.listeners.delete(listener);};};
 getSnapshot = () => this.state;
 private publish(patch: Partial<PlayState>) {this.state = {...this.state, ...patch};this.listeners.forEach(fn => fn());}
 bind(next: Binding) {
  const old = this.binding;if (old && Object.keys(next).every(key => old[key as keyof Binding] === next[key as keyof Binding])) return;
  this.epoch++;this.sequence++;this.flight = null;this.binding = next;
  this.publish({connected: next.connected, reading: false, busy: null, datasetChanged: Boolean(this.state.datasetId && this.state.datasetId !== next.datasetId),
   acceptUnknown: Boolean(this.acceptCommand) || this.state.acceptUnknown, playbackUnknown: Boolean(this.playbackCommand),draftUnknown:Boolean(this.draftCommand)});
 }
 private usable() {return Boolean(this.binding?.connected && this.state.connected && !this.state.datasetChanged && this.state.experienceId && this.state.datasetId);}
 private position(quote = this.state.quote, confirming = this.state.acceptUnknown) {
  this.route({experienceId: this.state.experienceId!, datasetId: this.state.datasetId!, ...(quote ? {quoteId: quote.id, confirming} : {})});
 }
 async open(experienceId: string, restored?: PlayRoute): Promise<boolean> {
  if (this.flight || ((this.acceptCommand || this.draftCommand) && this.state.experienceId !== experienceId)) {this.publish({visible: true});return false;}
  const datasetId = restored?.datasetId ?? this.binding?.datasetId;if (!datasetId) return false;
  const different = this.state.experienceId !== experienceId || this.state.datasetId !== datasetId;
  if (different) {this.viewSession=null;this.progressCommand=null;this.lastProgressAt=0;}
  this.sequence++;
  this.publish({visible: true, experienceId, datasetId, datasetChanged: datasetId !== this.binding?.datasetId, error: '',
   ...(different ? {play: null, quote: null, draft: '', draftRecord: null, draftUnknown: false, draftConflict: null, lastMedia: null, playbackUnknown: false} : {})});
  if (!this.usable()) return false;
  try {if (restored) this.route(restored);else this.position();} catch {this.publish({error: '游玩位置暂时未能保存，请检查浏览器地址栏访问。'});return false;}
  if (restored?.quoteId) {
   const epoch = this.epoch, sequence = ++this.sequence;
   this.publish({reading: true});
   try {
    const result = await this.binding!.client.getQuote({protocolVersion: 1, datasetId, experienceId, quoteId: restored.quoteId});
    if (epoch !== this.epoch || sequence !== this.sequence) return false;
    if(result.acceptedTurnId){
     this.acceptCommand=null;this.publish({quote:null,draft:'',draftRecord:null,acceptUnknown:false});this.position(null,false);
    }else{
     this.publish({quote: result.quote, draft: result.quote.summary.prompt, acceptUnknown: Boolean(restored.confirming)});
     if (restored.confirming) this.acceptCommand = this.acceptInput(result.quote);
     this.position(result.quote, Boolean(restored.confirming));
    }
   } catch (error) {
    if (epoch === this.epoch && sequence === this.sequence) {this.publish({error: message(error)});this.route(restored);}return false;
   } finally {if (epoch === this.epoch && sequence === this.sequence) this.publish({reading: false});}
  }
  return this.refresh();
 }
 async close() {
  if (this.flight || this.state.draftConflict) return false;
  if (this.draftDirty() && !await this.saveDraft()) return false;
  this.viewSession=null;this.progressCommand=null;this.lastProgressAt=0;
  this.sequence++;this.publish({visible: false, reading: false});
  if (!this.acceptCommand && !this.playbackCommand) this.route(null);
  return true;
 }
 suspend() {this.epoch++;this.sequence++;this.flight = null;}
 private handle(error: unknown) {
  this.publish({error: message(error)});
  if (error instanceof PlaybackClientError && [401, 403, 412].includes(error.status ?? 0)) this.binding?.invalidate();
 }
 mediaFailed() {this.publish({error: '视频暂时未能播放。请检查本机连接后重新读取进展；已有视频仍保留，不会重新生成。'});}
 clearError() {this.publish({error: ''});}
 async refresh(): Promise<boolean> {
  if (!this.usable() || this.state.busy) return false;
  const b = this.binding!, epoch = this.epoch, sequence = ++this.sequence;
  const current = () => epoch === this.epoch && sequence === this.sequence;
  this.publish({reading: true});
  try {
   const play = await b.client.get({protocolVersion: 1, datasetId: this.state.datasetId!, experienceId: this.state.experienceId!});
   if (!current()) return false;
   const same = this.state.play?.interaction?.id === play.interaction?.id || this.state.quote?.experienceRevision === play.revision;
   let draftRecord = this.state.draftRecord;
   if (play.interaction && draftRecord?.interactionEventId !== play.interaction.id) {
    draftRecord = await b.client.getDraft({protocolVersion:1,datasetId:play.datasetId,experienceId:play.experienceId,interactionEventId:play.interaction.id});
    if (!current()) return false;
   }
   this.publish({play, ...(play.turn?.media ? {lastMedia: {turnId: play.turn.id, mediaId: play.turn.media.id, duration: play.turn.media.duration}} : play.inherited?{lastMedia:{turnId:play.inherited.turnId,mediaId:play.inherited.mediaId,duration:play.inherited.duration}}:{}),
    ...(!same && !this.acceptCommand ? {draft: draftRecord?.text ?? '', quote: null} : {}),
    ...(draftRecord?.interactionEventId === play.interaction?.id ? {draftRecord, ...(this.state.draftRecord?.interactionEventId !== draftRecord?.interactionEventId && !this.state.quote ? {draft:draftRecord?.text ?? ''} : {})} : {draftRecord:null})});
   if (play.status === 'awaiting' && this.playbackCommand?.turnId === play.turn?.id) {this.playbackCommand = null;this.publish({playbackUnknown: false});}
   return true;
  } catch (error) {if (current()) this.handle(error);return false;}
  finally {if (current()) this.publish({reading: false});}
 }
 draft(value: string) {if (!this.acceptCommand && !this.draftCommand && !this.state.draftConflict && !this.state.busy) {this.publish({draft: value.slice(0, 2000), quote: null});this.position(null, false);}}
 draftDirty() {return Boolean(this.state.draftRecord && this.state.draft!==this.state.draftRecord.text) || Boolean(this.draftCommand);}
 async saveDraft(): Promise<boolean> {
  if (!this.usable() || this.state.busy || this.state.draftConflict || !this.state.draftRecord) return false;
  if (!this.draftDirty()) return true;
  const record=this.state.draftRecord;
  const input=this.draftCommand ?? {protocolVersion:1 as const,datasetId:record.datasetId,experienceId:record.experienceId,interactionEventId:record.interactionEventId,
   expectedDraftRevision:record.revision,text:this.state.draft,commandId:v7()};
  this.draftCommand=input;
  return this.command('draft',async current=>{
   try {
    const result=await this.binding!.client.saveDraft(input);if(!current())return false;
    this.draftCommand=null;this.publish({draftRecord:result,draftUnknown:false});return true;
   }catch(error){
    if(current()){
     const rejected=error instanceof PlaybackClientError&&error.outcome==='rejected'&&!this.state.draftUnknown;
     if(rejected)this.draftCommand=null;
     this.publish({draftUnknown:!rejected});this.handle(error);
     if(rejected && error instanceof PlaybackClientError && error.code==='REVISION_CONFLICT') {
      try {
       const latest=await this.binding!.client.getDraft({protocolVersion:1,datasetId:input.datasetId,experienceId:input.experienceId,interactionEventId:input.interactionEventId});
       if(current())this.publish({draftConflict:latest,error:'另一窗口已保存新的回应。请决定保留哪一份。'});
      }catch(readError){if(current())this.handle(readError);}
     }
    }return false;
   }
  });
 }
 resolveDraftConflict(keepLocal:boolean) {
  const latest=this.state.draftConflict;if(!latest||this.state.busy)return;
  this.publish({draftRecord:latest,draftConflict:null,draftUnknown:false,error:'',quote:null,...(!keepLocal?{draft:latest.text}:{})});this.position(null,false);
 }
 cancelQuote() {if (this.acceptCommand || this.state.busy) return;this.publish({quote: null, error: ''});this.position(null, false);}
 private command(kind: NonNullable<PlayState['busy']>, work: (current: () => boolean) => Promise<boolean>): Promise<boolean> {
  if (this.flight) return this.flight;
  const epoch = this.epoch;this.sequence++;
  let done!: (value: boolean) => void;const task = new Promise<boolean>(resolve => {done = resolve;});this.flight = task;
  const current = () => epoch === this.epoch && this.flight === task;
  this.publish({busy: kind, error: '', reading: false});
  void (async () => {
   try {return await work(current);} catch (error) {if (current()) this.handle(error);return false;}
   finally {if (current()) {this.flight = null;this.publish({busy: null});}}
  })().then(done);return task;
 }
 async quote(text?: string): Promise<boolean> {
  if (!this.usable() || this.state.busy || this.acceptCommand) return false;
  const play = this.state.play;if (!play || !['preparing', 'awaiting'].includes(play.status)) return false;
  const content = (text ?? this.state.draft).trim();if (play.status === 'awaiting' && !content) return false;
  this.publish({draft: content, quote: null});
  const epoch=this.epoch;
  if(play.status==='awaiting' && !await this.saveDraft())return false;
  if(epoch!==this.epoch||!this.usable()||this.state.play?.revision!==play.revision)return false;
  return this.command('quote', async current => {
   const base = {protocolVersion: 1 as const, datasetId: play.datasetId, experienceId: play.experienceId, expectedExperienceRevision: play.revision, commandId: v7()};
   const result = await this.binding!.client.quote(play.status === 'preparing' ? {...base, kind: 'opening'} : {...base, kind: 'response', interactionEventId: play.interaction!.id, text: content});
   if (!current()) return false;this.publish({quote: result.data});this.position(result.data, false);return true;
  });
 }
 private acceptInput(quote: QuoteDTO): AcceptGenerationInput {
  return {protocolVersion: 1, datasetId: quote.datasetId, experienceId: quote.experienceId, expectedExperienceRevision: quote.experienceRevision,
   quoteId: quote.id, commandId: quote.id, consent: true};
 }
 async accept(): Promise<boolean> {
  if (!this.usable() || this.state.busy || !this.state.quote) return false;
  const quote = this.state.quote;
  if (!this.acceptCommand && Date.parse(quote.expiresAt) <= Date.now()) {this.publish({error: '报价已过期，请重新获取费用。'});return false;}
  // Persist the opaque command identity in navigation before any paid acceptance request.
  try {this.position(quote, true);} catch {this.publish({error: '确认位置未能保存，尚未提交生成请求。'});return false;}
  const input = this.acceptCommand ?? this.acceptInput(quote);this.acceptCommand = input;
  const accepted = await this.command('accept', async current => {
   try {
    await this.binding!.client.accept(structuredClone(input));if (!current()) return false;
    this.acceptCommand = null;this.publish({quote: null, acceptUnknown: false, draft: '', draftRecord: null, play: null});this.position(null, false);return true;
   } catch (error) {
    if (current()) {
     // Once an attempt was uncertain, a later rejection cannot erase its original command identity.
     const rejected = error instanceof PlaybackClientError && error.outcome === 'rejected' && !this.state.acceptUnknown;
     if (rejected) {this.acceptCommand = null;this.position(quote, false);}
     this.publish({acceptUnknown: !rejected});this.handle(error);
     if(error instanceof PlaybackClientError&&error.code==='GENERATION_QUOTE_EXPIRED'&&this.state.acceptUnknown) {
      try {
       const observed=await this.binding!.client.getQuote({protocolVersion:1,datasetId:input.datasetId,experienceId:input.experienceId,quoteId:input.quoteId});
       if(current()&&observed.acceptedTurnId===null&&Date.parse(observed.quote.expiresAt)<=Date.now()) {
        this.acceptCommand=null;this.publish({acceptUnknown:false,quote:null});this.position(null,false);
       }
      }catch{/* Keep original identity until authoritative expiry is established. */}
     }
    }return false;
   }
  });
  await this.refresh();return accepted;
 }
 async beginViewing():Promise<boolean> {
  const play=this.state.play;if(!this.usable()||play?.status!=='playing'||!play.turn?.media||this.state.busy)return false;
  if(this.viewSession?.turnId===play.turn.id&&this.viewSession.mediaId===play.turn.media.id)return true;
  return this.command('viewing',async current=>{
   const result=await this.binding!.client.beginPlayback({protocolVersion:1,datasetId:play.datasetId,experienceId:play.experienceId,expectedExperienceRevision:play.revision,turnId:play.turn!.id,mediaId:play.turn!.media!.id,commandId:v7()});
   if(!current())return false;this.viewSession=result;this.lastProgressAt=0;return true;
  });
 }
 restartViewing(){if(this.state.busy)return;this.viewSession=null;this.progressCommand=null;this.lastProgressAt=0;this.clearError();}
 async reportCoverage(progress:{positionMs:number;coveredMs:number},force=false):Promise<boolean>{
  if(this.state.busy==='progress'&&this.flight){if(!force)return true;await this.flight;}
  const view=this.viewSession,play=this.state.play;
  if(!this.usable()||this.state.busy||!view||play?.status!=='playing'||view.turnId!==play.turn?.id)return false;
  if(view.status==='complete')return true;
  if(!force&&Date.now()-this.lastProgressAt<1000)return true;
  this.lastProgressAt=Date.now();
  return this.command('progress',async current=>{
   // A lost response can hide a committed sequence. Reconcile that exact free
   // command before issuing another report, including the final ended report.
   if(this.progressCommand){
    const recovered=await this.binding!.client.reportPlayback(this.progressCommand);
    if(!current())return false;this.viewSession=recovered;this.progressCommand=null;
   }
   const latest=this.viewSession!;
   if(latest.status==='complete'||(!force&&Math.round(progress.coveredMs)<=latest.coveredMs))return true;
   this.progressCommand={protocolVersion:1,datasetId:latest.datasetId,experienceId:latest.experienceId,commandId:v7(),playbackSessionId:latest.id,
    sequence:latest.sequence+1,positionMs:Math.round(progress.positionMs),coveredMs:Math.round(progress.coveredMs)};
   const result=await this.binding!.client.reportPlayback(this.progressCommand);
   if(!current())return false;this.viewSession=result;this.progressCommand=null;return true;
  });
 }
 async ended(turnId: string, mediaId: string, progress?:{positionMs:number;coveredMs:number}): Promise<boolean> {
  if(this.state.busy==='progress'&&this.flight)await this.flight;
  if (!this.usable() || this.state.busy) return false;
  const play = this.state.play;
  if (!play || play.status !== 'playing' || play.turn?.id !== turnId || play.turn.media?.id !== mediaId) return false;
  if(!this.playbackCommand){
   if(!progress||!await this.reportCoverage(progress,true)||this.viewSession?.status!=='complete')return false;
  }
  const input = this.playbackCommand ?? {protocolVersion: 1 as const, datasetId: play.datasetId, experienceId: play.experienceId,
   expectedExperienceRevision: play.revision, turnId, mediaId, commandId: turnId};
  this.playbackCommand = input;
  const confirmed = await this.command('playback', async current => {
   try {await this.binding!.client.completePlayback(input);if (!current()) return false;this.playbackCommand = null;this.publish({playbackUnknown: false});return true;}
   catch (error) {if (current()) {this.publish({playbackUnknown: true});this.handle(error);}return false;}
  });
  await this.refresh();return confirmed;
 }
}
