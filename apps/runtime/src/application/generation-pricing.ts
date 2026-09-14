import type {StagePrice} from '../ports/generation-policy.js';
import {bindingLabel,canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import {fields} from '../contracts/story-draft-validation.js';
import {isTimestamp} from '../contracts/primitives.js';
export type GenerationMeters={kind:'text';inputTokens:number;outputTokens:number;images?:number;maxCalls:number}|{kind:'video';seconds:number;images:number;maxCalls:1};
const max=9223372036854775807n;
function integer(value:unknown):bigint{
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value)||BigInt(value)>max)throw Error();return BigInt(value);
}
export function calculateGenerationCost(price:StagePrice,meters:GenerationMeters,currency:'CNY'|'USD',now:Date):bigint{
 try{
  if(!meters||!['text','video'].includes(meters.kind))throw Error();
  const p=canonicalBindingJson(price);fields(p,['version','bindingHash','validUntil','currency','inputTokenMicros','outputTokenMicros','perTokens','outputSecondMicros','inputImageMicros','complete','adapterReady']);
  bindingLabel(p.version);if(p.complete!==true||p.adapterReady!==true||p.currency!==currency||!isTimestamp(p.validUntil)||
   !Number.isFinite(now.getTime())||Date.parse(p.validUntil)<=now.getTime()||typeof p.bindingHash!=='string'||!/^[a-f0-9]{64}$/.test(p.bindingHash))throw Error();
  const input=integer(p.inputTokenMicros),output=integer(p.outputTokenMicros),per=integer(p.perTokens),seconds=integer(p.outputSecondMicros),images=integer(p.inputImageMicros);
  if(per===0n||!Number.isSafeInteger(meters.maxCalls)||meters.maxCalls<1||meters.maxCalls>3)throw Error();
  const quantity=(v:number)=>{if(!Number.isSafeInteger(v)||v<0||v>1_000_000)throw Error();return BigInt(v);};
  const ceil=(v:bigint)=>(v+per-1n)/per;
  const cost=meters.kind==='text'?(ceil(quantity(meters.inputTokens)*input)+ceil(quantity(meters.outputTokens)*output)+quantity(meters.images??0)*images)*BigInt(meters.maxCalls):
   quantity(meters.seconds)*seconds+quantity(meters.images)*images;
  if(cost<=0n||cost>max||(meters.kind==='video'&&meters.maxCalls!==1))throw Error();return cost;
 }catch{throw Error('GENERATION_PRICE_UNAVAILABLE');}
}
