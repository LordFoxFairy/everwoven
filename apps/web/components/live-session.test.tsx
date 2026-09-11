import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import styles from './live-session.module.css';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {LiveSnapshot} from '../lib/video/session-controller';
import type {LiveVideoProvider} from '../lib/video/types';
import type {Story} from '../../../packages/domain/src/story';
import {LiveSession} from './live-session';
import {ConfiguredLiveSession} from './configured-live-session';
import {TRPCReactProvider} from '../trpc/react';

const fixture=vi.hoisted(()=>({snapshot:null as LiveSnapshot|null}));
vi.mock('react',async importOriginal=>{
 const react=await importOriginal<typeof import('react')>();
 return {...react,useSyncExternalStore:(...args:Parameters<typeof react.useSyncExternalStore>)=>fixture.snapshot??react.useSyncExternalStore(...args)};
});
const story:Story={id:'test',title:'我的世界',world:'用户设定',opening:'用户开场',character:'角色',personality:'沉静',genre:'自定义',image:''};
const provider:LiveVideoProvider={id:'test',label:'测试引擎',capabilities:{audioOutput:false,voiceInput:false,cancelDirection:false},open:vi.fn()};
function render(){return renderToStaticMarkup(<LiveSession story={story} provider={provider} onExit={()=>{}}/>);}
afterEach(()=>{fixture.snapshot=null;vi.clearAllMocks();});
describe('desktop live presentation',()=>{
 it('starts with landscape generation selected, not a portrait default',()=>{
  const html=render();
  expect(html).toMatch(/<input[^>]*checked=""[^>]*value="16:9"/);
  expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="9:16"/);
  expect(provider.open).not.toHaveBeenCalled();
 });
 it('keeps the video in a dedicated stage and expression outside its bounds',()=>{
  fixture.snapshot={phase:'active',ready:true,media:'playing',stream:null,error:'',intents:[]};
  const html=render();
  expect(html).toMatch(/<section[^>]*aria-label="视频舞台"[^>]*>[\s\S]*<video/);
  expect(html).toMatch(/<\/section>[\s\S]*aria-label="自由表达"/);
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('ABCD');
  if(process.env.WRITE_LAYOUT_FIXTURES==='1'){
   let css=readFileSync(new URL('./live-session.module.css',import.meta.url),'utf8');
   css=css.replace(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g,(selector,local)=>styles[local]?'.'+styles[local]:selector);
   const base=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8').split('.shell{')[0].replaceAll(/@import[^;]+;/g,'');
   const dir=new URL('../../../artifacts/desktop-layout-2026-09-09/',import.meta.url);
   mkdirSync(dir,{recursive:true});
   writeFileSync(new URL('stage.html',dir),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>布局验收 · 无模型连接</title><style>${base} ${css}</style><body>${html}</body></html>`);
  }
 });
 it('retains the world context in a desktop preparation layout when no engine is configured',()=>{
  const html=renderToStaticMarkup(<TRPCReactProvider><ConfiguredLiveSession story={story} onExit={()=>{}}/></TRPCReactProvider>);
  expect(html).toContain('用户开场');
  expect(html).toContain('桌面宽幅');
  expect(html).not.toContain('<video');
  expect(provider.open).not.toHaveBeenCalled();
 });
 it('shows first-frame waiting without asking for an opening message',()=>{
  fixture.snapshot={phase:'connecting',ready:false,media:'waiting',stream:null,error:'',intents:[]};
  const html=render();
  expect(html).toContain('正在进入故事');
  expect(html).not.toContain('aria-label="自由表达"');
  expect(html).not.toContain('<textarea');
 });
 it('does not invite input before the first frame even when the connection is ready',()=>{
  fixture.snapshot={phase:'active',ready:true,media:'waiting',stream:null,error:'',intents:[]};
  expect(render()).not.toContain('aria-label="自由表达"');
 });
 it('keeps failure and exit inside the stage without a live indicator',()=>{
  fixture.snapshot={phase:'failed',ready:false,media:'waiting',stream:null,error:'连接失败',intents:[]};
  const html=render();
  expect(html).toContain('连接失败');
  expect(html).not.toContain('aria-label="正在播放"');
 });
});
