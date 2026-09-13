// @vitest-environment jsdom
import {StrictMode} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AuthoringSessionProvider,useAuthoringSession} from './session-context';
import type {AuthoringSession} from './session-client';
afterEach(cleanup);
const datasetId='01994b80-0000-7000-8000-000000000099';
function Probe(){const s=useAuthoringSession();return <><output>{s.state.status}:{s.state.datasetId??'none'}</output><button onClick={()=>void s.connect()}>connect</button><button onClick={s.invalidate}>invalidate</button><input aria-label="draft" defaultValue="retained"/></>;}
function client(){return {session:vi.fn<()=>Promise<AuthoringSession>>().mockResolvedValue({authenticated:true,datasetId}),connect:vi.fn<()=>Promise<AuthoringSession>>().mockResolvedValue({authenticated:true,datasetId}),logout:vi.fn().mockResolvedValue(undefined)};}
it('never checks the host in demo or unconfigured mode',()=>{
 const c=client();const view=render(<AuthoringSessionProvider mode="demo" client={c}><Probe/></AuthoringSessionProvider>);
 expect(screen.getByRole('status').textContent).toBe('demo:none');expect(c.session).not.toHaveBeenCalled();
 view.rerender(<AuthoringSessionProvider mode="unconfigured" client={c}><Probe/></AuthoringSessionProvider>);
 expect(screen.getByRole('status').textContent).toBe('unconfigured:none');expect(c.session).not.toHaveBeenCalled();
});
it('keeps editor mounted through reconnect and obtains dataset from verified session',async()=>{
 const c=client();c.session.mockResolvedValueOnce({authenticated:false});c.connect.mockRejectedValueOnce(Error('offline'));
 render(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);
 await screen.findByText('disconnected:none');fireEvent.change(screen.getByLabelText('draft'),{target:{value:'my text'}});
 fireEvent.click(screen.getByText('connect'));
 await screen.findByText(`connected:${datasetId}`);
 expect(c.connect).toHaveBeenCalledTimes(1);expect(c.connect.mock.calls[0]).toEqual([]);expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('my text');
});
it('invalidation retains prior dataset and ignores late session results',async()=>{
 const c=client();render(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);
 await screen.findByText(`connected:${datasetId}`);
 let resolve!:(s:AuthoringSession)=>void;c.session.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 fireEvent.click(screen.getByText('connect'));await waitFor(()=>expect(c.session).toHaveBeenCalledTimes(2));
 fireEvent.click(screen.getByText('invalidate'));resolve({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000088'});
 await waitFor(()=>expect(screen.getByRole('status').textContent).toBe(`disconnected:${datasetId}`));
});
it('locks same-frame connection attempts and never leaks raw transport errors',async()=>{
 const c=client();c.session.mockResolvedValue({authenticated:false});c.connect.mockRejectedValue(new Error('/private TOKEN'));
 render(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);await screen.findByText('disconnected:none');
 fireEvent.click(screen.getByText('connect'));fireEvent.click(screen.getByText('connect'));
 await waitFor(()=>expect(c.connect).toHaveBeenCalledTimes(2));
 expect(document.body.textContent).not.toContain('/private');
});

it('ignores stale connect refresh and invalidate handles after a mode/client switch',async()=>{
 const a=client(),b=client();let captured!:ReturnType<typeof useAuthoringSession>;
 function Capture(){captured=useAuthoringSession();return <Probe/>;}
 const view=render(<AuthoringSessionProvider mode="local" client={a}><Capture/></AuthoringSessionProvider>);
 await screen.findByText(`connected:${datasetId}`);const stale=captured;
 view.rerender(<AuthoringSessionProvider mode="demo" client={a}><Capture/></AuthoringSessionProvider>);
 await stale.connect();await stale.refresh();stale.invalidate();
 expect(a.connect).not.toHaveBeenCalled();expect(a.session).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('status').textContent).toBe('demo:none');
 view.rerender(<AuthoringSessionProvider mode="local" client={b}><Capture/></AuthoringSessionProvider>);
 await screen.findByText(`connected:${datasetId}`);stale.invalidate();
 expect(screen.getByRole('status').textContent).toBe(`connected:${datasetId}`);
});
it('exposes checking rather than old demo/connected state while a new client is pending',async()=>{
 const a=client(),b=client();let resolve!:(s:AuthoringSession)=>void;b.session.mockImplementation(()=>new Promise(r=>resolve=r));
 const view=render(<AuthoringSessionProvider mode="demo" client={a}><Probe/></AuthoringSessionProvider>);
 view.rerender(<AuthoringSessionProvider mode="local" client={b}><Probe/></AuthoringSessionProvider>);
 expect(screen.getByRole('status').textContent).toBe('checking:none');
 resolve({authenticated:true,datasetId});await screen.findByText(`connected:${datasetId}`);
 let reject!:(e:Error)=>void;a.session.mockImplementation(()=>new Promise((_,r)=>reject=r));
 view.rerender(<AuthoringSessionProvider mode="local" client={a}><Probe/></AuthoringSessionProvider>);
 expect(screen.getByRole('status').textContent).toBe(`checking:${datasetId}`);
 reject(Error('failed'));await screen.findByText(`disconnected:${datasetId}`);
});

it('ignores the first StrictMode request when the second lifetime has already connected',async()=>{
 const c=client();let first!:(value:AuthoringSession)=>void;
 c.session.mockImplementationOnce(()=>new Promise(resolve=>first=resolve));
 render(<StrictMode><AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider></StrictMode>);
 await screen.findByText(`connected:${datasetId}`);expect(c.session).toHaveBeenCalledTimes(2);
 await act(async()=>first({authenticated:false}));
 expect(screen.getByRole('status').textContent).toBe(`connected:${datasetId}`);
});
it('ignores a prior authenticated epoch invalidation after reconnecting with the same client',async()=>{
 const c=client();let captured!:ReturnType<typeof useAuthoringSession>;
 function Capture(){captured=useAuthoringSession();return <Probe/>;}
 render(<AuthoringSessionProvider mode="local" client={c}><Capture/></AuthoringSessionProvider>);
 await screen.findByText(`connected:${datasetId}`);const old=captured;
 await act(async()=>{await captured.connect();});
 expect(c.connect).not.toHaveBeenCalled();expect(c.session).toHaveBeenCalledTimes(2);
 await act(async()=>old.invalidate());
 expect(screen.getByRole('status').textContent).toBe(`connected:${datasetId}`);
});

it('automatically GETs then establishes once, using the POST dataset without another GET',async()=>{
 const c=client();c.session.mockResolvedValue({authenticated:false});
 render(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);
 await screen.findByText(`connected:${datasetId}`);
 expect(c.session).toHaveBeenCalledTimes(1);expect(c.connect).toHaveBeenCalledExactlyOnceWith();
 expect(c.session.mock.invocationCallOrder[0]).toBeLessThan(c.connect.mock.invocationCallOrder[0]!);
});
it('a failed automatic attempt waits for an explicit retry and preserves working input',async()=>{
 const c=client();c.session.mockResolvedValue({authenticated:false});c.connect.mockRejectedValueOnce(Error('TOKEN'));
 const ui=render(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);
 await screen.findByText('disconnected:none');fireEvent.change(screen.getByLabelText('draft'),{target:{value:'retained B'}});
 ui.rerender(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);await act(async()=>{});
 expect(c.session).toHaveBeenCalledTimes(1);expect(c.connect).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByText('connect'));await screen.findByText(`connected:${datasetId}`);
 expect(c.connect).toHaveBeenCalledTimes(2);expect(screen.getByLabelText('draft')).toHaveProperty('value','retained B');
});
it('a failed GET does not attempt establishment and an authenticated GET never POSTs',async()=>{
 const c=client();c.session.mockRejectedValueOnce(Error('offline'));
 render(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);
 await screen.findByText('disconnected:none');expect(c.connect).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('connect'));await screen.findByText(`connected:${datasetId}`);expect(c.connect).not.toHaveBeenCalled();
});
it('fences a late local POST and its finally during a new session attempt',async()=>{
 const c=client();c.session.mockResolvedValue({authenticated:false});let oldResolve!:(s:AuthoringSession)=>void,newResolve!:(s:AuthoringSession)=>void;
 c.connect.mockImplementationOnce(()=>new Promise(r=>oldResolve=r)).mockImplementationOnce(()=>new Promise(r=>newResolve=r));
 render(<AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider>);
 await waitFor(()=>expect(c.connect).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByText('invalidate'));fireEvent.click(screen.getByText('connect'));
 await waitFor(()=>expect(c.connect).toHaveBeenCalledTimes(2));await act(async()=>oldResolve({authenticated:true,datasetId:'01994b80-0000-7000-8000-000000000088'}));
 expect(screen.getByRole('status').textContent).toBe('checking:none');fireEvent.click(screen.getByText('connect'));expect(c.connect).toHaveBeenCalledTimes(2);
 await act(async()=>newResolve({authenticated:true,datasetId}));await screen.findByText(`connected:${datasetId}`);
});
it('StrictMode performs only the current local establishment and unmount ignores its late result',async()=>{
 const c=client();c.session.mockResolvedValue({authenticated:false});let resolve!:(s:AuthoringSession)=>void;
 c.connect.mockImplementationOnce(()=>new Promise(r=>resolve=r));
 const ui=render(<StrictMode><AuthoringSessionProvider mode="local" client={c}><Probe/></AuthoringSessionProvider></StrictMode>);
 await waitFor(()=>expect(c.connect).toHaveBeenCalledTimes(1));ui.unmount();await act(async()=>resolve({authenticated:true,datasetId}));
 expect(c.connect).toHaveBeenCalledTimes(1);
});
