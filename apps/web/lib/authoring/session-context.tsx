'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {AuthoringSessionClient} from './session-client';

type Mode='demo'|'unconfigured'|'local';
type State={status:'demo'|'unconfigured'|'checking'|'disconnected'|'connected';datasetId:string|null;busy:boolean;error:string};
type Connection={state:State;connect():Promise<void>;refresh():Promise<void>;invalidate():void};
const Context=createContext<Connection|null>(null);

/** Lives above navigation. Losing authorization must not unmount unsaved editors. */
export function AuthoringSessionProvider({mode,client,children}:{mode:Mode;client:AuthoringSessionClient;children:ReactNode}){
 const dataset=useRef<string|null>(null);
 // Both the invocation and completion belong to a single client/mode lifetime.
 // An old editor callback must never invalidate or unlock a newer connection.
 const scope=useMemo(()=>({active:false,epoch:0,locked:false}),[client,mode]);
 const initial:State={status:mode==='local'?'checking':mode,datasetId:mode==='local'?dataset.current:null,busy:mode==='local',error:''};
 const [stored,setStored]=useState({scope,state:initial,epoch:scope.epoch});
 const state=stored.scope===scope?stored.state:initial;
 const viewEpoch=stored.scope===scope?stored.epoch:scope.epoch;
 const publish=useCallback((state:State)=>setStored({scope,state,epoch:scope.epoch}),[scope]);
 const invalidate=useCallback(()=>{
  if(!scope.active||mode!=='local'||viewEpoch!==scope.epoch)return;
  scope.epoch++;scope.locked=false;
  publish({status:'disconnected',datasetId:dataset.current,busy:false,error:'连接已失效，未保存内容仍保留。'});
 },[scope,mode,publish,viewEpoch]);
 const run=useCallback(async()=>{
  if(!scope.active||mode!=='local'||scope.locked)return;
  scope.locked=true;const epoch=++scope.epoch;
  const current=()=>scope.active&&epoch===scope.epoch;
  publish({status:'checking',datasetId:dataset.current,busy:true,error:''});
  try{
   let session=await client.session();
   if(!current())return;
   // One automatic establishment per invocation. Failure waits for an explicit
   // retry; reconnecting a session never invokes a pending business command.
   if(!session.authenticated)session=await client.connect();
   if(!current())return;
   if(!session.authenticated)throw Error('LOCAL_SESSION_INVALID');
   dataset.current=session.datasetId;
   publish({status:'connected',datasetId:dataset.current,busy:false,error:''});
  }catch{
   if(current())publish({status:'disconnected',datasetId:dataset.current,busy:false,error:'本机连接失败，请重试。未保存内容仍保留。'});
  }finally{if(current())scope.locked=false;}
 },[scope,client,mode,publish]);
 useEffect(()=>{
  scope.active=true;scope.locked=false;
  if(mode==='local')void run();
  else {dataset.current=null;publish({status:mode,datasetId:null,busy:false,error:''});}
  return()=>{scope.active=false;scope.epoch++;scope.locked=false;};
 },[scope,mode,run,publish]);
 return <Context.Provider value={{state,connect:run,refresh:run,invalidate}}>{children}</Context.Provider>;
}
export function useAuthoringSession(){const value=useContext(Context);if(!value)throw Error('AuthoringSessionProvider is required');return value;}
