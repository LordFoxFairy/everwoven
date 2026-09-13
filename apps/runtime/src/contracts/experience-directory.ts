import type {StoryProtocol} from './story-draft.js';
import type {ExperienceBudget} from './experience-opening.js';
import {fields, parseProtocol, parseId, parseTitle, parseRevision} from './story-draft-validation.js';
import {parseBudget} from './experience-opening-validation.js';
import {bindingLabel} from './provider-binding-validation.js';
import {isTimestamp} from './primitives.js';
export type ExperienceList = StoryProtocol & {limit?: number; cursor?: string};
export type ExperienceSummary = {id: string; storyVersionId: string; title: string; sourceRevision: number; status: string;
  schedulingPaused: boolean; modelId: string; region: string; budget: ExperienceBudget; createdAt: string; updatedAt: string};
export type ExperiencePage = StoryProtocol & {items: ExperienceSummary[]; nextCursor: string | null};
function cursor(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(v)) throw Error('INVALID_EXPERIENCE_CURSOR'); return v;
}
export function parseExperienceList(value: unknown): ExperienceList & {limit: number} {
  const protocol = parseProtocol(value);
  try {
    fields(value, ['protocolVersion', 'datasetId'], ['limit', 'cursor']);
    const limit = value.limit === undefined ? 20 : value.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) throw Error();
    return {...protocol, limit, ...(value.cursor !== undefined ? {cursor: cursor(value.cursor)} : {})};
  } catch {throw Error('INVALID_EXPERIENCE_QUERY');}
}
export function parseExperienceSummary(value: unknown): ExperienceSummary {
  fields(value, ['id', 'storyVersionId', 'title', 'sourceRevision', 'status', 'schedulingPaused', 'modelId', 'region', 'budget', 'createdAt', 'updatedAt']);
  if (typeof value.status !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(value.status) || typeof value.schedulingPaused !== 'boolean' ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || value.updatedAt < value.createdAt) throw Error('INVALID_EXPERIENCE_DTO');
  return {id: parseId(value.id), storyVersionId: parseId(value.storyVersionId), title: parseTitle(value.title), sourceRevision: parseRevision(value.sourceRevision),
    status: value.status, schedulingPaused: value.schedulingPaused, modelId: bindingLabel(value.modelId), region: bindingLabel(value.region), budget: parseBudget(value.budget), createdAt: value.createdAt, updatedAt: value.updatedAt};
}
export function parseExperiencePage(value: unknown): ExperiencePage {
  try {
    fields(value, ['protocolVersion', 'datasetId', 'items', 'nextCursor']); const protocol = parseProtocol(value);
    if (!Array.isArray(value.items) || value.items.length > 50) throw Error();
    const items = value.items.map(parseExperienceSummary);
    if (new Set(items.map(x => x.id)).size !== items.length || (items.length === 0 && value.nextCursor !== null)) throw Error();
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1]!, b = items[i]!;
      if (a.updatedAt < b.updatedAt || (a.updatedAt === b.updatedAt && a.id <= b.id)) throw Error();
    }
    return {...protocol, items, nextCursor: value.nextCursor === null ? null : cursor(value.nextCursor)};
  } catch {throw Error('INVALID_EXPERIENCE_DTO');}
}
