import {isDeepStrictEqual} from 'node:util';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {ExperienceOpeningDTO} from '../contracts/experience-opening.js';
import type {ExperienceOpeningReadScope, ExperienceRecord} from '../ports/experience-opening-store.js';
import {parseId} from '../contracts/story-draft-validation.js';
import {parseBudget} from '../contracts/experience-opening-validation.js';
import {readStoryVersionInScope} from './story-versions.js';
import {decodeStoredBinding, publicBinding} from './provider-binding-snapshots.js';
import {isTimestamp} from '../contracts/primitives.js';

export function assertOpeningAuthority(scope: ExperienceOpeningReadScope, owner: InternalOwnerContext) {
  if (scope.ownerId !== owner.ownerId) throw Error('OWNER_UNAVAILABLE');
}
/** Reconstruct immutable CREATE facts, without today's authoring source, defaults or mutable response text. */
export async function openingFacts(
  scope: ExperienceOpeningReadScope, owner: InternalOwnerContext, row: ExperienceRecord,
): Promise<ExperienceOpeningDTO> {
  assertOpeningAuthority(scope, owner);
  try {
    const {story,binding,budget}=await fixedExperienceFacts(scope,owner,row);
    const setup = await scope.findSetup(row.id);
    if (!setup) throw Error();
    parseId(setup.id);
    if (setup.ownerId !== owner.ownerId || setup.experienceId !== row.id || setup.kind !== 'setup' ||
      setup.experienceRevision !== 1 || setup.schemaVersion !== 1 || !isDeepStrictEqual(setup.options, []) ||
      setup.createdAt.getTime() !== row.createdAt.getTime()) throw Error();
    const drafts = await scope.findOpeningDrafts(setup.id);
    if (drafts.length !== 1) throw Error();
    const draft = drafts[0]!;
    parseId(draft.id);
    if (draft.ownerId !== owner.ownerId || draft.experienceId !== row.id || draft.interactionEventId !== setup.id ||
      draft.createdAt.getTime() !== row.createdAt.getTime()) throw Error();
    return {
      protocolVersion: 1, datasetId: owner.datasetId, id: row.id, revision: 1, status: 'preparing', schedulingPaused: true,
      createdAt: row.createdAt.toISOString(), story, binding, budget,
      setup: {id: setup.id, kind: 'setup', experienceId: row.id, experienceRevision: 1, options: []},
      responseDraft: {id: draft.id, experienceId: row.id, interactionEventId: setup.id, text: '', revision: 1},
      media: null, canRespond: false, canDispatch: false,
    };
  } catch { throw Error('STORED_EXPERIENCE_INVALID'); }
}
export async function assertStillPreparing(scope: ExperienceOpeningReadScope, row: ExperienceRecord) {
  if (row.status !== 'preparing' || row.schedulingPaused !== true || row.dispatchEpoch !== 0 || row.revision !== 1 ||
    row.rowRevision !== 1 || row.archivedAt !== null || row.updatedAt.getTime() !== row.createdAt.getTime())
    throw Error('PREPARATION_NO_LONGER_CURRENT');
  const setup = await scope.findSetup(row.id), drafts = setup ? await scope.findOpeningDrafts(setup.id) : [];
  if (drafts.length !== 1) throw Error('STORED_EXPERIENCE_INVALID');
  const draft = drafts[0]!;
  if (draft.text !== '' || draft.revision !== 1 || draft.updatedAt.getTime() !== draft.createdAt.getTime())
    throw Error('PREPARATION_NO_LONGER_CURRENT');
}

/** Fixed story, character and binding facts shared by openings and forked routes. */
export async function fixedExperienceFacts(scope: ExperienceOpeningReadScope, owner: InternalOwnerContext, row: ExperienceRecord) {
  assertOpeningAuthority(scope, owner);
  try {
    parseId(row.id); parseId(row.storyVersionId); parseId(row.providerBindingVersionId);
    if (row.ownerId !== owner.ownerId || !isTimestamp(row.createdAt.toISOString()) || typeof row.budgetLimitMicros !== 'bigint') throw Error();
    const story = await readStoryVersionInScope(scope, owner, row.storyVersionId);
    const bindingRow = await scope.findBinding(row.providerBindingVersionId);
    if (!bindingRow || bindingRow.id !== row.providerBindingVersionId) throw Error();
    const fixedBinding = decodeStoredBinding(bindingRow, owner), binding = publicBinding(fixedBinding, owner);
    if (row.createdAt.getTime() < Math.max(Date.parse(story.sealedAt), fixedBinding.createdAt.getTime())) throw Error();
    const budget = parseBudget({limitMicros: row.budgetLimitMicros.toString(), currency: row.budgetCurrency});
    return {story,binding,budget};
  } catch {throw Error('STORED_EXPERIENCE_INVALID');}
}
