import {createHash} from 'node:crypto';
import type {
  DraftDTO,
  DraftCreate,
  DraftUpdate,
  DraftLifecycle,
  InternalOwnerContext,
  MainCharacterInput,
} from '../contracts/story-draft.js';
import type {StoryDraftWriteScope} from '../ports/story-draft-store.js';
import {parseDraftDTO} from '../contracts/story-draft-output.js';
import {isBusinessId} from '../contracts/primitives.js';
export type StoryAction = 'create' | 'update' | 'delete' | 'restore';
export type StoryWrite = DraftCreate | DraftUpdate | DraftLifecycle;
export function storyCommand(owner: InternalOwnerContext, action: StoryAction, input: StoryWrite) {
  const type = `authoring.story.${action}.v1`;
  return {
    type,
    hash: createHash('sha256')
      .update(JSON.stringify([type, owner.ownerId, owner.datasetId, input]))
      .digest('hex'),
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function assertMain(data: DraftDTO, input: MainCharacterInput | null) {
  const main = data.mainCharacter;
  if (input === null) {
    if (main !== null) throw Error();
    return;
  }
  if (!main || !same(main.overrides, input.overrides)) throw Error();
  if (input.kind === 'bound' && main.version.id !== input.characterVersionId) throw Error();
  if (
    input.kind === 'library' &&
    (main.version.characterTemplateId !== input.templateId ||
      main.version.sourceRevision !== input.expectedTemplateRevision)
  )
    throw Error();
  if (
    input.kind === 'inline' &&
    (main.version.name !== input.name ||
      !same(main.version.settings, input.settings) ||
      main.version.portraitAssetId !== input.portraitAssetId)
  )
    throw Error();
}
/** Match explicit command fields and aggregate internal truth, never today's root/template/Asset. */
export function assertStoryResponse(action: StoryAction, input: StoryWrite, data: DraftDTO, receiptId?: string) {
  if (data.datasetId !== input.datasetId || data.protocolVersion !== input.protocolVersion) throw Error();
  if (action === 'create') {
    const v = input as DraftCreate;
    if (
      (receiptId !== undefined && data.id !== receiptId) ||
      data.revision !== 1 ||
      data.deletedAt !== null ||
      data.archivedAt !== null ||
      data.createdAt !== data.updatedAt ||
      data.title !== v.title ||
      !same(data.settings, v.settings) ||
      !same(data.assetSlots, v.assetSlots)
    )
      throw Error();
    // Every CREATE reference was new and checked in this same transaction.
    // Validate that historical fact, not today's Asset state. Later actions may
    // legitimately retain missing, unavailable or soft-deleted asset views.
    if (
      data.assets.some(
        (asset) => asset.state !== 'present' || asset.data.status !== 'ready' || asset.data.deletedAt !== null,
      )
    )
      throw Error();
    assertMain(data, v.mainCharacter);
  } else {
    const v = input as DraftUpdate | DraftLifecycle;
    if (data.id !== v.id || data.revision !== v.expectedRevision + 1) throw Error();
    if (action === 'delete' ? data.deletedAt !== data.updatedAt : data.deletedAt !== null) throw Error();
    if (action === 'update') {
      const p = (v as DraftUpdate).patch;
      if (Object.hasOwn(p, 'title') && p.title !== data.title) throw Error();
      if (Object.hasOwn(p, 'settings') && !same(p.settings, data.settings)) throw Error();
      if (Object.hasOwn(p, 'assetSlots') && !same(p.assetSlots, data.assetSlots)) throw Error();
      if (Object.hasOwn(p, 'mainCharacter')) assertMain(data, p.mainCharacter!);
    }
  }
}
export async function replayStory(
  scope: StoryDraftWriteScope,
  owner: InternalOwnerContext,
  action: StoryAction,
  input: StoryWrite,
) {
  const command = storyCommand(owner, action, input),
    receipt = await scope.findReceipt(input.commandId);
  if (!receipt) return null;
  if (receipt.commandType !== command.type || receipt.payloadHash !== command.hash) throw Error('IDEMPOTENCY_CONFLICT');
  try {
    if (receipt.schemaVersion !== 1 || !isBusinessId(receipt.id)) throw Error();
    const data = parseDraftDTO(receipt.response);
    assertStoryResponse(action, input, data, receipt.id);
    return {data, replayed: true};
  } catch {
    throw Error('COMMAND_RECEIPT_INVALID');
  }
}
