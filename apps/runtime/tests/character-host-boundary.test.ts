import {beforeEach, describe, expect, it, vi} from 'vitest';
const fixture = vi.hoisted(() => ({
  owner: {ownerId: '01994b80-0000-7000-8000-000000000001', datasetId: '01994b80-0000-7000-8000-000000000002'},
  authenticate: vi.fn(), validatedHost: vi.fn(), open: vi.fn(), disconnect: vi.fn(), compose: vi.fn(),
}));
vi.mock('../src/host/sessions.js', () => ({createSessionOperations: () => ({authenticateSession: fixture.authenticate})}));
vi.mock('../src/host/storage.js', () => ({validatedHost: fixture.validatedHost, checkedFile: vi.fn(), recheckTarget: vi.fn(),
  initializeLocalHost: vi.fn(), readLocalHost: vi.fn()}));
vi.mock('../src/infrastructure/db/client.js', () => ({openRuntimeDatabase: fixture.open}));
vi.mock('../src/composition/character-service.js', () => ({createCharacterService: fixture.compose}));
import {withLocalCharacters} from '../src/host/index.js';
beforeEach(() => {
  vi.resetAllMocks(); fixture.authenticate.mockResolvedValue({...fixture.owner});
  fixture.validatedHost.mockResolvedValue({target: {directory: '/isolated'}, identity: {}, manifest: {...fixture.owner}});
  fixture.open.mockResolvedValue({$disconnect: fixture.disconnect}); fixture.compose.mockReturnValue({});
});
describe('character host trusted dataset double authentication', () => {
  it.each(['ownerId', 'datasetId'] as const)('rejects manifest %s mismatch before database open', async key => {
    fixture.validatedHost.mockResolvedValue({target: {directory: '/isolated'}, identity: {}, manifest: {...fixture.owner, [key]: '01994b80-0000-7000-8000-000000000099'}});
    const work = vi.fn(); await expect(withLocalCharacters('/isolated', 'dev', 'token', work)).rejects.toThrow(key === 'datasetId' ? 'DATASET_CHANGED' : 'LOCAL_CHARACTERS_FAILED');
    expect(fixture.open).not.toHaveBeenCalled(); expect(work).not.toHaveBeenCalled();
  });
  it.each(['ownerId', 'datasetId'] as const)('compares second authentication %s before invoking work', async key => {
    fixture.authenticate.mockResolvedValueOnce({...fixture.owner}).mockResolvedValueOnce({...fixture.owner, [key]: '01994b80-0000-7000-8000-000000000099'});
    const work = vi.fn(); await expect(withLocalCharacters('/isolated', 'dev', 'token', work)).rejects.toThrow(key === 'datasetId' ? 'DATASET_CHANGED' : 'LOCAL_CHARACTERS_FAILED');
    expect(work).not.toHaveBeenCalled(); expect(fixture.compose).not.toHaveBeenCalled(); expect(fixture.disconnect).toHaveBeenCalledOnce();
  });
  it('passes exactly the trusted owner and dataset when all identities match', async () => {
    const work = vi.fn().mockResolvedValue('ok');
    await expect(withLocalCharacters('/isolated', 'dev', 'token', work)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledWith({}, fixture.owner); expect(fixture.authenticate).toHaveBeenCalledTimes(2);
  });
});
