import {TRPCError} from '@trpc/server';
import type {InternalOwnerContext} from 'runtime/contracts/story-draft';
import type {CharacterCreate,CharacterUpdate,CharacterLifecycle,CharacterListInput,CharacterDTO,CharacterPage,CharacterCommandResult} from 'runtime/contracts/character-template';
import {guardLocalRequest,localRuntimeConfig,sessionToken} from './local-boundary';
import {localError} from './local-runtime';
export type CharacterService={
 create(owner:InternalOwnerContext,input:CharacterCreate):Promise<CharacterCommandResult>;
 get(owner:InternalOwnerContext,id:string,includeDeleted?:boolean):Promise<CharacterDTO>;
 list(owner:InternalOwnerContext,input?:CharacterListInput):Promise<CharacterPage>;
 update(owner:InternalOwnerContext,input:CharacterUpdate):Promise<CharacterCommandResult>;
 delete(owner:InternalOwnerContext,input:CharacterLifecycle):Promise<CharacterCommandResult>;
 restore(owner:InternalOwnerContext,input:CharacterLifecycle):Promise<CharacterCommandResult>;
};
export type WithCharacters=<T>(work:(characters:CharacterService,owner:InternalOwnerContext)=>Promise<T>)=>Promise<T>;
export function localCharacterAccess(request: Request, env: Record<string, string | undefined>): WithCharacters {
  return async (work) => {
    const config = localRuntimeConfig(env),
      token = sessionToken(request);
    if (!config || !token) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先连接本机数据库' });
    try {
      guardLocalRequest(request, config);
    } catch (error) {
      throw localError(error);
    }
    try {
      // Host authenticates before opening the database and rechecks before work.
      const host = await import('runtime/host');
      return await host.withLocalCharacters(config.directory, config.environment, token, work);
    } catch (error) {
      throw localError(error);
    }
  };
}
