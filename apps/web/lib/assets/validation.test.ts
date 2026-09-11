import {it,expect} from 'vitest';
import {validateImageFile,validateImageDimensions} from './validation';
it('accepts supported raster images only',()=>{expect(()=>validateImageFile({type:'image/png',size:1000})).not.toThrow();expect(()=>validateImageFile({type:'image/svg+xml',size:1000})).toThrow();expect(()=>validateImageFile({type:'image/gif',size:1000})).toThrow();});
it('rejects empty oversized or invalid dimensions',()=>{for(const size of [0,11*1024*1024])expect(()=>validateImageFile({type:'image/png',size})).toThrow();for(const pair of [[0,300],[100,100],[10000,10000],[NaN,300]])expect(()=>validateImageDimensions(pair[0],pair[1])).toThrow();expect(()=>validateImageDimensions(1024,1536)).not.toThrow();});
