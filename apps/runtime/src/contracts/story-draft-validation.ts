import {isBusinessId} from './primitives.js';
import type {
  StorySettings,
  DraftCreate,
  DraftUpdate,
  DraftLifecycle,
  DraftGet,
  DraftListInput,
  InternalOwnerContext,
  MainCharacterInput,
  CharacterOverrides,
  StoryAssetSlots,
  StoryProtocol,
} from './story-draft.js';

export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  code = 'INVALID_STORY_COMMAND',
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error(code);
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && [...value].length <= max;
}
export function parseTitle(value: unknown): string {
  if (!text(value, 120) || !value.trim()) throw new Error('INVALID_STORY_COMMAND');
  return value;
}
export function parseSettings(value: unknown): StorySettings {
  fields(value, ['world', 'opening', 'genre', 'playerRole', 'worldRules', 'tone']);
  if (
    !text(value.world, 12000) ||
    !text(value.opening, 12000) ||
    !text(value.genre, 80) ||
    !text(value.playerRole, 4000) ||
    !text(value.tone, 500) ||
    !Array.isArray(value.worldRules) ||
    value.worldRules.length > 30 ||
    ![...value.worldRules].every((rule) => text(rule, 1000))
  )
    throw new Error('INVALID_STORY_COMMAND');
  return {
    world: value.world,
    opening: value.opening,
    genre: value.genre,
    playerRole: value.playerRole,
    worldRules: [...value.worldRules] as string[],
    tone: value.tone,
  };
}
export function parseOwner(value: InternalOwnerContext): string {
  fields(value, ['ownerId', 'datasetId'], [], 'OWNER_UNAVAILABLE');
  if (!isBusinessId(value.ownerId) || !isBusinessId(value.datasetId)) throw new Error('OWNER_UNAVAILABLE');
  return value.ownerId;
}
export function parseId(value: unknown): string {
  if (!isBusinessId(value)) throw new Error('INVALID_STORY_COMMAND');
  return value;
}
export function parseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    throw new Error('INVALID_STORY_COMMAND');
  return value;
}

