import {handleAssetUpload} from '../../../../../server/local-assets-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = async (request: Request, context: {params: Promise<{uploadId: string}>}) =>
  handleAssetUpload(request, (await context.params).uploadId, process.env);
export {handler as PUT, handler as GET, handler as POST, handler as DELETE, handler as PATCH, handler as HEAD, handler as OPTIONS};
