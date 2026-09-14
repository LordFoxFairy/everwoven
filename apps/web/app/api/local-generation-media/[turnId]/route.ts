import {handleGenerationMedia} from '../../../../server/local-generation-media-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = async (request: Request, context: {params: Promise<{turnId: string}>}) =>
  handleGenerationMedia(request, (await context.params).turnId, process.env);
export {handler as GET, handler as HEAD, handler as POST, handler as PUT, handler as DELETE, handler as PATCH, handler as OPTIONS};
