import type {PrismaClient} from '../generated/prisma/client.js';
import type {AssetServiceDependencies,AssetService} from '../ports/asset-service.js';
import {PrismaAssetStore} from '../infrastructure/db/prisma-asset-store.js';
import {createAssets} from '../application/assets.js';
/** No constructor I/O: Host must provide authenticated context and scope-bound lazy openFiles. */
export function createAssetService(db:PrismaClient,deps:AssetServiceDependencies):AssetService{return createAssets(new PrismaAssetStore(db),deps);}
