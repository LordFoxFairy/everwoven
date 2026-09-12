import {localRuntimeConfig} from '../server/local-boundary';
import {connection} from 'next/server';
import {Platform} from '../components/platform';
import {resolveAppEnvironment} from '../lib/environment/config';
export default async function Page(){
 // Resolve at request time: one built image can run all deployment modes.
 await connection();
 const environment=resolveAppEnvironment(process.env);
 return <><meta name="app-environment" content={environment}/><Platform environment={environment} databaseEnabled={localRuntimeConfig(process.env)!==null}/></>;
}
