'use client';
import {createEntityId} from '../../../packages/domain/src/id';

import {useState,useEffect,useRef} from 'react';
import {ArrowLeft,Check,Play,Save as SaveIcon,Users,BookOpen} from 'lucide-react';
import {applyCharacterTemplate,type Story,type AssetRole} from '../../../packages/domain/src/story';
import type {Character} from './storage';
import type {StoryController,StoryState} from '../lib/authoring/story-controller';
import type {DraftDTO} from '../../runtime/src/contracts/story-draft';
import {effectivePortrait,type StoryFields} from '../lib/authoring/story-viewmodel';
import {useAssetPreview} from '../lib/authoring/use-asset-preview';
import type {AssetRef} from '../lib/authoring/asset-ports';
import type {CharacterSelection,CharacterSource,PendingState} from '../lib/authoring/character-viewmodel';
import {images} from '../lib/presentation/story-art';
import {ImageAssetPicker,useStoryArtwork,useImageUpload,useAssetBinding} from './story-assets';
const sections=['基础信息','世界与开局','角色配置','画面与素材'];
export function Editor({initial,characters,onSave,onSaveCharacter,onBack,onPlay,notice,dialog,formal=false,characterSource,characterPending,characterReset=false,characterEpoch,onResetCharacter,connectionSlot,story,onPrepared,prepareButtonRef}:{initial:Story;characters:Character[];onSave:(s:Story)=>Promise<Story>;story?:{controller:StoryController;state:StoryState};onPrepared?:(dto:DraftDTO)=>void;prepareButtonRef?:React.Ref<HTMLButtonElement>;onSaveCharacter:(c:CharacterSelection)=>Promise<CharacterSelection>;formal?:boolean;characterSource?:CharacterSource;characterPending?:PendingState;characterReset?:boolean;characterEpoch?:unknown;connectionSlot?:React.ReactNode;onResetCharacter?:()=>void;onBack:()=>void;onPlay:(s:Story)=>void;notice:string;dialog:React.ReactNode}){
 const [demoStory,setS]=useState<Story&Partial<Pick<StoryFields,'playerRole'|'worldRules'|'tone'>>>(initial),[section,setSection]=useState(0),[saved,setSaved]=useState(JSON.stringify(initial));
 const [demoEditingKey]=useState(createEntityId),binding=useAssetBinding(),editingKey=story?.state.editingKey??demoEditingKey;
 // Legacy fields support demo rendering only; formal mutations always serialize the complete controller form.
 const s=story?{...demoStory,...story.state.fields}:demoStory;
 const saveLock=useRef(false),[storySaving,setStorySaving]=useState(false);
 const [portrait,setPortrait]=useState<AssetRef|null>(()=>formal&&characterSource?.portraitAssetId?{kind:'formal',datasetId:characterSource.datasetId,id:characterSource.portraitAssetId}:null);
 const portraitBaseline=useRef(JSON.stringify(portrait));
 function selectImage(role:AssetRole,ref:AssetRef|null){
  if(story){story.controller.selectAsset(role,ref,editingKey);return;}
  if(formal){if(role==='character'&&(!ref||(ref.kind==='formal'&&ref.datasetId===binding?.datasetId)))setPortrait(ref);return;}
  if(ref&&ref.kind!=='demo')return;
  setS(prev=>({...prev,assets:{...prev.assets,[role]:ref?.id},...(role==='character'?{artId:undefined}:{})}));
 }
 const characterUpload=useImageUpload(`${editingKey}:character`,ref=>selectImage('character',ref));
 const coverUpload=useImageUpload(`${editingKey}:cover`,ref=>selectImage('cover',ref));
 const openingUpload=useImageUpload(`${editingKey}:opening`,ref=>selectImage('opening',ref));
 const uploads={character:characterUpload,cover:coverUpload,opening:openingUpload};
 const imageUnknown=Object.values(uploads).some(x=>x.state.unknown);
 const imageReset=Object.values(uploads).some(x=>x.state.datasetChanged)||Boolean(portrait?.kind==='formal'&&binding?.datasetId&&portrait.datasetId!==binding.datasetId);
 const recovery=characterReset||imageReset||Boolean(story?.state.datasetChanged);
 const imageBlocked=()=>Object.values(uploads).some(x=>{const current=x.controller.getSnapshot();return current.busy||current.unknown||current.datasetChanged;});
 function recover(){if(Object.values(uploads).every(x=>x.controller.discardForDatasetChange())){setPortrait(null);story?.controller.fromRetained();onResetCharacter?.();}}
 const [busyRoles,setBusyRoles]=useState<Partial<Record<AssetRole,boolean>>>({}),[feedback,setFeedback]=useState('');
 const [characterSaving,setCharacterSaving]=useState(false),characterLock=useRef(false),attempt=useRef(0),alive=useRef(true),currentStory=useRef(s),submitted=useRef('');currentStory.current=s;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;attempt.current++;};},[]);
 useEffect(()=>{attempt.current++;characterLock.current=false;setCharacterSaving(false);saveLock.current=false;setStorySaving(false);},[characterEpoch]);
 const busy=storySaving||Boolean(story?.state.saving||story?.state.reading)||Object.values(busyRoles).some(Boolean)||Object.values(uploads).some(x=>x.state.busy)||characterSaving||Boolean(characterPending?.busy),dirty=story?story.state.dirty:JSON.stringify(s)!==saved||JSON.stringify(portrait)!==portraitBaseline.current,demoArt=useStoryArtwork(formal?{...demoStory,assets:undefined,artId:undefined,image:''}:demoStory);
 const assetDataset=story?.state.assetDatasetId??binding?.datasetId;
 const portraitRef=story?(effectivePortrait(story.state.fields)&&assetDataset?{kind:'formal' as const,datasetId:assetDataset,id:effectivePortrait(story.state.fields)!}:null):portrait;
 const coverId=story?.state.fields.assetSlots.cover;
 const formalPreview=useAssetPreview(formal?(coverId&&assetDataset?{kind:'formal',datasetId:assetDataset,id:coverId}:portraitRef):null,binding);
 const art=formal?{url:formalPreview.url,missing:formalPreview.status==='missing'||formalPreview.status==='error'}:demoArt;
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirty||busy||story?.state.unknown||characterPending?.unknown||imageUnknown||recovery){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty,busy,story?.state.unknown,characterPending?.unknown,imageUnknown,recovery]);
 function field(key:'title'|'world'|'opening'|'genre'|'character'|'personality'|'appearance'|'speakingStyle'|'boundaries'|'relationship'|'playerRole'|'tone'|'image',value:string){if(story&&key!=='image')story.controller.field(key,value);else setS(prev=>({...prev,[key]:value}));}
 async function save(prepare=false){
  if(saveLock.current||busy||recovery||imageBlocked()||characterPending?.unknown)return;
  saveLock.current=true;setStorySaving(true);setFeedback('');const epoch=++attempt.current,snapshot=structuredClone(demoStory);
  try{if(formal){if(!story)throw Error('正式剧本客户端未配置。');const dto=await story.controller.save();if(alive.current&&epoch===attempt.current&&prepare)onPrepared?.(dto);}
   else{const acknowledged=await onSave(snapshot);if(alive.current&&epoch===attempt.current){setSaved(JSON.stringify(snapshot));if(prepare)onPlay(acknowledged);}}}
  catch(error){if(alive.current&&epoch===attempt.current)setFeedback(story?.state.error||'剧本保存未确认，输入仍保留，请处理错误或确认原命令。');}
  finally{if(alive.current&&epoch===attempt.current){saveLock.current=false;setStorySaving(false);}}
 }

 function assetPicker(role:AssetRole){return <ImageAssetPicker role={role} assetRef={formal?(role==='character'?portraitRef:story?.state.fields.assetSlots[role]&&assetDataset?{kind:'formal',datasetId:assetDataset,id:story.state.fields.assetSlots[role]!}:null):s.assets?.[role]?{kind:'demo',id:s.assets[role]!}:null} upload={uploads[role]} onChange={ref=>selectImage(role,ref)} disabled={busy||Boolean(story?.state.unknown)||Boolean(characterPending?.unknown)||recovery} onBusyChange={value=>setBusyRoles(prev=>prev[role]===value?prev:{...prev,[role]:value})}/>;}
 function characterCopy(story:Story):CharacterSelection{return {id:createEntityId(),name:story.character,personality:story.personality,appearance:story.appearance??'',speakingStyle:story.speakingStyle??'',boundaries:story.boundaries??'',portraitRef:formal?portraitRef:story.assets?.character?{kind:'demo',id:story.assets.character}:null,...(formal?{source:characterSource}:{imageAssetId:story.assets?.character})};}

 function contentKey(c:CharacterSelection){const {id,source,...fields}=c;return JSON.stringify(fields);}
 async function saveCharacter(){
  if(characterLock.current||busy||recovery||imageBlocked())return;
  const next=characterCopy(s);if(!characterPending?.unknown&&(!next.name.trim()||[...next.name].length>120)){setFeedback('请填写角色姓名，最多120个字符；其他设定可留空。');return;}
  if(!characterPending?.unknown)submitted.current=contentKey(next);
  characterLock.current=true;setCharacterSaving(true);setFeedback('');const version=++attempt.current;
  try{await onSaveCharacter(next);if(alive.current&&version===attempt.current){const changed=contentKey(characterCopy(currentStory.current))!==submitted.current;
   setFeedback(changed?'已确认提交的角色；当前角色还有未另存的修改。':'角色模板已保存。此剧本仍是编辑副本，未冻结角色版本。');}}
  catch(error){if(alive.current&&version===attempt.current&&!(error instanceof Error&&error.message==='RESPONSE_SUPERSEDED'))setFeedback('角色另存失败，输入仍保留；请处理错误或确认原命令。');}
  finally{if(alive.current&&version===attempt.current){characterLock.current=false;setCharacterSaving(false);}}
 }

 return <div className="editor-shell">
  <header className="editor-header"><button disabled={busy} className="text-button" onClick={()=>{if(story?.state.unknown||characterPending?.unknown||imageUnknown||recovery||imageBlocked()){setFeedback('角色或图片命令结果待确认，请先处理原命令。');return;}if(!dirty||confirm('还有未保存的修改，确定离开吗？'))onBack();}}><ArrowLeft size={18}/>我的剧本</button><span className="editor-title">{s.title||'未命名剧本'}<small>{busy?'正在处理，请稍候…':dirty?'有未保存修改':formal?(story?.state.confirmed?'本机 SQLite 草稿':'未保存的编辑副本'):'浏览器草稿'}</small></span><div><button disabled={busy||recovery||imageUnknown||Boolean(characterPending?.unknown)||(formal&&(!story?.state.connected||Boolean(story.state.confirmed?.deletedAt)))} className="secondary" onClick={()=>void save()}><SaveIcon size={16}/>{story?.state.unknown?'确认上次剧本命令':'保存草稿'}</button><button disabled={busy||recovery||imageUnknown||Boolean(characterPending?.unknown)||(formal&&(!story?.state.connected||Boolean(story.state.confirmed?.deletedAt)))} className="primary" ref={prepareButtonRef} onClick={()=>void save(true)}><Play size={16}/>保存并进入准备</button></div></header>
  <div className="editor-layout"><aside className="editor-nav"><p className="eyebrow">STORY STUDIO</p><h2>构建你的开端</h2>{sections.map((x,i)=><button disabled={characterSaving||Boolean(characterPending?.busy)} className={section===i?'editor-tab active':'editor-tab'} key={x} onClick={()=>setSection(i)}><span>0{i+1}</span>{x}</button>)}<p className="editor-tip">不必写下所有情节。<br/>为角色和世界留一点空间，<br/>让故事在游玩中发生。</p></aside>
  <main className="editor-main">{connectionSlot}<p className="eyebrow">STEP 0{section+1} / 04</p><h1>{sections[section]}</h1><p className="muted">{['让玩家一眼知道，这是怎样一个故事。','定义起点，而不是替玩家决定终点。','先有一个鲜活的人，才会有想继续的故事。','封面给人看，参考图定义角色，开场图定义起点。'][section]}</p><div className="editor-fields">
  {section===0&&<><label>剧本名称 <span>*</span><input value={s.title} onChange={e=>field('title',e.target.value)} placeholder="为你的故事起一个名字" maxLength={formal?undefined:120}/><small>一个令人想走进去的名字。</small></label><label>故事题材<select value={s.genre} onChange={e=>field('genre',e.target.value)}>{[...new Set([s.genre,'浪漫','都市','奇幻','日常'])].map(x=><option key={x}>{x}</option>)}</select></label><div className="inline-note"><BookOpen size={20}/><p>这是你的剧本，不是固定的剧情树。用户进入后可以用自己的对话和行动推动发展。</p></div></>}
  {section===1&&<><label>世界背景 <span>*</span><textarea value={s.world} onChange={e=>field('world',e.target.value)} placeholder="故事发生在哪里？这个世界有哪些规则？" rows={5}/></label><label>开局情境 <span>*</span><textarea value={s.opening} onChange={e=>field('opening',e.target.value)} placeholder="用几句话描述故事开始的这一刻…" rows={4}/><small>避免替玩家规定台词、行动和情感选择。</small></label><label>玩家身份<textarea value={s.playerRole??''} onChange={e=>field('playerRole',e.target.value)} rows={2}/></label><label>世界规则（每行一条）<textarea value={(s.worldRules??[]).join('\n')} onChange={e=>{const value=e.target.value?e.target.value.split('\n'):[];if(story)story.controller.field('worldRules',value);else setS(prev=>({...prev,worldRules:value}));}} rows={3}/></label><label>叙事语气<input value={s.tone??''} onChange={e=>field('tone',e.target.value)}/></label></>}
  {section===2&&<>
   {!formal&&characters.length>0&&<label>从角色库复制<select value="" disabled={busy} onChange={e=>{const c=characters.find(c=>c.id===e.target.value);if(c&&(!(s.character||s.personality||s.appearance||s.speakingStyle||s.boundaries||s.assets?.character||s.artId)||confirm('替换当前角色的姓名、设定与参考图？剧本背景和初始关系保持不变。')))setS(prev=>applyCharacterTemplate(prev,c));}}><option value="" disabled>选择角色模板</option>{characters.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><small>完整复制外貌、表达习惯、边界与图片，后续独立编辑。</small></label>}
   <label>角色姓名 <span>*</span><input value={s.character} onChange={e=>field('character',e.target.value)} placeholder="TA 叫什么？"/></label><label>性格与背景<textarea value={s.personality} onChange={e=>field('personality',e.target.value)} placeholder="TA 的性格、经历，以及想做什么…" rows={3}/></label><div className="character-fields-grid"><label>外貌与穿着<textarea value={s.appearance??''} onChange={e=>field('appearance',e.target.value)} placeholder="发型、神态、常穿的衣服…" rows={3}/></label><label>表达习惯<textarea value={s.speakingStyle??''} onChange={e=>field('speakingStyle',e.target.value)} placeholder="说话直接，还是慢慢表达？" rows={3}/></label></div><label>你们的初始关系<input value={s.relationship??''} onChange={e=>field('relationship',e.target.value)} placeholder="例如初次见面、熟识，或你自己的设定"/><small>关系属于这个剧本，不随角色模板复制。</small></label><label>相处边界<textarea value={s.boundaries??''} onChange={e=>field('boundaries',e.target.value)} placeholder="例如尊重距离，不替玩家表达感情…" rows={3}/></label>
   {story&&<><p role="status">{story.state.fields.source?.kind==='bound'?'已绑定固定角色版本；文字修改仅作为此剧本覆盖，不修改角色库。':story.state.fields.source?.kind==='library'?'来源：角色库；保存后角色设定独立保留。':'当前角色为此剧本内联草稿。'}</p><label>角色头像方式<select value={story.state.fields.portrait.mode} disabled={busy||story.state.unknown||recovery} onChange={e=>{if(e.target.value!=='asset')story.controller.portraitMode(e.target.value as 'inherit'|'none');}}><option value="inherit">继承固定角色头像</option><option value="none">不使用角色头像</option><option value="asset" disabled>使用所选参考图</option></select></label><button type="button" className="text-button" disabled={busy||story.state.unknown||recovery} onClick={()=>story.controller.clearCharacter()}>清除当前角色</button></>}
   {assetPicker('character')}{!formal&&s.artId&&!s.assets?.character&&<div className="inline-note"><p>此剧本带有演示角色视觉。选择自己的图片会替换它。</p><button type="button" className="text-button" onClick={()=>setS(prev=>({...prev,artId:undefined}))}>移除演示视觉</button></div>}
   <button type="button" className="secondary" disabled={busy||recovery||imageUnknown} onClick={()=>void saveCharacter()}><Users size={16}/>{characterPending?.unknown?'确认上次角色命令':'另存为角色模板'}</button><div className="inline-note"><Users size={20}/><p>一期支持一位主要角色。角色模板、剧本草稿与游玩设定独立，修改不会串到其他故事。</p></div>
  </>}
  {section===3&&<>{assetPicker('cover')}{assetPicker('opening')}{!formal&&<><label>未选自定义图片时的封面</label><div className="image-options">{Object.entries(images).map(([key,url],i)=><button aria-pressed={s.image===key} className={s.image===key?'image-option picked':'image-option'} key={key} onClick={()=>field('image',key)}><img src={url} alt={['海边','夜空','森林','小屋'][i]}/><span>{['海边','夜空','森林','小屋'][i]}{s.image===key&&<Check size={14}/>}</span></button>)}</div><div className="inline-note"><p>演练图片现阶段只保存在浏览器，不代表已经交给视频模型。正式生成会按供应商与模型校验素材用途；封面不进入生成提示。</p></div></>}{formal&&<p className="inline-note">角色参考、剧本封面和开场画面随剧本一起保存；不会启动生成任务。</p>}</>}
  </div><>{formal&&<p className="inline-note">{story?.state.confirmed?'剧本已保存；当前修改需再次保存后生效。':'当前输入尚未保存；保存后角色设定独立保留，图片随剧本保存。'}</p>}{story?.state.error&&<p role="alert">{story.state.error}</p>}{story?.state.message&&<p role="status">{story.state.message}</p>}{recovery&&<div role="alert">数据已重置，工作文本仍保留。<button type="button" disabled={busy} onClick={recover}>{story?'从保留文本新建剧本':'从保留文本新建角色'}</button></div>}</><div className="editor-bottom"><span>{section+1} / 4</span>{section<3?<button disabled={characterSaving||Boolean(characterPending?.busy)} className="primary" onClick={()=>setSection(section+1)}>继续配置 →</button>:<button disabled={busy||Boolean(story?.state.unknown)||recovery||imageUnknown||Boolean(characterPending?.unknown)||(formal&&(!story?.state.connected||Boolean(story.state.confirmed?.deletedAt)))} className="primary" onClick={()=>void save()}>保存剧本<Check size={16}/></button>}</div>{feedback&&<p className="inline-note" role="status">{feedback}</p>}{notice&&<p className="inline-note" role="status">{notice}</p>}</main>
  <aside className="editor-preview"><p className="eyebrow">你的故事，初见模样</p><div className="preview-cover" style={{backgroundImage:art.url?`url(${art.url})`:undefined}}><span>{s.genre} · 开放故事</span><h2>{s.title||'一个尚未命名的故事'}</h2></div>{art.missing&&<p role="status">本机图片缺失，请重新选择。</p>}<h3>{s.character||'等待一位角色'}</h3><p>{s.world||'你的世界会在这里慢慢浮现。'}</p><hr/><small>这是封面预览，不是生成中的视频。<br/>图片选好即存本机，设定点击保存后生效。</small></aside>
  </div>{dialog}
 </div>;
}
