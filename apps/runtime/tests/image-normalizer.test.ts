import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import sharp from 'sharp';
import {afterEach, describe, expect, it, vi} from 'vitest';
afterEach(()=>vi.restoreAllMocks());

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const expected=(bytes:Uint8Array)=>({inputSha256:hash(bytes),inputByteSize:String(bytes.byteLength)});
async function normalizer(options?:{timeoutMs:number}){const m=await import('../src/infrastructure/media/sharp-image-normalizer.js').catch(()=>null);expect(m,'real normalizer must exist').not.toBeNull();return m!.createImageNormalizer(options);}
const picture=(width=320,height=256)=>sharp({create:{width,height,channels:4,background:{r:120,g:70,b:210,alpha:0.7}}});
function chunk(type:string,data:Buffer){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([name,data])),data.length+8);return out;}
function chunks(png:Buffer){const result:{type:string;data:Buffer}[]=[];for(let at=8;at<png.length;){const length=png.readUInt32BE(at);result.push({type:png.toString('ascii',at+4,at+8),data:png.subarray(at+8,at+8+length)});at+=length+12;}return result;}
function rebuild(parts:{type:string;data:Buffer}[]){return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),...parts.map(p=>chunk(p.type,p.data))]);}
function frameControl(sequence:number){const bytes=Buffer.alloc(26);bytes.writeUInt32BE(sequence);bytes.writeUInt32BE(320,4);bytes.writeUInt32BE(256,8);bytes.writeUInt16BE(1,20);bytes.writeUInt16BE(10,22);return bytes;}

