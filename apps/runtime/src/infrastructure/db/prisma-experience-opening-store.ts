import {Prisma, type PrismaClient} from '../../generated/prisma/client.js';
import type {ExperienceOpeningReadScope, ExperienceOpeningWriteScope, ExperienceOpeningStore} from '../../ports/experience-opening-store.js';
import {createStoryVersionReadScope, createStoryVersionWriteScope} from './prisma-story-version-store.js';
import {withOwnerWrite} from './write-gate.js';

export function createExperienceOpeningReadScope(tx: Prisma.TransactionClient, ownerId: string): ExperienceOpeningReadScope {
  return {
    ...createStoryVersionReadScope(tx, ownerId),
    listExperiences: ({take, before}) => tx.experience.findMany({where: {ownerId, deletedAt: null, archivedAt: null,
      ...(before ? {OR: [{updatedAt: {lt: before.updatedAt}}, {updatedAt: before.updatedAt, id: {lt: before.id}}]} : {})},
      orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], take}),
    findExperience: id => tx.experience.findFirst({where: {id, ownerId}}),
    findBinding: id => tx.providerBindingVersion.findFirst({where: {id, ownerId}}),
    // Root ownership was checked; unfiltered children expose corrupt shadow ownership.
    findSetup: experienceId => tx.interactionEvent.findUnique({where: {experienceId_experienceRevision: {experienceId, experienceRevision: 1}}}),
    findOpeningDrafts: interactionEventId => tx.responseDraft.findMany({where: {interactionEventId}}),
    findOpeningReceiptById: id => tx.commandReceipt.findFirst({where: {id, ownerId}}),
  };
}
export function createExperienceOpeningWriteScope(tx: Prisma.TransactionClient, ownerId: string): ExperienceOpeningWriteScope {
  const assertOwner = (input: {ownerId: string}) => { if (input.ownerId !== ownerId) throw Error('OWNER_UNAVAILABLE'); };
  // Application-owned relations, not SQL foreign keys. Check parents before inserting children.
  async function requireParent(experienceId: string) {
    const root = await tx.experience.findFirst({where: {id: experienceId, ownerId}});
    if (!root || root.deletedAt !== null || root.archivedAt !== null || root.status !== 'preparing' ||
      !root.schedulingPaused || root.dispatchEpoch !== 0 || root.revision !== 1 || root.rowRevision !== 1)
      throw Error('EXPERIENCE_PARENT_INVALID');
    return root;
  }
  return {
    ...createStoryVersionWriteScope(tx, ownerId),
    ...createExperienceOpeningReadScope(tx, ownerId),
    findOpeningReceipt: commandId => tx.commandReceipt.findUnique({where: {ownerId_commandId: {ownerId, commandId}}}),
    findBindingByVersion: (bindingKey, versionNo) => tx.providerBindingVersion.findUnique({where: {ownerId_bindingKey_versionNo: {ownerId, bindingKey, versionNo}}}),
    insertBinding: async input => {
      assertOwner(input);
      await tx.providerBindingVersion.create({data: {...input, parameters: input.parameters as Prisma.InputJsonValue, capabilities: input.capabilities as Prisma.InputJsonValue}});
    },
    insertExperience: async input => { assertOwner(input); await tx.experience.create({data: input}); },
    insertSetup: async input => {
      assertOwner(input);
      const root = await requireParent(input.experienceId);
      if (input.createdAt.getTime() !== root.createdAt.getTime()) throw Error('EXPERIENCE_PARENT_INVALID');
      await tx.interactionEvent.create({data: input});
    },
    insertResponseDraft: async input => {
      assertOwner(input);
      const root = await requireParent(input.experienceId);
      const setup = await tx.interactionEvent.findFirst({where: {
        id: input.interactionEventId, ownerId, experienceId: input.experienceId, kind: 'setup', experienceRevision: 1,
      }});
      if (!setup || setup.schemaVersion !== 1 || setup.createdAt.getTime() !== root.createdAt.getTime() ||
        input.createdAt.getTime() !== root.createdAt.getTime() || input.updatedAt.getTime() !== root.createdAt.getTime())
        throw Error('EXPERIENCE_PARENT_INVALID');
      await tx.responseDraft.create({data: input});
    },
    insertOpeningReceipt: async input => {
      assertOwner(input);
      await tx.commandReceipt.create({data: {...input, response: input.response as unknown as Prisma.InputJsonValue}});
    },
  };
}
export class PrismaExperienceOpeningStore implements ExperienceOpeningStore {
  constructor(private readonly db: PrismaClient) {}
  read<T>(ownerId: string, work: (scope: ExperienceOpeningReadScope) => Promise<T>): Promise<T> {
    return this.db.$transaction(async tx => {
      if (!await tx.localProfile.findFirst({where: {id: ownerId, deletedAt: null}, select: {id: true}})) throw Error('OWNER_UNAVAILABLE');
      return work(createExperienceOpeningReadScope(tx, ownerId));
    });
  }
  write<T>(ownerId: string, work: (scope: ExperienceOpeningWriteScope) => Promise<T>): Promise<T> {
    return withOwnerWrite(this.db, ownerId, tx => work(createExperienceOpeningWriteScope(tx, ownerId)));
  }
}
