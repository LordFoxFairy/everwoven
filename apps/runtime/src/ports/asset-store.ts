import type {AssetDTO,UploadIntentDTO} from '../contracts/asset.js';
/** Asset begin receipts share their server-generated primary identity with the upload.
 * This is a persisted command-to-upload binding independent of response JSON, not a foreign key.
 * Complete receipts retain independently generated identities. No other business receipt changes. */
export type AssetReceiptRecord={id:string;commandType:string;payloadHash:string;schemaVersion:number;response:unknown};
export type UploadRecord={id:string;ownerId:string;assetId:string;inputSha256:string;inputByteSize:bigint;originalName:string;rightsDeclaration:string;status:string;outputSha256:string|null;outputByteSize:bigint|null;outputWidth:number|null;outputHeight:number|null;processingToken:string|null;leaseExpiresAt:Date|null;createdAt:Date;updatedAt:Date;expiresAt:Date;revision:number};
export type AssetRecord={id:string;ownerId:string;storageKey:string;sha256:string;mimeType:string;byteSize:bigint;originalName:string;rightsDeclaration:string;width:number;height:number;status:string;deletedAt:Date|null;createdAt:Date;updatedAt:Date;revision:number};
export type UploadPatch=Partial<Pick<UploadRecord,'status'|'outputSha256'|'outputByteSize'|'outputWidth'|'outputHeight'|'processingToken'|'leaseExpiresAt'>> & {updatedAt:Date};
export interface AssetReadScope {
 findUpload(id:string):Promise<UploadRecord|null>;
 countUploadIdentities(assetId:string):Promise<number>;
 findAsset(id:string):Promise<AssetRecord|null>;
 hasAssetIdentity(id:string,storageKey:string):Promise<boolean>;
}
export interface AssetWriteScope extends AssetReadScope {
 findReceipt(commandId:string):Promise<AssetReceiptRecord|null>;
 insertReceipt(value:{id:string;commandId:string;commandType:string;payloadHash:string;response:UploadIntentDTO|AssetDTO;createdAt:Date}):Promise<void>;
 insertUpload(value:UploadRecord):Promise<UploadRecord>;
 casUpload(previous:UploadRecord,patch:UploadPatch):Promise<number>;
 insertAsset(value:AssetRecord):Promise<AssetRecord>;
 markUnavailable(previous:AssetRecord,now:Date):Promise<number>;
}
export interface AssetStore {
 read<T>(ownerId:string,work:(scope:AssetReadScope)=>Promise<T>):Promise<T>;
 /** Work begins only after the real owner WriteGate is acquired. No file/body work in here. */
 write<T>(ownerId:string,work:(scope:AssetWriteScope)=>Promise<T>):Promise<T>;
}
