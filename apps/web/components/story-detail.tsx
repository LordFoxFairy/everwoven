'use client';
import {useAppEnvironment} from '../lib/environment/context';
import {StoryAssetStatus} from './story-asset-status';
import {useEffect,useRef} from 'react';
import {ArrowRight,X,MessageCircle,Compass,Heart} from 'lucide-react';
import type {Story} from '../../../packages/domain/src/story';
import {useStoryArtwork} from './story-assets';
export function StartDialog({story,onClose,onStart}:{story:Story;onClose:()=>void;onStart:()=>void}){
 const demo=useAppEnvironment()==='demo';
 const art=useStoryArtwork(story);
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=ref.current;node?.showModal();return()=>node?.close();},[]);
 return <dialog ref={ref} onCancel={onClose} className="start-dialog character-detail" aria-labelledby="start-title">
  <button className="close" aria-label="关闭详情" onClick={onClose} autoFocus><X size={19}/></button>
  <div className="detail-portrait" style={{backgroundImage:art.url?`url(${art.url})`:undefined}}><span className="detail-art-label">{art.missing?'本机图片缺失':Object.values(story.assets??{}).some(Boolean)?'自定义图片 · 本机素材':story.artId?'原创 AI 角色视觉 · 静态参考':'场景参考 · 静态演示'}</span><div className="portrait-caption"><small>MEET SOMEONE, BEGIN SOMETHING</small><h2>{story.character}</h2><p>{story.relationship||'关系由你定义'}</p></div></div>
  <div className="detail-content"><p className="eyebrow">{story.genre} / 用户驱动 · 开放剧情</p><h2 id="start-title">{story.title}</h2><p className="detail-intro">{story.world}</p><section className="character-introduction"><h3>先认识 TA</h3><p>{story.personality||'留给你们在故事里慢慢发现。'}</p><div className="detail-traits"><span><MessageCircle size={15}/> {story.speakingStyle||'表达习惯由你设定'}</span><span><Heart size={15}/> {story.relationship||'不预设亲密关系'}</span></div></section><section className="detail-opening"><h3><Compass size={16}/>故事从这里开始</h3><p>{story.opening}</p></section><details className="detail-boundaries"><summary>你的身份与相处边界</summary><p>以你自己的身份进入，随时通过输入补充设定。</p><p>{story.boundaries||'用户决定自己的行动与感情，角色不替用户作出重大选择。'}</p></details><StoryAssetStatus story={story}/><div className="detail-start"><div className="demo-info">{demo?<>前端交互演练 · 不调用模型、不计费<br/>使用静态参考与示例建议，回应只保存在本浏览器。</>:<>真实视频生成尚未接通。<br/>你可以继续打磨设定；当前不会调用模型或以演练替代。</>}</div><button className="primary" disabled={!demo} onClick={()=>{if(demo)onStart();}}>{demo?'开始交互演练':'视频生成待接入'}<ArrowRight size={17}/></button></div></div>
 </dialog>
}
