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
