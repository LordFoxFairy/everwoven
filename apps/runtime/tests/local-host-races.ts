import {lstat, open, type FileHandle} from 'node:fs/promises';
import {vi} from 'vitest';

/** Deterministic pause after the real open and before the real fstat result. No fabricated Stats. */
export async function raceOpenedFile<T>(path: string, race: (attempt: number) => Promise<void>, work: () => Promise<T>) {
  const probe = await open(path, 'r'), prototype = Object.getPrototypeOf(probe);
  const original: FileHandle['stat'] = prototype.stat;
  await probe.close();
  let attempts = 0;
  const handles: FileHandle[] = [];
  const spy = vi.spyOn(prototype, 'stat').mockImplementation(async function (this: FileHandle) {
    const before = await original.call(this);
    const entry = await lstat(path).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
    if (entry && before.dev === entry.dev && before.ino === entry.ino) {
      handles.push(this); await race(++attempts);
      return original.call(this);
    }
    return before;
  });
  try {return {result: await work(), attempts, handles};}
  finally {spy.mockRestore();}
}
