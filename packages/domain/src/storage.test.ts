import {it,expect,vi} from 'vitest';
import {readLibrary,writeLibrary,emptyLibrary} from '../../../apps/web/components/storage';
it('rejects writes from an outdated tab instead of overwriting newer data',()=>{
 const map=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)});
 readLibrary();localStorage.setItem('weiwan.prototype.v1',JSON.stringify({...emptyLibrary,characters:[{id:'new',name:'新角色',personality:'耐心'}]}));
 expect(()=>writeLibrary(emptyLibrary)).toThrow();expect(JSON.parse(localStorage.getItem('weiwan.prototype.v1')!).characters).toHaveLength(1);vi.unstubAllGlobals();
});

it('round-trips asset references and full templates without embedding image bytes',()=>{
 const map=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)});
 try{readLibrary();const story={id:'s',title:'t',world:'w',opening:'o',character:'c',personality:'p',genre:'g',image:'sea',assets:{cover:'asset-cover',character:'asset-person',opening:'asset-opening'}};
 const data={drafts:[story],saves:[],characters:[{id:'c',name:'n',personality:'p',appearance:'a',speakingStyle:'s',boundaries:'b',imageAssetId:'asset-person'}]};writeLibrary(data);expect(readLibrary()).toEqual(data);expect(localStorage.getItem('weiwan.prototype.v1')).not.toContain('base64');}finally{vi.unstubAllGlobals();}
});
it('rejects malformed new asset metadata without deleting existing storage',()=>{
 const raw=JSON.stringify({drafts:[],saves:[],characters:[{id:'c',name:'n',personality:'p',imageAssetId:{bad:true}}]});vi.stubGlobal('localStorage',{getItem:()=>raw});
 try{expect(()=>readLibrary()).toThrow('存档内容异常');expect(localStorage.getItem('weiwan.prototype.v1')).toBe(raw);}finally{vi.unstubAllGlobals();}
});
