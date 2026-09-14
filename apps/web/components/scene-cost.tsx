'use client';
import {useState,useRef,useEffect} from 'react';
import {Dialog} from 'radix-ui';
import {ReceiptText,X} from 'lucide-react';
import type {CostDTO,CostQuery} from 'runtime/contracts/generation-cost';
import {createGenerationClient} from '../lib/experience/playback-client';
import styles from './scene-history.module.css';
const amount=(v:string,currency:string)=>`${currency} ${(BigInt(v)/1000000n).toString()}.${(BigInt(v)%1000000n).toString().padStart(6,'0')}`;
/** Read-on-open disclosure, outside the response deck. Never starts or settles generation. */
export function SceneCost({query,container}:{query:CostQuery;container:HTMLElement|null}){
 const [client]=useState(createGenerationClient),[open,setOpen]=useState(false),[data,setData]=useState<CostDTO|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sequence=useRef(0);useEffect(()=>()=>{sequence.current++;},[]);
 async function read(){const ticket=++sequence.current;setBusy(true);setError('');try{const next=await client.cost(query);if(ticket===sequence.current)setData(next);}catch{if(ticket===sequence.current)setError('费用暂未读到，已有记录保留。');}finally{if(ticket===sequence.current)setBusy(false);}}
 return <Dialog.Root open={open} onOpenChange={value=>{setOpen(value);if(value)void read();else sequence.current++;}}>
  <Dialog.Trigger asChild><button aria-label="本幕费用"><ReceiptText size={17}/><span>费用</span></button></Dialog.Trigger>
  <Dialog.Portal container={container}><Dialog.Overlay className={styles.scrim}/><Dialog.Content className={styles.panel}>
   <header><div><Dialog.Title>本幕费用</Dialog.Title><Dialog.Description>仅统计这次开局配置的供应商账户。</Dialog.Description></div><Dialog.Close aria-label="收起费用"><X size={18}/></Dialog.Close></header>
   {busy?<p role="status">正在读取费用…</p>:data?<section className={styles.detail}>
    <h3>{data.reviewRequired?'费用需要核对':data.status==='held'?'费用尚未结清':'本幕已结算'}</h3>
    <p>确认上限 {amount(data.quotedMicros,data.currency)}</p><p>已结算 {amount(data.settledMicros,data.currency)} · 仍预留 {amount(data.reservedMicros,data.currency)}</p>
    {data.stages.map(row=><p key={row.stage}>{({planner:'剧情规划',video:'视频生成',validator:'画面核验'})[row.stage]} · {row.amountMicros===null?'待确认':amount(row.amountMicros,data.currency)}<br/><small>{row.basis==='account-charge'?'供应商账户扣费':'按供应商用量与原费率核算'}</small></p>)}
    <p>{data.reviewRequired?'已记录超出确认上限的费用，同一故事暂停新生成；回看和存档保留。':data.status==='held'?'完整费用证据确认前，预留额度保持占用。':'未使用的预留已释放，所有分支仍共用故事总额度。'}</p>
    <small>用量核算不等于供应商最终发票；不含充值费、税费或外部 BYOK 账户费用。</small>
   </section>:null}
   {error&&<p role="alert">{error}</p>}{!busy&&<button onClick={()=>void read()}>刷新费用</button>}
  </Dialog.Content></Dialog.Portal>
 </Dialog.Root>;
}
