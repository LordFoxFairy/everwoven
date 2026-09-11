/** Public deployment enum only. Never serialize process.env to the browser. */
export type AppEnvironment = 'demo' | 'dev' | 'prod';
export function resolveAppEnvironment(env: Record<string,string|undefined>): AppEnvironment {
 const value=env.APP_ENV ?? 'demo';
 if(value!=='demo'&&value!=='dev'&&value!=='prod')throw Error('APP_ENV must be demo, dev, or prod');
 return value;
}
export function libraryStorageKey(environment:AppEnvironment){return environment==='demo'?'weiwan.prototype.v1':`everwoven.${environment}.library.v1`;}
export function assetDatabaseName(environment:AppEnvironment){return environment==='demo'?'weiwan-assets-v1':`everwoven-${environment}-assets-v1`;}
