'use client';
import type {Story,AssetRole} from '../../../packages/domain/src/story';
import {useImageAsset} from './story-assets';
const titles:Record<AssetRole,string>={cover:'剧本封面',character:'角色参考',opening:'开场画面'};
function AssetStatus({role,id}:{role:AssetRole;id:string}){
 const asset=useImageAsset(id);
 return <li>{titles[role]} · {asset.missing?'本机图片缺失，请回编辑器重新选择':asset.url?'本机可用 · 尚未发送模型':'正在检查本机图片…'}</li>;
}
export function StoryAssetStatus({story}:{story:Story}){
 const roles=(['cover','character','opening'] as const).filter(role=>story.assets?.[role]);
 if(!roles.length)return null;
 return <details><summary>本次故事的图片素材 · {roles.length} 张</summary><ul style={{paddingLeft:18,lineHeight:2,fontSize:12}}>{roles.map(role=><AssetStatus key={role} role={role} id={story.assets![role]!}/>)}</ul><p style={{fontSize:12,lineHeight:1.8}}>封面只用于展示。角色参考与开场帧是不同输入模式，正式接入时按所选模型单独校验；保存图片不等于已参与生成。</p></details>;
}
