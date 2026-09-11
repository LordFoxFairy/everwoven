import {getDeployment,videoModels,videoSuppliers,type ModelSelection} from './catalog';
import {createDirectorModel} from './director';
import type {LiveVideoProvider} from './types';
/** Resolves a supplier-model deployment; no implicit supplier fallback. */
export function resolveLiveModel(selection:ModelSelection):LiveVideoProvider{
 const binding=getDeployment(selection.providerId,selection.modelId);
 if(binding.mode!=='live'||binding.adapter!=='fal-wma')throw Error('该部署的连续视频适配尚未完成');
 return createDirectorModel({providerId:binding.providerId,modelId:binding.modelId,label:`${videoSuppliers[binding.providerId].label} / ${videoModels[binding.modelId].label}`,endpoint:binding.endpoint});
}
