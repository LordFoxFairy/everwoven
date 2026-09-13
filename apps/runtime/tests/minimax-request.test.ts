import {describe,it,expect} from 'vitest';
import {buildMiniMaxRequest,type MiniMaxRequestInput} from '../src/providers/minimax-request.js';
const input:MiniMaxRequestInput={model:'MiniMax-H3-Max',prompt:'在用户设定的世界里回应本次行动',resolution:'480P',duration:5};
describe('official video request contract',()=>{
 it('defaults text generation to desktop landscape',()=>{
  expect(buildMiniMaxRequest(input)).toEqual({model:'MiniMax-H3-Max',content:[{type:'text',text:input.prompt}],resolution:'480P',duration:5,ratio:'16:9'});
 });
 it('preserves explicitly supported wide ratios',()=>{
  expect(buildMiniMaxRequest({...input,ratio:'21:9'}).ratio).toBe('21:9');
 });
 it('uses image-defined composition explicitly for first/last frames',()=>{
  const result=buildMiniMaxRequest({...input,frames:{first:'https://assets.example/first.png',last:'https://assets.example/last.png'}});
  expect(result.ratio).toBe('adaptive');
  expect(result.content).toHaveLength(3);
  expect(result.content[1]).toMatchObject({type:'image_url',role:'first_frame',image_url:{url:'https://assets.example/first.png'}});
 });
 it('does not silently promise landscape output when a frame fixes composition',()=>{
  expect(()=>buildMiniMaxRequest({...input,ratio:'16:9',frames:{first:'https://assets.example/first.png'}})).toThrow();
 });
 it.each([
  {model:'MiniMax-H3',resolution:'480P'},
  {model:'MiniMax-H3-Max',resolution:'2K'},
  {duration:4},{duration:16},{duration:5.5},{duration:NaN},
  {prompt:'  '},{prompt:'字'.repeat(7001)},{ratio:'adaptive'},{ratio:'16:10'},
  {frames:{}},{frames:{reference:'https://assets.example/portrait.png'}},
  {frames:{first:'blob:local-image'}},{frames:{first:'data:image/png;base64,AAAA'}},
  {frames:{first:'http://assets.example/image.png'}},
  {frames:{first:'https://user:password@assets.example/image.png'}},
  {model:'h3-max-director'},
 ])('rejects invalid or unsupported input before spending: %j',change=>{
  expect(()=>buildMiniMaxRequest({...input,...change} as MiniMaxRequestInput)).toThrow();
 });
 it('accepts standard H3 four-second 2K input without substituting a model',()=>{
  expect(buildMiniMaxRequest({...input,model:'MiniMax-H3',resolution:'2K',duration:4}).model).toBe('MiniMax-H3');
 });
 it('rejects overlong frame locators before parsing or returning a request',()=>{
  expect(()=>buildMiniMaxRequest({...input,frames:{first:'https://media.example/?x='+'a'.repeat(65536)}})).toThrow();
 });
 it('counts multibyte URL size rather than only UTF-16 length',()=>{
  expect(()=>buildMiniMaxRequest({...input,frames:{first:'https://media.example/?x='+'界'.repeat(3000)}})).toThrow();
  expect(buildMiniMaxRequest({...input,frames:{first:'https://media.example/?x='+'界'.repeat(2000)}}).content).toHaveLength(2);
 });
 it('bounds escaped JSON for both frames plus prompt, not just each field separately',()=>{
  const url='https://media.example/?x='+'"'.repeat(8100);
  expect(()=>buildMiniMaxRequest({...input,prompt:'\u0001'.repeat(7000),frames:{first:url,last:url}})).toThrow();
  const body=buildMiniMaxRequest({...input,prompt:'界'.repeat(7000),frames:{first:'https://media.example/a',last:'https://media.example/b'}});
  expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(65536);
 });
});
