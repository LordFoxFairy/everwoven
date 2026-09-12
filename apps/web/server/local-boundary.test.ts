import {expect,it} from 'vitest';
import {localRuntimeConfig, guardLocalRequest} from './local-boundary';
const env={APP_ENV:'dev',APP_ORIGIN:'http://127.0.0.1:3198',RUNTIME_DATA_DIR:'/tmp/test-host',EVERWOVEN_LOCAL_LAUNCH:'loopback-v1'};
it('requires the dedicated local launcher and non-demo environment',()=>{
 expect(localRuntimeConfig({...env,EVERWOVEN_LOCAL_LAUNCH:undefined})).toBeNull();
 expect(localRuntimeConfig({...env,APP_ENV:'demo'})).toBeNull();
 expect(localRuntimeConfig({...env,APP_ORIGIN:'http://0.0.0.0:3198'})).toBeNull();
 expect(localRuntimeConfig({...env,APP_ORIGIN:'https://remote.example'})).toBeNull();
 expect(localRuntimeConfig(env)?.environment).toBe('dev');
});
it('requires origin and custom header for mutations, not just Host',()=>{
 const config=localRuntimeConfig(env)!;
 const request=(headers:Record<string,string>)=>new Request(env.APP_ORIGIN+'/api/local-session',{method:'POST',headers});
 expect(()=>guardLocalRequest(request({}),config)).toThrow();
 expect(()=>guardLocalRequest(request({origin:env.APP_ORIGIN}),config)).toThrow();
 expect(()=>guardLocalRequest(request({origin:'http://evil.example','x-everwoven-request':'1'}),config)).toThrow();
 expect(()=>guardLocalRequest(request({origin:env.APP_ORIGIN,'x-everwoven-request':'1'}),config)).not.toThrow();
});

it('rejects duplicate cookies rather than choosing an attacker-selected value',async()=>{
 const {sessionToken}=await import('./local-boundary');
 const token='a'.repeat(43);
 expect(sessionToken(new Request(env.APP_ORIGIN,{headers:{cookie:`everwoven_local=${token}`}}))).toBe(token);
 expect(sessionToken(new Request(env.APP_ORIGIN,{headers:{cookie:`everwoven_local=${token}; everwoven_local=${token}`}}))).toBe('');
});
it('bounds actual streamed bytes when no Content-Length is supplied',async()=>{
 const {boundedJSONRequest}=await import('./local-boundary');
 const request=new Request(env.APP_ORIGIN,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:'x'.repeat(1024)})});
 expect(request.headers.has('content-length')).toBe(false);
 await expect(boundedJSONRequest(request,1024)).rejects.toThrow('BODY_TOO_LARGE');
});
