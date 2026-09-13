import {Prisma,type PrismaClient} from '../../generated/prisma/client.js';
import type {AssetMaintenanceStore,MaintenanceCandidate} from '../../ports/asset-maintenance.js';
/** Tuple comparison keeps the existing owner/createdAt/id index seekable, including ties.
 * Values are bound, not interpolated SQL. Only returned candidates count against the page;
 * SQL may inspect non-candidate index entries, so this is not a hard CPU/time limit. */
export function maintenanceQuery(ownerId:string,{now,after,limit}:Parameters<AssetMaintenanceStore['list']>[1]){
 return Prisma.sql`SELECT id, hex(id) AS idStorage, created_at AS createdAt, CAST(created_at AS TEXT) AS createdAtStorage, status, lease_expires_at AS leaseExpiresAt
 FROM asset_uploads WHERE owner_id = ${ownerId}
 ${after?Prisma.sql`AND (created_at,id) > (${after.createdAt},${after.id})`:Prisma.empty}
 AND (status IN ('failed','deleting') OR (status != 'completed' AND expires_at <= ${now}))
 ORDER BY created_at,id LIMIT ${limit}`;
}
export class PrismaAssetMaintenanceStore implements AssetMaintenanceStore {
 constructor(private readonly db:PrismaClient){}
 list(ownerId:string,query:Parameters<AssetMaintenanceStore['list']>[1]):Promise<MaintenanceCandidate[]>{
  return this.db.$transaction(async tx=>{
   if(!await tx.localProfile.findFirst({where:{id:ownerId,deletedAt:null},select:{id:true}}))throw Error('OWNER_UNAVAILABLE');
   const rows=await tx.$queryRaw<Array<MaintenanceCandidate&{idStorage:unknown;createdAtStorage:unknown}>>(maintenanceQuery(ownerId,query));
   return rows.map(({idStorage,createdAtStorage,...row})=>{
    // Invalid UTF-8 TEXT must not silently become U+FFFD and a different bound key.
    if(typeof row.id!=='string'||idStorage!==Buffer.from(row.id,'utf8').toString('hex').toUpperCase())throw Error('ASSET_MAINTENANCE_FAILED');
    // The approved adapter writes ISO milliseconds +00:00. Date coercion can hide
    // a different stored TEXT ordering (or numeric storage), yielding a cursor
    // that repeats/skips rows when rebound. Such pagination corruption is fatal,
    // not repaired or silently normalized by maintenance.
    if(!(row.createdAt instanceof Date)||!Number.isFinite(row.createdAt.getTime())||
     createdAtStorage!==row.createdAt.toISOString().replace('Z','+00:00'))throw Error('ASSET_MAINTENANCE_FAILED');
    return row;
   });
  });
 }
}
