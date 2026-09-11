import type {RehearsalSave} from '../../components/storage';

/** Creation recency only: legacy browser records have no reliable last-active time. */
export function recentlyOpened(saves: readonly RehearsalSave[]): RehearsalSave | undefined {
  const time = (save: RehearsalSave) => {const value = Date.parse(save.createdAt); return Number.isFinite(value) ? value : -Infinity;};
  return saves.reduce<RehearsalSave | undefined>((latest, save) => !latest || time(save) > time(latest) ? save : latest, undefined);
}

/** Presentation of saved facts, never generated memory or live-provider status. */
export function rehearsalResumeCopy(save: RehearsalSave) {
  const checkpoint = save.mockSession;
  if (!checkpoint) return {label: '早期演练记录', action: '重新进入演练', description: '设定与回应仍在；旧记录没有场景恢复点，将重新演练当前片段。'};
  const hasDraft = Boolean(checkpoint.responseDraft.trim());
  switch (checkpoint.state.phase) {
    case 'awaiting': return hasDraft
      ? {label: '有一段未发送的回应', action: '继续写完回应', description: '回到原来的回应位置。草稿保留，不会自动发送。'}
      : {label: '停在你的回应时刻', action: '继续回应', description: '选一个方向，或用自己的话，决定接下来发生什么。'};
    case 'watching': return {label: '停在静态参考画面', action: '回到参考画面', description: '回到这次演练，模拟片段结束后，再决定下一步。'};
    case 'generating': return {label: '演练准备尚未完成', action: '继续演练准备', description: '从当前阶段继续本地演练，不代表后台有视频正在生成。'};
    case 'failed': return {label: '这一幕演练中断', action: '查看并重试', description: '设定与已记录的回应仍在。回到现场后，由你决定是否重试。'};
  }
}
