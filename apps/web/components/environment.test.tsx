// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Platform} from './platform';
import {readLibrary,writeLibrary,emptyLibrary} from './storage';
import {StartDialog} from './story-detail';
import {AppEnvironmentContext} from '../lib/environment/context';
import {listExampleStories} from '../mocks/catalog';
import {libraryStorageKey} from '../lib/environment/config';
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each(['dev','prod'] as const)('%s never opens frontend demo and retains authoring',async environment=>{
 render(<Platform environment={environment}/>);
 await screen.findByRole('heading',{name:/让想象发生/});
 expect(screen.queryByText(/前端演练 · 设定/)).toBeNull();
 await userEvent.click(screen.getByRole('button',{name:'剧本广场'}));
 expect(screen.queryByRole('button',{name:'查看在潮声之间'})).toBeNull();
 expect(screen.getByText('正式剧本广场尚未开放')).toBeTruthy();
 await userEvent.click(screen.getByRole('button',{name:'我的剧本'}));
 expect(screen.getByRole('button',{name:'新建剧本'})).toBeTruthy();
});
it('demo retains example catalog',async()=>{
 render(<Platform environment="demo"/>);
 await userEvent.click(await screen.findByRole('button',{name:'剧本广场'}));
 expect(screen.getByRole('button',{name:'查看在潮声之间'})).toBeTruthy();
});
it('keeps per-environment storage and conflict detection independent',()=>{
 readLibrary('demo');readLibrary('dev');readLibrary('prod');
 writeLibrary(emptyLibrary,'demo');writeLibrary(emptyLibrary,'dev');
 expect(localStorage.getItem(libraryStorageKey('prod'))).toBeNull();
 localStorage.setItem(libraryStorageKey('dev'),'external edit');
 expect(()=>writeLibrary(emptyLibrary,'dev')).toThrow('其他标签页');
 expect(()=>writeLibrary(emptyLibrary,'demo')).not.toThrow();
});

it.each(['dev','prod'] as const)('%s start dialog is explicitly disabled',async environment=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 const start=vi.fn();
 render(<AppEnvironmentContext.Provider value={environment}><StartDialog story={listExampleStories()[0]!} onClose={vi.fn()} onStart={start}/></AppEnvironmentContext.Provider>);
 const button=screen.getByRole('button',{name:'视频生成待接入',hidden:true}) as HTMLButtonElement;
 expect(button.disabled).toBe(true);
 await userEvent.click(button);expect(start).not.toHaveBeenCalled();
});

it('renders and opens authoring without secure-context-only randomUUID',async()=>{
 const getRandomValues=globalThis.crypto.getRandomValues.bind(globalThis.crypto);
 vi.stubGlobal('crypto',{getRandomValues});
 render(<Platform environment="demo"/>);
 await screen.findByRole('heading',{name:/让想象发生/});
 await userEvent.click(screen.getByRole('button',{name:'我的剧本'}));
 await userEvent.click(screen.getByRole('button',{name:'新建剧本'}));
 expect(screen.getByRole('button',{name:'保存草稿'})).toBeTruthy();
});
