// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AuthoringSessionProvider} from '../lib/authoring/session-context';
import {LocalConnection} from './local-connection';
afterEach(cleanup);
const datasetId='01994b80-0000-7000-8000-000000000099';
it('connects in place and keeps the code out of persistent browser storage',async()=>{
 const client={session:vi.fn().mockResolvedValueOnce({authenticated:false}).mockResolvedValue({authenticated:true,datasetId}),connect:vi.fn().mockResolvedValue(undefined),logout:vi.fn()};
 const write=vi.spyOn(Storage.prototype,'setItem');
 render(<AuthoringSessionProvider mode="local" client={client}><LocalConnection/></AuthoringSessionProvider>);
 const code=await screen.findByLabelText('本机连接码');expect(code.getAttribute('type')).toBe('password');
 fireEvent.change(code,{target:{value:'single-use-code'}});fireEvent.submit(code.closest('form')!);
 await screen.findByText('已连接本机');expect(client.connect).toHaveBeenCalledExactlyOnceWith('single-use-code');expect(write).not.toHaveBeenCalled();
 write.mockRestore();
});
it('shows configuration separately and performs no connection request in demo',()=>{
 const client={session:vi.fn(),connect:vi.fn(),logout:vi.fn()};
 const view=render(<AuthoringSessionProvider mode="unconfigured" client={client}><LocalConnection/></AuthoringSessionProvider>);
 expect(screen.getByText('本机服务尚未启用')).toBeTruthy();expect(screen.queryByLabelText('本机连接码')).toBeNull();
 view.rerender(<AuthoringSessionProvider mode="demo" client={client}><LocalConnection/></AuthoringSessionProvider>);
 expect(client.session).not.toHaveBeenCalled();expect(screen.queryByLabelText('本机连接码')).toBeNull();
});
it('preserves the entered code after a failed connection and offers retry without private errors',async()=>{
 const client={session:vi.fn().mockResolvedValue({authenticated:false}),connect:vi.fn().mockRejectedValue(Error('TOKEN /private/path')),logout:vi.fn()};
 render(<AuthoringSessionProvider mode="local" client={client}><LocalConnection/></AuthoringSessionProvider>);
 const code=await screen.findByLabelText('本机连接码');fireEvent.change(code,{target:{value:'one-time'}});fireEvent.submit(code.closest('form')!);
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('本机连接失败'));
 expect((code as HTMLInputElement).value).toBe('one-time');expect(document.body.textContent).not.toContain('TOKEN');
});
