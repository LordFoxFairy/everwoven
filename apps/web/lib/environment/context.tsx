'use client';
import {createContext,useContext} from 'react';
import type {AppEnvironment} from './config';
export const AppEnvironmentContext=createContext<AppEnvironment>('demo');
export function useAppEnvironment(){return useContext(AppEnvironmentContext);}
