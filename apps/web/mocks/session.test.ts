import {describe, expect, it} from 'vitest';
import {initialDemoState, advanceDemo, demoSuggestions, restoreDemo, validDemoCheckpoint} from './session';

describe('frontend segmented rehearsal', () => {
  it('restores a versioned mock checkpoint without advancing or discarding its draft', () => {
    const checkpoint = {version: 1 as const, state: {phase: 'awaiting' as const, turn: 2}, responseDraft: '尚未发送'};
    const restored = restoreDemo(checkpoint, 2);
    expect(restored).toEqual(checkpoint);
    restored.responseDraft = 'changed';
    expect(checkpoint.responseDraft).toBe('尚未发送');
  });
  it('rejects corrupted or inconsistent checkpoints instead of replacing them', () => {
    expect(validDemoCheckpoint({version: 2, state: {phase: 'awaiting', turn: 0}, responseDraft: ''}, 0)).toBe(false);
    expect(validDemoCheckpoint({version: 1, state: {phase: 'awaiting', turn: 2}, responseDraft: ''}, 1)).toBe(false);
    expect(validDemoCheckpoint({version: 1, state: {phase: 'unknown', turn: 0}, responseDraft: ''}, 0)).toBe(false);
  });
  it('offers no response until the current simulated segment has ended', () => {
    let state = initialDemoState();
    expect(advanceDemo(state, {type: 'respond', text: 'hello'})).toEqual(state);
    state = advanceDemo(state, {type: 'generated', turn: 0});
    expect(state.phase).toBe('watching');
    expect(advanceDemo(state, {type: 'respond', text: 'hello'})).toEqual(state);
    state = advanceDemo(state, {type: 'ended'});
    expect(state.phase).toBe('awaiting');
    expect(advanceDemo(state, {type: 'respond', text: 'hello'})).toMatchObject({phase: 'generating', turn: 1});
  });
  it('ignores repeated responses and stale completion callbacks', () => {
    const waiting = advanceDemo(advanceDemo(initialDemoState(), {type: 'generated', turn: 0}), {type: 'ended'});
    const next = advanceDemo(waiting, {type: 'respond', text: 'next'});
    expect(advanceDemo(next, {type: 'respond', text: 'twice'})).toEqual(next);
    expect(advanceDemo(next, {type: 'generated', turn: 0})).toEqual(next);
  });
  it('retains the round on failure and retries without making a new intent', () => {
    const failed = advanceDemo(initialDemoState(), {type: 'fail'});
    expect(failed.phase).toBe('failed');
    expect(advanceDemo(failed, {type: 'retry'})).toEqual(initialDemoState());
  });
  it('supplies independent, explicitly simulated suggestions', () => {
    const choices = demoSuggestions('遥');
    expect(choices).toHaveLength(3);
    expect(choices.every(choice => choice.simulated)).toBe(true);
    choices[0]!.text = 'modified';
    expect(demoSuggestions('遥')[0]!.text).not.toBe('modified');
  });
});
