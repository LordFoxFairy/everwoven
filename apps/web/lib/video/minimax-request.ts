/** Official V2 request shape. Pure: no credentials, uploads or network. */
export type MiniMaxModel='MiniMax-H3'|'MiniMax-H3-Max';
export type MiniMaxRatio='21:9'|'16:9'|'4:3'|'1:1'|'3:4'|'9:16';
export type MiniMaxRequestInput={
 model:MiniMaxModel;prompt:string;resolution:'480P'|'768P'|'2K';duration:number;
 ratio?:MiniMaxRatio|'adaptive';frames?:{first?:string;last?:string};
};
type Content={type:'text';text:string}|{type:'image_url';image_url:{url:string};role:'first_frame'|'last_frame'};
export type MiniMaxRequest={model:MiniMaxModel;content:Content[];resolution:MiniMaxRequestInput['resolution'];duration:number;ratio:MiniMaxRatio|'adaptive'};
const ratios:readonly string[]=['21:9','16:9','4:3','1:1','3:4','9:16'];
export function buildMiniMaxRequest(input:MiniMaxRequestInput):MiniMaxRequest{
 if(!input||!['MiniMax-H3','MiniMax-H3-Max'].includes(input.model))throw Error('所选模型不属于本官方适配器');
 if(Object.keys(input).some(key=>!['model','prompt','resolution','duration','ratio','frames'].includes(key)))throw Error('请求包含尚未适配的输入字段');
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>7000)throw Error('本接口提示词应为 1–7000 个字符');
 const standard=input.model==='MiniMax-H3';
 if(!(standard?['768P','2K']:['480P','768P']).includes(input.resolution))throw Error('所选模型不支持这个分辨率');
 if(!Number.isInteger(input.duration)||input.duration<(standard?4:5)||input.duration>15)throw Error('所选模型不支持这个片段时长');
 const content:Content[]=[{type:'text',text:input.prompt.trim()}];
 let ratio:MiniMaxRequest['ratio'];
 if(input.frames!==undefined){
  const frames=input.frames;
  if(!frames||Array.isArray(frames)||typeof frames!=='object'||Object.keys(frames).some(key=>key!=='first'&&key!=='last')||!Object.keys(frames).length)throw Error('本次仅适配首帧和尾帧，请明确图片用途');
  if(input.ratio!==undefined&&input.ratio!=='adaptive')throw Error('首尾帧模式由图片决定构图，请先确认图片比例');
  for(const key of ['first','last'] as const){
   if(!Object.hasOwn(frames,key))continue;
   const value=frames[key];
   if(typeof value!=='string'||!value.trim()||value!==value.trim())throw Error('图片地址尚未准备好');
   let url:URL;try{url=new URL(value);}catch{throw Error('图片地址尚未准备好');}
   // HTTPS URLs only in this adapter; local blobs stay on the device.
   if(url.protocol!=='https:'||url.username||url.password)throw Error('图片需使用不含登录凭据的 HTTPS 地址');
   content.push({type:'image_url',image_url:{url:value},role:key==='first'?'first_frame':'last_frame'});
  }
  ratio='adaptive';
 }else{
  ratio=input.ratio??'16:9';
  if(!ratios.includes(ratio))throw Error('文生视频需要明确且受支持的构图比例');
 }
 return {model:input.model,content,resolution:input.resolution,duration:input.duration,ratio};
}
