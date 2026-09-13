import {expect,it,vi} from 'vitest';
import {v7} from 'uuid';
import {createAssetMaintenance} from '../src/application/asset-maintenance.js';
import type {MaintenanceCandidate,AssetMaintenanceStore} from '../src/ports/asset-maintenance.js';
const owner={ownerId:v7(),datasetId:v7()},now=new Date('2026-09-12T12:00:00.000Z');
const row=(patch:Partial<MaintenanceCandidate>={}):MaintenanceCandidate=>({id:v7(),createdAt:new Date('2026-09-11T00:00:00.000Z'),status:'failed',leaseExpiresAt:null,...patch});
function setup(rows:MaintenanceCandidate[]=[]){
 const store:AssetMaintenanceStore={list:vi.fn(async()=>rows)},revalidate=vi.fn(async()=>{}),cleanup=vi.fn(async()=>({kind:'absent' as const}));
 return {store,revalidate,cleanup,run:createAssetMaintenance(store,{owner,revalidate,cleanup,now:()=>now})};
}
it('defaults to preview / 25 inspected rows and never invokes cleanup',async()=>{
 const s=setup([row()]);const result=await s.run({datasetId:owner.datasetId});
 expect(result).toMatchObject({mode:'preview',examined:1,nextCursor:null,items:[{outcome:'preview'}]});
 expect(s.store.list).toHaveBeenCalledWith(owner.ownerId,expect.objectContaining({limit:25,now,after:null}));expect(s.cleanup).not.toHaveBeenCalled();
});
it.each([0,-1,101,1.5,'25',null])('rejects limit %s before store',async limit=>{
 const s=setup();await expect(s.run({datasetId:owner.datasetId,limit} as never)).rejects.toThrow('INVALID_ASSET_MAINTENANCE');expect(s.store.list).not.toHaveBeenCalled();
});
it('rejects unexpected fields and dataset before store',async()=>{
 const s=setup();await expect(s.run({datasetId:owner.datasetId,ownerId:v7()} as never)).rejects.toThrow('INVALID_ASSET_MAINTENANCE');
 await expect(s.run({datasetId:v7()})).rejects.toThrow('DATASET_CHANGED');expect(s.store.list).not.toHaveBeenCalled();
});
it('errors and active leases consume quota; cleanup is serial, sanitized and never retried in-page',async()=>{
 const rows=[row(),row({leaseExpiresAt:new Date(now.getTime()+1)}),row()];const s=setup(rows);
 s.cleanup.mockRejectedValueOnce(Error('/private/path SECRET')).mockResolvedValue({kind:'absent'});
 const result=await s.run({datasetId:owner.datasetId,apply:true,limit:3});
 expect(result.items.map(i=>i.outcome)).toEqual(['error','lease-protected','absent']);
 expect(result.items[0]).toEqual({uploadId:rows[0]!.id,outcome:'error',error:'ASSET_MAINTENANCE_ITEM_FAILED'});
 expect(result.examined).toBe(3);expect(result.nextCursor).toBeTypeOf('string');expect(s.cleanup).toHaveBeenCalledTimes(2);
 expect(JSON.stringify(result)).not.toMatch(/private|SECRET/);
});
it('cursor roundtrips strict position and refuses another owner/dataset before listing',async()=>{
 const r=row(),s=setup([r]);const first=await s.run({datasetId:owner.datasetId,limit:1});
 vi.mocked(s.store.list).mockResolvedValueOnce([]);await s.run({datasetId:owner.datasetId,cursor:first.nextCursor!});
 expect(s.store.list).toHaveBeenLastCalledWith(owner.ownerId,expect.objectContaining({after:{id:r.id,createdAt:r.createdAt}}));
 for(const changed of [{...owner,ownerId:v7()},{...owner,datasetId:v7()}]){
  const store={list:vi.fn()},run=createAssetMaintenance(store,{owner:changed,revalidate:s.revalidate,cleanup:s.cleanup});
  await expect(run({datasetId:changed.datasetId,cursor:first.nextCursor!})).rejects.toThrow('INVALID_ASSET_MAINTENANCE_CURSOR');expect(store.list).not.toHaveBeenCalled();
 }
});
it.each(['!', 'a'.repeat(2049), Buffer.from('{}').toString('base64url')])('rejects malformed cursor before reads',async cursor=>{
 const s=setup();await expect(s.run({datasetId:owner.datasetId,cursor})).rejects.toThrow('INVALID_ASSET_MAINTENANCE_CURSOR');expect(s.store.list).not.toHaveBeenCalled();
});
it('stops before next row on revocation, instead of treating authority failure as a per-item error',async()=>{
 const s=setup([row(),row()]);s.cleanup.mockImplementationOnce(async()=>{s.revalidate.mockRejectedValue(Error('LOCAL_SESSION_INVALID'));return {kind:'absent'};});
 await expect(s.run({datasetId:owner.datasetId,apply:true})).rejects.toThrow('LOCAL_SESSION_INVALID');expect(s.cleanup).toHaveBeenCalledOnce();
});
it('rechecks boundary after list before any cleanup',async()=>{
 const s=setup([row()]);vi.mocked(s.store.list).mockImplementationOnce(async()=>{s.revalidate.mockRejectedValue(Error('DATASET_CHANGED'));return [row()];});
 await expect(s.run({datasetId:owner.datasetId,apply:true})).rejects.toThrow('DATASET_CHANGED');expect(s.cleanup).not.toHaveBeenCalled();
});
it('bounds a faulty store response and does not loop or fetch a second page',async()=>{
 const s=setup(Array.from({length:26},()=>row()));await expect(s.run({datasetId:owner.datasetId,apply:true})).rejects.toThrow('ASSET_MAINTENANCE_FAILED');expect(s.cleanup).not.toHaveBeenCalled();expect(s.store.list).toHaveBeenCalledOnce();
});
