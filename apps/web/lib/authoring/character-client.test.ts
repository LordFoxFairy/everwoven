import {beforeEach,expect,it,vi} from 'vitest';
import {createAppClient} from '../../trpc/client';
import {createCharacterClient} from './character-client';
vi.mock('../../trpc/client',()=>({createAppClient:vi.fn()}));
const methods={create:{mutate:vi.fn()},get:{query:vi.fn()},list:{query:vi.fn()},update:{mutate:vi.fn()},delete:{mutate:vi.fn()},restore:{mutate:vi.fn()}};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(createAppClient).mockReturnValue({characters:methods} as unknown as ReturnType<typeof createAppClient>);});
const id='01994b80-0000-7000-8000-000000000099';
const create={datasetId:id,commandId:id,name:'未完成的角色',settings:{personality:'',appearance:'',speakingStyle:'',boundaries:''},portraitAssetId:null};
it('delegates all operations without translating IDs or silently creating mock data',async()=>{
 const c=createCharacterClient();const result={confirmed:true};
 for(const method of Object.values(methods))Object.values(method)[0]!.mockResolvedValue(result);
 expect(await c.create(create)).toBe(result);expect(methods.create.mutate).toHaveBeenCalledExactlyOnceWith(create);
 expect(await c.get(id)).toBe(result);expect(methods.get.query).toHaveBeenCalledExactlyOnceWith({id,includeDeleted:true});
 const query={q:'未完成',limit:10,deleted:'only' as const};expect(await c.list(query)).toBe(result);expect(methods.list.query).toHaveBeenCalledExactlyOnceWith(query);
 const update={datasetId:id,commandId:id,id,expectedRevision:1,patch:{name:'更新'}};
 expect(await c.update(update)).toBe(result);expect(methods.update.mutate).toHaveBeenCalledExactlyOnceWith(update);
 const lifecycle={datasetId:id,commandId:id,id,expectedRevision:2};
 expect(await c.delete(lifecycle)).toBe(result);expect(methods.delete.mutate).toHaveBeenCalledExactlyOnceWith(lifecycle);
 expect(await c.restore(lifecycle)).toBe(result);expect(methods.restore.mutate).toHaveBeenCalledExactlyOnceWith(lifecycle);
});
it('keeps ambiguous command failure unchanged and never automatically retries',async()=>{
 const error=Object.assign(new Error('response lost'),{data:{code:'INTERNAL_SERVER_ERROR'}});methods.create.mutate.mockRejectedValue(error);
 await expect(createCharacterClient().create(create)).rejects.toBe(error);
 expect(methods.create.mutate).toHaveBeenCalledTimes(1);
});