export function parseProtocol(value: unknown): StoryProtocol {
  if (
    !value ||
    typeof value !== 'object' ||
    !Object.hasOwn(value, 'protocolVersion') ||
    (value as Record<string, unknown>).protocolVersion !== 1
  )
    throw Error('CLIENT_RELOAD_REQUIRED');
  return {protocolVersion: 1, datasetId: parseId((value as Record<string, unknown>).datasetId)};
}
const characterLimits = {personality: 8000, appearance: 4000, speakingStyle: 2000, boundaries: 4000} as const;
export function parseCharacterFields(
  value: unknown,
  partial: false,
): import('./character-template.js').CharacterSettings;
export function parseCharacterFields(
  value: unknown,
  partial: true,
): Partial<import('./character-template.js').CharacterSettings>;
export function parseCharacterFields(value: unknown, partial: boolean) {
  const keys = Object.keys(characterLimits);
  fields(value, partial ? [] : keys, partial ? keys : []);
  const result: Record<string, string> = {};
  for (const key of keys as (keyof typeof characterLimits)[])
    if (Object.hasOwn(value, key)) {
      if (!text(value[key], characterLimits[key])) throw Error('INVALID_STORY_COMMAND');
      result[key] = value[key];
    }
  return result;
}
export function parseOverrides(value: unknown): CharacterOverrides {
  fields(value, ['portrait', 'relationship'], ['name', 'settings']);
  fields(value.portrait, ['mode'], ['assetId']);
  const p = value.portrait;
  if (
    !['inherit', 'none', 'asset'].includes(p.mode as string) ||
    (p.mode === 'asset') !== Object.hasOwn(p, 'assetId') ||
    !text(value.relationship, 4000)
  )
    throw Error('INVALID_STORY_COMMAND');
  if (Object.hasOwn(value, 'name') && !text(value.name, 120)) throw Error('INVALID_STORY_COMMAND');
  return {
    portrait: p.mode === 'asset' ? {mode: 'asset', assetId: parseId(p.assetId)} : {mode: p.mode as 'inherit' | 'none'},
    relationship: value.relationship,
    ...(Object.hasOwn(value, 'name') ? {name: value.name as string} : {}),
    ...(Object.hasOwn(value, 'settings') ? {settings: parseCharacterFields(value.settings, true)} : {}),
  };
}
export function parseSlots(value: unknown): StoryAssetSlots {
  fields(value, ['cover', 'opening', 'character']);
  const ref = (v: unknown) => (v === null ? null : parseId(v));
  return {cover: ref(value.cover), opening: ref(value.opening), character: ref(value.character)};
}
export function parseMainCharacter(value: unknown, allowBound = true): MainCharacterInput | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw Error('INVALID_STORY_COMMAND');
  const kind = (value as Record<string, unknown>).kind;
  if (kind === 'library') {
    fields(value, ['kind', 'templateId', 'expectedTemplateRevision', 'overrides']);
    return {
      kind,
      templateId: parseId(value.templateId),
      expectedTemplateRevision: parseRevision(value.expectedTemplateRevision),
      overrides: parseOverrides(value.overrides),
    };
  }
  if (kind === 'bound' && allowBound) {
    fields(value, ['kind', 'characterVersionId', 'overrides']);
    return {kind, characterVersionId: parseId(value.characterVersionId), overrides: parseOverrides(value.overrides)};
  }
  if (kind === 'inline') {
    fields(value, ['kind', 'name', 'settings', 'portraitAssetId', 'overrides']);
    return {
      kind,
      name: parseTitle(value.name),
      settings: parseCharacterFields(value.settings, false),
      portraitAssetId: value.portraitAssetId === null ? null : parseId(value.portraitAssetId),
      overrides: parseOverrides(value.overrides),
    };
  }
  throw Error('INVALID_STORY_COMMAND');
}
export function assertPortraitSlots(main: {overrides: CharacterOverrides} | null, slots: StoryAssetSlots): void {
  const p = main?.overrides.portrait;
  if ((p?.mode === 'asset' ? p.assetId : null) !== slots.character) throw Error('INVALID_STORY_COMMAND');
}
export function parseCreate(value: unknown): DraftCreate {
  const protocol = parseProtocol(value);
  fields(value, ['protocolVersion', 'datasetId', 'commandId', 'title', 'settings', 'mainCharacter', 'assetSlots']);
  const mainCharacter = parseMainCharacter(value.mainCharacter, false) as DraftCreate['mainCharacter'],
    assetSlots = parseSlots(value.assetSlots);
  assertPortraitSlots(mainCharacter, assetSlots);
  return {
    ...protocol,
    commandId: parseId(value.commandId),
    title: parseTitle(value.title),
    settings: parseSettings(value.settings),
    mainCharacter,
    assetSlots,
  };
}
export function parseLifecycle(value: unknown): DraftLifecycle {
  const protocol = parseProtocol(value);
  fields(value, ['protocolVersion', 'datasetId', 'commandId', 'id', 'expectedRevision']);
  return {
    ...protocol,
    commandId: parseId(value.commandId),
    id: parseId(value.id),
    expectedRevision: parseRevision(value.expectedRevision),
  };
}
export function parseUpdate(value: unknown): DraftUpdate {
  const protocol = parseProtocol(value);
  fields(value, ['protocolVersion', 'datasetId', 'commandId', 'id', 'expectedRevision', 'patch']);
  fields(value.patch, [], ['title', 'settings', 'mainCharacter', 'assetSlots']);
  const p = value.patch;
  if (!Object.keys(p).length) throw Error('INVALID_STORY_COMMAND');
  return {
    ...protocol,
    commandId: parseId(value.commandId),
    id: parseId(value.id),
    expectedRevision: parseRevision(value.expectedRevision),
    patch: {
      ...(Object.hasOwn(p, 'title') ? {title: parseTitle(p.title)} : {}),
      ...(Object.hasOwn(p, 'settings') ? {settings: parseSettings(p.settings)} : {}),
      ...(Object.hasOwn(p, 'mainCharacter') ? {mainCharacter: parseMainCharacter(p.mainCharacter)} : {}),
      ...(Object.hasOwn(p, 'assetSlots') ? {assetSlots: parseSlots(p.assetSlots)} : {}),
    },
  };
}
export function parseGet(value: unknown): Required<DraftGet> {
  let protocol: StoryProtocol;
  try {
    protocol = parseProtocol(value);
  } catch (e) {
    if ((e as Error).message === 'CLIENT_RELOAD_REQUIRED') throw e;
    throw Error('INVALID_STORY_QUERY');
  }
  fields(value, ['protocolVersion', 'datasetId', 'id'], ['includeDeleted'], 'INVALID_STORY_QUERY');
  if (Object.hasOwn(value, 'includeDeleted') && typeof value.includeDeleted !== 'boolean')
    throw Error('INVALID_STORY_QUERY');
  try {
    return {...protocol, id: parseId(value.id), includeDeleted: value.includeDeleted === true};
  } catch {
    throw Error('INVALID_STORY_QUERY');
  }
}
export function parseList(value: unknown): DraftListInput & {limit: number; deleted: 'exclude' | 'only'; q: string} {
  let protocol: StoryProtocol;
  try {
    protocol = parseProtocol(value);
  } catch (e) {
    if ((e as Error).message === 'CLIENT_RELOAD_REQUIRED') throw e;
    throw Error('INVALID_STORY_QUERY');
  }
  fields(value, ['protocolVersion', 'datasetId'], ['limit', 'deleted', 'q', 'genre', 'cursor'], 'INVALID_STORY_QUERY');
  if (
    (Object.hasOwn(value, 'limit') &&
      (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100)) ||
    (Object.hasOwn(value, 'deleted') && !['exclude', 'only'].includes(value.deleted as string)) ||
    (Object.hasOwn(value, 'q') && !text(value.q, 120)) ||
    (Object.hasOwn(value, 'genre') && !text(value.genre, 80)) ||
    (Object.hasOwn(value, 'cursor') &&
      (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 2048))
  )
    throw Error('INVALID_STORY_QUERY');
  return {
    ...protocol,
    limit: (value.limit as number) ?? 20,
    deleted: (value.deleted as 'exclude' | 'only') ?? 'exclude',
    q: (value.q as string) ?? '',
    ...(Object.hasOwn(value, 'genre') ? {genre: value.genre as string} : {}),
    ...(Object.hasOwn(value, 'cursor') ? {cursor: value.cursor as string} : {}),
  };
}
