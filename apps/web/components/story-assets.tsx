'use client';
import {createContext,useContext,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import type {AssetRole,Story,CharacterTemplate} from '../../../packages/domain/src/story';
import type {AssetReadBinding,AssetRef} from '../lib/authoring/asset-ports';
import {useAssetUploadController} from '../lib/authoring/use-asset-upload-controller';
import {useAssetPreview} from '../lib/authoring/use-asset-preview';
import {validateImageFile,validateImageDimensions} from '../lib/assets/validation';
import {storyArtwork} from '../lib/presentation/story-art';
import styles from './story-assets.module.css';

const AssetContext=createContext<AssetReadBinding|null>(null);
export function AssetProvider({binding,children}:{binding:AssetReadBinding;children:ReactNode}){return <AssetContext.Provider value={binding}>{children}</AssetContext.Provider>;}
export function useAssetBinding(){return useContext(AssetContext);}
/** Container-owned, not picker-owned. A tab unmount never discards a command. */
export function useImageUpload(editingKey:string,onChange:(ref:AssetRef|null)=>void){
 const binding=useAssetBinding();if(!binding)throw Error('素材客户端未配置');
 const upload=useAssetUploadController({...binding,editingKey}),change=useRef(onChange);change.current=onChange;
 useLayoutEffect(()=>{if(upload.state.result){const result=upload.controller.takeResult(upload.state.result.operationId);if(result)change.current(result.ref);}},[upload.controller,upload.state.result]);
 return {...upload,binding,editingKey};
}
export type ImageUpload=ReturnType<typeof useImageUpload>;
/** Legacy Story assets are demo-only. Never reinterpret their bare IDs as formal references. */
export function useImageAsset(id?:string){
 const binding=useAssetBinding();const preview=useAssetPreview(id?{kind:'demo',id}:null,binding);
 return {...preview,url:preview.url??'',name:'',missing:preview.status==='missing'};
}
export function useStoryArtwork(story:Story){
 const id=story.assets?.cover||story.assets?.character||story.assets?.opening,asset=useImageAsset(id);
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
function PreviewStatus({preview}:{preview:ReturnType<typeof useAssetPreview>}){
 if(preview.status==='loading')return <small role="status">正在读取图片…</small>;
 if(preview.status==='disconnected')return <small role="status">连接失效，请重新连接后读取图片。</small>;
 if(preview.status==='error'||preview.status==='missing')return <div className={styles.readError} role="alert"><small>{preview.status==='missing'?'图片不可用或已缺失，请重试或重新选择。':preview.error?.message||'图片读取失败，请重试。'}</small><button type="button" onClick={preview.retry}>重试图片读取</button></div>;
 return null;
}
export function CharacterPortrait({character,assetRef}:{character:CharacterTemplate;assetRef?:AssetRef|null}){
 const binding=useAssetBinding(),ref=assetRef===undefined?(character.imageAssetId?{kind:'demo' as const,id:character.imageAssetId}:null):assetRef;
 const preview=useAssetPreview(ref,binding);
 return <div className={styles.portrait}>{preview.url?<img src={preview.url} alt={`${character.name}的参考图`}/>:!ref?<span>{[...character.name][0]}</span>:null}<PreviewStatus preview={preview}/></div>;
}
const labels:Record<AssetRole,{title:string;description:string}>={
 cover:{title:'剧本封面',description:'用于广场与剧本详情，不作为模型输入。'},
 character:{title:'角色参考',description:'记录人物外观参考。素材用途与后续所选模型的能力分别确认。'},
 opening:{title:'开场画面',description:'定义第一段视频的起始画面，与角色参考用途不同。'},
};
const phaseText={idle:'',validating:'正在验证图片…',beginning:'正在创建上传意图…',sending:'正在上传图片…',completing:'正在确认图片保存…',unknown:'图片上传结果待确认；保留原命令，不自动重新上传。',ready:'',rejected:''};
export function ImageAssetPicker({role,assetRef,upload,onChange,disabled=false,onBusyChange}:{role:AssetRole;assetRef:AssetRef|null;upload:ImageUpload;onChange:(ref:AssetRef|null)=>void;disabled?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const {controller,state,binding,editingKey}=upload,preview=useAssetPreview(assetRef,binding);
 const [file,setFile]=useState<File|null>(null),[rights,setRights]=useState(false),[error,setError]=useState(''),[validating,setValidating]=useState(false),[localURL,setLocalURL]=useState('');
 const selectedScope=useRef<{client:AssetReadBinding['client'];datasetId:string|null;editingKey:string}|null>(null);
 const busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
 useEffect(()=>()=>busyCallback.current?.(false),[]);
 const alive=useRef(true),sequence=useRef(0),selectLock=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;};},[]);
 // A different editing instance/namespace must not carry an unchecked local file into it.
 useEffect(()=>{sequence.current++;selectLock.current=false;setValidating(false);setFile(null);setRights(false);setError('');},[controller,binding.client,binding.datasetId,editingKey]);
 useEffect(()=>{if(!file||!binding.connected)return;const url=URL.createObjectURL(file);setLocalURL(url);return()=>{URL.revokeObjectURL(url);setLocalURL('');};},[file,binding.connected]);
 useEffect(()=>{onBusyChange?.(state.busy||validating);},[state.busy,validating,onBusyChange]);
 const blocked=disabled||validating||state.busy||state.unknown||state.datasetChanged||!binding.connected;
 const isBlocked=()=>{const current=controller.getSnapshot();return disabled||selectLock.current||current.busy||current.unknown||current.datasetChanged||!binding.connected;};
 async function select(next?:File){
  if(!next||isBlocked()||!controller.reset())return;
  const turn=++sequence.current;selectedScope.current={client:binding.client,datasetId:binding.datasetId,editingKey};selectLock.current=true;setValidating(true);setFile(null);setRights(false);setError('');
  try{validateImageFile(next);const bitmap=await createImageBitmap(next);try{validateImageDimensions(bitmap.width,bitmap.height);}finally{bitmap.close();}
   if(alive.current&&sequence.current===turn)setFile(next);
  }catch{if(alive.current&&sequence.current===turn)setError('请选择有效的 JPG / PNG / WebP，最多10 MB，每边256–8000像素且不超过2400万像素。');}
  finally{if(alive.current&&sequence.current===turn){selectLock.current=false;setValidating(false);}}
 }
 function clear(){if(isBlocked()||!controller.reset())return;sequence.current++;setFile(null);setRights(false);setError('');onChange(null);}
 const localCurrent=selectedScope.current?.client===binding.client&&selectedScope.current.datasetId===binding.datasetId&&selectedScope.current.editingKey===editingKey&&binding.connected;
 const showLocal=localCurrent&&state.phase!=='ready';
 const formal=binding.client.kind==='formal',shown=(showLocal?localURL:'')||preview.url;
 return <section className={styles.asset} aria-busy={state.busy||validating}>
 <div className={styles.assetHeader}><h3>{labels[role].title}</h3><span>{assetRef?'已选择':'可选'}</span></div><p>{labels[role].description}</p>
 {shown&&<img src={shown} alt={`${labels[role].title}${showLocal&&localURL?'待上传':'预览'}`}/>}
 <label className={styles.picker}>{state.busy||validating?'正在处理图片…':assetRef?'替换图片':'选择图片'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked} aria-label={`选择${labels[role].title}`} onChange={e=>{void select(e.target.files?.[0]);e.target.value='';}}/></label>
 <label className={styles.rights}><input type="checkbox" checked={rights} disabled={blocked||!file} onChange={e=>setRights(e.target.checked)}/><span>我确认有权使用这张图片</span></label>
 <p className={styles.disclosure}>仅记录你的声明，不代表平台验证版权。{formal?'图片存于本机服务；保存角色后才关联，后续模型调用另行发生。':'演练图片只存于当前浏览器，不发送到正式服务。'}</p>
 <button type="button" disabled={blocked||!file||!rights||state.phase==='ready'} onClick={()=>{if(file&&rights&&!isBlocked()&&controller.getSnapshot().phase!=='ready')void controller.start(file,'我确认有权使用这张图片');}}>{formal?'上传图片':'导入图片'}</button>
 {(assetRef||file)&&<button type="button" disabled={blocked} onClick={clear}>清除选择</button>}
 <small>{file?.name||state.fileName||'JPG / PNG / WebP · 最多 10 MB'}</small>
 {!(showLocal&&localURL)&&<PreviewStatus preview={preview}/>}
 {(validating||phaseText[state.phase])&&<p role="status">{validating?'正在验证图片…':phaseText[state.phase]}</p>}
 {state.phase==='ready'&&<p role="status">{formal?'图片已保存到本机，保存角色后生效':'图片已导入当前浏览器，保存设定后生效'}</p>}
 {state.error&&<p role="alert">{state.error.message}</p>}{error&&<p role="alert">{error}</p>}
 {state.unknown&&!state.datasetChanged&&<button type="button" disabled={state.busy||!binding.connected} onClick={()=>void controller.confirm()}>确认上次图片命令</button>}
 {state.phase==='rejected'&&!state.datasetChanged&&<button type="button" disabled={disabled||state.busy||!binding.connected} onClick={()=>void controller.retry()}>重试图片上传</button>}
 {state.datasetChanged&&<p role="alert">数据已重置，原图片命令停止重放。请从保留文本新建并重新选择图片。</p>}
 </section>;
}
