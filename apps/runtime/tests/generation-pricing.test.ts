import {describe,it,expect} from 'vitest';
import {calculateGenerationCost} from '../src/application/generation-pricing.js';
import type {StagePrice} from '../src/ports/generation-policy.js';
const rate:StagePrice={version:'official-test-v1',bindingHash:'a'.repeat(64),validUntil:'2099-01-01T00:00:00.000Z',currency:'USD',inputTokenMicros:'2',outputTokenMicros:'5',perTokens:'3',outputSecondMicros:'80000',inputImageMicros:'100',complete:true,adapterReady:true};
describe('generation cost upper bound',()=>{
 it('rounds each per-call token meter up and includes every permitted call',()=>{
  expect(calculateGenerationCost(rate,{kind:'text',inputTokens:4,outputTokens:4,maxCalls:2},'USD',new Date())).toBe(20n);
 });
 it('counts image input and output seconds separately without losing integer precision',()=>{
  expect(calculateGenerationCost({...rate,outputSecondMicros:'9007199254740993'},{kind:'video',seconds:5,images:2,maxCalls:1},'USD',new Date())).toBe(45035996273705165n);
 });
 it.each([{complete:false},{adapterReady:false},{currency:'CNY'},{validUntil:'2000-01-01T00:00:00.000Z'},{perTokens:'0'},{inputTokenMicros:'1.2'},{outputSecondMicros:undefined}])('rejects absent/unknown/invalid evidence %#',patch=>{
  expect(()=>calculateGenerationCost({...rate,...patch} as StagePrice,{kind:'video',seconds:5,images:0,maxCalls:1},'USD',new Date())).toThrow('GENERATION_PRICE_UNAVAILABLE');
 });
});
