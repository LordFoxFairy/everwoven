import {isBusinessId} from './primitives.js';
import {fields as strictFields} from './story-draft-validation.js';
import type {CharacterCreate, CharacterUpdate, CharacterLifecycle, CharacterListInput, CharacterSettings} from './character-template.js';

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  strictFields(value, required, optional, 'INVALID_CHARACTER_COMMAND');
}
const text = (value: unknown, max: number): value is string => typeof value === 'string' && [...value].length <= max;
export function parseName(value: unknown): string {
  if (!text(value, 120) || !value.trim()) throw new Error('INVALID_CHARACTER_COMMAND'); return value;
}
export function parseId(value: unknown): string {
  if (!isBusinessId(value)) throw new Error('INVALID_CHARACTER_COMMAND'); return value;
}
export function parseSettings(value: unknown): CharacterSettings {
  fields(value, ['personality', 'appearance', 'speakingStyle', 'boundaries']);
  if (!text(value.personality, 8000) || !text(value.appearance, 4000) || !text(value.speakingStyle, 2000) || !text(value.boundaries, 4000)) throw new Error('INVALID_CHARACTER_COMMAND');
  return {personality: value.personality, appearance: value.appearance, speakingStyle: value.speakingStyle, boundaries: value.boundaries};
}
export function parsePortrait(value: unknown): string | null {return value === null ? null : parseId(value);}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('INVALID_CHARACTER_COMMAND'); return value;
}
export function parseCreate(value: CharacterCreate): CharacterCreate {
  fields(value, ['datasetId', 'commandId', 'name', 'settings', 'portraitAssetId']);
  return {datasetId: parseId(value.datasetId), commandId: parseId(value.commandId), name: parseName(value.name), settings: parseSettings(value.settings), portraitAssetId: parsePortrait(value.portraitAssetId)};
}
export function parseLifecycle(value: CharacterLifecycle): CharacterLifecycle {
  fields(value, ['datasetId', 'commandId', 'id', 'expectedRevision']);
  return {datasetId: parseId(value.datasetId), commandId: parseId(value.commandId), id: parseId(value.id), expectedRevision: revision(value.expectedRevision)};
}
export function parseUpdate(value: CharacterUpdate): CharacterUpdate {
  fields(value, ['datasetId', 'commandId', 'id', 'expectedRevision', 'patch']);
  fields(value.patch, [], ['name', 'settings', 'portraitAssetId']);
  if (Object.keys(value.patch).length === 0) throw new Error('INVALID_CHARACTER_COMMAND');
  return {datasetId: parseId(value.datasetId), commandId: parseId(value.commandId), id: parseId(value.id), expectedRevision: revision(value.expectedRevision), patch: {
    ...(Object.hasOwn(value.patch, 'name') ? {name: parseName(value.patch.name)} : {}),
    ...(Object.hasOwn(value.patch, 'settings') ? {settings: parseSettings(value.patch.settings)} : {}),
    ...(Object.hasOwn(value.patch, 'portraitAssetId') ? {portraitAssetId: parsePortrait(value.patch.portraitAssetId)} : {}),
  }};
}
export function parseList(value: CharacterListInput = {}): Required<Omit<CharacterListInput, 'cursor'>> & Pick<CharacterListInput, 'cursor'> {
  strictFields(value, [], ['limit', 'deleted', 'q', 'cursor'], 'INVALID_CHARACTER_QUERY');
  if ((Object.hasOwn(value, 'limit') && (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100)) ||
      (Object.hasOwn(value, 'deleted') && value.deleted !== 'exclude' && value.deleted !== 'only') ||
      (Object.hasOwn(value, 'q') && !text(value.q, 120)) || (Object.hasOwn(value, 'cursor') && typeof value.cursor !== 'string')) throw new Error('INVALID_CHARACTER_QUERY');
  return {limit: value.limit ?? 20, deleted: value.deleted ?? 'exclude', q: value.q ?? '', ...(value.cursor !== undefined ? {cursor: value.cursor} : {})};
}