it('pins sharp as a direct runtime dependency at the approved exact version',async()=>{
 const {readFileSync}=await import('node:fs');const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));expect(pkg.dependencies.sharp).toBe('0.35.4');expect(sharp.versions.sharp).toBe('0.35.4');
});
describe('real bytes-only static image normalization',()=>{
 it.each(['jpeg','png','webp'] as const)('fully decodes %s into deterministic metadata-free WebP',async format=>{
  const n=await normalizer(),input=await picture().toFormat(format).toBuffer();const result=await n.normalize(input,expected(input)),again=await n.normalize(input,expected(input));
  expect(Buffer.compare(Buffer.from(result.bytes),Buffer.from(again.bytes))).toBe(0);expect(result).toMatchObject({mimeType:'image/webp',width:320,height:256,sha256:hash(result.bytes),byteSize:String(result.bytes.byteLength)});
  const decoded=await sharp(result.bytes).raw().toBuffer({resolveWithObject:true});expect(decoded.info).toMatchObject({width:320,height:256});expect(decoded.data.length).toBe(320*256*decoded.info.channels);const meta=await sharp(result.bytes).metadata();expect(meta.format).toBe('webp');expect(meta.pages??1).toBe(1);expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();
 });
 it('honors EXIF orientation in pixels, strips private metadata and never enlarges',async()=>{
  const raw=Buffer.alloc(512*256*3);for(let y=0;y<256;y++)for(let x=0;x<512;x++)raw[(y*512+x)*3+(x<256?0:2)]=255;
  const input=await sharp(raw,{raw:{width:512,height:256,channels:3}}).withExif({IFD0:{Artist:'fixture-only'}}).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">fixture-only</x:xmpmeta>').withMetadata({orientation:6}).jpeg().toBuffer();
  expect((await sharp(input).metadata()).orientation).toBe(6);const n=await normalizer(),out=await n.normalize(input,expected(input));expect(out).toMatchObject({width:256,height:512});const meta=await sharp(out.bytes).metadata();for(const key of ['orientation','exif','icc','xmp','iptc'] as const)expect(meta[key]).toBeUndefined();
  const pixels=await sharp(out.bytes).removeAlpha().raw().toBuffer();expect(pixels[(20*256+128)*3]).toBeGreaterThan(200);expect(pixels[(480*256+128)*3+2]).toBeGreaterThan(200);
 });
 it.each([[256,256],[8000,256],[6000,4000]])('accepts input boundary %s x %s and preserves aspect ratio within 2048',async(width,height)=>{
  const n=await normalizer(),input=await picture(width,height).png().toBuffer(),out=await n.normalize(input,expected(input));const scale=Math.min(1,2048/Math.max(width,height));expect(out.width).toBe(Math.round(width*scale));expect(out.height).toBe(Math.round(height*scale));expect(out.bytes.byteLength).toBeLessThanOrEqual(10*1024*1024);
 });
 it.each([[255,256],[256,255],[8001,256],[256,8001],[6001,4000]])('rejects dimension/pixel budget %s x %s',async(width,height)=>{
  const n=await normalizer(),input=await picture(width,height).png().toBuffer();await expect(n.normalize(input,expected(input))).rejects.toMatchObject({code:'IMAGE_DIMENSIONS_INVALID',message:'IMAGE_DIMENSIONS_INVALID'});
 });
 it('accepts an isolated Uint8Array view and snapshots caller-owned bytes before awaiting',async()=>{
  const n=await normalizer(),png=await picture().png().toBuffer(),wrapped=Buffer.concat([Buffer.from('prefix'),png,Buffer.from('suffix')]),view=new Uint8Array(wrapped.buffer,wrapped.byteOffset+6,png.length),metadata=expected(view);const work=n.normalize(view,metadata);view.fill(0);expect((await work).width).toBe(320);
 });
 it.each(['https://example.invalid/private.png','/private/image.png',new ArrayBuffer(4),[],null,{path:'secret'}])('rejects non-byte inputs without fetching or opening %#',async value=>{
  const n=await normalizer();await expect(n.normalize(value as unknown as Uint8Array,{inputSha256:'a'.repeat(64),inputByteSize:'4'})).rejects.toMatchObject({code:'INVALID_IMAGE_INPUT',message:'INVALID_IMAGE_INPUT'});
 });
 it('checks actual byte count/hash and rejects oversize before decoder admission',async()=>{
  const n=await normalizer(),input=await picture().png().toBuffer();await expect(n.normalize(input,{...expected(input),inputSha256:'f'.repeat(64)})).rejects.toMatchObject({code:'IMAGE_HASH_MISMATCH'});await expect(n.normalize(input,{...expected(input),inputByteSize:String(input.length+1)})).rejects.toMatchObject({code:'IMAGE_SIZE_MISMATCH'});
  await expect(n.normalize(Buffer.alloc(10*1024*1024+1),{inputSha256:'a'.repeat(64),inputByteSize:'10485760'})).rejects.toMatchObject({code:'IMAGE_TOO_LARGE'});await expect(n.normalize(input,{...expected(input),inputByteSize:input.length} as never)).rejects.toMatchObject({code:'INVALID_IMAGE_INPUT'});
 });
 it.each(['<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>','GIF89a','not an image'])('rejects unsupported magic rather than guessing from metadata %#',async text=>{
  const n=await normalizer(),input=Buffer.from(text);await expect(n.normalize(input,expected(input))).rejects.toMatchObject({code:'UNSUPPORTED_IMAGE_FORMAT'});
 });
 it.each(['jpeg','png','webp'] as const)('rejects truncated %s including containers with readable headers',async format=>{
  const n=await normalizer(),valid=await picture().toFormat(format).toBuffer(),input=valid.subarray(0,valid.length-8);await expect(n.normalize(input,expected(input))).rejects.toMatchObject({code:'INVALID_IMAGE_DATA',message:'INVALID_IMAGE_DATA'});
 });
 it('rejects entropy damage after a valid JPEG header instead of trusting metadata or shrink-on-load',async()=>{
  const raw=Buffer.alloc(512*512*3);let seed=7;for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=seed>>>24;}
  const jpeg=await sharp(raw,{raw:{width:512,height:512,channels:3}}).jpeg().toBuffer(),input=Buffer.concat([jpeg.subarray(0,Math.floor(jpeg.length/2)),Buffer.from([255,217])]);expect((await sharp(input).metadata()).width).toBe(512);const n=await normalizer();await expect(n.normalize(input,expected(input))).rejects.toMatchObject({code:'INVALID_IMAGE_DATA'});
 });
 it('rejects damaged PNG pixels even when container CRCs and metadata are valid',async()=>{
  const valid=await picture().png().toBuffer(),input=rebuild(chunks(valid).map(p=>p.type==='IDAT'?{...p,data:Buffer.alloc(p.data.length,255)}:p));expect((await sharp(input).metadata()).width).toBe(320);const n=await normalizer();await expect(n.normalize(input,expected(input))).rejects.toMatchObject({code:'INVALID_IMAGE_DATA'});
 });
 it('rejects APNG controls, including formats a single-page decoder might silently flatten',async()=>{
  const png=await picture().png().toBuffer(),parts=chunks(png),idat=Buffer.concat(parts.filter(p=>p.type==='IDAT').map(p=>p.data)),control=Buffer.alloc(8);control.writeUInt32BE(2);const frame=Buffer.alloc(4);frame.writeUInt32BE(2);
  const input=rebuild([parts[0]!,{type:'acTL',data:control},{type:'fcTL',data:frameControl(0)},{type:'IDAT',data:idat},{type:'fcTL',data:frameControl(1)},{type:'fdAT',data:Buffer.concat([frame,idat])},{type:'IEND',data:Buffer.alloc(0)}]);const n=await normalizer();await expect(n.normalize(input,expected(input))).rejects.toMatchObject({code:'IMAGE_ANIMATED'});
 });
 it('rejects genuine animated WebP and multi-page TIFF',async()=>{
  const pixels=Buffer.alloc(256*512*4,255);pixels.fill(20,0,256*256*4);const pipeline=()=>sharp(pixels,{raw:{width:256,height:512,channels:4,pageHeight:256}});const webp=await pipeline().webp({loop:0,delay:[100,100]}).toBuffer();expect((await sharp(webp).metadata()).pages).toBe(2);const n=await normalizer();await expect(n.normalize(webp,expected(webp))).rejects.toMatchObject({code:'IMAGE_ANIMATED'});const tiff=await pipeline().tiff().toBuffer();await expect(n.normalize(tiff,expected(tiff))).rejects.toMatchObject({code:'UNSUPPORTED_IMAGE_FORMAT'});
 });
 it('rejects concatenated JPEG pictures and JPEG multi-picture metadata',async()=>{
  const n=await normalizer(),jpeg=await picture().jpeg().toBuffer(),joined=Buffer.concat([jpeg,jpeg]);await expect(n.normalize(joined,expected(joined))).rejects.toMatchObject({code:'INVALID_IMAGE_DATA'});
  const mpf=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,226,0,10]),Buffer.from('MPF\0abcd','binary'),jpeg.subarray(2)]);await expect(n.normalize(mpf,expected(mpf))).rejects.toMatchObject({code:'IMAGE_ANIMATED'});
 });
 it('shares a two-decoder budget across instances and rejects the third instead of queueing',async()=>{
  const a=await normalizer(),b=await normalizer(),input=await picture(2048,2048).png().toBuffer(),metadata=expected(input);const first=a.normalize(input,metadata),second=b.normalize(input,metadata);await expect(a.normalize(input,metadata)).rejects.toMatchObject({code:'IMAGE_DECODER_BUSY'});await Promise.all([first,second]);expect((await a.normalize(input,metadata)).width).toBe(2048);
 });
 it('returns only fixed public decoder errors and releases slots after actual rejection',async()=>{
  const n=await normalizer(),bad=Buffer.from([255,216,255,224,0,2,255,217]);const results=await Promise.allSettled([n.normalize(bad,expected(bad)),n.normalize(bad,expected(bad))]);for(const result of results){expect(result.status).toBe('rejected');if(result.status==='rejected'){expect(result.reason.message).toBe('INVALID_IMAGE_DATA');expect(result.reason.cause).toBeUndefined();}}
  const good=await picture().png().toBuffer();expect((await n.normalize(good,expected(good))).width).toBe(320);
 });
});

