import {isBusinessId} from './primitives.js';
import type {StorySettings, DraftCreate, DraftUpdate, DraftLifecycle, InternalOwnerContext} from './story-draft.js';

export function fields(value: unknown, required: readonly string[], optional: readonly string[] = [], code = 'INVALID_STORY_COMMAND'): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error(code);
}
function text(value: unknown, max: number): value is string {return typeof value === 'string' && [...value].length <= max;}
export function parseTitle(value: unknown): string {
  if (!text(value, 120) || !value.trim()) throw new Error('INVALID_STORY_COMMAND'); return value;
}
export function parseSettings(value: unknown): StorySettings {
  fields(value, ['world', 'opening', 'genre', 'playerRole', 'worldRules', 'tone']);
  if (!text(value.world, 12000) || !text(value.opening, 12000) || !text(value.genre, 80) ||
      !text(value.playerRole, 4000) || !text(value.tone, 500) || !Array.isArray(value.worldRules) ||
      value.worldRules.length > 30 || ![...value.worldRules].every(rule => text(rule, 1000))) throw new Error('INVALID_STORY_COMMAND');
  return {world: value.world, opening: value.opening, genre: value.genre, playerRole: value.playerRole,
    worldRules: [...value.worldRules] as string[], tone: value.tone};
}
export function parseOwner(value: InternalOwnerContext): string {
  fields(value, ['ownerId', 'datasetId'], [], 'OWNER_UNAVAILABLE');
  if (!isBusinessId(value.ownerId) || !isBusinessId(value.datasetId)) throw new Error('OWNER_UNAVAILABLE'); return value.ownerId;
}
export function parseId(value: unknown): string {if (!isBusinessId(value)) throw new Error('INVALID_STORY_COMMAND'); return value;}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('INVALID_STORY_COMMAND'); return value;
}
export function parseCreate(value: DraftCreate): DraftCreate {
  fields(value, ['datasetId', 'commandId', 'title', 'settings']);
  return {datasetId: parseId(value.datasetId), commandId: parseId(value.commandId), title: parseTitle(value.title), settings: parseSettings(value.settings)};
}
export function parseLifecycle(value: DraftLifecycle): DraftLifecycle {
  fields(value, ['datasetId', 'commandId', 'id', 'expectedRevision']);
  return {datasetId: parseId(value.datasetId), commandId: parseId(value.commandId), id: parseId(value.id), expectedRevision: revision(value.expectedRevision)};
}
export function parseUpdate(value: DraftUpdate): DraftUpdate {
  fields(value, ['datasetId', 'commandId', 'id', 'expectedRevision', 'patch']);
  fields(value.patch, [], ['title', 'settings']);
  if (Object.keys(value.patch).length === 0) throw new Error('INVALID_STORY_COMMAND');
  return {datasetId: parseId(value.datasetId), commandId: parseId(value.commandId), id: parseId(value.id), expectedRevision: revision(value.expectedRevision), patch: {
    ...(Object.hasOwn(value.patch, 'title') ? {title: parseTitle(value.patch.title)} : {}),
    ...(Object.hasOwn(value.patch, 'settings') ? {settings: parseSettings(value.patch.settings)} : {}),
  }};
}
