import {expect,it} from 'vitest';
import {PassThrough} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {readMaintenanceCode} from '../src/host/asset-maintenance-cli.js';
it.each(['','\n','\r\n'])('reads a chunked code with %j terminator only at EOF',async ending=>{
 const code=randomBytes(32).toString('base64url'),input=new PassThrough();const result=readMaintenanceCode(input);
 input.write(code.slice(0,12));input.write(code.slice(12));input.end(ending);expect(await result).toBe(code);
 expect(input.listenerCount('data')).toBe(0);expect(input.listenerCount('end')).toBe(0);
});
it('deadline stops an open stdin rather than waiting for EOF forever',async()=>{
 const input=new PassThrough(),result=readMaintenanceCode(input,10);input.write('partial');
 await expect(result).rejects.toThrow('LOCAL_HOST_COMMAND_FAILED');expect(input.destroyed).toBe(true);expect(input.listenerCount('data')).toBe(0);
});
it('rejects overflow immediately before EOF, destroys input and never includes secret/error details',async()=>{
 const input=new PassThrough(),result=readMaintenanceCode(input);input.write('SECRET'.repeat(10000));
 await expect(result).rejects.toThrow(/^LOCAL_HOST_COMMAND_FAILED$/);expect(input.destroyed).toBe(true);expect(input.listenerCount('data')).toBe(0);
});
it.each(['error','close'])('handles input %s without leaking diagnostics or leaving collection listeners',async event=>{
 const input=new PassThrough(),result=readMaintenanceCode(input);
 if(event==='error')input.destroy(Error('/private/secret'));else input.destroy();
 await expect(result).rejects.toThrow(/^LOCAL_HOST_COMMAND_FAILED$/);expect(input.listenerCount('data')).toBe(0);
});
