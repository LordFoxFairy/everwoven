import {expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {OpeningController, budgetFromText} from './opening-controller';
import {OpeningClientError} from './opening-ports';
import {clientFixture, source, choice, datasetId, deferred, directory, opening} from './opening-test-fixtures';
import type {ExperienceOpeningResult} from 'runtime/contracts/experience-opening';
function setup() {
  const client = clientFixture(), binding = {client, connected: true, datasetId, invalidate: vi.fn()}, c = new OpeningController();
  c.bind(binding); c.open(source); return {c, client, binding};
}
async function ready() {const f = setup(); await f.c.load(); f.c.select(choice.bindingKey, choice.versionNo); return f;}
it('binding/open/load/close never create; reopening keeps selected settings', async () => {
  const {c, client} = await ready(); c.budget('1.250001', 'USD'); c.close();
  expect(c.getSnapshot().visible).toBe(false); c.open(source);
  expect(c.getSnapshot()).toMatchObject({visible: true, amount: '1.250001', currency: 'USD'});
  expect(client.create).not.toHaveBeenCalled();
});
it.each([['0', '0'], ['0.000001', '1'], ['1.25', '1250000'], ['9223372036854.775807', '9223372036854775807']])('parses exact decimal %s into %s micros', (text, expected) => {
  expect(budgetFromText(text, 'USD')).toEqual({limitMicros: expected, currency: 'USD'});
});
it.each(['', '-1', '+1', '01', '1e3', 'NaN', '0.0000001', '9223372036854.775808'])('rejects invalid budget %s', text => {
  expect(() => budgetFromText(text, 'CNY')).toThrow();
});
it('requires ready directory, explicit selection and valid amount, without dispatch', async () => {
  const {c, client} = setup(); expect(await c.submit()).toBe(false); await c.load(); expect(await c.submit()).toBe(false);
  c.select('not-registered', 1); expect(await c.submit()).toBe(false); c.select(choice.bindingKey, 1); c.budget('oops', 'CNY'); expect(await c.submit()).toBe(false);
  expect(client.create).not.toHaveBeenCalled();
});
it('freezes saved A revision and one command despite doubleclick, caller changes or field updates', async () => {
  const {c, client} = await ready(), pending = deferred<ExperienceOpeningResult>(); client.create.mockReturnValueOnce(pending.promise);
  c.budget('1.25', 'CNY'); const first = c.submit(), second = c.submit();
  expect(first).toBe(second); expect(client.create).toHaveBeenCalledTimes(1);
  const command = structuredClone(client.create.mock.calls[0]![0]); c.budget('50', 'USD'); c.select('other', 5); c.open({...source, revision: 4});
  expect(command).toMatchObject({storyDraftId: source.id, expectedStoryRevision: 3, budget: {limitMicros: '1250000', currency: 'CNY'}});
  pending.resolve({data: opening(command), replayed: false}); expect(await first).toBe(true);
  expect(c.getSnapshot()).toMatchObject({busy: false, unknown: false, amount: '1.25', confirmed: {canDispatch: false, media: null}});
  expect(await c.submit()).toBe(false); expect(client.create).toHaveBeenCalledTimes(1);
});
it('retains unknown through close/reopen/reconnect and pre-receipt rejection, exact original command only', async () => {
  const {c, client, binding} = await ready(); client.create.mockRejectedValueOnce(new OpeningClientError('OPENING_NETWORK_ERROR', null, 'unknown'));
  expect(await c.submit()).toBe(false); const original = structuredClone(client.create.mock.calls[0]![0]);
  c.close(); c.open({...source, id: v7(), title: 'other'}); c.budget('99', 'USD');
  c.bind({...binding, connected: false}); c.bind({...binding, invalidate: vi.fn()}); await c.load();
  expect(client.create).toHaveBeenCalledTimes(1); expect(c.getSnapshot()).toMatchObject({unknown: true, source: {id: source.id}});
  client.create.mockRejectedValueOnce(new OpeningClientError('INVALID_EXPERIENCE_COMMAND', 400, 'rejected'));
  expect(await c.confirm()).toBe(false); expect(c.getSnapshot().unknown).toBe(true);
  expect(await c.confirm()).toBe(true); expect(client.create.mock.calls.map(([q]) => q)).toEqual([original, original, original]);
});
it('first definitive rejection releases selection, unlike prior unknown', async () => {
  const {c, client} = await ready(); client.create.mockRejectedValueOnce(new OpeningClientError('REVISION_CONFLICT', 409, 'rejected'));
  expect(await c.submit()).toBe(false); expect(c.getSnapshot().unknown).toBe(false); c.budget('2', 'USD');
  expect(c.getSnapshot().amount).toBe('2'); c.close(); expect(c.open({...source, revision: 4})).toBe(true);
});
it('dataset change blocks old replay and keeps source; returning to original dataset allows explicit confirmation', async () => {
  const {c, client, binding} = await ready(); client.create.mockRejectedValueOnce(Error('lost')); await c.submit();
  c.bind({...binding, datasetId: v7()}); expect(c.getSnapshot().datasetChanged).toBe(true);
  expect(await c.confirm()).toBe(false); expect(await c.submit()).toBe(false); expect(client.create).toHaveBeenCalledTimes(1);
  c.bind({...binding, invalidate: vi.fn()}); expect(await c.confirm()).toBe(true);
});
it.each(['resolve', 'reject'] as const)('old attempt %s and finally cannot overwrite or unlock reconfirmation', async outcome => {
  const {c, client, binding} = await ready(), old = deferred<ExperienceOpeningResult>(), next = deferred<ExperienceOpeningResult>();
  client.create.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const original = c.submit(), input = structuredClone(client.create.mock.calls[0]![0]);
  c.bind({...binding, connected: false}); const invalidate = vi.fn(); c.bind({...binding, invalidate});
  const confirmation = c.confirm();
  if (outcome === 'resolve') old.resolve({data: opening(input), replayed: false}); else old.reject(new OpeningClientError('LOCAL_SESSION_INVALID', 401, 'rejected'));
  expect(await original).toBe(false); expect(c.getSnapshot()).toMatchObject({busy: true, unknown: true, confirmed: null}); expect(invalidate).not.toHaveBeenCalled();
  next.resolve({data: opening(input), replayed: true}); expect(await confirmation).toBe(true);
});
it('superseded directory read cannot replace current dataset choices', async () => {
  const {c, client, binding} = setup(), old = deferred<typeof directory>(); client.bindings.mockReturnValueOnce(old.promise);
  const read = c.load(); c.close(); c.bind({...binding, datasetId: v7()}); old.resolve(directory); await read;
  expect(c.getSnapshot().directory).toBeNull(); expect(c.getSnapshot().datasetChanged).toBe(true);
});
it('directory failure does not claim a create is unknown; 401 invalidates captured session only', async () => {
  const {c, client, binding} = setup(); client.bindings.mockRejectedValueOnce(new OpeningClientError('LOCAL_SESSION_INVALID', 401, 'rejected'));
  await c.load(); expect(c.getSnapshot()).toMatchObject({unknown: false, loading: false}); expect(binding.invalidate).toHaveBeenCalledTimes(1);
});
it('empty or invalid provider configuration is not dispatchable and does not erase confirmed history', async () => {
  const {c, client} = await ready(); await c.submit(); const confirmed = c.getSnapshot().confirmed;
  client.bindings.mockResolvedValueOnce({...directory, status: 'unavailable', items: []}); await c.load();
  expect(c.getSnapshot().confirmed).toEqual(confirmed); expect(await c.submit()).toBe(false);
});
it('refresh of confirmed preparation is read-only and verifies current state explicitly', async () => {
  const {c, client} = await ready(); await c.submit(); const saved = c.getSnapshot().confirmed!;
  client.getPreparing.mockResolvedValueOnce(saved); expect(await c.refresh()).toBe(true);
  expect(client.getPreparing).toHaveBeenCalledWith({protocolVersion: 1, datasetId, id: saved.id}); expect(client.create).toHaveBeenCalledTimes(1);
  client.getPreparing.mockRejectedValueOnce(new OpeningClientError('PREPARATION_NO_LONGER_CURRENT', 409, 'rejected'));
  expect(await c.refresh()).toBe(false); expect(c.getSnapshot().current).toBe(false); expect(c.getSnapshot().confirmed).toEqual(saved);
});
it('historical CREATE acknowledgements never assert current preparing, even after unknown replay', async () => {
  const {c, client} = await ready(); client.create.mockRejectedValueOnce(Error('lost')); await c.submit();
  const accepted = opening(client.create.mock.calls[0]![0]); client.create.mockResolvedValueOnce({data: accepted, replayed: true});
  expect(await c.confirm()).toBe(true); expect(c.getSnapshot()).toMatchObject({unknown: false, confirmed: accepted, current: false});
  expect(client.getPreparing).not.toHaveBeenCalled();
  client.getPreparing.mockRejectedValueOnce(new OpeningClientError('PREPARATION_NO_LONGER_CURRENT', 409, 'rejected'));
  expect(await c.refresh()).toBe(false); expect(c.getSnapshot().current).toBe(false);
});
