import {handleLocalSession} from '../../../server/local-session';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handler=(request:Request)=>handleLocalSession(request,process.env);
export {handler as GET,handler as POST,handler as DELETE};
