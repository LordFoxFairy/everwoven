import {handleTRPCRequest} from '../../../../server/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = (request: Request) => handleTRPCRequest(request, process.env);
export {handler as GET, handler as POST};
