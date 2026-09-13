import type {
  DraftDTO,
  DraftSummaryDTO,
  DraftPage,
  DraftCommandResult,
  CharacterVersionDTO,
  MainCharacterDTO,
  StoryAssetView,
} from './story-draft.js';
import {
  fields,
  parseProtocol,
  parseTitle,
  parseSettings,
  parseId,
  parseRevision,
  parseCharacterFields,
  parseOverrides,
  parseSlots,
  assertPortraitSlots,
} from './story-draft-validation.js';
import {parseAssetDTO} from './asset-validation.js';
import {isTimestamp} from './primitives.js';
const bad = () => Error('INVALID_STORY_DTO');
function safe<T>(work: () => T): T {
  try {
    return work();
  } catch {
    throw bad();
  }
}
function date(v: unknown): string {
  if (!isTimestamp(v)) throw bad();
  return v;
}
function nullableDate(v: unknown) {
  return v === null ? null : date(v);
}
function nullableId(v: unknown) {
  return v === null ? null : parseId(v);
}
function smallText(v: unknown, max: number): string {
  if (typeof v !== 'string' || [...v].length > max) throw bad();
  return v;
}
function lifecycle(v: Record<string, unknown>) {
  const createdAt = date(v.createdAt),
    updatedAt = date(v.updatedAt);
  if (updatedAt < createdAt) throw bad();
  return {
    revision: parseRevision(v.revision),
    createdAt,
    updatedAt,
    deletedAt: nullableDate(v.deletedAt),
    archivedAt: nullableDate(v.archivedAt),
  };
}
export function parseCharacterVersionDTO(value: unknown): CharacterVersionDTO {
  return safe(() => {
    fields(value, [
      'id',
      'characterTemplateId',
      'versionNo',
      'sourceRevision',
      'name',
      'settings',
      'portraitAssetId',
      'schemaVersion',
      'createdAt',
    ]);
    if (value.schemaVersion !== 1) throw bad();
    return {
      id: parseId(value.id),
      characterTemplateId: parseId(value.characterTemplateId),
      versionNo: parseRevision(value.versionNo),
      sourceRevision: parseRevision(value.sourceRevision),
      name: parseTitle(value.name),
      settings: parseCharacterFields(value.settings, false),
      portraitAssetId: nullableId(value.portraitAssetId),
      schemaVersion: 1,
      createdAt: date(value.createdAt),
    };
  });
}
export function effectiveCharacter(
  version: CharacterVersionDTO,
  overrides: MainCharacterDTO['overrides'],
): MainCharacterDTO['effective'] {
  return {
    name: overrides.name ?? version.name,
    settings: {...version.settings, ...overrides.settings},
    relationship: overrides.relationship,
    portraitAssetId:
      overrides.portrait.mode === 'inherit'
        ? version.portraitAssetId
        : overrides.portrait.mode === 'none'
          ? null
          : overrides.portrait.assetId,
  };
}
export function parseMainCharacterDTO(value: unknown): MainCharacterDTO | null {
  return safe(() => {
    if (value === null) return null;
    fields(value, ['version', 'overrides', 'effective']);
    const version = parseCharacterVersionDTO(value.version),
      overrides = parseOverrides(value.overrides);
    fields(value.effective, ['name', 'settings', 'relationship', 'portraitAssetId']);
    const e = value.effective;
    const effective = {
      name: smallText(e.name, 120),
      settings: parseCharacterFields(e.settings, false),
      relationship: smallText(e.relationship, 4000),
      portraitAssetId: nullableId(e.portraitAssetId),
    };
    if (JSON.stringify(effective) !== JSON.stringify(effectiveCharacter(version, overrides))) throw bad();
    return {version, overrides, effective};
  });
}
export function parseDraftDTO(value: unknown): DraftDTO {
  return safe(() => {
    fields(value, [
      'protocolVersion',
      'datasetId',
      'id',
      'title',
      'settings',
      'mainCharacter',
      'assetSlots',
      'assets',
      'schemaVersion',
      'revision',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'archivedAt',
    ]);
    const protocol = parseProtocol(value),
      mainCharacter = parseMainCharacterDTO(value.mainCharacter),
      assetSlots = parseSlots(value.assetSlots);
    assertPortraitSlots(mainCharacter, assetSlots);
    if (value.schemaVersion !== 1) throw bad();
    const ids = [
      ...new Set(
        [...Object.values(assetSlots), mainCharacter?.version.portraitAssetId].filter(
          (v): v is string => typeof v === 'string',
        ),
      ),
    ].sort();
    if (!Array.isArray(value.assets) || value.assets.length !== ids.length || value.assets.length > 4) throw bad();
    const assets: StoryAssetView[] = Array.from(value.assets).map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw bad();
      if (entry.state === 'present') {
        fields(entry, ['state', 'data']);
        const data = parseAssetDTO(entry.data);
        if (data.datasetId !== protocol.datasetId || data.id !== ids[index]) throw bad();
        return {state: 'present', data};
      }
      fields(entry, ['state', 'id', 'datasetId']);
      if (entry.state !== 'missing' || entry.datasetId !== protocol.datasetId || entry.id !== ids[index]) throw bad();
      return {state: 'missing', id: parseId(entry.id), datasetId: protocol.datasetId};
    });
    return {
      ...protocol,
      id: parseId(value.id),
      title: parseTitle(value.title),
      settings: parseSettings(value.settings),
      mainCharacter,
      assetSlots,
      assets,
      schemaVersion: 1,
      ...lifecycle(value),
    };
  });
}
export function parseDraftSummaryDTO(value: unknown): DraftSummaryDTO {
  return safe(() => {
    fields(value, [
      'protocolVersion',
      'datasetId',
      'id',
      'title',
      'genre',
      'mainCharacterName',
      'coverAssetId',
      'revision',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'archivedAt',
    ]);
    return {
      ...parseProtocol(value),
      id: parseId(value.id),
      title: parseTitle(value.title),
      genre: smallText(value.genre, 80),
      mainCharacterName: value.mainCharacterName === null ? null : smallText(value.mainCharacterName, 120),
      coverAssetId: nullableId(value.coverAssetId),
      ...lifecycle(value),
    };
  });
}
export function parseDraftPage(value: unknown): DraftPage {
  return safe(() => {
    fields(value, ['protocolVersion', 'datasetId', 'items', 'nextCursor', 'totalMatching']);
    const p = parseProtocol(value);
    if (
      !Array.isArray(value.items) ||
      value.items.length > 100 ||
      !Number.isSafeInteger(value.totalMatching) ||
      (value.totalMatching as number) < value.items.length ||
      (value.nextCursor !== null &&
        (typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor.length > 2048))
    )
      throw bad();
    const items = Array.from(value.items).map(parseDraftSummaryDTO);
    if (items.some((x) => x.datasetId !== p.datasetId) || new Set(items.map((x) => x.id)).size !== items.length)
      throw bad();
    return {...p, items, nextCursor: value.nextCursor as string | null, totalMatching: value.totalMatching as number};
  });
}
export function parseDraftCommandResult(value: unknown): DraftCommandResult {
  return safe(() => {
    fields(value, ['data', 'replayed']);
    if (typeof value.replayed !== 'boolean') throw bad();
    return {data: parseDraftDTO(value.data), replayed: value.replayed};
  });
}
