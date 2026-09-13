'use client';
import {useEffect,useLayoutEffect,useState,useSyncExternalStore} from 'react';
import {StoryController} from './story-controller';
import type {StoryDraftClient} from './story-ports';
import {useAuthoringSession} from './session-context';
export function useStoryController(client:StoryDraftClient){const session=useAuthoringSession(),[controller]=useState(()=>new StoryController()),connected=session.state.status==='connected';useLayoutEffect(()=>{controller.bind({client,connected,datasetId:session.state.datasetId,invalidate:session.invalidate});},[controller,client,connected,session.state.datasetId,session.invalidate]);useEffect(()=>{if(connected)void controller.load();},[controller,client,connected,session.state.datasetId,session.invalidate]);useEffect(()=>()=>controller.suspend(),[controller]);const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);return{controller,state,session};}
