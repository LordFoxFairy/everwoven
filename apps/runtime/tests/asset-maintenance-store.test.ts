import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {v7} from 'uuid';
import {prepare,dispose,fixture,type Fixture} from './fixtures/host-assets/setup.js';
import {PrismaAssetMaintenanceStore,maintenanceQuery} from '../src/infrastructure/db/prisma-asset-maintenance-store.js';
let f:Fixture;beforeAll(prepare,30000);afterAll(dispose);beforeEach(async()=>{f=await fixture();});afterEach(async()=>{await f.close();});
const now=new Date('2026-09-12T12:00:00.000Z'),createdAt=new Date('2026-09-10T00:00:00.000Z');
async function insert(status:string,patch:Record<string,unknown>={}){
 return f.database(db=>db.assetUpload.create({data:{id:v7(),ownerId:f.manifest.ownerId,assetId:v7(),inputSha256:'a'.repeat(64),inputByteSize:1n,originalName:'private',rightsDeclaration:'private',status,createdAt,updatedAt:createdAt,expiresAt:new Date(now.getTime()-1),...patch}}));
}
it('EXPLAIN uses owner tuple keyset without OFFSET/temp sorting and identity lookup is nonunique indexed',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec(readFileSync(new URL('../prisma/migrations/202609120001_authoring_baseline/migration.sql',import.meta.url),'utf8'));
  const q=maintenanceQuery(f.manifest.ownerId,{now,after:{id:v7(),createdAt},limit:25});
  const plan=db.prepare('EXPLAIN QUERY PLAN '+q.sql).all(...q.values.map(v=>v instanceof Date?v.toISOString().replace('Z','+00:00'):v) as never[]);
  expect(JSON.stringify(plan)).toContain('ix_asset_uploads_owner');expect(JSON.stringify(plan)).toContain('(created_at,id)>');expect(JSON.stringify(plan)).not.toMatch(/SCAN |TEMP B-TREE/);expect(q.sql).not.toMatch(/OFFSET/);
  const identity=db.prepare('EXPLAIN QUERY PLAN SELECT id,owner_id,status FROM asset_uploads WHERE asset_id=? LIMIT 2').all(v7());
  expect(JSON.stringify(identity)).toContain('ix_asset_uploads_asset');
  expect(db.prepare("PRAGMA index_list('asset_uploads')").all().find(r=>r.name==='ix_asset_uploads_asset')!.unique).toBe(0);
 }finally{db.close();}
});
it('actual DB pages same timestamps strictly, excludes completed/future and other owners, retains lease candidates',async()=>{
 const a=await insert('failed'),b=await insert('deleting'),c=await insert('processing',{leaseExpiresAt:new Date(now.getTime()+10000)});
 await insert('completed');await insert('reserved',{expiresAt:new Date(now.getTime()+1000)});await insert('failed',{ownerId:v7()});
 await f.database(async db=>{
  const store=new PrismaAssetMaintenanceStore(db),first=await store.list(f.manifest.ownerId,{now,after:null,limit:2});expect(first.map(r=>r.id)).toEqual([a.id,b.id]);
  expect(first[0]!.createdAt).toEqual(createdAt);
  const second=await store.list(f.manifest.ownerId,{now,after:first[1]!,limit:2});expect(second.map(r=>r.id)).toEqual([c.id]);expect(second[0]!.leaseExpiresAt).toEqual(c.leaseExpiresAt);
 });
});
it('requires a live owner even on an empty page',async()=>{
 await f.database(async db=>{await db.localProfile.update({where:{id:f.manifest.ownerId},data:{deletedAt:now}});await expect(new PrismaAssetMaintenanceStore(db).list(f.manifest.ownerId,{now,after:null,limit:25})).rejects.toThrow('OWNER_UNAVAILABLE');});
});
it.each(['missing','unique'])('single fresh baseline gate rejects %s identity index instead of migrating',async kind=>{
 await f.database(async db=>{await db.$executeRawUnsafe('DROP INDEX ix_asset_uploads_asset');if(kind==='unique')await db.$executeRawUnsafe('CREATE UNIQUE INDEX ix_asset_uploads_asset ON asset_uploads(asset_id)');});
 await expect(f.database(async()=>{})).rejects.toThrow('DATABASE_SCHEMA_NOT_APPROVED');
});
