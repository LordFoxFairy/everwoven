/** Public metadata only: never put credentials or tenant base URLs here. */
export const videoSuppliers={
 minimax:{id:'minimax',label:'MiniMax 官方'},
 fal:{id:'fal',label:'fal'},
} as const;
export const videoModels={
 'minimax-h3':{id:'minimax-h3',label:'MiniMax H3'},
 'minimax-h3-max':{id:'minimax-h3-max',label:'MiniMax H3 Max'},
 'h3-max-director':{id:'h3-max-director',label:'H3 Max Director'},
} as const;
export type SupplierId=keyof typeof videoSuppliers;
export type ModelId=keyof typeof videoModels;
export type ModelSelection={providerId:SupplierId;modelId:ModelId};
export type VideoDeployment=ModelSelection & {
 endpoint:string;mode:'live'|'job';adapter:'fal-wma'|'minimax-v2';
};
const deployments:readonly VideoDeployment[]=[
 {providerId:'minimax',modelId:'minimax-h3',endpoint:'MiniMax-H3',mode:'job',adapter:'minimax-v2'},
 {providerId:'minimax',modelId:'minimax-h3-max',endpoint:'MiniMax-H3-Max',mode:'job',adapter:'minimax-v2'},
 {providerId:'fal',modelId:'h3-max-director',endpoint:'minimax/h3-max/director',mode:'live',adapter:'fal-wma'},
];
export function getDeployment(providerId:string,modelId:string):VideoDeployment{
 const match=deployments.find(item=>item.providerId===providerId&&item.modelId===modelId);
 if(!match)throw Error('尚未配置这个供应商与模型组合');
 return {...match};
}
import type {VideoConfiguration} from '../../contracts/video';
export type {VideoConfiguration} from '../../contracts/video';
export function resolveVideoConfiguration(env:Record<string,string|undefined>):VideoConfiguration{
 if(!env.VIDEO_PROVIDER||!env.VIDEO_MODEL)return{available:false,selection:null,reason:'unselected'};
 let binding:VideoDeployment;
 try{binding=getDeployment(env.VIDEO_PROVIDER,env.VIDEO_MODEL);}catch{return{available:false,selection:null,reason:'unsupported'};}
 const selection={providerId:binding.providerId,modelId:binding.modelId};
 // The job binding is registered, but a job-to-continuous-playback adapter is not implemented.
 if(binding.mode!=='live')return{available:false,selection,reason:'not-live'};
 if(env.APP_ENV!=='dev'||env.NODE_ENV!=='development'||env.FAL_LOCAL_ENABLED!=='true')return{available:false,selection,reason:'disabled'};
 if(!env.FAL_KEY)return{available:false,selection,reason:'missing-key'};
 return{available:true,selection,reason:'ready'};
}
export const configurationMessages:Record<VideoConfiguration['reason'],string>={
 ready:'供应商与模型已配置',unselected:'请先在服务端选择供应商与模型。',unsupported:'当前供应商与模型组合尚未适配。',
 'not-live':'已选择 MiniMax 官方模型。其 V2 任务接口已登记；连续生成与播放适配尚待完成，不会自动改走 fal。',
 disabled:'实时接入未启用，或当前环境尚未开放。','missing-key':'所选供应商的服务端密钥尚未配置。'
};
