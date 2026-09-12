import {describe, expect, it} from 'vitest';

const datasetId='01994b80-0000-7000-8000-000000000001';
const commandId='01994b80-0000-7000-8000-000000000002';
const uploadId='01994b80-0000-7000-8000-000000000003';
const assetId='01994b80-0000-7000-8000-000000000004';
const time='2026-09-12T00:00:00.000Z';
const begin={datasetId,commandId,inputSha256:'a'.repeat(64),inputByteSize:'1024',originalName:'自绘角色.png',rightsDeclaration:'本人创作并授权使用'};
const intent={id:uploadId,datasetId,assetId,inputSha256:begin.inputSha256,inputByteSize:begin.inputByteSize,originalName:begin.originalName,rightsDeclaration:begin.rightsDeclaration,status:'reserved',outputSha256:null,outputByteSize:null,outputWidth:null,outputHeight:null,createdAt:time,updatedAt:time,expiresAt:'2026-09-13T00:00:00.000Z',revision:1};
const asset={id:assetId,datasetId,sha256:'b'.repeat(64),mimeType:'image/webp',byteSize:'512',originalName:begin.originalName,rightsDeclaration:begin.rightsDeclaration,width:256,height:300,status:'ready',deletedAt:null,createdAt:time,updatedAt:time,revision:1};
async function parsers(){const m=await import('../src/contracts/asset-validation.js').catch(()=>null);expect(m,'asset boundary must exist').not.toBeNull();return m!;}

describe('single strict public asset protocol',()=>{
 it('canonicalizes begin property order without converting or supplementing fields',async()=>{
  const p=await parsers();const reversed=Object.fromEntries(Object.entries(begin).reverse());expect(p.parseBeginUpload(reversed)).toEqual(begin);expect(JSON.stringify(p.parseBeginUpload(reversed))).toBe(JSON.stringify(begin));
 });
 it.each(['ownerId','storageKey','path','url','processingToken','leaseExpiresAt','assetId','uploadId','mimeType','unknown'])('rejects client-selected or private begin field %s',async key=>{
  const p=await parsers();expect(()=>p.parseBeginUpload({...begin,[key]:'private/secret'})).toThrow(/^INVALID_ASSET_COMMAND$/);
 });
 it.each([null,[],{},'file.png',{...begin,commandId:assetId.replace('-7000-','-4000-')},{...begin,datasetId:'not-v7'},...Object.keys(begin).map(key=>Object.fromEntries(Object.entries(begin).filter(([k])=>k!==key)))])('rejects malformed/missing begin data %#',async input=>{
  const p=await parsers();expect(()=>p.parseBeginUpload(input)).toThrow(/^INVALID_ASSET_COMMAND$/);
 });
 it.each([0,1024,1024n,'0','01','+1','1.0','1e3',' 1','10485761','9'.repeat(100),''])('rejects noncanonical or out-of-budget input bytes %#',async inputByteSize=>{
  const p=await parsers();expect(()=>p.parseBeginUpload({...begin,inputByteSize})).toThrow(/^INVALID_ASSET_COMMAND$/);
 });
 it.each(['A'.repeat(64),'a'.repeat(63),'g'.repeat(64)])('rejects malformed hash %#',async inputSha256=>{const p=await parsers();expect(()=>p.parseBeginUpload({...begin,inputSha256})).toThrow(/^INVALID_ASSET_COMMAND$/);});
 it.each(['',' ','../x.png','/x.png','C:\\x.png','bad\0.png','a'.repeat(256)])('requires a bounded filename, never a path %#',async originalName=>{const p=await parsers();expect(()=>p.parseBeginUpload({...begin,originalName})).toThrow(/^INVALID_ASSET_COMMAND$/);});
 it.each(['',' ', '权'.repeat(2001)])('requires a bounded rights declaration %#',async rightsDeclaration=>{const p=await parsers();expect(()=>p.parseBeginUpload({...begin,rightsDeclaration})).toThrow(/^INVALID_ASSET_COMMAND$/);});
 it('accepts exact byte/name/rights boundaries and returns a fresh object',async()=>{const p=await parsers();const input={...begin,inputByteSize:'10485760',originalName:'😀'.repeat(255),rightsDeclaration:'权'.repeat(2000)};expect(p.parseBeginUpload(input)).toEqual(input);expect(p.parseBeginUpload(input)).not.toBe(input);});
 it('get/complete accept only their explicit dataset/entity/command IDs',async()=>{
  const p=await parsers();expect(p.parseGetUpload({uploadId,datasetId})).toEqual({datasetId,uploadId});expect(p.parseGetAsset({assetId,datasetId})).toEqual({datasetId,assetId});expect(p.parseCompleteUpload({uploadId,commandId,datasetId})).toEqual({datasetId,commandId,uploadId});
  expect(()=>p.parseGetUpload({datasetId,uploadId,path:'private'})).toThrow(/^INVALID_ASSET_QUERY$/);expect(()=>p.parseGetAsset({datasetId,assetId,storageKey:'private'})).toThrow(/^INVALID_ASSET_QUERY$/);expect(()=>p.parseCompleteUpload({datasetId,commandId,uploadId,assetId})).toThrow(/^INVALID_ASSET_COMMAND$/);
 });
 it.each(['reserved','processing','published','finalizing','completed','failed','deleting'])('validates upload status %s with public output metadata',async status=>{
  const p=await parsers();const output=['published','finalizing','completed'].includes(status)?{outputSha256:asset.sha256,outputByteSize:asset.byteSize,outputWidth:asset.width,outputHeight:asset.height}:{};const value={...intent,...output,status};expect(p.parseUploadIntentDTO(value)).toEqual(value);
 });
 it.each(['storageKey','ownerId','path','url','processingToken','leaseExpiresAt','token'])('rejects private DTO property %s instead of spreading ORM records',async key=>{
  const p=await parsers();expect(()=>p.parseUploadIntentDTO({...intent,[key]:'secret'})).toThrow(/^INVALID_ASSET_DTO$/);expect(()=>p.parseAssetDTO({...asset,[key]:'secret'})).toThrow(/^INVALID_ASSET_DTO$/);
 });
 it('validates actual public image metadata and decimal output sizes',async()=>{
  const p=await parsers();expect(p.parseAssetDTO(asset)).toEqual(asset);expect(JSON.stringify(p.parseAssetDTO(asset))).toContain('"byteSize":"512"');expect(p.parseAssetDTO({...asset,status:'unavailable'}).status).toBe('unavailable');
  for(const patch of [{byteSize:512},{byteSize:'01'},{width:2049},{height:0},{mimeType:'image/png'},{sha256:'bad'},{revision:2147483648},{createdAt:'yesterday'},{status:'processing'}])expect(()=>p.parseAssetDTO({...asset,...patch})).toThrow(/^INVALID_ASSET_DTO$/);
 });
 it('rejects partial output, absent published metadata and invented statuses',async()=>{
  const p=await parsers();for(const patch of [{status:'ready'},{status:'completed'},{outputWidth:256},{outputSha256:'bad'},{inputByteSize:1024},{datasetId:'old'}])expect(()=>p.parseUploadIntentDTO({...intent,...patch})).toThrow(/^INVALID_ASSET_DTO$/);
 });
});
it('publishes only compiled, pure asset contract entrypoints for future browser adapters',async()=>{
 const {readFileSync}=await import('node:fs');const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 for(const name of ['asset','asset-validation'])expect(pkg.exports[`./contracts/${name}`]).toEqual({types:`./src/contracts/${name}.ts`,default:`./dist/contracts/${name}.js`});
});
