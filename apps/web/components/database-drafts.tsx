'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {v7 as uuidv7} from 'uuid';
import type {DraftCreate, DraftDTO, DraftListInput, DraftPage, DraftUpdate, DraftLifecycle} from '../../runtime/src/contracts/story-draft';
import type {DatabaseDraftsClient} from '../lib/authoring/ports';
import {Button} from './ui/button';
import styles from './database-drafts.module.css';

type Fields = {title: string; premise: string; playerRole: string; worldRules: string; tone: string};
type Filter = NonNullable<DraftListInput['deleted']>;
type Mutation = {kind: 'create'; input: DraftCreate} | {kind: 'update'; input: DraftUpdate}
  | {kind: 'delete' | 'restore'; input: DraftLifecycle};
const emptyFields: Fields = {title: '', premise: '', playerRole: '', worldRules: '', tone: ''};
const fieldsOf = (data: DraftDTO): Fields => ({title: data.title, ...data.settings, worldRules: data.settings.worldRules.join('\n')});
const snapshot = (fields: Fields, worldRules: string[]) => JSON.stringify([fields, worldRules]);
const unique = (items: DraftDTO[]) => [...new Map(items.map(item => [item.id, item])).values()];

// Accept plain errors and structured port errors without depending on a transport.
function errorInfo(error: unknown) {
  const obj = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const data = obj.data && typeof obj.data === 'object' ? obj.data as Record<string, unknown> : {};
  const message = typeof obj.message === 'string' ? obj.message : typeof error === 'string' ? error : '操作失败，请重试。';
  const code = data.code ?? obj.code;
  const unauthorized = code === 'UNAUTHORIZED' || obj.status === 401 || data.httpStatus === 401 || message === 'UNAUTHORIZED';
  const forbidden = code === 'FORBIDDEN' || obj.status === 403 || data.httpStatus === 403 || message === 'FORBIDDEN';
  const conflict = code === 'CONFLICT' || code === 'REVISION_CONFLICT' || obj.status === 409 || message.includes('REVISION_CONFLICT');
  const rejected = unauthorized || forbidden || conflict || code === 'BAD_REQUEST' || message === 'INVALID_STORY_COMMAND' || obj.status === 400;
  // HTTP/generic transport refusals describe this attempt, not historical writes.
  // Only explicit domain rejections can settle an already-unknown command; access
  // denial takes precedence even when other error metadata looks business-like.
  const replayRejected = !unauthorized && !forbidden && ['REVISION_CONFLICT', 'INVALID_STORY_COMMAND'].some(reason => code === reason || message === reason);
  return {unauthorized, rejected, replayRejected, message: unauthorized ? '会话已失效，请重新连接；未保存输入仍保留。'
    : forbidden ? '请求被权限或来源边界拒绝，请检查连接配置后重试。' : conflict
    ? '版本冲突：数据库草稿已被修改。当前输入仍保留；请先复制需要保留的内容，再确认重新载入草稿，人工合并后保存。' : message};
}

