import {createHash} from 'node:crypto';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {fields, parseOwner, parseId} from '../contracts/story-draft-validation.js';
import {parseExperienceList, parseExperiencePage, type ExperienceList, type ExperiencePage, type ExperienceSummary} from '../contracts/experience-directory.js';
import {isTimestamp} from '../contracts/primitives.js';
import type {ExperienceOpeningStore} from '../ports/experience-opening-store.js';
import {assertOpeningAuthority, openingFacts} from './experience-opening-facts.js';

/** Read-only live keyset page. Cursor is a scoped position, not authority or a snapshot lease. */
export async function listExperiences(store: ExperienceOpeningStore, owner: InternalOwnerContext, input: ExperienceList): Promise<ExperiencePage> {
  parseOwner(owner); const q = parseExperienceList(input);
  if (q.datasetId !== owner.datasetId) throw Error('DATASET_CHANGED');
  const scopeHash = createHash('sha256').update(JSON.stringify(['experience-list.v1', owner.ownerId, owner.datasetId, 'active', 'updatedAt/id:desc'])).digest('hex');
  let before: {updatedAt: Date; id: string} | undefined;
  if (q.cursor) {
    try {
      const bytes = Buffer.from(q.cursor, 'base64url'); if (bytes.toString('base64url') !== q.cursor) throw Error();
      const c: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      fields(c, ['version', 'scopeHash', 'updatedAt', 'id']);
      if (c.version !== 1 || c.scopeHash !== scopeHash || !isTimestamp(c.updatedAt)) throw Error();
      before = {updatedAt: new Date(c.updatedAt), id: parseId(c.id)};
    } catch {throw Error('INVALID_EXPERIENCE_CURSOR');}
  }
  return store.read(owner.ownerId, async scope => {
    assertOpeningAuthority(scope, owner);
    const rows = await scope.listExperiences({take: q.limit + 1, ...(before ? {before} : {})}), items: ExperienceSummary[] = [];
    for (const row of rows.slice(0, q.limit)) {
      if (row.ownerId !== owner.ownerId || row.deletedAt || row.archivedAt) throw Error('STORED_EXPERIENCE_INVALID');
      // Reuse in-scope sealing/binding/ownership checks, not public nested transactions.
      const facts = await openingFacts(scope, owner, row);
      items.push({id: row.id, storyVersionId: facts.story.id, title: facts.story.title, sourceRevision: facts.story.sourceRevision,
        status: row.status, schedulingPaused: row.schedulingPaused, modelId: facts.binding.modelId, region: facts.binding.region,
        budget: facts.budget, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()});
    }
    const last = items.at(-1), nextCursor = rows.length > q.limit && last
      ? Buffer.from(JSON.stringify({version: 1, scopeHash, updatedAt: last.updatedAt, id: last.id})).toString('base64url') : null;
    try {return parseExperiencePage({protocolVersion: 1, datasetId: owner.datasetId, items, nextCursor});}
    catch {throw Error('STORED_EXPERIENCE_INVALID');}
  });
}
