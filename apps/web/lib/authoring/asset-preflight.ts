import {validateImageFile, validateImageDimensions} from '../assets/validation';
import {AssetTransportError} from './asset-failure';
export function validateAssetSelection(file: File, rights: string): void {
  if (typeof rights !== 'string' || !rights.trim() || [...rights].length > 2000) throw new AssetTransportError('invalid');
  try {validateImageFile(file);} catch {throw new AssetTransportError(file.size > 10 * 1024 * 1024 ? 'tooLarge' : 'invalid');}
}
/** Feedback only; server independently hashes and decodes the original, unmodified File. */
export async function prepareAssetFile(file: File): Promise<{inputSha256: string; inputByteSize: string}> {
  let bitmap: ImageBitmap;
  try {bitmap = await createImageBitmap(file);} catch {throw new AssetTransportError('invalid');}
  try {validateImageDimensions(bitmap.width, bitmap.height);} catch {throw new AssetTransportError('invalid');} finally {bitmap.close();}
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw new AssetTransportError('invalid');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return {inputSha256: [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join(''), inputByteSize: String(bytes.byteLength)};
}
