'use client';
import {useRef, type ReactNode, type RefObject} from 'react';
import {Dialog} from 'radix-ui';
import {ArrowLeft, Check, ShieldCheck, Film} from 'lucide-react';
import type {OpeningController, OpeningState} from '../lib/experience/opening-controller';
import {Button} from './ui/button';
import styles from './story-preparation.module.css';

export function StoryPreparation({controller, state, unsavedChanges, triggerRef, connectionSlot, returnLabel = '返回编辑', onStart}: {
  controller: OpeningController; state: OpeningState; unsavedChanges: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>; connectionSlot: ReactNode; returnLabel?: string; onStart?: (experienceId: string) => void;
}) {
  const back = useRef<HTMLButtonElement>(null), source = state.source, story = source ?? state.confirmed?.story;
  if (!story) return null;
  const locked = state.busy || state.unknown || Boolean(state.confirmed), disabled = locked || !state.connected || state.datasetChanged;
  const directory = state.directory;
  return <Dialog.Root open={state.visible} onOpenChange={open => {if (!open) controller.close();}}>
    <Dialog.Portal><Dialog.Overlay className="modal-backdrop">
      <Dialog.Content className={styles.panel} onOpenAutoFocus={event => {event.preventDefault(); back.current?.focus();}}
        onCloseAutoFocus={event => {event.preventDefault(); triggerRef.current?.focus();}}>
        <header className={styles.header}>
          <Button ref={back} type="button" variant="outline" size="sm" onClick={() => controller.close()}><ArrowLeft size={15}/>{returnLabel}</Button>
          <span className={styles.status}><ShieldCheck size={15}/>仅本机 · 未调用模型</span>
        </header>
        <div className={styles.intro}>
          <Dialog.Title asChild><p className={styles.eyebrow}>正式故事准备</p></Dialog.Title>
          <h2>{story.title}</h2>
          <Dialog.Description>先确认这一次旅程的起点。准备完成后进入故事，查看费用并确认生成。</Dialog.Description>
        </div>
        <div className={styles.grid}>
          <section className={styles.story} aria-label="已保存的开局">
            <span className={styles.eyebrow}>你的设定</span><h3>从这里，展开故事</h3>
            <p className={styles.revision}>已保存 · 修订 {source?.revision ?? state.confirmed!.story.sourceRevision}</p>
            <dl><dt>世界</dt><dd>{story.settings.world || '尚未填写世界设定'}</dd>
              <dt>开场</dt><dd>{story.settings.opening || '尚未填写开场'}</dd>
              <dt>角色</dt><dd>{story.mainCharacter?.effective.name ?? '尚未配置角色'}</dd></dl>
            {state.origin === 'draft' && unsavedChanges && <p className={styles.note}>本次准备不包含尚未保存的修改。返回编辑保存后，可重新确认起点。</p>}
          </section>
          <section className={styles.settings} aria-label="模型与预算">
            {!state.connected && connectionSlot}
            {state.datasetChanged && <p role="alert" className={styles.warning}>数据集已变化，原开局内容保留；请连接原数据集后再确认，不会迁移原请求。</p>}
            {state.confirmed ? <>
              <div className={styles.confirmed}><Check size={22}/><h3>开局配置已固定</h3></div>
              <p>尚未报价、尚未生成。配置已保存到本机，后续编辑剧本不会改变这次开局。</p>
              <dl><dt>固定模型</dt><dd>{state.confirmed.binding.modelId}</dd><dt>连接与地区</dt><dd>{state.confirmed.binding.connectionId} · {state.confirmed.binding.region === 'cn' ? '中国区' : '国际区'}</dd><dt>预算上限 · 不等于费用授权</dt><dd>{state.amount} {state.currency}</dd></dl>
              {onStart && <Button type="button" disabled={!state.connected || state.datasetChanged || state.busy} onClick={() => onStart(state.confirmed!.id)}>进入故事</Button>}
              {!state.current && <p className={styles.note}>下面的记录仅代表最初确认，请读取当前准备状态。</p>}
              <Button type="button" variant="outline" disabled={!state.connected || state.datasetChanged || state.reading} onClick={() => void controller.refresh()}>{state.reading ? '正在读取…' : '读取准备状态'}</Button>
            </> : <>
              <div className={styles.sectionHeading}><h3><Film size={17}/>视频模型</h3><Button type="button" variant="outline" size="sm" disabled={!state.connected || state.datasetChanged || state.loading} onClick={() => void controller.load()}>{state.loading ? '正在读取…' : '刷新模型配置'}</Button></div>
              {directory?.status === 'ready' ? <fieldset className={styles.models} disabled={disabled} aria-label="选择视频模型">
                {directory.items.map(item => <label key={`${item.bindingKey}:${item.versionNo}`} className={styles.model}>
                  <input type="radio" name="opening-model" checked={state.selection?.bindingKey === item.bindingKey && state.selection.versionNo === item.versionNo} onChange={() => controller.select(item.bindingKey, item.versionNo)}/>
                  <span><strong>{item.modelId}</strong><small>{item.region === 'cn' ? '中国区' : '国际区'} · {item.connectionId} · {String(item.generation.duration)} 秒 · {String(item.generation.resolution)}</small><small>{item.operationKind === 'text-to-video' ? '文字生成视频' : '图片生成视频'} · 账户能力待验证</small></span>
                </label>)}
              </fieldset> : <p className={styles.note}>{state.loading ? '正在读取本机启动配置…' : directory?.status === 'empty' ? '本机尚未登记视频模型。请在宿主配置 providers.json 后重启应用；这里不会要求你输入密钥。' : directory ? '本机模型配置暂不可用。检查宿主配置并重启后，可重新读取；剧本仍保留。' : '连接本机后读取模型配置。'}</p>}
              {state.directoryError && <p role="alert" className={styles.warning}>{state.directoryError}</p>}
              <div className={styles.budget}>
                <label>预算上限<input aria-label="预算上限" inputMode="decimal" value={state.amount} disabled={disabled} maxLength={21} onChange={event => controller.budget(event.target.value, state.currency)}/></label>
                <label>预算币种<select aria-label="预算币种" value={state.currency} disabled={disabled} onChange={event => controller.budget(state.amount, event.target.value === 'USD' ? 'USD' : 'CNY')}><option value="CNY">CNY · 人民币</option><option value="USD">USD · 美元</option></select></label>
              </div>
              <p className={styles.note}>0 表示不允许产生费用。填写上限不等于付款授权；实际生成前仍需确认报价。</p>
              {state.unknown && <p role="alert" className={styles.warning}>上次开局请求的结果待确认。请勿关闭或刷新页面；下方只确认原请求，不会另建一份。</p>}
              <Button type="button" className={styles.submit} disabled={!state.connected || state.datasetChanged || state.busy || (!state.unknown && (state.loading || directory?.status !== 'ready' || !state.selection))}
                onClick={() => void (state.unknown ? controller.confirm() : controller.submit())}>{state.busy ? '正在确认开局…' : state.unknown ? '确认上次开局请求' : '确认开局配置'}</Button>
            </>}
            {state.error && <p role="alert" className={styles.warning}>{state.error}</p>}
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Overlay></Dialog.Portal>
  </Dialog.Root>;
}
