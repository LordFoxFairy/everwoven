import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {AssetService} from './asset-service.js';
export type AssetMaintenanceInput = {datasetId:string;apply?:boolean;limit?:number;cursor?:string};
export type MaintenancePosition = {id:string;createdAt:Date};
export type MaintenanceCandidate = MaintenancePosition & {status:string;leaseExpiresAt:Date|null};
export interface AssetMaintenanceStore {
 list(ownerId:string,query:{now:Date;after:MaintenancePosition|null;limit:number}):Promise<MaintenanceCandidate[]>;
}
export type AssetMaintenanceItem = {uploadId:string;outcome:'preview'|'lease-protected'|'removed'|'absent'|'error';error?:'ASSET_MAINTENANCE_ITEM_FAILED'};
export type AssetMaintenanceResult = {datasetId:string;mode:'preview'|'apply';examined:number;items:AssetMaintenanceItem[];nextCursor:string|null};
export type AssetMaintenanceDependencies = {owner:InternalOwnerContext;revalidate:()=>Promise<void>;cleanup:AssetService['cleanup'];now?:()=>Date};
