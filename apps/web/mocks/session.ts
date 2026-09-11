export type DemoState = {phase: 'generating' | 'watching' | 'awaiting' | 'failed'; turn: number};
export type DemoCheckpoint = {version: 1; state: DemoState; responseDraft: string};
export function restoreDemo(checkpoint: DemoCheckpoint | undefined, turns: number): DemoCheckpoint {
  if (checkpoint === undefined) return {version: 1, state: {phase: 'generating', turn: turns}, responseDraft: ''};
  if (!validDemoCheckpoint(checkpoint, turns)) throw Error('演练恢复数据异常，原数据已保留');
  return structuredClone(checkpoint);
}
export function validDemoCheckpoint(checkpoint: unknown, turns: number): checkpoint is DemoCheckpoint {
  if (!checkpoint || typeof checkpoint !== 'object') return false;
  const value = checkpoint as Partial<DemoCheckpoint>;
  return value.version === 1 && typeof value.responseDraft === 'string' && value.responseDraft.length <= 2000
    && !!value.state && typeof value.state === 'object' && Number.isSafeInteger(value.state.turn)
    && value.state.turn >= 0 && value.state.turn === turns
    && ['generating', 'watching', 'awaiting', 'failed'].includes(value.state.phase);
}
export type DemoEvent = {type: 'generated'; turn: number} | {type: 'respond'; text: string} | {type: 'ended' | 'fail' | 'retry'};
export function initialDemoState(): DemoState {return {phase: 'generating', turn: 0};}
/** Frontend state simulation only: no provider, network, world facts or billing. */
export function advanceDemo(state: DemoState, event: DemoEvent): DemoState {
  switch (event.type) {
    case 'generated': return state.phase === 'generating' && event.turn === state.turn ? {...state, phase: 'watching'} : state;
    case 'ended': return state.phase === 'watching' ? {...state, phase: 'awaiting'} : state;
    case 'respond': return state.phase === 'awaiting' && event.text.trim() ? {phase: 'generating', turn: state.turn + 1} : state;
    case 'fail': return state.phase === 'generating' ? {...state, phase: 'failed'} : state;
    case 'retry': return state.phase === 'failed' ? {...state, phase: 'generating'} : state;
  }
}
export function demoSuggestions(character: string) {
  return [
    {id: 'ask', title: `问问${character}`, text: '可以告诉我，你现在在想什么吗？', simulated: true},
    {id: 'act', title: '向前走一步', text: '我走近一些，看看眼前有什么。', simulated: true},
    {id: 'listen', title: '先听你说', text: '我想先听听你的想法。', simulated: true},
  ];
}
