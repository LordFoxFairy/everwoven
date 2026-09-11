'use client';
import {SessionOpening} from './session-opening';
import {StoryAssetStatus} from './story-asset-status';
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useTRPC} from '../trpc/react';
import type {Story} from '../../../packages/domain/src/story';
import {configurationMessages,videoModels,videoSuppliers} from '../lib/video/catalog';
import {resolveLiveModel} from '../lib/video/registry';
import type {LiveVideoProvider} from '../lib/video/types';
import {LiveSession} from './live-session';
import styles from './live-session.module.css';
export function ConfiguredLiveSession({story,onExit}:{story:Story;onExit:()=>void}){
 const trpc=useTRPC();
 const configuration=useQuery(trpc.video.configuration.queryOptions());
 const [provider,setProvider]=useState<LiveVideoProvider|null>(null),[adapterError,setAdapterError]=useState('');
 const config=configuration.data;
 const message=configuration.isError?'接入配置读取失败，请稍后重试。':adapterError||(config?configurationMessages[config.reason]:'正在读取供应商与模型配置…');
 const selection=config?.selection?`${videoSuppliers[config.selection.providerId].label} / ${videoModels[config.selection.modelId].label}`:'';
 useEffect(()=>{
  setProvider(null);setAdapterError('');
  // A configured but disabled deployment must never instantiate a live adapter.
  if(configuration.isError||configuration.isFetching||!config?.available||!config.selection)return;
  try{setProvider(resolveLiveModel(config.selection));}catch{setAdapterError('所选模型的实时适配尚未完成。');}
 },[config,configuration.isError,configuration.isFetching]);
 if(provider)return <LiveSession story={story} provider={provider} onExit={onExit}/>;
 return <main className={styles.prepare}>
  <button className={styles.back} onClick={onExit}>← 返回剧本</button>
  <section className={styles.preparation} aria-labelledby="prepare-title">
   <SessionOpening story={story}/>
   <div className={styles.setup}>
    <span className={styles.eyebrow}>进入前的准备</span>
    <h2>让这个世界展开</h2>
    <p>桌面宽幅 · 随窗口等比适配。开始后，视频是整个现场的主体，表达时也不会遮住画面。</p>
    <div className={styles.unavailable} role="status"><strong>{selection||'供应商与模型尚未选定'}</strong><p>{message}</p></div>
    <StoryAssetStatus story={story}/>
    <p className={styles.frameNote}>确认接入配置后，再开始实时游玩。当前没有创建生成任务或产生费用。</p>
    <button className={styles.start} disabled>等待引擎就绪</button>
    <button className={styles.recheck} disabled={configuration.isFetching} onClick={()=>void configuration.refetch()}>重新检查配置</button>
   </div>
  </section>
 </main>;
}
