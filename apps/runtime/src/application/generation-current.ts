import {readForkBase} from './saved-scene.js';
import type {Prisma, Experience} from '../generated/prisma/client.js';

/** Acceptance advances the experience revision; clocks and UUID ordering do not identify a turn. */
export async function currentGenerationTurn(tx: Prisma.TransactionClient, datasetId: string,
  root: Pick<Experience, 'id' | 'ownerId' | 'status' | 'revision'>) {
  const quotes = await tx.generationQuote.findMany({where: {ownerId: root.ownerId, datasetId, experienceId: root.id,
    acceptedTurnId: {not: null}}, orderBy: {experienceRevision: 'desc'}, take: 2});
  if (root.status === 'preparing') {
    if (quotes.length) throw Error('STORED_GENERATION_INVALID');
    return null;
  }
  if(!quotes.length&&root.revision===1&&['paused','awaiting'].includes(root.status)){
    const actual=await tx.experience.findFirst({where:{id:root.id,ownerId:root.ownerId}});
    if(!actual)throw Error('STORED_GENERATION_INVALID');
    const {base}=await readForkBase(tx,{ownerId:root.ownerId,datasetId},actual);
    const event=await tx.interactionEvent.findFirst({where:{id:base.interactionEventId,experienceId:root.id,ownerId:root.ownerId,experienceRevision:1,kind:'decision'}});
    if(!event)throw Error('STORED_GENERATION_INVALID');return null;
  }
  const quote = quotes[0];
  const expectedRevision = root.revision - (root.status === 'awaiting' ? 2 : 1);
  if (!quote || quote.schemaVersion !== 1 || quote.experienceRevision !== expectedRevision ||
    quotes[1]?.experienceRevision === quote.experienceRevision) throw Error('STORED_GENERATION_INVALID');
  const turn = await tx.generationTurn.findUnique({where: {quoteId: quote.id}});
  if (!turn || turn.ownerId !== root.ownerId || turn.experienceId !== root.id || turn.id !== quote.acceptedTurnId ||
    turn.interactionEventId !== quote.interactionEventId) throw Error('STORED_GENERATION_INVALID');
  return turn;
}
