import {Prisma, type PrismaClient} from '../../generated/prisma/client.js';
import type {ExecutionProfileReadScope, ExecutionProfileWriteScope, ExecutionProfileStore} from '../../ports/execution-profile-store.js';
import {withOwnerWrite} from './write-gate.js';

export function createExecutionProfileReadScope(tx: Prisma.TransactionClient, ownerId: string): ExecutionProfileReadScope {
  return {
    findBinding: id => tx.providerBindingVersion.findFirst({where: {id, ownerId}}),
    findProfile: id => tx.executionProfileVersion.findFirst({where: {id, ownerId}}),
  };
}
export function createExecutionProfileWriteScope(tx: Prisma.TransactionClient, ownerId: string): ExecutionProfileWriteScope {
  const assertOwner = (row: {ownerId: string}) => {if (row.ownerId !== ownerId) throw Error('OWNER_UNAVAILABLE');};
  return {
    ...createExecutionProfileReadScope(tx, ownerId),
    findBindingByVersion: (bindingKey, versionNo) => tx.providerBindingVersion.findUnique({where: {ownerId_bindingKey_versionNo: {ownerId, bindingKey, versionNo}}}),
    findProfileByVersion: (profileKey, versionNo) => tx.executionProfileVersion.findUnique({where: {ownerId_profileKey_versionNo: {ownerId, profileKey, versionNo}}}),
    insertBinding: async row => {
      assertOwner(row);
      await tx.providerBindingVersion.create({data: {...row, parameters: row.parameters as Prisma.InputJsonValue, capabilities: row.capabilities as Prisma.InputJsonValue}});
    },
    insertProfile: async row => {
      assertOwner(row);
      for (const id of [row.plannerBindingVersionId, row.videoBindingVersionId, row.validatorBindingVersionId]) {
        if (!await tx.providerBindingVersion.findFirst({where: {id, ownerId}, select: {id: true}})) throw Error('EXECUTION_PROFILE_PARENT_INVALID');
      }
      await tx.executionProfileVersion.create({data: {...row, snapshot: row.snapshot as unknown as Prisma.InputJsonValue}});
    },
  };
}
export class PrismaExecutionProfileStore implements ExecutionProfileStore {
  constructor(private readonly db: PrismaClient) {}
  read<T>(ownerId: string, work: (scope: ExecutionProfileReadScope) => Promise<T>): Promise<T> {
    return this.db.$transaction(async tx => {
      if (!await tx.localProfile.findFirst({where: {id: ownerId, deletedAt: null}, select: {id: true}})) throw Error('OWNER_UNAVAILABLE');
      return work(createExecutionProfileReadScope(tx, ownerId));
    });
  }
  write<T>(ownerId: string, work: (scope: ExecutionProfileWriteScope) => Promise<T>): Promise<T> {
    return withOwnerWrite(this.db, ownerId, tx => work(createExecutionProfileWriteScope(tx, ownerId)));
  }
}
