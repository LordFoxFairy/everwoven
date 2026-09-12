import {expect, it} from 'vitest';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createImageNormalizer} from '../src/infrastructure/media/sharp-image-normalizer.js';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function subject(){const mod=await import('../src/infrastructure/media/private-asset-verifier.js').catch(()=>null);expect(mod).not.toBeNull();return mod!;}
async function fixture(){const bytes=await sharp({create:{width:2048,height:66,channels:3,background:'blue'}}).webp().toBuffer();return {bytes,expected:{mimeType:'image/webp' as const,sha256:hash(bytes),byteSize:String(bytes.length),width:2048,height:66}};}
it('verifies all pixels without reencoding or applying the input minimum edge',async()=>{const {verifyNormalizedImage}=await subject(),{bytes,expected}=await fixture();const result=await verifyNormalizedImage(bytes,expected);expect(result.bytes).toBeInstanceOf(Buffer);expect(result.bytes).toEqual(bytes);expect(result.metadata).toEqual(expected);});
it.each(['width','height','sha256','byteSize'])('rejects a false expected %s',async field=>{const {verifyNormalizedImage}=await subject(),{bytes,expected}=await fixture();await expect(verifyNormalizedImage(bytes,{...expected,[field]:field==='sha256'?'a'.repeat(64):field==='byteSize'?'1':1})).rejects.toBeTruthy();});
it('shares two actual decoder slots with the normalizer in both directions',async()=>{
 const {verifyNormalizedImage}=await subject(),{bytes,expected}=await fixture(),input=await sharp({create:{width:256,height:256,channels:3,background:'red'}}).png().toBuffer();const normalizer=createImageNormalizer(),metadata={inputSha256:hash(input),inputByteSize:String(input.length)};
 const first=normalizer.normalize(input,metadata),second=normalizer.normalize(input,metadata);await expect(verifyNormalizedImage(bytes,expected)).rejects.toMatchObject({code:'IMAGE_DECODER_BUSY'});await Promise.all([first,second]);
 const a=verifyNormalizedImage(bytes,expected),b=verifyNormalizedImage(bytes,expected);await expect(normalizer.normalize(input,metadata)).rejects.toMatchObject({code:'IMAGE_DECODER_BUSY'});await Promise.all([a,b]);expect((await verifyNormalizedImage(bytes,expected)).bytes).toEqual(bytes);
});
it('rejects damaged pixel payload with readable dimensions and consistent RIFF framing',async()=>{
 const {verifyNormalizedImage}=await subject();const raw=Buffer.alloc(320*64*3);let seed=9;for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=seed>>>24;}
 const good=await sharp(raw,{raw:{width:320,height:64,channels:3}}).webp().toBuffer();expect(good.toString('ascii',12,16)).toBe('VP8 ');const bytes=Buffer.from(good.subarray(0,Math.floor(good.length/4)*2));bytes.writeUInt32LE(bytes.length-8,4);bytes.writeUInt32LE(bytes.length-20,16);expect((await sharp(bytes).metadata()).width).toBe(320);
 await expect(verifyNormalizedImage(bytes,{mimeType:'image/webp',sha256:hash(bytes),byteSize:String(bytes.length),width:320,height:64})).rejects.toMatchObject({code:'INVALID_IMAGE_DATA',message:'INVALID_IMAGE_DATA'});
});
it('rejects actual animated output and releases capacity for subsequent verification',async()=>{
 const {verifyNormalizedImage}=await subject();const raw=Buffer.alloc(256*512*3,255);raw.fill(0,0,256*256*3);const bytes=await sharp(raw,{raw:{width:256,height:512,channels:3,pageHeight:256}}).webp({loop:0,delay:[100,100]}).toBuffer();expect((await sharp(bytes).metadata()).pages).toBe(2);
 await expect(verifyNormalizedImage(bytes,{mimeType:'image/webp',sha256:hash(bytes),byteSize:String(bytes.length),width:256,height:256})).rejects.toMatchObject({code:'IMAGE_ANIMATED'});const good=await fixture();expect((await verifyNormalizedImage(good.bytes,good.expected)).metadata).toEqual(good.expected);
});
it('snapshots the caller-owned output and expectation',async()=>{
 const {verifyNormalizedImage}=await subject(),{bytes,expected}=await fixture(),original=Buffer.from(bytes),metadata={...expected};const pending=verifyNormalizedImage(bytes,metadata);bytes.fill(0);metadata.width=1;const result=await pending;expect(result.bytes).toEqual(original);expect(result.metadata).toEqual(expected);
});
