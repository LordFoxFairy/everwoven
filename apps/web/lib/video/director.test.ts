import {describe,it,expect,vi} from 'vitest';
import {openDirector,type Transport} from './director';
import {localAccess} from './access';
import type {VideoEvent} from './types';
const options={prompt:'一个用户驱动的世界',aspectRatio:'9:16' as const,resolution:'480p' as const};
function setup(){let callbacks!:Parameters<Transport>[0];const send=vi.fn(),close=vi.fn();const events:VideoEvent[]=[];const session=openDirector(options,event=>events.push(event),value=>{callbacks=value;return{send,close};});return{callbacks,send,close,events,session};}
describe('Director contract',()=>{
 it('configures once only when transport is live',async()=>{const s=setup();expect(s.send).not.toHaveBeenCalled();s.callbacks.state('live');s.callbacks.state('live');expect(s.send).toHaveBeenCalledTimes(1);expect(s.send.mock.calls[0][0]).toMatchObject({type:'configure',prompt_version:1,aspect_ratio:'9:16'});await s.session.close();});
 it('correlates directions without claiming playback',async()=>{const s=setup();s.callbacks.state('live');s.callbacks.data({type:'configured'});s.session.send('a','去窗边');s.session.send('a','去窗边');expect(s.send).toHaveBeenCalledTimes(2);s.callbacks.data('{invalid');s.callbacks.data(JSON.stringify({type:'prompt_applied',prompt_version:2}));s.callbacks.data({type:'chunk',prompt_version:2});expect(s.events.filter(e=>e.type==='intent')).toEqual([{type:'intent',inputId:'a',state:'sent'},{type:'intent',inputId:'a',state:'accepted'},{type:'intent',inputId:'a',state:'generated'}]);await s.session.close();});
 it('stops then closes once and rejects late input',async()=>{const s=setup();s.callbacks.state('live');await s.session.close();await s.session.close();expect(s.send).toHaveBeenLastCalledWith({type:'stop'});expect(s.close).toHaveBeenCalledTimes(1);expect(()=>s.session.send('b','你好')).toThrow();});
 it('retries failed peer cleanup',async()=>{const s=setup();s.callbacks.state('live');s.close.mockRejectedValueOnce(Error('close failed'));await expect(s.session.close()).rejects.toThrow();await s.session.close();expect(s.close).toHaveBeenCalledTimes(2);});
 it('releases peer even if error occurs synchronously during creation',async()=>{const close=vi.fn(async()=>{});const session=openDirector(options,()=>{},callbacks=>{callbacks.error();return{send:vi.fn(),close};});await session.close();expect(close).toHaveBeenCalledTimes(1);});
 it('rejects blank world',()=>{expect(()=>openDirector({...options,prompt:' '},()=>{},()=>({send(){},close(){}}))).toThrow();});
});
describe('local proxy guard',()=>{
 const env={APP_ENV:'dev',NODE_ENV:'development',FAL_LOCAL_ENABLED:'true',FAL_KEY:'test-not-a-key'};
 it('permits only explicit same-origin local dev',()=>{const request=new Request('http://127.0.0.1:3100/api/fal/proxy',{headers:{origin:'http://127.0.0.1:3100'}});expect(localAccess(request,env)).toBe(true);expect(localAccess(request,{...env,NODE_ENV:'production'})).toBe(false);expect(localAccess(request,{...env,FAL_KEY:''})).toBe(false);});
 it.each(['demo','prod',undefined])('blocks non-dev application mode %s even with keys',APP_ENV=>{const req=new Request('http://127.0.0.1:3100/api/fal/proxy',{headers:{origin:'http://127.0.0.1:3100'}});expect(localAccess(req,{...env,APP_ENV})).toBe(false);});
 it('rejects foreign and missing origin',()=>{expect(localAccess(new Request('http://127.0.0.1:3100/api/fal/proxy'),env)).toBe(false);expect(localAccess(new Request('http://127.0.0.1:3100/api/fal/proxy',{headers:{origin:'https://evil.example'}}),env)).toBe(false);});
});
