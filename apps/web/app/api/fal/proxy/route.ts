import {resolveVideoConfiguration} from '../../../../lib/video/catalog';
import type {NextRequest} from 'next/server';
import {createRouteHandler} from '@fal-ai/server-proxy/nextjs';
import {localAccess} from '../../../../lib/video/access';
export const runtime='nodejs';
const handlers=createRouteHandler({allowedEndpoints:['minimax/h3-max/director'],allowUnauthorizedRequests:false,isAuthenticated:async()=>true});
async function proxy(request:NextRequest){
 const config=resolveVideoConfiguration(process.env);
 if(!config.available||config.selection?.providerId!=='fal'||!localAccess(request,process.env))return Response.json({error:'实时接入仅在已配置的本地开发环境启用。'},{status:403});
 try{return await handlers.POST(request);}catch{return Response.json({error:'实时连接代理失败。'},{status:502});}
}
export {proxy as POST,proxy as GET,proxy as PUT};
