import type {HistoryService} from 'runtime/host';
import type {InternalOwnerContext} from 'runtime/contracts/story-draft';
import {guardLocalRequest,localRuntimeConfig,sessionToken} from './local-boundary';
import {localGenerationError} from './local-generation';
export type WithHistory=<T>(work:(service:HistoryService,owner:InternalOwnerContext)=>Promise<T>)=>Promise<T>;
export function localHistoryAccess(request:Request,env:Record<string,string|undefined>):WithHistory{
 return async work=>{const config=localRuntimeConfig(env),token=sessionToken(request);if(!config||!token)throw localGenerationError(Error('LOCAL_SESSION_INVALID'));
  try{guardLocalRequest(request,config);return await(await import('runtime/host')).withLocalHistory(config.directory,config.environment,token,work);}catch(error){throw localGenerationError(error);}};
}
