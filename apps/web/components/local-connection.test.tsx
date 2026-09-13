// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AuthoringSessionProvider,useAuthoringSession} from '../lib/authoring/session-context';
import {LocalConnection} from './local-connection';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const datasetId='01994b80-0000-7000-8000-000000000099';
const client=()=>({session:vi.fn().mockResolvedValue({authenticated:false}),connect:vi.fn().mockResolvedValue({authenticated:true,datasetId}),logout:vi.fn()});
it('connects automatically without a code form, terminal instructions or browser storage',async()=>{
 const c=client(),read=vi.spyOn(Storage.prototype,'getItem'),write=vi.spyOn(Storage.prototype,'setItem');
 render(<AuthoringSessionProvider mode="local" client={c}><LocalConnection/></AuthoringSessionProvider>);
 expect(document.querySelector('input,form')).toBeNull();expect(document.body.textContent).not.toMatch(/连接码|终端/);
 await screen.findByText('已连接本机');expect(c.connect).toHaveBeenCalledExactlyOnceWith();expect(c.session).toHaveBeenCalledTimes(1);expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
it('shows configuration separately and performs no connection request in demo',()=>{
 const c=client();const ui=render(<AuthoringSessionProvider mode="unconfigured" client={c}><LocalConnection/></AuthoringSessionProvider>);
 expect(screen.getByText('本机服务尚未启用')).toBeTruthy();expect(document.querySelector('input,form')).toBeNull();
 ui.rerender(<AuthoringSessionProvider mode="demo" client={c}><LocalConnection/></AuthoringSessionProvider>);
 expect(c.session).not.toHaveBeenCalled();expect(c.connect).not.toHaveBeenCalled();expect(document.body.textContent).toBe('');
});
it('one failed attempt offers an explicit retry with no credentials or private diagnostics',async()=>{
 const c=client();c.connect.mockRejectedValueOnce(Error('TOKEN /private/path'));
 render(<AuthoringSessionProvider mode="local" client={c}><LocalConnection/><input aria-label="draft" defaultValue="B"/></AuthoringSessionProvider>);
 const retry=await screen.findByRole('button',{name:'重新连接'});expect(screen.getByRole('alert').textContent).toContain('本机连接失败');expect(document.body.textContent).not.toMatch(/TOKEN|private|连接码|终端/);
 await act(async()=>{});expect(c.connect).toHaveBeenCalledTimes(1);fireEvent.click(retry);await screen.findByText('已连接本机');expect(c.connect).toHaveBeenCalledTimes(2);expect(screen.getByLabelText('draft')).toHaveProperty('value','B');
});
it('keeps a single retry disabled while pending and respects disabled prop',async()=>{
 const c=client();c.connect.mockRejectedValueOnce(Error('offline'));const ui=render(<AuthoringSessionProvider mode="local" client={c}><LocalConnection disabled/></AuthoringSessionProvider>);
 expect((await screen.findByRole('button',{name:'重新连接'}) as HTMLButtonElement).disabled).toBe(true);
 ui.rerender(<AuthoringSessionProvider mode="local" client={c}><LocalConnection/></AuthoringSessionProvider>);
 let resolve!:(s:{authenticated:true;datasetId:string})=>void;c.connect.mockImplementationOnce(()=>new Promise(r=>resolve=r));fireEvent.click(screen.getByRole('button',{name:'重新连接'}));
 await waitFor(()=>expect(c.connect).toHaveBeenCalledTimes(2));expect((screen.getByRole('button',{name:'正在连接…'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>resolve({authenticated:true,datasetId}));await screen.findByText('已连接本机');
});
it('401 invalidation offers reconnect in place and does not trigger automatic attempts',async()=>{
 const c=client();let session!:ReturnType<typeof useAuthoringSession>;
 function Content(){session=useAuthoringSession();return <><LocalConnection/><input aria-label="draft" defaultValue="unknown B"/></>;}
 render(<AuthoringSessionProvider mode="local" client={c}><Content/></AuthoringSessionProvider>);await screen.findByText('已连接本机');
 act(()=>session.invalidate());await screen.findByRole('button',{name:'重新连接'});expect(c.connect).toHaveBeenCalledTimes(1);expect(screen.getByLabelText('draft')).toHaveProperty('value','unknown B');
 fireEvent.click(screen.getByRole('button',{name:'重新连接'}));await screen.findByText('已连接本机');expect(c.connect).toHaveBeenCalledTimes(2);
});