export function DatabaseDrafts({client, onPendingChange}: {client: DatabaseDraftsClient; onPendingChange?: (s: {dirty: boolean; busy: boolean; unknown?: boolean}) => void}) {
  const fieldId = useId();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState<DraftDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('exclude');
  const [listReady, setListReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<DraftDTO | null>(null);
  const [fields, setFields] = useState<Fields>(emptyFields);
  // A textarea is only a presentation of rules: a stored rule can itself contain
  // newlines. Keep its original array until the user actually edits this field.
  const [worldRules, setWorldRules] = useState<string[]>([]);
  const [baseline, setBaseline] = useState(snapshot(emptyFields, []));
  const [unknown, setUnknown] = useState<Mutation | null>(null);
  const dirty = Boolean(unknown) || (editing && snapshot(fields, worldRules) !== baseline);
  const locked = useRef(false);
  const generation = useRef(0);
  const pendingCallback = useRef(onPendingChange);
  const attempts = useRef(new Map<string, {payload: string; commandId: string}>());

  useEffect(() => {pendingCallback.current = onPendingChange;}, [onPendingChange]);
  useEffect(() => {pendingCallback.current?.({dirty, busy, ...(unknown ? {unknown: true} : {})});}, [dirty, busy, unknown]);
  useEffect(() => () => {pendingCallback.current?.({dirty: false, busy: false});}, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {event.preventDefault(); event.returnValue = '';}
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);

  function fail(cause: unknown) {
    const info = errorInfo(cause);
    setError(info.message);
    if (info.unauthorized) setAuthenticated(false);
  }

  // Ref lock closes the gap before React renders disabled buttons. Generation
  // invalidates responses after unmount/client replacement (including StrictMode).
  async function run(work: (current: () => boolean) => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    const version = generation.current;
    const current = () => version === generation.current;
    setBusy(true); setError('');
    try {await work(current);} catch (cause) {if (current()) fail(cause);}
    finally {if (current()) {locked.current = false; setBusy(false);}}
  }

  function showPage(page: DraftPage, nextFilter: Filter, append = false) {
    setItems(previous => unique(append ? [...previous, ...page.items] : page.items));
    setCursor(page.nextCursor); setFilter(nextFilter); setListReady(true);
  }

  async function checkSession(current: () => boolean) {
    const session = await client.session();
    if (!current()) return;
    setAuthenticated(session.authenticated);
    if (session.authenticated) {
      const page = await client.list({deleted: filter});
      if (current()) showPage(page, filter);
    }
  }

  useEffect(() => {
    locked.current = false;
    void run(checkSession);
    return () => {generation.current += 1;};
    // Recheck only when the injected port changes, not on editor/list state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  function loadList(nextFilter = filter, append = false) {
    void run(async current => {
      const page = await client.list({deleted: nextFilter, ...(append && cursor ? {cursor} : {})});
      if (current()) showPage(page, nextFilter, append);
    });
  }

  function mayDiscard() {
    if (unknown) {setError('上次操作结果尚未确认，请先确认原命令，再切换草稿或退出连接。'); return false;}
    return !locked.current && (!dirty || window.confirm('还有未保存的修改。确定放弃这些输入并继续吗？'));
  }

  function select(data: DraftDTO) {
    const next = fieldsOf(data);
    setSelected(data); setFields(next); setWorldRules(data.settings.worldRules);
    setBaseline(snapshot(next, data.settings.worldRules)); setEditing(true);
  }

  function openDraft(id: string) {
    if (!mayDiscard()) return;
    void run(async current => {
      const data = await client.get(id);
      if (current()) select(data);
    });
  }

  function newDraft() {
    if (!mayDiscard()) return;
    attempts.current.delete('create');
    setSelected(null); setFields(emptyFields); setWorldRules([]); setBaseline(snapshot(emptyFields, [])); setEditing(true); setError('');
  }

  function field(key: keyof Fields, value: string) {
    if (locked.current || fields[key] === value) return;
    // An edited payload is a new command, including an edit back to the old text.
    attempts.current.delete(selected ? `update:${selected.id}` : 'create');
    setFields(previous => ({...previous, [key]: value}));
    if (key === 'worldRules') setWorldRules(value === '' ? [] : value.split('\n'));
  }

  function commandId(scope: string, payload: unknown) {
    const fingerprint = JSON.stringify(payload);
    const previous = attempts.current.get(scope);
    if (previous?.payload === fingerprint) return previous.commandId;
    const commandId = uuidv7();
    attempts.current.set(scope, {payload: fingerprint, commandId});
    return commandId;
  }

  function accept(data: DraftDTO, preserveInput = false) {
    if (preserveInput) {
      setSelected(data); setBaseline(snapshot(fieldsOf(data), data.settings.worldRules));
    } else select(data);
    setItems(previous => {
      const rest = previous.filter(item => item.id !== data.id);
      const belongs = filter === 'only' ? data.deletedAt !== null : data.deletedAt === null;
      return belongs ? [data, ...rest] : rest;
    });
  }

  async function execute(mutation: Mutation, current: () => boolean, confirming = false, preserveInput = false) {
    try {
      const response = mutation.kind === 'create' ? await client.create(mutation.input)
        : mutation.kind === 'update' ? await client.update(mutation.input)
        : await client[mutation.kind](mutation.input);
      if (current()) {
        setUnknown(null);
        attempts.current.delete(mutation.kind === 'create' ? 'create' : `${mutation.kind}:${mutation.input.id}`);
        accept(response.data, confirming || preserveInput);
      }
    } catch (cause) {
      if (current()) {
        const info = errorInfo(cause);
        setUnknown((confirming ? info.replayRejected : info.rejected) ? null : mutation);
      }
      throw cause;
    }
  }

  function confirmUnknown() {
    if (!authenticated || !unknown) return;
    // Replay the immutable original command, never the current form. Once its
    // ID/revision is known, the next explicit save writes the user's newer input.
    void run(current => execute(unknown, current, true));
  }

  function save() {
    if (unknown) {confirmUnknown(); return;}
    if (!authenticated || selected?.deletedAt) return;
    void run(async current => {
      if (!fields.title.trim()) throw new Error('请填写标题。');
      const content = {title: fields.title, settings: {
        premise: fields.premise, playerRole: fields.playerRole,
        worldRules: [...worldRules], tone: fields.tone,
      }};
      const scope = selected ? `update:${selected.id}` : 'create';
      const payload = selected ? {id: selected.id, expectedRevision: selected.revision, patch: content} : content;
      const id = commandId(scope, payload);
      await execute('patch' in payload
        ? {kind: 'update', input: {...payload, commandId: id}}
        : {kind: 'create', input: {...payload, commandId: id}}, current);
    });
  }

  function lifecycle(action: 'delete' | 'restore') {
    if (!authenticated || !selected || locked.current || unknown) return;
    if (action === 'delete' && !window.confirm(dirty
      ? '删除草稿并放弃未保存的输入？数据库中的草稿可在已删除列表恢复。'
      : '删除这个数据库草稿？之后可在已删除列表恢复。')) return;
    void run(async current => {
      const payload = {id: selected.id, expectedRevision: selected.revision};
      const scope = `${action}:${selected.id}`;
      await execute({kind: action, input: {...payload, commandId: commandId(scope, payload)}}, current, false, action === 'restore' && dirty);
    });
  }

  function connect() {
    if (!code.trim() || locked.current) return;
    const submittedCode = code;
    setCode('');
    void run(async current => {
      await client.connect(submittedCode);
      if (current()) await checkSession(current);
    });
  }

  function logout() {
    if (!mayDiscard()) return;
    void run(async current => {
      await client.logout();
      if (!current()) return;
      setAuthenticated(false); setItems([]); setCursor(null); setListReady(false); setCode('');
      setEditing(false); setSelected(null); setFields(emptyFields); setWorldRules([]); setBaseline(snapshot(emptyFields, []));
      attempts.current.clear();
    });
  }

  return <section className={styles.root} aria-label="数据库草稿" aria-busy={busy}>
    <header className={styles.header}>
      <div><h2>数据库草稿</h2><p>目前仅支持世界设定，人物与图片稍后绑定。</p></div>
      {authenticated && <Button variant="outline" disabled={busy} onClick={logout}>退出连接</Button>}
    </header>
    <p className={styles.note}>浏览器草稿另行保留，不自动导入。此处编辑不会修改浏览器草稿。</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {unknown && <p className={styles.note}>上次操作结果待确认。当前输入仍保留；请先按原命令确认结果，再保存新修改。</p>}
    {busy && <p role="status" className={styles.muted}>正在处理，请稍候…</p>}
    {!authenticated && <div className={styles.connection}>
      {authenticated === false && <form aria-label="连接数据库" onSubmit={event => {event.preventDefault(); connect();}}>
        <label>一次性连接码<input type="password" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy}/></label>
        <Button type="submit" disabled={busy || !code.trim()}>连接</Button>
      </form>}
      <Button variant="outline" disabled={busy} onClick={() => void run(checkSession)}>重新检查会话</Button>
      {dirty && <p className={styles.muted}>未保存输入保留在本页内存中，重新连接后可继续保存。</p>}
    </div>}
    {authenticated && <div className={styles.layout}>
      <aside className={styles.library} aria-label="数据库草稿列表">
        <div className={styles.actions}>
          <Button variant="outline" size="sm" aria-pressed={filter === 'exclude'} disabled={busy} onClick={() => loadList('exclude')}>有效</Button>
          <Button variant="outline" size="sm" aria-pressed={filter === 'only'} disabled={busy} onClick={() => loadList('only')}>已删除</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => loadList()}>刷新列表</Button>
        </div>
        <Button variant="outline" disabled={busy} onClick={newDraft}>新建数据库草稿</Button>
        {!listReady && !busy && <p className={styles.muted}>列表尚未载入，请刷新列表重试。</p>}
        {listReady && items.length === 0 && <p className={styles.muted}>{filter === 'only' ? '暂无已删除草稿。' : '暂无数据库草稿，从一个世界设定开始。'}</p>}
        <ul className={styles.list}>{items.map(item => <li key={item.id}>
          <button className={styles.item} aria-label={`${item.deletedAt ? '查看' : '编辑'} ${item.title}`} aria-current={selected?.id === item.id ? 'true' : undefined} disabled={busy} onClick={() => openDraft(item.id)}>
            <strong>{item.title}</strong><small>修订 {item.revision}{item.deletedAt ? ' · 已删除' : ''}</small>
          </button>
        </li>)}</ul>
        {cursor && <Button variant="outline" disabled={busy} onClick={() => loadList(filter, true)}>加载更多</Button>}
      </aside>
      <div className={styles.editor}>
        {!editing ? <p className={styles.muted}>选择一个草稿继续编辑，或新建世界设定。</p> : <form aria-label="世界设定" onSubmit={event => {event.preventDefault(); save();}}>
          <div className={styles.editorHeader}><h3>{selected ? '世界设定' : '新建世界设定'}</h3>
            <p role="status" className={styles.muted}>{dirty ? '有未保存修改' : selected ? `${selected.deletedAt ? '已删除' : '已保存'} · 修订 ${selected.revision}` : '尚未创建'}</p>
          </div>
          <fieldset disabled={busy || Boolean(selected?.deletedAt)} className={styles.fields}>
            <label><span id={`${fieldId}-title`}>{'标题'}</span><input aria-labelledby={`${fieldId}-title`} value={fields.title} onChange={event => field('title', event.target.value)} maxLength={120}/></label>
            <label><span id={`${fieldId}-premise`}>{'故事前提'}</span><textarea aria-labelledby={`${fieldId}-premise`} value={fields.premise} onChange={event => field('premise', event.target.value)} rows={4} maxLength={12000}/></label>
            <label><span id={`${fieldId}-playerRole`}>{'玩家身份'}</span><textarea aria-labelledby={`${fieldId}-playerRole`} value={fields.playerRole} onChange={event => field('playerRole', event.target.value)} rows={2} maxLength={4000}/></label>
            <label><span id={`${fieldId}-worldRules`}>{'世界规则（每行一条）'}</span><textarea aria-labelledby={`${fieldId}-worldRules`} value={fields.worldRules} onChange={event => field('worldRules', event.target.value)} rows={4}/></label>
            <label><span id={`${fieldId}-tone`}>{'语气'}</span><input aria-labelledby={`${fieldId}-tone`} value={fields.tone} onChange={event => field('tone', event.target.value)} maxLength={500}/></label>
          </fieldset>
          <div className={styles.actions}>
            {unknown ? <Button type="button" disabled={busy} onClick={confirmUnknown}>{unknown.kind === 'delete' ? '确认上次删除' : unknown.kind === 'restore' ? '确认上次恢复' : '确认上次保存'}</Button>
              : selected?.deletedAt ? <Button type="button" disabled={busy} onClick={() => lifecycle('restore')}>恢复草稿</Button>
              : <Button type="submit" disabled={busy || (!dirty && Boolean(selected))}>{busy ? '保存中…' : selected ? '保存' : '创建草稿'}</Button>}
            {selected && <Button type="button" variant="outline" disabled={busy} onClick={() => openDraft(selected.id)}>重新载入草稿</Button>}
            {selected && !selected.deletedAt && !unknown && <Button type="button" variant="outline" disabled={busy} onClick={() => lifecycle('delete')}>删除草稿</Button>}
          </div>
        </form>}
      </div>
    </div>}
  </section>;
}
