import type {PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {parseOwner} from '../contracts/story-draft-validation.js';
import {parseGetGenerationMedia, type GetGenerationMedia} from '../contracts/generation-media.js';
import {parsePrivateVideoMetadata} from '../contracts/private-video.js';
import type {PrivateVideoMetadata, PrivateVideoReader} from '../ports/private-video.js';

/** SQLite is the authority; a URL, filesystem candidate or recovery hint never grants access. */
export async function openGenerationMedia(db: PrismaClient, owner: InternalOwnerContext, input: GetGenerationMedia,
  files: {open(metadata: PrivateVideoMetadata): Promise<PrivateVideoReader>}, revalidate: () => Promise<void>): Promise<PrivateVideoReader> {
  parseOwner(owner);const query = parseGetGenerationMedia(input);
  if (query.datasetId !== owner.datasetId) throw Error('DATASET_CHANGED');
  await revalidate();
  const metadata = await db.$transaction(async tx => {
    if (!await tx.localProfile.findFirst({where: {id: owner.ownerId, deletedAt: null}})) throw Error('OWNER_UNAVAILABLE');
    const root = await tx.experience.findFirst({where: {id: query.experienceId, ownerId: owner.ownerId, deletedAt: null, archivedAt: null}});
    if (!root) throw Error('GENERATION_MEDIA_NOT_FOUND');
    const turn = await tx.generationTurn.findFirst({where: {id: query.turnId, ownerId: owner.ownerId, experienceId: root.id, status: {in: ['ready', 'viewed']}}});
    if (!turn) throw Error('GENERATION_MEDIA_NOT_FOUND');
    const quote = await tx.generationQuote.findFirst({where: {id: turn.quoteId, ownerId: owner.ownerId, datasetId: owner.datasetId,
      experienceId: root.id, acceptedTurnId: turn.id, interactionEventId: turn.interactionEventId, schemaVersion: 1}});
    if (!quote) throw Error('GENERATION_MEDIA_NOT_FOUND');
    const value = parsePrivateVideoMetadata(turn.media);
    if (value.id !== query.mediaId) throw Error('GENERATION_MEDIA_NOT_FOUND');
    return value;
  });
  await revalidate();const reader = await files.open(metadata);
  try {await revalidate();return reader;} catch (error) {await reader.close();throw error;}
}
