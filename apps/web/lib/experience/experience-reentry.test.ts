import {expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import {OpeningController} from './opening-controller';
import {OpeningClientError} from './opening-ports';
import {clientFixture, datasetId, source, opening, deferred} from './opening-test-fixtures';
import type {ExperienceOpeningDTO} from 'runtime/contracts/experience-opening';
import type {ExperiencePage} from 'runtime/contracts/experience-directory';
function setup() {const client = clientFixture(), c = new OpeningController(), binding = {client, connected: true, datasetId, invalidate: vi.fn()}; c.bind(binding); return {c, client, binding};}
it('reenters an existing frozen opening without pretending it is a DraftDTO or creating anything', async () => {
  const {c, client} = setup(), dto = opening(); dto.budget.limitMicros = '1234567'; client.getPreparing.mockResolvedValue(dto);
  expect(await c.openExisting(dto.id)).toBe(true);
  expect(c.getSnapshot()).toMatchObject({origin: 'existing', source: null, confirmed: dto, current: true, visible: true, amount: '1.234567'});
  expect(await c.submit()).toBe(false); expect(client.create).not.toHaveBeenCalled(); expect(client.bindings).not.toHaveBeenCalled();
  c.close(); expect(c.getSnapshot().confirmed).toEqual(dto);
});
it('keeps unknown original intent rather than replacing it with a listed experience', async () => {
  const {c, client} = setup(); c.open(source); await c.load(); c.select('video', 1); client.create.mockRejectedValueOnce(Error('lost')); await c.submit(); c.close();
  expect(await c.openExisting(v7())).toBe(false); expect(c.getSnapshot()).toMatchObject({visible: true, unknown: true, source: {id: source.id}, origin: 'draft'});
  expect(client.getPreparing).not.toHaveBeenCalled();
});
it.each(['resolve', 'reject'] as const)('late existing read %s cannot overwrite or unlock a new dataset read', async result => {
  const {c, client, binding} = setup(), old = deferred<ExperienceOpeningDTO>(), next = deferred<ExperienceOpeningDTO>();
  const a = opening(), b = opening(); client.getPreparing.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const oldTask = c.openExisting(a.id); c.bind({...binding, invalidate: vi.fn()}); const newTask = c.openExisting(b.id);
  if (result === 'resolve') old.resolve(a); else old.reject(new OpeningClientError('LOCAL_SESSION_INVALID', 401, 'rejected'));
  expect(await oldTask).toBe(false); expect(c.getSnapshot()).toMatchObject({reading: true, confirmed: null}); expect(binding.invalidate).not.toHaveBeenCalled();
  next.resolve(b); expect(await newTask).toBe(true); expect(c.getSnapshot().confirmed?.id).toBe(b.id);
});
it('closing a read or starting a draft supersedes its late result', async () => {
  const {c, client} = setup(), response = deferred<ExperienceOpeningDTO>(), dto = opening(); client.getPreparing.mockReturnValueOnce(response.promise);
  const task = c.openExisting(dto.id); c.close(); c.open(source); response.resolve(dto);
  expect(await task).toBe(false); expect(c.getSnapshot()).toMatchObject({origin: 'draft', source, confirmed: null});
});
it('list reads work without a draft; dataset changes fence late list pages', async () => {
  const {c, client, binding} = setup(), response = deferred<ExperiencePage>(); client.list.mockReturnValueOnce(response.promise);
  const task = c.loadExperiences(); c.bind({...binding, datasetId: v7()}); response.resolve({protocolVersion: 1, datasetId, items: [], nextCursor: null}); await task;
  expect(c.getSnapshot()).toMatchObject({listReady: false, listLoading: false, items: []}); expect(client.create).not.toHaveBeenCalled();
});
it('list errors retain prior page but never mark a mutation unknown', async () => {
  const {c, client, binding} = setup(); await c.loadExperiences(); client.list.mockRejectedValueOnce(new OpeningClientError('LOCAL_SESSION_INVALID', 401, 'rejected'));
  await c.loadExperiences(); expect(c.getSnapshot()).toMatchObject({unknown: false, listLoading: false, listReady: true}); expect(binding.invalidate).toHaveBeenCalledTimes(1);
});
