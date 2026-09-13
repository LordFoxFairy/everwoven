import type {PrismaClient} from '../generated/prisma/client.js';
import type {BindingResolver} from '../contracts/provider-binding.js';
import type {CreateExperience, GetPreparingExperience} from '../contracts/experience-opening.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {createExperience, getPreparingExperience} from '../application/experience-openings.js';
import {systemServices, type RuntimeServices} from '../application/runtime-services.js';
import {PrismaExperienceOpeningStore} from '../infrastructure/db/prisma-experience-opening-store.js';
import {listExperiences} from '../application/experience-directory.js';
import type {ExperienceList} from '../contracts/experience-directory.js';

/** Internal host composition; no global registry, implicit session, quote or provider request. */
export function createExperienceOpeningService(db: PrismaClient, resolver: BindingResolver, services: RuntimeServices = systemServices) {
  const store = new PrismaExperienceOpeningStore(db);
  return {
    list: (owner: InternalOwnerContext, input: ExperienceList) => listExperiences(store, owner, input),
    create: (owner: InternalOwnerContext, input: CreateExperience) => createExperience(store, owner, input, resolver, services),
    getPreparing: (owner: InternalOwnerContext, input: GetPreparingExperience) => getPreparingExperience(store, owner, input),
  };
}
