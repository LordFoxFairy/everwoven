import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, rename, rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {checkedDirectory, checkedFile, digest, readSecureJSON, record, recheckTarget, sameFile, unlinkOwned, validatedHost, writeExclusive,
  type HostManifest, type LocalEnvironment, type ValidatedHost} from './storage.js';

const CODE_TTL = 5 * 60_000, SESSION_TTL = 8 * 60 * 60_000;
type Credential = {version: 1; ownerId: string; datasetId: string; environment: LocalEnvironment; issuedAt: number; expiresAt: number};
function validSecret(secret: string) {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, 'base64url').toString('base64url') !== secret) throw new Error('LOCAL_SESSION_INVALID');
}
function validTime(now: number) {if (!Number.isSafeInteger(now) || now < 0) throw new Error('LOCAL_SESSION_INVALID'); return now;}
function credential(manifest: HostManifest, now: number, ttl: number): Credential {
  return {version: 1, ownerId: manifest.ownerId, datasetId: manifest.datasetId, environment: manifest.environment, issuedAt: now, expiresAt: now + ttl};
}
function validateCredential(value: unknown, manifest: HostManifest, now: number, ttl: number): Credential {
  record(value, ['version', 'ownerId', 'datasetId', 'environment', 'issuedAt', 'expiresAt']);
  if (value.version !== 1 || value.ownerId !== manifest.ownerId || value.datasetId !== manifest.datasetId || value.environment !== manifest.environment ||
      typeof value.issuedAt !== 'number' || !Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0 || value.issuedAt > now ||
      typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt !== value.issuedAt + ttl || now >= value.expiresAt) throw new Error('LOCAL_SESSION_INVALID');
  return value as Credential;
}
async function recheckHost(host: ValidatedHost) {
  await recheckTarget(host.target, host.identity);
  const current = await validatedHost(host.target.directory, host.manifest.environment);
  if (!sameFile(current.identity, host.identity) || JSON.stringify(current.manifest) !== JSON.stringify(host.manifest)) throw new Error('LOCAL_SESSION_INVALID');
}
/** Internal clock injection only. Public host functions use Date.now, never a request timestamp. */
export function createSessionOperations(options: {now: () => number} = {now: Date.now}) {
  const now = () => validTime(options.now());
  return {
    async issueConnectionCode(directory: string, environment: LocalEnvironment): Promise<string> {
      try {
        const host = await validatedHost(directory, environment), code = randomBytes(32).toString('base64url');
        await recheckHost(host);
        const path = join(host.target.directory, 'security/codes', `${digest(code)}.json`);
        const identity = await writeExclusive(path, JSON.stringify(credential(host.manifest, now(), CODE_TTL)));
        try {await recheckHost(host);} catch (error) {await unlinkOwned(path, identity); throw error;}
        return code;
      } catch {throw new Error('LOCAL_SESSION_INVALID');}
    },
    async exchangeConnectionCode(directory: string, environment: LocalEnvironment, code: string): Promise<{token: string; expiresAt: number; datasetId: string}> {
      try {
        validSecret(code);
        const host = await validatedHost(directory, environment), source = join(host.target.directory, 'security/codes', `${digest(code)}.json`);
        validateCredential(await readSecureJSON(source), host.manifest, now(), CODE_TTL);
        await recheckHost(host);
        // Reserve a unique empty claim directory: rename can never replace an existing record.
        const claimDirectory = join(host.target.directory, 'security/claims', randomUUID());
        await mkdir(claimDirectory, {mode: 0o700});
        const claimIdentity = await checkedDirectory(claimDirectory), claimed = join(claimDirectory, 'record.json');
        try {
          await rename(source, claimed); // Only one process can remove the source name.
          const identity = await checkedFile(claimed);
          try {
            await recheckHost(host);
            const value = await readSecureJSON(claimed);
            validateCredential(value, host.manifest, now(), CODE_TTL); // Recheck expiry AFTER atomic claim.
            const token = randomBytes(32).toString('base64url'), time = now();
            validateCredential(value, host.manifest, time, CODE_TTL);
            const session = credential(host.manifest, time, SESSION_TTL), path = join(host.target.directory, 'security/sessions', `${digest(token)}.json`);
            const sessionIdentity = await writeExclusive(path, JSON.stringify(session));
            try {await recheckHost(host);} catch (error) {await unlinkOwned(path, sessionIdentity); throw error;}
            return {token, expiresAt: session.expiresAt, datasetId: session.datasetId};
          } finally {await unlinkOwned(claimed, identity);}
        } finally {
          // Only our own empty claim directory; never restore a claimed code after uncertainty.
          if (sameFile(await checkedDirectory(claimDirectory), claimIdentity)) await rmdir(claimDirectory).catch(() => {});
        }
      } catch {throw new Error('LOCAL_SESSION_INVALID');}
    },
    async authenticateSession(directory: string, environment: LocalEnvironment, token: string): Promise<{ownerId: string; datasetId: string}> {
      try {
        validSecret(token); const host = await validatedHost(directory, environment);
        const value = await readSecureJSON(join(host.target.directory, 'security/sessions', `${digest(token)}.json`));
        await recheckHost(host);
        validateCredential(value, host.manifest, now(), SESSION_TTL);
        return {ownerId: host.manifest.ownerId, datasetId: host.manifest.datasetId};
      } catch {throw new Error('LOCAL_SESSION_INVALID');}
    },
    async revokeSession(directory: string, environment: LocalEnvironment, token: string): Promise<void> {
      try {
        validSecret(token); const host = await validatedHost(directory, environment);
        const path = join(host.target.directory, 'security/sessions', `${digest(token)}.json`);
        await recheckHost(host);
        const identity = await checkedFile(path).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
        if (identity) await unlinkOwned(path, identity);
        await recheckHost(host);
      } catch {throw new Error('LOCAL_SESSION_INVALID');}
    },
  };
}
