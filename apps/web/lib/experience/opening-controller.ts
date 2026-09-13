import {v7} from 'uuid';
import type {DraftDTO} from 'runtime/contracts/story-draft';
import type {CreateExperience, ExperienceBudget, ExperienceOpeningDTO} from 'runtime/contracts/experience-opening';
import type {BindingDirectory} from 'runtime/contracts/video-binding-registry';
import {parseBudget, parseCreateExperience} from 'runtime/contracts/experience-opening-validation';
import {OpeningClientError, type OpeningClient} from './opening-ports';

type Binding = {client: OpeningClient; connected: boolean; datasetId: string | null; invalidate: () => void};
export type OpeningState = {
  visible: boolean; source: DraftDTO | null; connected: boolean; datasetChanged: boolean;
  directory: BindingDirectory | null; loading: boolean; selection: {bindingKey: string; versionNo: number} | null;
  amount: string; currency: ExperienceBudget['currency']; busy: boolean; unknown: boolean;
  confirmed: ExperienceOpeningDTO | null; current: boolean; reading: boolean; error: string; directoryError: string;
};
export function budgetFromText(text: string, currency: ExperienceBudget['currency']): ExperienceBudget {
  if (!/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/.test(text)) throw Error('请输入有效金额，最多六位小数。');
  const [whole, fraction = ''] = text.split('.');
  return parseBudget({limitMicros: (BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString(), currency});
}
function failure(error: unknown) {
  const e = error instanceof OpeningClientError ? error : null;
  const messages: Partial<Record<OpeningClientError['code'], string>> = {
    REVISION_CONFLICT: '剧本已被更新，请返回编辑，保存并重新确认准备内容。', STORY_ARCHIVED: '剧本已归档，请先恢复。',
    STORY_ASSET_NOT_READY: '剧本中有图片尚未就绪，请返回编辑检查素材。', PROVIDER_BINDING_CONFLICT: '模型连接已变更，请由本机更新配置版本后重新准备。',
    PROVIDER_BINDING_NOT_REGISTERED: '该模型配置已不在启动目录中，请重新读取配置。',
    PROVIDER_CONFIGURATION_UNAVAILABLE: '本机模型配置暂不可用，已有内容仍保留。', PROVIDER_NOT_INITIALIZED: '本机模型配置尚未初始化，请检查启动状态。',
    PREPARATION_NO_LONGER_CURRENT: '这段旅程已离开初始准备状态；这里保留的是开局记录，不是当前播放状态。',
    EXPERIENCE_NOT_FOUND: '未找到该准备记录；保留当前确认信息，请检查本机数据。',
    LOCAL_SESSION_INVALID: '本机连接已失效，请重连后手动确认。', LOCAL_ORIGIN_DENIED: '当前连接来源校验失败，请检查本机入口。',
    DATASET_CHANGED: '本机数据集发生变化，原准备内容已保留，不会提交到另一个数据集。', CLIENT_RELOAD_REQUIRED: '客户端协议需更新，请先保留当前内容。',
  };
  return {message: e && messages[e.code] || '准备请求未得到可靠确认，内容仍保留。',
    definitive: e?.outcome === 'rejected', denied: e?.status === 401 || e?.status === 403, reset: e?.status === 412};
}
/** One preparation intent; lifetime belongs to the workspace, not its dismissible dialog. */
export class OpeningController {
  private state: OpeningState = {visible: false, source: null, connected: false, datasetChanged: false, directory: null, loading: false, selection: null,
    amount: '0', currency: 'CNY', busy: false, unknown: false, confirmed: null, current: false, reading: false, error: '', directoryError: ''};
  private binding: Binding | null = null; private epoch = 0; private readSequence = 0; private directorySequence = 0;
  private pending: CreateExperience | null = null; private flight: Promise<boolean> | null = null; private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = () => this.state;
  private publish(patch: Partial<OpeningState>) {this.state = {...this.state, ...patch}; this.listeners.forEach(fn => fn());}
  private fence() {this.epoch++; this.readSequence++; this.directorySequence++; this.flight = null;
    this.publish({busy: false, reading: false, loading: false, ...(this.pending ? {unknown: true} : {})});}
  bind(next: Binding) {
    const old = this.binding;
    if (old && old.client === next.client && old.connected === next.connected && old.datasetId === next.datasetId && old.invalidate === next.invalidate) return;
    this.fence(); this.binding = next;
    this.publish({connected: next.connected, directory: null,
      datasetChanged: Boolean(this.state.source && next.datasetId !== this.state.source.datasetId)});
  }
  suspend() {this.fence();}
  private usable() {return Boolean(this.binding?.connected && this.state.connected && this.state.source && !this.state.datasetChanged);}
  private locked() {return Boolean(this.pending || this.state.busy || this.state.confirmed);}
  open(source: DraftDTO): boolean {
    this.publish({visible: true});
    if (this.pending) return false;
    const old = this.state.source;
    if (old?.datasetId === source.datasetId && old.id === source.id && old.revision === source.revision) return true;
    this.fence();
    this.publish({source: structuredClone(source), datasetChanged: source.datasetId !== this.binding?.datasetId, directory: null, selection: null,
      amount: '0', currency: 'CNY', unknown: false, confirmed: null, current: false, error: '', directoryError: ''});
    return true;
  }
  close() {this.directorySequence++; this.readSequence++; this.publish({visible: false, loading: false, reading: false});}
  select(bindingKey: string, versionNo: number) {
    if (this.locked()) return;
    const found = this.state.directory?.items.find(x => x.bindingKey === bindingKey && x.versionNo === versionNo);
    this.publish({selection: found ? {bindingKey, versionNo} : null, error: ''});
  }
  budget(amount: string, currency: ExperienceBudget['currency']) {if (!this.locked()) this.publish({amount, currency, error: ''});}
  async load() {
    const b = this.binding; if (!this.usable() || !b?.datasetId) return;
    const epoch = this.epoch, sequence = ++this.directorySequence, current = () => epoch === this.epoch && sequence === this.directorySequence;
    this.publish({loading: true, directoryError: ''});
    try {
      const directory = await b.client.bindings({protocolVersion: 1, datasetId: b.datasetId}); if (!current()) return;
      const selected = this.state.selection, retained = directory.items.some(x => x.bindingKey === selected?.bindingKey && x.versionNo === selected.versionNo);
      this.publish({directory, ...(!this.locked() && !retained ? {selection: null} : {})});
    } catch (error) {if (current()) {const info = failure(error); this.publish({directoryError: info.message}); if (info.denied || info.reset) b.invalidate();}}
    finally {if (current()) this.publish({loading: false});}
  }
  submit(): Promise<boolean> {
    if (this.flight) return this.flight;
    if (this.pending || !this.usable() || this.state.confirmed) return Promise.resolve(false);
    const {source, selection, directory, amount, currency} = this.state;
    if (!source || source.deletedAt || source.archivedAt || directory?.status !== 'ready' || !selection ||
      !directory.items.some(x => x.bindingKey === selection.bindingKey && x.versionNo === selection.versionNo)) {
      this.publish({error: '请先选择本机模型配置；归档或删除的剧本须先恢复。'}); return Promise.resolve(false);
    }
    try {
      const command = parseCreateExperience({protocolVersion: 1, datasetId: source.datasetId, commandId: v7(), storyDraftId: source.id,
        expectedStoryRevision: source.revision, bindingKey: selection.bindingKey, expectedBindingVersion: selection.versionNo, budget: budgetFromText(amount, currency)});
      return this.execute(command);
    } catch {this.publish({error: '请检查预算金额，最多六位小数，且不超过本机支持的金额上限。'}); return Promise.resolve(false);}
  }
  confirm(): Promise<boolean> {
    if (this.flight) return this.flight;
    if (!this.pending || !this.usable()) return Promise.resolve(false);
    return this.execute(this.pending);
  }
  private execute(command: CreateExperience): Promise<boolean> {
    const b = this.binding!; if (command.datasetId !== b.datasetId) return Promise.resolve(false);
    const epoch = this.epoch, current = () => this.epoch === epoch && this.pending === command;
    // Install the lock before notifying subscribers, including same-frame double clicks.
    let finish!: (value: boolean) => void; const task = new Promise<boolean>(resolve => {finish = resolve;});
    this.flight = task; this.pending = command; this.publish({busy: true, error: ''});
    void (async () => {
      try {
        const result = await b.client.create(structuredClone(command)); if (!current()) return false;
        this.pending = null; this.publish({confirmed: result.data, current: false, unknown: false, busy: false}); return true;
      } catch (error) {
        if (current()) {
          const info = failure(error), unknown = this.state.unknown || !info.definitive || info.reset;
          if (!unknown) this.pending = null;
          this.publish({unknown, error: info.message, busy: false}); if (info.denied || info.reset) b.invalidate();
        }
        return false;
      } finally {if (epoch === this.epoch) {this.flight = null; this.publish({busy: false});}}
    })().then(finish);
    return task;
  }
  async refresh(): Promise<boolean> {
    const b = this.binding, dto = this.state.confirmed;
    if (!this.usable() || !b || !dto || this.state.busy) return false;
    const epoch = this.epoch, sequence = ++this.readSequence, current = () => epoch === this.epoch && sequence === this.readSequence;
    this.publish({reading: true, error: ''});
    try {
      const result = await b.client.getPreparing({protocolVersion: 1, datasetId: dto.datasetId, id: dto.id}); if (!current()) return false;
      this.publish({confirmed: result, current: true}); return true;
    } catch (error) {
      if (current()) {const info = failure(error); this.publish({current: false, error: info.message}); if (info.denied || info.reset) b.invalidate();}
      return false;
    } finally {if (current()) this.publish({reading: false});}
  }
}
