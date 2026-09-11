/** Local development only. Production needs authenticated ownership, quotas and rate limits. */
export function localAccess(request:Request,env:{APP_ENV?:string;NODE_ENV?:string;FAL_LOCAL_ENABLED?:string;FAL_KEY?:string}):boolean{
 const url=new URL(request.url);
 return env.APP_ENV==='dev'&&env.NODE_ENV==='development'&&env.FAL_LOCAL_ENABLED==='true'&&Boolean(env.FAL_KEY)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&request.headers.get('origin')===url.origin;
}
