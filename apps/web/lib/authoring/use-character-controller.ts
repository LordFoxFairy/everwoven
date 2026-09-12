'use client';
import {useEffect,useLayoutEffect,useState,useSyncExternalStore} from 'react';
import {CharacterController} from './character-controller';
import type {CharacterClient} from './character-client';
import {useAuthoringSession} from './session-context';
export function useCharacterController(client:CharacterClient){
 const session=useAuthoringSession(),[controller]=useState(()=>new CharacterController());
 const connected=session.state.status==='connected';
 useLayoutEffect(()=>{controller.bind({client,connected,datasetId:session.state.datasetId,invalidate:session.invalidate});},[controller,client,connected,session.state.datasetId,session.invalidate]);
 useEffect(()=>{if(connected)void controller.load();},[controller,client,connected,session.state.datasetId,session.invalidate]);
 useEffect(()=>()=>controller.suspend(),[controller]);
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 return {controller,state,session};
}
