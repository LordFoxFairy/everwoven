import {parseGetGenerationMedia, type GetGenerationMedia} from 'runtime/contracts/generation-media';
/** Same-origin, session-cookie media reads. No provider URL or credential enters the stage. */
export function generationMediaURL(input: GetGenerationMedia): string {
  const {turnId, ...params} = parseGetGenerationMedia(input);
  return `/api/local-generation-media/${turnId}?${new URLSearchParams(params)}`;
}
