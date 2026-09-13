import {fields, parseProtocol, parseId, parseRevision} from './story-draft-validation.js';
import {bindingLabel} from './provider-binding-validation.js';
import type {CreateExperience, ExperienceBudget, GetPreparingExperience} from './experience-opening.js';

const code = 'INVALID_EXPERIENCE_COMMAND';
export function parseBudget(v: unknown): ExperienceBudget {
  fields(v, ['limitMicros', 'currency'], [], code);
  if (typeof v.limitMicros !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(v.limitMicros) ||
    BigInt(v.limitMicros) > 9223372036854775807n || !['CNY', 'USD'].includes(v.currency as string)) throw Error(code);
  return {limitMicros: v.limitMicros, currency: v.currency as ExperienceBudget['currency']};
}
export function parseCreateExperience(value: unknown): CreateExperience {
  const protocol = parseProtocol(value);
  try {
    fields(value, ['protocolVersion', 'datasetId', 'commandId', 'storyDraftId', 'expectedStoryRevision', 'bindingKey', 'expectedBindingVersion', 'budget']);
    return {...protocol, commandId: parseId(value.commandId), storyDraftId: parseId(value.storyDraftId),
      expectedStoryRevision: parseRevision(value.expectedStoryRevision), bindingKey: bindingLabel(value.bindingKey),
      expectedBindingVersion: parseRevision(value.expectedBindingVersion), budget: parseBudget(value.budget)};
  } catch { throw Error(code); }
}
export function parseGetPreparingExperience(value: unknown): GetPreparingExperience {
  const protocol = parseProtocol(value);
  try {
    fields(value, ['protocolVersion', 'datasetId', 'id']);
    return {...protocol, id: parseId(value.id)};
  } catch { throw Error('INVALID_EXPERIENCE_QUERY'); }
}