it('accepts a valid JPEG exactly at ten MiB without treating metadata padding as pixels',async()=>{
 const base=await picture().jpeg().toBuffer(),remaining=10*1024*1024-base.length,count=Math.ceil(remaining/65537),segments:Buffer[]=[];let rest=remaining;
 for(let i=0;i<count;i++){const size=Math.floor(rest/(count-i)),segment=Buffer.alloc(size);segment[0]=255;segment[1]=239;segment.writeUInt16BE(size-2,2);segments.push(segment);rest-=size;}
 const bytes=Buffer.concat([base.subarray(0,2),...segments,base.subarray(2)]);expect(bytes.length).toBe(10*1024*1024);const n=await normalizer();expect((await n.normalize(bytes,expected(bytes))).width).toBe(320);
});
it('attaches finite native sharp timeouts to the full decode and encoder, without mutating global concurrency',async()=>{
 const input=await picture().png().toBuffer(),native=vi.spyOn(sharp.prototype,'timeout'),global=vi.spyOn(sharp,'concurrency');const n=await normalizer();await n.normalize(input,expected(input));
 expect(native).toHaveBeenCalledTimes(2);for(const [options] of native.mock.calls){const seconds=(options as {seconds:number}).seconds;expect(seconds).toBeGreaterThanOrEqual(1);expect(seconds).toBeLessThanOrEqual(10);}expect(global).not.toHaveBeenCalled();
});
it('a short real processing deadline rejects safely and waits for native work to settle before later jobs',async()=>{
 const input=await picture(6000,4000).png().toBuffer(),originalMetadata=sharp.prototype.metadata,originalBuffer=sharp.prototype.toBuffer;
 const completions:Promise<unknown>[]=[];
 // Observe real native promises; no substituted pixels, metadata or decoder success.
 vi.spyOn(sharp.prototype,'metadata').mockImplementation(function(this:ReturnType<typeof sharp>){const work=originalMetadata.call(this);completions.push(work.catch(()=>{}));return work;} as typeof originalMetadata);
 vi.spyOn(sharp.prototype,'toBuffer').mockImplementation(function(this:ReturnType<typeof sharp>,options:unknown){const work=originalBuffer.call(this,options as {resolveWithObject:true});completions.push(work.catch(()=>{}));return work;} as typeof originalBuffer);
 const short=await normalizer({timeoutMs:1});await expect(short.normalize(input,expected(input))).rejects.toMatchObject({code:'IMAGE_PROCESSING_TIMEOUT',message:'IMAGE_PROCESSING_TIMEOUT'});await Promise.all(completions);await Promise.resolve();
 const regular=await normalizer();expect((await regular.normalize(input,expected(input))).width).toBe(2048);
});
it('rejects a generated PNG dimension bomb before allocating the claimed raster',async()=>{
 const valid=await picture().png().toBuffer(),parts=chunks(valid);const header=Buffer.from(parts[0]!.data);header.writeUInt32BE(100000,0);header.writeUInt32BE(100000,4);const bomb=rebuild([{type:'IHDR',data:header},...parts.slice(1)]),n=await normalizer();await expect(n.normalize(bomb,expected(bomb))).rejects.toMatchObject({code:'IMAGE_DIMENSIONS_INVALID'});
});
