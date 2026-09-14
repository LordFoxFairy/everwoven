import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {validatedHost, checkedFile, sameFile, type LocalEnvironment} from './storage.js';
import {acquireLocalStoreAuthority} from './store-epoch.js';
import {openRuntimeDatabase} from '../infrastructure/db/client.js';
import {createGenerationWorker} from '../application/generation-worker.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {GenerationPolicy} from '../ports/generation-policy.js';
import {loadGenerationInstallation} from './generation-installation.js';

export type GenerationRuntimeStatus = {status: 'ready' | 'unavailable' | 'stopping'; reason: string | null};
/** One launcher lifecycle. SQLite remains the durable queue; no browser owns background work. */
export function createLocalGenerationRuntime(install = loadGenerationInstallation, makeWorker = createGenerationWorker) {
 let key = '', owner: InternalOwnerContext | null = null, state: GenerationRuntimeStatus = {status: 'unavailable', reason: 'GENERATION_NOT_INITIALIZED'};
 let installation: Awaited<ReturnType<typeof loadGenerationInstallation>> | undefined, running: Promise<void> | undefined;
 let database: Awaited<ReturnType<typeof openRuntimeDatabase>> | undefined, worker: ReturnType<typeof createGenerationWorker> | undefined;
 let initialized: Promise<void> | undefined, stopping: Promise<void> | undefined;
 const lifetime = new AbortController();
 const identity = (directory: string, environment: LocalEnvironment) => `${resolve(directory)}\0${environment}`;
 const ready = () => {if (state.status !== 'ready' || !running || lifetime.signal.aborted) throw Error('GENERATION_RUNTIME_UNAVAILABLE');};
 return {
  initialize(directory: string, environment: LocalEnvironment, env: Record<string, string | undefined> = process.env) {
   const requested = identity(directory, environment);
   if (key && requested !== key) return Promise.reject(Error('GENERATION_STARTUP_CONFLICT'));
   if (initialized) return initialized;key = requested;
   initialized = (async () => {
    try {
     const host = await validatedHost(directory, environment), capture = await acquireLocalStoreAuthority(directory, environment);
     owner = {ownerId: host.manifest.ownerId, datasetId: host.manifest.datasetId};
     const path = join(host.target.directory, 'runtime.db'), file = await checkedFile(path);
     const revalidate = async () => {
      await capture.revalidate();
      const current = await validatedHost(directory, environment);
      if (!sameFile(current.identity, host.identity) || !sameFile(await checkedFile(path), file) || JSON.stringify(current.manifest) !== JSON.stringify(host.manifest)) throw Error('STORE_AUTHORITY_UNAVAILABLE');
     };
     database = await openRuntimeDatabase(path);await revalidate();
     const authority = {...capture, revalidate};
     installation = await install(database, host, owner, authority, env);
     worker = makeWorker(database, owner, authority, installation.executor, undefined, lifetime.signal);
     state = {status: 'ready', reason: null};
    } catch (error) {
     const known = ['GENERATION_CONFIGURATION_UNAVAILABLE', 'GENERATION_CREDENTIALS_UNAVAILABLE', 'GENERATION_VIDEO_PROVIDER_UNAVAILABLE', 'GENERATION_INPUT_BOUND_UNAVAILABLE'];
     state = {status: 'unavailable', reason: error instanceof Error && known.includes(error.message) ? error.message : 'GENERATION_CONFIGURATION_UNAVAILABLE'};
     await database?.$disconnect();database = undefined;installation = undefined;
    }
   })();return initialized;
  },
  start() {
   if (running || !worker || state.status !== 'ready' || lifetime.signal.aborted) return;
   running = (async () => {
    try {
     let busyFailures=0;
     while (!lifetime.signal.aborted) {
      try {const worked=await worker!.tick();busyFailures=0;if(!worked)await delay(500,undefined,{signal:lifetime.signal});}
      catch(error){
       if(!isSQLiteBusy(error)||++busyFailures>5)throw error;
       await delay(Math.min(250*2**(busyFailures-1),4000),undefined,{signal:lifetime.signal});
      }
     }
    }
    catch {if (!lifetime.signal.aborted) state = {status: 'unavailable', reason: 'GENERATION_RUNTIME_UNAVAILABLE'};}
   })();
  },
  stop() {
   if (stopping) return stopping;
   state = {status: 'stopping', reason: null};lifetime.abort();
   stopping = (async () => {await initialized;await running;await worker?.drain();await database?.$disconnect();database = undefined;state = {status:'stopping',reason:null};})();
   return stopping;
  },
  access(directory: string, environment: LocalEnvironment, context: InternalOwnerContext): {policy: GenerationPolicy; status: () => GenerationRuntimeStatus} {
   const matches = () => key === identity(directory, environment) && owner?.ownerId === context.ownerId && owner.datasetId === context.datasetId;
   const check = () => {if (!matches()) throw Error('GENERATION_RUNTIME_UNAVAILABLE');ready();};
   return {status: () => matches() ? {...state} : {status: 'unavailable', reason: 'GENERATION_NOT_INITIALIZED'}, policy: {
    resolve(input) {check();return installation!.policy.resolve(input);},
    assertDispatch(profile) {check();installation!.policy.assertDispatch(profile);},
   }};
  },
 };
}
export const localGenerationRuntime = createLocalGenerationRuntime();

/** Only identified SQLite lock contention can retry the queue tick, never arbitrary provider failures. */
export function isSQLiteBusy(error:unknown,depth=0):boolean {
 if(depth>5||!error||typeof error!=='object')return false;
 const e=error as Record<string,unknown>;
 if(e.code==='SQLITE_BUSY'||e.code==='SQLITE_LOCKED'||e.originalCode==='SQLITE_BUSY'||e.originalCode==='5')return true;
 return ['cause','meta','driverAdapterError'].some(key=>isSQLiteBusy(e[key],depth+1));
}
