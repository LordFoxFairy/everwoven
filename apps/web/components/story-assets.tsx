'use client';
import {useAppEnvironment} from '../lib/environment/context';
import {useEffect,useRef,useState} from 'react';
import type {AssetRole,Story,CharacterTemplate} from '../../../packages/domain/src/story';
import {readImageAsset,importImageAsset} from '../lib/assets/store';
import {storyArtwork} from '../lib/presentation/story-art';
import styles from './story-assets.module.css';
export function useImageAsset(id?:string){
 const environment=useAppEnvironment();
 const [asset,setAsset]=useState<{id?:string;url:string;name:string;missing:boolean}>({url:'',name:'',missing:false});
 useEffect(()=>{let active=true,url='';setAsset({id,url:'',name:'',missing:false});if(id)void readImageAsset(id,environment).then(value=>{if(!active)return;if(value){url=URL.createObjectURL(value.blob);setAsset({id,url,name:value.name,missing:false});}else setAsset({id,url:'',name:'',missing:true});}).catch(()=>{if(active)setAsset({id,url:'',name:'',missing:true});});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[id,environment]);
 return asset.id===id?asset:{id,url:'',name:'',missing:false};
}
export function useStoryArtwork(story:Story){
 const id=story.assets?.cover||story.assets?.character||story.assets?.opening;
 const asset=useImageAsset(id);
 return {url:id?asset.url:storyArtwork(story),missing:asset.missing};
}
export function StoryCover({story,children,...props}:Omit<React.ButtonHTMLAttributes<HTMLButtonElement>,'style'> & {story:Story}){
 const art=useStoryArtwork(story);
 return <button {...props} style={{backgroundImage:art.url?`url(${art.url})`:undefined}}>{children}{art.missing&&<small className={styles.missing}>本机图片缺失，请重新选择</small>}</button>;
}
export function StoryThumbnail({story}:{story:Story}){
 const art=useStoryArtwork(story);
 return art.url?<img src={art.url} alt=""/>:<span className={styles.thumbnail}>{art.missing?'图片缺失':story.character.slice(0,1)}</span>;
}
export function CharacterPortrait({character}:{character:CharacterTemplate}){
 const asset=useImageAsset(character.imageAssetId);
 return <div className={styles.portrait}>{asset.url?<img src={asset.url} alt={`${character.name}的参考图`}/>:<span>{character.name.slice(0,1)}</span>}{asset.missing&&<small>本机图片缺失</small>}</div>;
}
const labels:Record<AssetRole,{title:string;description:string}>= {
 cover:{title:'剧本封面',description:'用于广场与剧本详情，不作为模型输入。'},
 character:{title:'角色参考',description:'用于定义人物外观；H3 支持参考图，H3 Max 不支持角色参考模式。'},
 opening:{title:'开场画面',description:'定义第一段视频的起始画面，与角色参考用途不同。'},
};
export function ImageAssetPicker({role,assetId,onChange,onBusyChange}:{role:AssetRole;assetId?:string;onChange:(id?:string)=>void;onBusyChange?:(busy:boolean)=>void}){
 const environment=useAppEnvironment();
 const asset=useImageAsset(assetId),[busy,setBusy]=useState(false),[error,setError]=useState('');const mounted=useRef(true),lock=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function select(file?:File){if(!file||lock.current)return;lock.current=true;setBusy(true);setError('');onBusyChange?.(true);try{const result=await importImageAsset(file,environment);if(mounted.current)onChange(result.id);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'图片导入失败');}finally{lock.current=false;if(mounted.current){setBusy(false);onBusyChange?.(false);}}}
 return <section className={styles.asset}><div className={styles.assetHeader}><h3>{labels[role].title}</h3><span>{assetId?'仅本机保存':'可选'}</span></div><p>{labels[role].description}</p>{asset.url&&<img src={asset.url} alt={`${labels[role].title}预览`}/>}<label className={styles.picker}>{busy?'正在处理图片…':assetId?'替换图片':'选择图片'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label={`选择${labels[role].title}`} onChange={e=>{void select(e.target.files?.[0]);e.target.value='';}}/></label>{assetId&&<button type="button" disabled={busy} onClick={()=>onChange(undefined)}>清除选择</button>}<small>{asset.name||'JPG / PNG / WebP · 最多 10 MB'}<br/>保留最大边 2048px 的处理副本，不上传外部服务。</small>{asset.missing&&<p role="status">本机原图记录缺失，请重新选择。</p>}{error&&<p role="alert">{error}</p>}</section>;
}
