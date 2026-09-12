import { localError } from '../local-runtime';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { parseCreate, parseUpdate, parseLifecycle } from 'runtime/contracts/character-template-validation';
import type { CharacterCreate, CharacterUpdate, CharacterLifecycle } from 'runtime/contracts/character-template';
import { createTRPCRouter, publicMetadataProcedure } from './trpc';
const characterProcedure = publicMetadataProcedure.use(async ({ ctx, next }) => {
  if (!ctx.withCharacters) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先连接本机数据库' });
  // Keep transport errors outside the host callback; the host sanitizes domain failures.
  const result = await ctx.withCharacters((characters, owner) => next({ ctx: { ...ctx, characters, owner } }));
  if (!result.ok)
    throw result.error.code === 'INTERNAL_SERVER_ERROR'
      ? localError(result.error.cause ?? result.error)
      : result.error;
  return result;
});
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
function parse<T>(fn: (value: T) => T, value: unknown): T {
  try {
    return fn(value as T);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_CHARACTER_COMMAND' });
  }
}
export const characterRouter = createTRPCRouter({
  create: characterProcedure
    .input((value: unknown) => parse<CharacterCreate>(parseCreate, value))
    .mutation(({ ctx, input }) => ctx.characters.create(ctx.owner, input)),
  update: characterProcedure
    .input((value: unknown) => parse<CharacterUpdate>(parseUpdate, value))
    .mutation(({ ctx, input }) => ctx.characters.update(ctx.owner, input)),
  delete: characterProcedure
    .input((value: unknown) => parse<CharacterLifecycle>(parseLifecycle, value))
    .mutation(({ ctx, input }) => ctx.characters.delete(ctx.owner, input)),
  restore: characterProcedure
    .input((value: unknown) => parse<CharacterLifecycle>(parseLifecycle, value))
    .mutation(({ ctx, input }) => ctx.characters.restore(ctx.owner, input)),
  get: characterProcedure
    .input(z.object({ id, includeDeleted: z.boolean().optional() }).strict())
    .query(({ ctx, input }) => ctx.characters.get(ctx.owner, input.id, input.includeDeleted)),
  list: characterProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          deleted: z.enum(['exclude', 'only']).optional(),
          cursor: z.string().max(2048).optional(),
          q: z.string().refine(value => [...value].length <= 120).optional(),
        })
        .strict()
        .optional(),
    )
    .query(({ ctx, input }) => ctx.characters.list(ctx.owner, input)),
});
