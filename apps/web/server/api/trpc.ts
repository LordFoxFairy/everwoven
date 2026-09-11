import {initTRPC} from '@trpc/server';

export type APIContext = {env: Record<string, string | undefined>};
const t = initTRPC.context<APIContext>().create({
  errorFormatter({shape}) {
    const {stack: _stack, ...data} = shape.data;
    return {...shape, message: data.code === 'INTERNAL_SERVER_ERROR' ? '服务暂不可用' : shape.message, data};
  },
});
export const createTRPCRouter = t.router;
// Only non-sensitive read-only metadata may use this procedure.
// Authenticated business procedures will be added after local session bootstrap.
export const publicMetadataProcedure = t.procedure;
