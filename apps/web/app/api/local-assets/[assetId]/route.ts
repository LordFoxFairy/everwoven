import {handleAssetBytes} from '../../../../server/local-assets-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = async (request: Request, context: {params: Promise<{assetId: string}>}) =>
  handleAssetBytes(request, (await context.params).assetId, process.env);
export {handler as GET, handler as PUT, handler as POST, handler as DELETE, handler as PATCH, handler as HEAD, handler as OPTIONS};
