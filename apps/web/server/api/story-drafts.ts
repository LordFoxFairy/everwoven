import { localError } from '../local-runtime';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { parseCreate, parseUpdate, parseLifecycle } from 'runtime/contracts/story-draft-validation';
import type { DraftCreate, DraftUpdate, DraftLifecycle } from 'runtime/contracts/story-draft';
import { createTRPCRouter, publicMetadataProcedure } from './trpc';
const storyProcedure = publicMetadataProcedure.use(async ({ ctx, next }) => {
  if (!ctx.withStories) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先连接本机数据库' });
  // Keep transport errors outside the host callback; the host sanitizes domain failures.
  const result = await ctx.withStories((stories, owner) => next({ ctx: { ...ctx, stories, owner } }));
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
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_STORY_COMMAND' });
  }
}
export const storyDraftRouter = createTRPCRouter({
  create: storyProcedure
    .input((value: unknown) => parse<DraftCreate>(parseCreate, value))
    .mutation(({ ctx, input }) => ctx.stories.create(ctx.owner, input)),
  update: storyProcedure
    .input((value: unknown) => parse<DraftUpdate>(parseUpdate, value))
    .mutation(({ ctx, input }) => ctx.stories.update(ctx.owner, input)),
  delete: storyProcedure
    .input((value: unknown) => parse<DraftLifecycle>(parseLifecycle, value))
    .mutation(({ ctx, input }) => ctx.stories.delete(ctx.owner, input)),
  restore: storyProcedure
    .input((value: unknown) => parse<DraftLifecycle>(parseLifecycle, value))
    .mutation(({ ctx, input }) => ctx.stories.restore(ctx.owner, input)),
  get: storyProcedure
    .input(z.object({ id, includeDeleted: z.boolean().optional() }).strict())
    .query(({ ctx, input }) => ctx.stories.get(ctx.owner, input.id, input.includeDeleted)),
  list: storyProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          deleted: z.enum(['exclude', 'only']).optional(),
          cursor: z.string().max(2048).optional(),
        })
        .strict()
        .optional(),
    )
    .query(({ ctx, input }) => ctx.stories.list(ctx.owner, input)),
});
