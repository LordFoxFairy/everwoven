import {resolveVideoConfiguration} from '../../lib/video/catalog';
import {videoConfigurationSchema} from '../../contracts/video';

export function readVideoConfiguration(env: Record<string, string | undefined>) {
  return videoConfigurationSchema.parse(resolveVideoConfiguration(env));
}
