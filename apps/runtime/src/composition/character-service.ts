import type {PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {CharacterCreate, CharacterUpdate, CharacterLifecycle, CharacterListInput} from '../contracts/character-template.js';
import {createCharacter, getCharacter, listCharacters, updateCharacter, deleteCharacter, restoreCharacter} from '../application/characters.js';
import {systemServices, type RuntimeServices} from '../application/runtime-services.js';
import {PrismaCharacterStore} from '../infrastructure/db/prisma-character-store.js';

export function createCharacterService(db: PrismaClient, services: RuntimeServices = systemServices) {
  const store = new PrismaCharacterStore(db);
  return {
    create: (owner: InternalOwnerContext, input: CharacterCreate) => createCharacter(store, owner, input, services),
    get: (owner: InternalOwnerContext, id: string, includeDeleted = false) => getCharacter(store, owner, id, includeDeleted),
    list: (owner: InternalOwnerContext, input?: CharacterListInput) => listCharacters(store, owner, input),
    update: (owner: InternalOwnerContext, input: CharacterUpdate) => updateCharacter(store, owner, input, services),
    delete: (owner: InternalOwnerContext, input: CharacterLifecycle) => deleteCharacter(store, owner, input, services),
    restore: (owner: InternalOwnerContext, input: CharacterLifecycle) => restoreCharacter(store, owner, input, services),
  };
}
