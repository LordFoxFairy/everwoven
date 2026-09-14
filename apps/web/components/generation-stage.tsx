'use client';
import {SceneCost} from './scene-cost';
import {SceneHistory} from './scene-history';
import {createGenerationClient} from '../lib/experience/playback-client';
import type {SavedSceneDetail} from 'runtime/contracts/history';
import {v7} from 'uuid';
import {useState} from 'react';
import type {PlayController, PlayState} from '../lib/experience/play-controller';
import {readPlayRoute} from '../lib/experience/play-route';
import {generationMediaURL} from '../lib/experience/media-url';
import {budgetToText} from '../lib/experience/opening-controller';
import {SegmentedStage, type SegmentedStageProps} from './segmented-stage';
import {StageConfirmation} from './stage-confirmation';

export function GenerationStage({controller, state, onExit}: {controller: PlayController; state: PlayState; onExit: () => void}) {
 const [mediaRevision,setMediaRevision]=useState(0),[historyClient]=useState(()=>createGenerationClient().history);
 const [preview,setPreview]=useState<SavedSceneDetail|null>(null),[historyOpen,setHistoryOpen]=useState(false),[resuming,setResuming]=useState(false);
 const play = state.play, saved = state.lastMedia;
 const recoveringFork=typeof window!=='undefined'&&Boolean(readPlayRoute(window.location.hash)?.forkCommandId);
 let phase: SegmentedStageProps['phase'] = !play ? 'loading' : ({paused:'preparing',preparing: 'preparing', generating: 'generating', playing: 'watching', awaiting: 'awaiting', unknown: 'unknown', failed: 'failed'} as Record<string, SegmentedStageProps['phase']>)[play.status] ?? 'unknown';
 if (state.busy === 'playback' || state.playbackUnknown) phase = 'confirming';
 if (state.acceptUnknown || state.datasetChanged || !state.connected) phase = 'unknown';
 if (state.busy === 'accept') phase = 'generating';
 if(preview)phase='history';
 const retry = () => {
  if(play?.status==='paused'&&!resuming){setResuming(true);void historyClient.resume({protocolVersion:1,datasetId:play.datasetId,experienceId:play.experienceId,expectedExperienceRevision:play.revision,commandId:v7()}).catch(()=>controller.mediaFailed()).finally(()=>{setResuming(false);void controller.refresh();});return;}
  if (state.draftUnknown || controller.draftDirty()) {void controller.saveDraft();return;}
  if (state.acceptUnknown && state.quote) {void controller.accept();return;}
  if (state.playbackUnknown && play?.turn?.media) {void controller.ended(play.turn.id, play.turn.media.id);return;}
  const route = readPlayRoute(window.location.hash);
  if (!state.quote && route?.quoteId) {void controller.open(route.experienceId, route);return;}
  if (state.error && play?.status !== 'preparing') {controller.restartViewing();if(play?.turn?.media)setMediaRevision(n=>n+1);}
  if (play?.status === 'preparing') void controller.quote();else void controller.refresh();
 };
 const quote = state.quote;
 const shown=preview?{turnId:preview.media.turnId,mediaId:preview.media.id,duration:preview.media.duration}:saved;
 return <SegmentedStage key={`${state.datasetId}:${state.experienceId}`} title={play?.title || '正在展开的故事'} context="准备好后，故事会从你的设定开始。"
  phase={phase} simulated={false} mediaRevision={mediaRevision} recoveryLabel={state.draftUnknown || controller.draftDirty() ? '保存原回应' : state.acceptUnknown ? '核对原确认' : state.playbackUnknown ? '确认已看完' : '重新读取'} media={shown && state.datasetId && state.experienceId ? {kind: 'video', url: generationMediaURL({datasetId: state.datasetId,
   experienceId: state.experienceId, turnId: shown.turnId, mediaId: shown.mediaId})} : {kind: 'empty', url: ''}}
  choices={play?.interaction?.choices ?? []} initialResponseDraft={state.draft} managedResponse responseDirty={controller.draftDirty()} responsePending={resuming || Boolean(state.busy) || state.reading || state.draftUnknown || Boolean(state.draftConflict)}
  tools={container=><>{recoveringFork||['awaiting','paused'].includes(play?.status??'')?<SceneHistory key={`${state.datasetId}:${state.experienceId}`} controller={controller} state={state} container={container} onPreview={scene=>{setPreview(scene);setMediaRevision(n=>n+1);}} onOpenChange={setHistoryOpen}/>:null}{play?.turn&&state.datasetId&&state.experienceId?<SceneCost key={play.turn.id} query={{protocolVersion:1,datasetId:state.datasetId,experienceId:state.experienceId,turnId:play.turn.id}} container={container}/>:null}</>}
  onDraftChange={text => controller.draft(text)} onRespond={text => controller.quote(text)}
  onPlaybackStart={()=>controller.beginViewing()} onPlaybackProgress={progress=>controller.reportCoverage(progress)}
  onEnded={progress => {if (saved) void controller.ended(saved.turnId, saved.mediaId,progress);}} onMediaError={() => controller.mediaFailed()}
  onExit={() => {void controller.close().then(closed => {if(closed)onExit();});}} onRetry={retry}
  storageError={state.error || (state.playbackUnknown ? '播放结果待确认，画面保留在这里。' : undefined)} onRetrySave={retry}
  statusDetail={state.acceptUnknown ? '上次生成确认的结果还没核对完成。可以核对原请求，或稍后回来继续。' : state.datasetChanged ? '请连接原数据集后继续这段旅程。'
   : !state.connected ? '正在等待本机连接。' : play?.status === 'unknown' ? '供应商结果尚未确认，已暂停继续生成，原费用记录保留。'
   : play?.status === 'paused' ? '这条路线从你选中的一幕后开始。原路线保留，继续后可以选择新的回应。' : play?.status === 'preparing' ? '先查看这一幕的费用与规格，确认后开始生成。' : '当前故事和进展已保存在本机。'}
  retryLabel={state.acceptUnknown ? '核对原确认' : play?.status==='paused'?'从这里继续': play?.status === 'preparing' ? '查看生成费用' : '读取当前进展'}
  overlay={container => historyOpen?null:state.draftConflict ? <StageConfirmation portalContainer={container} title="另一窗口更新了回应"
   description={`本机已保存：“${state.draftConflict.text.slice(0,120)}”。当前输入仍保留。你想使用已保存的回应，还是用当前输入覆盖它？`}
   cancelLabel="使用已保存回应" confirmLabel="保存我的回应" onCancel={()=>controller.resolveDraftConflict(false)} onConfirm={()=>{controller.resolveDraftConflict(true);void controller.saveDraft();}}/> : quote && !state.busy && !state.acceptUnknown ? <StageConfirmation key={quote.id} portalContainer={container}
   title="让这一幕发生？" description={`${quote.summary.prompt.slice(0, 160)}${quote.summary.prompt.length > 160 ? '…' : ''} · ${quote.summary.duration} 秒 / ${quote.summary.resolution} / ${quote.summary.ratio}。本次费用上限 ${budgetToText({limitMicros: quote.maxCostMicros, currency: quote.currency})} ${quote.currency}，包含剧情规划、视频生成与内容核验。确认后才开始。`}
   cancelLabel="再想想" confirmLabel="确认并生成" onCancel={() => controller.cancelQuote()} onConfirm={() => {
    if (Date.parse(quote.expiresAt) <= Date.now()) {controller.cancelQuote();void controller.quote(quote.summary.prompt);} else void controller.accept();
   }}/> : null}/>
}
