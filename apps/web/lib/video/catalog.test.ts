import {describe,it,expect} from 'vitest';
import {getDeployment,resolveVideoConfiguration} from './catalog';
import {videoConfigurationSchema} from '../../contracts/video';
describe('supplier-model deployment routing',()=>{
 it('separates supplier and model from endpoint',()=>{expect(getDeployment('fal','h3-max-director')).toMatchObject({providerId:'fal',modelId:'h3-max-director',endpoint:'minimax/h3-max/director',mode:'live'});});
 it('does not silently send MiniMax traffic to fal',()=>{expect(()=>getDeployment('minimax','h3-max-director')).toThrow();expect(getDeployment('minimax','minimax-h3').mode).toBe('job');expect(getDeployment('minimax','minimax-h3-max')).toMatchObject({endpoint:'MiniMax-H3-Max',mode:'job',adapter:'minimax-v2'});});
 it('requires explicit selection, not a hidden fal default',()=>{expect(resolveVideoConfiguration({}).available).toBe(false);expect(resolveVideoConfiguration({}).selection).toBeNull();});
 it('does not treat a task API as a live session',()=>{const result=resolveVideoConfiguration({VIDEO_PROVIDER:'minimax',VIDEO_MODEL:'minimax-h3',MINIMAX_API_KEY:'private'});expect(result.available).toBe(false);expect(result.reason).toBe('not-live');expect(JSON.stringify(result)).not.toContain('private');});
 it('shares Pollo identifiers with the runtime without marking job generation as streaming',()=>{
  const result=resolveVideoConfiguration({VIDEO_PROVIDER:'pollo',VIDEO_MODEL:'minimax-h3-max',POLLO_API_KEY:'private'});
  expect(videoConfigurationSchema.parse(result)).toEqual({available:false,selection:{providerId:'pollo',modelId:'minimax-h3-max'},reason:'not-live'});
  expect(getDeployment('pollo','minimax-h3-max')).toMatchObject({endpoint:'minimax-hailuo-03-max',adapter:'pollo-platform',mode:'job'});
  expect(JSON.stringify(result)).not.toContain('private');
 });
 it('requires the selected suppliers own credentials',()=>{const env={APP_ENV:'dev',NODE_ENV:'development',VIDEO_PROVIDER:'fal',VIDEO_MODEL:'h3-max-director',FAL_LOCAL_ENABLED:'true'};expect(resolveVideoConfiguration({...env,MINIMAX_API_KEY:'private'}).available).toBe(false);expect(resolveVideoConfiguration({...env,FAL_KEY:'private'}).available).toBe(true);expect(JSON.stringify(resolveVideoConfiguration({...env,FAL_KEY:'private'}))).not.toContain('private');});
 it.each(['demo','prod',undefined])('does not enable proxy metadata for %s',APP_ENV=>{expect(resolveVideoConfiguration({APP_ENV,NODE_ENV:'development',VIDEO_PROVIDER:'fal',VIDEO_MODEL:'h3-max-director',FAL_LOCAL_ENABLED:'true',FAL_KEY:'private'}).available).toBe(false);});
 it('fails closed in production and for unknown pairs',()=>{expect(resolveVideoConfiguration({VIDEO_PROVIDER:'anything',VIDEO_MODEL:'x'}).reason).toBe('unsupported');expect(resolveVideoConfiguration({NODE_ENV:'production',VIDEO_PROVIDER:'fal',VIDEO_MODEL:'h3-max-director',FAL_LOCAL_ENABLED:'true',FAL_KEY:'private'}).available).toBe(false);});
});
