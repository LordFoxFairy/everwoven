import {readFileSync,appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** Deliberately support Docker-safe SemVer tags without build metadata. */
export function releaseMetadata(ref,packageVersion,repository) {
 const match=/^refs\/tags\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/.exec(ref);
 if(!match)throw Error('Expected a vMAJOR.MINOR.PATCH tag (optional prerelease, no build metadata)');
 const version=match[1];
 if(version!==packageVersion)throw Error('Release tag must match root package.json version');
 if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository))throw Error('Invalid GitHub repository');
 const prerelease=version.split('-').slice(1).join('-');
 if(prerelease.split('.').some(x=>/^0\d+$/.test(x)))throw Error('Numeric prerelease identifiers must not have leading zeroes');
 return {version,image:`ghcr.io/${repository.split('/')[0].toLowerCase()}/everwoven-web`,stable:!prerelease};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
 const result=releaseMetadata(process.env.GITHUB_REF??'',pkg.version,process.env.GITHUB_REPOSITORY??'');
 const output=Object.entries(result).map(([key,value])=>`${key}=${value}`).join('\n')+'\n';
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);else process.stdout.write(output);
}
