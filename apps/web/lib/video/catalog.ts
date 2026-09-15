import {getDeployment, type VideoDeployment} from 'runtime/contracts/video-deployments';
export {videoSuppliers, videoModels, getDeployment} from 'runtime/contracts/video-deployments';
export type {SupplierId, ModelId, ModelSelection, VideoDeployment} from 'runtime/contracts/video-deployments';
import type {VideoConfiguration} from '../../contracts/video';
export type {VideoConfiguration} from '../../contracts/video';
export function resolveVideoConfiguration(env:Record<string,string|undefined>):VideoConfiguration{
 if(!env.VIDEO_PROVIDER||!env.VIDEO_MODEL)return{available:false,selection:null,reason:'unselected'};
 let binding:VideoDeployment;
 try{binding=getDeployment(env.VIDEO_PROVIDER,env.VIDEO_MODEL);}catch{return{available:false,selection:null,reason:'unsupported'};}
 const selection={providerId:binding.providerId,modelId:binding.modelId};
 // This contract describes continuous live sessions; job generation uses the durable opening/quote flow.
 if(binding.mode!=='live')return{available:false,selection,reason:'not-live'};
 if(env.APP_ENV!=='dev'||env.NODE_ENV!=='development'||env.FAL_LOCAL_ENABLED!=='true')return{available:false,selection,reason:'disabled'};
 if(!env.FAL_KEY)return{available:false,selection,reason:'missing-key'};
 return{available:true,selection,reason:'ready'};
}
export const configurationMessages:Record<VideoConfiguration['reason'],string>={
 ready:'供应商与模型已配置',unselected:'请先在服务端选择供应商与模型。',unsupported:'当前供应商与模型组合尚未适配。',
 'not-live':'所选模型采用分幕生成，请从剧本开始体验。',
 disabled:'实时接入未启用，或当前环境尚未开放。','missing-key':'所选供应商的服务端密钥尚未配置。'
};
