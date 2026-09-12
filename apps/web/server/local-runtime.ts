import { TRPCError } from '@trpc/server';
import type {
  DraftCreate,
  DraftUpdate,
  DraftLifecycle,
  DraftListInput,
  DraftDTO,
  DraftPage,
  DraftCommandResult,
  InternalOwnerContext,
} from 'runtime/contracts/story-draft';
import { guardLocalRequest, localRuntimeConfig, sessionToken } from './local-boundary';
export type StoryService = {
  create(owner: InternalOwnerContext, input: DraftCreate): Promise<DraftCommandResult>;
  get(owner: InternalOwnerContext, id: string, includeDeleted?: boolean): Promise<DraftDTO>;
  list(owner: InternalOwnerContext, input?: DraftListInput): Promise<DraftPage>;
  update(owner: InternalOwnerContext, input: DraftUpdate): Promise<DraftCommandResult>;
  delete(owner: InternalOwnerContext, input: DraftLifecycle): Promise<DraftCommandResult>;
  restore(owner: InternalOwnerContext, input: DraftLifecycle): Promise<DraftCommandResult>;
};
export type WithStories = <T>(
  work: (stories: StoryService, owner: InternalOwnerContext) => Promise<T>,
) => Promise<T>;
export function localError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  const code = error instanceof Error ? error.message : '';
  if (['REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'STORY_NOT_DELETED'].includes(code))
    return new TRPCError({ code: 'CONFLICT', message: code });
  if (code === 'STORY_NOT_FOUND') return new TRPCError({ code: 'NOT_FOUND', message: 'STORY_NOT_FOUND' });
  if (code.startsWith('INVALID_STORY') || code === 'INVALID_CURSOR')
    return new TRPCError({ code: 'BAD_REQUEST', message: code });
  if (code === 'LOCAL_SESSION_INVALID')
    return new TRPCError({ code: 'UNAUTHORIZED', message: '本机会话已失效，请重新连接' });
  if (code === 'LOCAL_ORIGIN_DENIED') return new TRPCError({ code: 'FORBIDDEN', message: '来源不受信任' });
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '服务暂不可用' });
}
export function localStoryAccess(request: Request, env: Record<string, string | undefined>): WithStories {
  return async (work) => {
    const config = localRuntimeConfig(env),
      token = sessionToken(request);
    if (!config || !token) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先连接本机数据库' });
    try {
      guardLocalRequest(request, config);
    } catch (error) {
      throw localError(error);
    }
    try {
      // Host authenticates before opening the database and rechecks before work.
      const host = await import('runtime/host');
      return await host.withLocalStories(config.directory, config.environment, token, work);
    } catch (error) {
      throw localError(error);
    }
  };
}
