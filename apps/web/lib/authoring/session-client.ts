export type AuthoringSession = {authenticated: true; datasetId: string} | {authenticated: false};
import {parseId} from 'runtime/contracts/story-draft-validation';

/** Shared transport for the single host connection; never expose cookies to UI. */
export function createAuthoringSessionClient() {
 async function request(method:'GET'|'POST'|'DELETE'):Promise<AuthoringSession>{
  try {
   const response=await fetch('/api/local-session',{
    method,credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:{'content-type':'application/json','x-everwoven-request':'1'},
    ...(method==='POST'?{body:JSON.stringify({mode:'local'})}:{}),
   });
   if(!response.ok)throw Error();
   const data:unknown=await response.json();
   if(!data||typeof data!=='object'||Array.isArray(data)||!('authenticated' in data)||typeof data.authenticated!=='boolean'||(method!=='GET'&&data.authenticated!==(method==='POST')))throw Error();
   if(!data.authenticated)return {authenticated:false};
   if(!('datasetId' in data))throw Error();
   return {authenticated:true,datasetId:parseId(data.datasetId)};
  }catch{throw Error('本机连接失败，请重试');}
 }
 return {
  session:()=>request('GET'),
  connect:()=>request('POST'),
  logout:async()=>{await request('DELETE');},
 };
}
export type AuthoringSessionClient=ReturnType<typeof createAuthoringSessionClient>;
