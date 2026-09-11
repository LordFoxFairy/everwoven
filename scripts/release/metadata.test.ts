import {expect,it} from 'vitest';
import {releaseMetadata} from './metadata.mjs';
it('uses exact release version and lower-case GHCR namespace',()=>{
 expect(releaseMetadata('refs/tags/v0.1.0','0.1.0','LordFoxFairy/everwoven')).toEqual({version:'0.1.0',image:'ghcr.io/lordfoxfairy/everwoven-web',stable:true});
});
it('does not treat prereleases as stable',()=>{
 expect(releaseMetadata('refs/tags/v0.2.0-rc.1','0.2.0-rc.1','LordFoxFairy/everwoven').stable).toBe(false);
});
it.each(['refs/heads/main','refs/tags/latest','refs/tags/v01.2.3','refs/tags/v1.0.0+build','refs/tags/v1.0.0;echo x'])('rejects invalid ref %s',ref=>{
 expect(()=>releaseMetadata(ref,'1.0.0','LordFoxFairy/everwoven')).toThrow();
});
it('rejects a tag/package version mismatch',()=>{
 expect(()=>releaseMetadata('refs/tags/v0.2.0','0.1.0','LordFoxFairy/everwoven')).toThrow('must match');
});
it('rejects malformed numeric prerelease and repository',()=>{
 expect(()=>releaseMetadata('refs/tags/v0.2.0-rc.01','0.2.0-rc.01','LordFoxFairy/everwoven')).toThrow();
 expect(()=>releaseMetadata('refs/tags/v0.1.0','0.1.0','bad\nowner/repo')).toThrow();
});
