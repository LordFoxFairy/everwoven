'use client';
import {useEffect,useState} from 'react';
import {DatabaseDrafts} from './database-drafts';
import {createDatabaseDraftsClient} from '../lib/authoring/database-client';
import {createAuthoringSessionClient} from '../lib/authoring/session-client';
import {AuthoringSessionProvider} from '../lib/authoring/session-context';
import {createCharacterClient} from '../lib/authoring/character-client';
import {useCharacterController} from '../lib/authoring/use-character-controller';
import {characterSelection,fieldsFromSelection,type CharacterSelection,type CharacterSource,type PendingState} from '../lib/authoring/character-viewmodel';
import {LocalConnection} from './local-connection';
import {House,Compass,BookOpen,Users,History,Plus,Search,ArrowUpRight,ArrowRight,ChevronLeft,Check,SlidersHorizontal,Sparkles,Send,Bookmark,X,MoreHorizontal,Film} from 'lucide-react';
import {listExampleStories} from '../mocks/catalog';
import {blankStory} from '../lib/presentation/new-story';
import {WorldHome} from './world-home';
import {readLibrary,writeLibrary,emptyLibrary,type Library,type Character} from './storage';
import {newSave,appendTurn,validateDraft,applyCharacterTemplate,type Story,type Save} from '../../../packages/domain/src/story';
import {Editor} from './story-editor';
import {MockSession} from '../mocks/mock-session';
import {StoryCover,StoryThumbnail} from './story-assets';
import {CharacterLibrary} from './character-library';
import {StartDialog} from './story-detail';
import {AppShell} from './layout/app-shell';
import type {WorkspaceView} from './layout/app-sidebar';
import {AppEnvironmentContext,useAppEnvironment} from '../lib/environment/context';
import type {AppEnvironment} from '../lib/environment/config';
type View=WorkspaceView|'editor'|'player';
export function Platform({environment='demo',databaseEnabled=false}:{environment?:AppEnvironment;databaseEnabled?:boolean}){const [sessionClient]=useState(createAuthoringSessionClient);return <AppEnvironmentContext.Provider value={environment}><AuthoringSessionProvider mode={environment==='demo'?'demo':databaseEnabled?'local':'unconfigured'} client={sessionClient}><PlatformContent key={environment} databaseEnabled={environment!=='demo'&&databaseEnabled}/></AuthoringSessionProvider></AppEnvironmentContext.Provider>;}
function PlatformContent({databaseEnabled}:{databaseEnabled:boolean}){
 const [databaseClient]=useState(createDatabaseDraftsClient);
 const [characterClient]=useState(createCharacterClient);
 const {controller:characterController,state:characterState,session}=useCharacterController(characterClient);
 const [characterSource,setCharacterSource]=useState<CharacterSource|undefined>();
 const [databasePending,setDatabasePending]=useState<{dirty:boolean;busy:boolean;unknown?:boolean}>({dirty:false,busy:false});
 const environment=useAppEnvironment(),demo=environment==='demo';
 const [examples]=useState(()=>demo?listExampleStories():[]);
 const [view,setView]=useState<View>('home'),[data,setData]=useState<Library>(emptyLibrary),[ready,setReady]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState(''),[genre,setGenre]=useState('全部'),[selected,setSelected]=useState<Story|null>(null),[draft,setDraft]=useState<Story>(blankStory),[active,setActive]=useState<Save|null>(null),[notice,setNotice]=useState(''),[characterPending,setCharacterPending]=useState<PendingState>({dirty:false,busy:false});
 const editorSourceChanged=!demo&&view==='editor'&&Boolean(characterSource&&session.state.datasetId&&characterSource.datasetId!==session.state.datasetId);
 const editorNeedsRecovery=!demo&&(characterState.datasetChanged||editorSourceChanged);
 useEffect(()=>{if(!demo){setReady(true);return;}try{setData(readLibrary(environment));}catch{setError('本地数据读取失败。为保护原数据，暂时关闭保存；请检查浏览器存储。');}setReady(true);},[]);
 function persist(next:Library){if(!demo){setNotice('正式剧本聚合尚未接入；输入仅在内存，不会保存到浏览器。');return false;}if(error){setNotice(error);return false;}try{writeLibrary(next,environment);setData(next);return true;}catch(e){setNotice('保存失败：'+(e instanceof Error?e.message:'本地存储不可用')+' 输入仍保留。');return false;}}
 function saveDraft(s:Story){const problems=validateDraft(s);if(problems.length){setNotice('请填写：'+problems.join('、'));return false;}const ok=persist({...data,drafts:[s,...data.drafts.filter(x=>x.id!==s.id)]});if(ok)setNotice('已保存到本机 · 非云同步');return ok;}
 function start(s:Story){if(!demo){setNotice('真实生成尚未接通；不会使用演练替代。');return;}const save=newSave(s);if(persist({...data,saves:[save,...data.saves]})){setActive(save);setSelected(null);setView('player');}}
 function updateSave(s:Save){if(persist({...data,saves:data.saves.map(x=>x.id===s.id?s:x)})){setActive(s);return true;}return false;}
 function mayLeave(){
  const current=characterController.getSnapshot();
  if(characterPending.unknown||editorSourceChanged||(!demo&&(current.unknown||current.datasetChanged))||databasePending.unknown){setNotice('上次保存结果待确认，请先确认原命令再离开。');return false;}
  return !characterPending.busy&&!(!demo&&(current.saving||current.reading))&&!databasePending.busy&&(!(characterPending.dirty||databasePending.dirty)||confirm('有未保存的修改，确定离开吗？'));
 }
 function navigate(next:View){
  if(next!==view){
   const current=characterController.getSnapshot();
   // A retained library draft stays in the controller. Only its recovery page
   // is reachable through this exception; never abandon Editor or a story command.
   const recovering=!demo&&view!=='editor'&&next==='characters'&&current.datasetChanged;
   if(recovering){
    if(current.saving||current.reading||characterPending.busy||databasePending.busy||databasePending.unknown)return;
    if(databasePending.dirty&&!confirm('有未保存的修改，确定离开吗？'))return;
   }else if(!mayLeave())return;
  }
  setView(next);setQuery('');setGenre('全部');
 }
 async function saveCharacter(c:CharacterSelection):Promise<CharacterSelection>{
  if(!demo){
   const submittedDataset=characterController.datasetId!;
   const current=characterController.getSnapshot();
   if(current.datasetChanged||(characterSource&&(characterSource.datasetId!==submittedDataset||characterSource.datasetId!==session.state.datasetId)))throw Error('DATASET_CHANGED');
   if(current.unknown){const dto=await characterController.confirm();return characterSelection(dto,submittedDataset);}
   const dto=await characterController.saveCopy(fieldsFromSelection({...c,source:characterSource}));return characterSelection(dto,submittedDataset);
  }
  if(!persist({...data,characters:[c,...data.characters.filter(x=>x.id!==c.id)]}))throw Error('BROWSER_SAVE_FAILED');
  setNotice('角色模板已保存到当前浏览器。');return c;
 }

 function edit(s?:Story){if(!mayLeave())return;setCharacterSource(undefined);setNotice('');setDraft(s?structuredClone(s):blankStory());setView('editor');}
 const stories=(view==='library'?data.drafts:examples).filter(s=>(genre==='全部'||s.genre===genre)&&`${s.title}${s.world}${s.character}`.includes(query));
 if(!ready)return <main className="empty" aria-busy="true">正在读取本地故事…</main>;
 if(demo&&view==='player'&&active)return <MockSession key={active.id} save={active} onChange={updateSave} onExit={()=>{setView('saves');setActive(null);}}/>;
 if(view==='editor')return <Editor connectionSlot={<LocalConnection/>} initial={draft} characters={data.characters} onSave={saveDraft} onSaveCharacter={saveCharacter} formal={!demo} characterSource={characterSource} characterPending={!demo?{dirty:characterState.dirty,busy:characterState.saving||characterState.reading,unknown:characterState.unknown||editorNeedsRecovery}:undefined} characterReset={editorNeedsRecovery} characterEpoch={session.invalidate} onResetCharacter={()=>{characterController.fromRetained();setCharacterSource(undefined);}} onBack={()=>{if(mayLeave())setView('library');}} onPlay={s=>setSelected(structuredClone(s))} notice={notice} dialog={selected&&<StartDialog story={selected} onClose={()=>setSelected(null)} onStart={()=>start(selected)}/>}/>;
 return <><AppShell view={view==='player'?'saves':view} draftCount={data.drafts.length} onNavigate={navigate} onCreate={()=>edit()}>
 <LocalConnection/>
 {error&&view!=='home'&&<p role="alert" className="error">{error}</p>}
 {view==='home'&&<WorldHome library={demo?data:{...data,saves:[]}} loadError={error} onCreate={()=>edit()} onExplore={()=>navigate('explore')} onResume={s=>{if(!demo)return;setActive(s);setView('player');}} onEdit={edit} onLibrary={()=>navigate('library')} onSaves={()=>navigate('saves')}/>}
 {view==='explore'&&!demo&&<div className="empty"><Compass/><h1>正式剧本广场尚未开放</h1><p>当前环境不展示演示数据。你可以先创建自己的剧本与角色。</p><button className="primary" onClick={()=>edit()}>创建剧本</button></div>}
 {view==='explore'&&demo&&<div className="page-heading"><div><p className="eyebrow">A PLACE FOR POSSIBILITIES</p><h1>给想象，找一个开端。</h1><p>这些只是示例。人物、关系与后来发生的事，都可以重新定义。</p></div></div>}
 {view==='library'&&databaseEnabled&&<DatabaseDrafts client={databaseClient} onPendingChange={setDatabasePending}/>}
 {view==='library'&&!databaseEnabled&&<div className="page-heading"><div><p className="eyebrow">YOUR STORY STUDIO</p><h1>我的剧本</h1><p>{demo?'先定义世界与角色，再把故事交给对话。':'正式剧本聚合仍待接入；新建仅保留编辑输入，不写浏览器。'}</p></div><button className="primary" onClick={()=>edit()}><Plus size={16}/>新建剧本</button></div>}
 {((view==='explore'&&demo)||(view==='library'&&!databaseEnabled))&&<><div className="section-heading"><h2>{view==='explore'?'寻找你的下一个开端':'创作中的故事'}<small>{view==='explore'?'示例设定，给灵感一个起点 · 非真实社区':`${data.drafts.length} 个本地草稿`}</small></h2><label className="search"><Search size={17}/><input aria-label="搜索剧本" placeholder="搜索故事、角色或世界…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="filters">{['全部','浪漫','都市','奇幻','日常'].map(g=><button className={genre===g?'chip selected':'chip'} onClick={()=>setGenre(g)} key={g}>{g}</button>)}<span className="filter-note"><SlidersHorizontal size={14}/>按题材探索</span></div><div className="story-grid">{stories.map((s,i)=><article className="story-card" key={s.id}><StoryCover story={s} className={s.artId||s.assets?.character?"cover character-cover":"cover"} onClick={()=>view==='library'?edit(s):setSelected(s)} aria-label={`查看${s.title}`}><span className="cover-tag">{view==='library'?'我的草稿':'演示设定'}</span><span className="cover-number">0{i+1}</span><span className="cover-title">{s.title}</span><span className="cover-arrow"><ArrowUpRight size={20}/></span></StoryCover><div className="card-line"><h3>{s.title}</h3><span>{s.genre}</span></div><p className="relationship-line">{s.relationship||'关系由你定义'}</p><p className="card-description">{s.world}</p><div className="card-meta"><span className="mini-avatar">{s.character.slice(0,1)}</span><span>{s.character}</span><span className="meta-right">开放剧情<ArrowRight size={13}/></span></div></article>)}</div>{!stories.length&&<div className="empty"><BookOpen/><h3>{query||genre!=='全部'?'暂时没有匹配的故事':'你的第一个故事，还没开始'}</h3><p>{query||genre!=='全部'?'换一个关键词或题材试试。':'只需要一个角色和一个开端。'}</p><button className="secondary" onClick={()=>query||genre!=='全部'?(setQuery(''),setGenre('全部')):edit()}>{query||genre!=='全部'?'清除筛选':'创建剧本'}</button></div>}</>}
 {view==='saves'&&<><div className="page-heading"><div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h1>还没讲完的故事</h1><p>每次开始，都是一条独立的故事线。</p></div></div>{!data.saves.length?<div className="empty"><History/><h3>还没有游玩记录</h3><button className="primary" onClick={()=>setView('explore')}>去剧本广场</button></div>:<div className="save-list">{data.saves.map(s=><button className="save-item" key={s.id} disabled={!demo} onClick={()=>{if(!demo)return;setActive(s);setView('player');}}><StoryThumbnail story={s.story}/><div><h3>{s.story.title}</h3><p>{s.turns.length} 条行动 · {new Date(s.createdAt).toLocaleString('zh-CN')}</p><small>演练设定与回应记录 · 非生成视频存档</small></div><span>继续演练<ArrowRight size={17}/></span></button>)}</div>}</>}
 {view==='characters'&&<CharacterLibrary {...(demo?{characters:data.characters,onSave:saveCharacter}:{controller:characterController})} onPendingChange={setCharacterPending} onUse={c=>{const current=characterController.getSnapshot();if(characterPending.busy||characterPending.unknown||(!demo&&(current.saving||current.reading||current.unknown||current.datasetChanged)))return;setCharacterSource(c.source);setDraft(applyCharacterTemplate(blankStory(),c));setView('editor');}}/>}
 <footer className="page-footer"><span>未完 / 每个故事，都有你的痕迹。</span><span>{view==='library'&&databaseEnabled?'SQLite 本机保存 · 尚未配置备份':demo?'浏览器本地保存 · 不代表云端备份':'正式角色使用 SQLite · 剧本聚合待接入'}</span></footer></AppShell>{notice&&<div role="status" className="toast">{notice}<button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={16}/></button></div>}{selected&&<StartDialog story={selected} onClose={()=>setSelected(null)} onStart={()=>start(selected)}/>}</>
}
