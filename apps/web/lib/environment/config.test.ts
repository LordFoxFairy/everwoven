import {expect,it} from 'vitest';
import {resolveAppEnvironment,libraryStorageKey,assetDatabaseName} from './config';
it('defaults to demo independently of NODE_ENV and keys',()=>{
 expect(resolveAppEnvironment({NODE_ENV:'production',MINIMAX_API_KEY:'test-secret'})).toBe('demo');
});
it.each(['demo','dev','prod'] as const)('accepts explicit %s',APP_ENV=>{
 expect(resolveAppEnvironment({APP_ENV,NODE_ENV:'production'})).toBe(APP_ENV);
});
it.each(['','production','staging','DEMO','dev '])('rejects invalid %s without echoing values',APP_ENV=>{
 expect(()=>resolveAppEnvironment({APP_ENV})).toThrow('APP_ENV must be demo, dev, or prod');
});
it('preserves demo keys and separates dev/prod namespaces',()=>{
 expect(libraryStorageKey('demo')).toBe('weiwan.prototype.v1');
 expect(assetDatabaseName('demo')).toBe('weiwan-assets-v1');
 expect(new Set((['demo','dev','prod'] as const).map(libraryStorageKey)).size).toBe(3);
 expect(new Set((['demo','dev','prod'] as const).map(assetDatabaseName)).size).toBe(3);
});
