import type {PrismaClient,Prisma} from '../../generated/prisma/client.js';
import type {AssetReadScope,AssetWriteScope,AssetStore} from '../../ports/asset-store.js';
import {withOwnerWrite} from './write-gate.js';
function readScope(tx:Prisma.TransactionClient,ownerId:string):AssetReadScope{return {
 findUpload:id=>tx.assetUpload.findFirst({where:{id,ownerId}}),
 countUploadIdentities:assetId=>tx.assetUpload.count({where:{assetId}}),
 findAsset:id=>tx.asset.findFirst({where:{id,ownerId}}),
 hasAssetIdentity:async(id,storageKey)=>Boolean(await tx.asset.findFirst({where:{OR:[{id},{storageKey}]},select:{id:true}})),
};}
function writeScope(tx:Prisma.TransactionClient,ownerId:string):AssetWriteScope{return {
 ...readScope(tx,ownerId),
 findReceipt:commandId=>tx.commandReceipt.findUnique({where:{ownerId_commandId:{ownerId,commandId}},select:{id:true,commandType:true,payloadHash:true,schemaVersion:true,response:true}}),
 insertReceipt:async value=>{await tx.commandReceipt.create({data:{...value,ownerId,schemaVersion:1}});},
 insertUpload:value=>{if(value.ownerId!==ownerId)throw Error('ASSET_IDENTITY_CONFLICT');return tx.assetUpload.create({data:value});},
 casUpload:async(previous,patch)=>{if(previous.ownerId!==ownerId)throw Error('ASSET_IDENTITY_CONFLICT');return (await tx.assetUpload.updateMany({where:{id:previous.id,ownerId,assetId:previous.assetId,revision:previous.revision,status:previous.status,processingToken:previous.processingToken,leaseExpiresAt:previous.leaseExpiresAt},data:{...patch,revision:{increment:1}}})).count;},
 insertAsset:value=>{if(value.ownerId!==ownerId)throw Error('ASSET_IDENTITY_CONFLICT');return tx.asset.create({data:value});},
 markUnavailable:async(previous,now)=>(await tx.asset.updateMany({where:{id:previous.id,ownerId,revision:previous.revision,status:'ready',deletedAt:null,storageKey:previous.storageKey},data:{status:'unavailable',updatedAt:now,revision:{increment:1}}})).count,
};}
export class PrismaAssetStore implements AssetStore {
 constructor(private readonly db:PrismaClient){}
 read<T>(ownerId:string,work:(scope:AssetReadScope)=>Promise<T>):Promise<T>{return this.db.$transaction(async tx=>{if(!await tx.localProfile.findFirst({where:{id:ownerId,deletedAt:null},select:{id:true}}))throw Error('OWNER_UNAVAILABLE');return work(readScope(tx,ownerId));});}
 write<T>(ownerId:string,work:(scope:AssetWriteScope)=>Promise<T>):Promise<T>{return withOwnerWrite(this.db,ownerId,tx=>work(writeScope(tx,ownerId)));}
}
