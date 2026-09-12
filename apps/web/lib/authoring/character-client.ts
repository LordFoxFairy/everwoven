import {createAppClient} from '../../trpc/client';
import type {CharacterCreate,CharacterUpdate,CharacterLifecycle,CharacterListInput,CharacterDTO,CharacterPage,CharacterCommandResult} from '../../../runtime/src/contracts/character-template';
export interface CharacterClient{
 create(input:CharacterCreate):Promise<CharacterCommandResult>;
 get(id:string):Promise<CharacterDTO>;
 list(input?:CharacterListInput):Promise<CharacterPage>;
 update(input:CharacterUpdate):Promise<CharacterCommandResult>;
 delete(input:CharacterLifecycle):Promise<CharacterCommandResult>;
 restore(input:CharacterLifecycle):Promise<CharacterCommandResult>;
}
export function createCharacterClient():CharacterClient {
 const client=createAppClient();
 return {
  create:input=>client.characters.create.mutate(input),
  get:id=>client.characters.get.query({id,includeDeleted:true}),
  list:input=>client.characters.list.query(input),
  update:input=>client.characters.update.mutate(input),
  delete:input=>client.characters.delete.mutate(input),
  restore:input=>client.characters.restore.mutate(input),
 };
}
