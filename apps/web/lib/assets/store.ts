import {createEntityId} from '../../../../packages/domain/src/id';
import {assetDatabaseName,type AppEnvironment} from '../environment/config';
import {validateImageDimensions,validateImageFile} from './validation';
export type ImageAsset={id:string;name:string;width:number;height:number;blob:Blob;createdAt:string};
function openDatabase(environment:AppEnvironment):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 let rejected=false;
 const request=indexedDB.open(assetDatabaseName(environment),1);
 request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'id'});
 request.onsuccess=()=>{if(rejected)request.result.close();else resolve(request.result);};
 request.onerror=()=>reject(Error('本机图片库不可用，请检查浏览器存储权限。'));
 request.onblocked=()=>{rejected=true;reject(Error('图片库正在更新，请关闭其他旧页面后重试。'));};
});}
export async function readImageAsset(id:string,environment:AppEnvironment='demo'):Promise<ImageAsset|undefined>{
 const db=await openDatabase(environment);
 try{return await new Promise((resolve,reject)=>{const request=db.transaction('images','readonly').objectStore('images').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
}
export async function importImageAsset(file:File,environment:AppEnvironment='demo'):Promise<ImageAsset>{
 validateImageFile(file);
 let bitmap:ImageBitmap;
 try{bitmap=await createImageBitmap(file);}catch{throw Error('图片解码失败，请选择有效图片。');}
 let blob:Blob;let width:number,height:number;
 try{
  validateImageDimensions(bitmap.width,bitmap.height);
  const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));width=Math.round(bitmap.width*scale);height=Math.round(bitmap.height*scale);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw Error('当前浏览器不支持图片处理。');context.drawImage(bitmap,0,0,width,height);
  blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(Error('图片处理失败')),'image/webp',.9));
 }finally{bitmap.close();}
 // Store a display/reference copy without source EXIF; never upload it automatically.
 const asset:ImageAsset={id:createEntityId(),name:file.name,width,height,blob,createdAt:new Date().toISOString()};
 const db=await openDatabase(environment);
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').add(asset);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('本机图片保存失败，请检查剩余空间。'));tx.onabort=()=>reject(Error('图片保存中断，原选择未改变。'));});}finally{db.close();}
 return asset;
}
