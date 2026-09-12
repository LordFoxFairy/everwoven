import {expect,it} from 'vitest';
import {handleTRPCRequest} from './http';
import {localError} from '../local-runtime';

it('registers character reads behind authentication without configured storage',async()=>{
 const response=await handleTRPCRequest(new Request('http://127.0.0.1:3100/api/trpc/characters.list'),{});
 expect(response.status).toBe(401);
 expect(await response.text()).not.toContain('Prisma');
});
it('rejects character writes without the explicit same-origin request marker',async()=>{
 const response=await handleTRPCRequest(new Request('http://127.0.0.1:3100/api/trpc/characters.create',{method:'POST',headers:{origin:'http://127.0.0.1:3100','content-type':'application/json'},body:'{}'}),{});
 expect(response.status).toBe(403);
});
it.each([
 ['CHARACTER_NOT_FOUND','NOT_FOUND'],
 ['CHARACTER_NOT_DELETED','CONFLICT'],
 ['INVALID_CHARACTER_COMMAND','BAD_REQUEST'],
 ['INVALID_CHARACTER_SETTINGS','BAD_REQUEST'],
] as const)('maps %s to its public domain code', (message,code)=>{
 expect(localError(new Error(message))).toMatchObject({message,code});
});
it('sanitizes private character database failures',()=>{
 expect(localError(new Error('/private/characters.db constraint failed'))).toMatchObject({code:'INTERNAL_SERVER_ERROR',message:'服务暂不可用'});
});
