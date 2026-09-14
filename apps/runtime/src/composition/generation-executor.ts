import type {GenerationExecutor, GenerationContext, PrivateSceneMedia} from '../application/generation-worker.js';
import {createSceneDirector, type SceneDirectorDependencies, type SceneFrameEvidence} from '../application/scene-director.js';
import type {PinnedProfile} from '../ports/execution-profile-store.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import {createTextObservationRecorder} from '../application/text-observations.js';
import type {RuntimeServices} from '../application/runtime-services.js';

export type GenerationExecutorDependencies = SceneDirectorDependencies & {
  /** Pure installed adapter/media-policy readiness check; must not read keys or perform I/O in the SQLite gate. */
  assertVideoProfile(profile: PinnedProfile): void;
  jobs: GenerationExecutor['jobs'];
  frames?: GenerationExecutor['frames'];
  materialize: GenerationExecutor['materialize'];
  /** Reads only this context's verified private media and returns chronological JPEG samples. */
  sample(context: GenerationContext, media: PrivateSceneMedia, signal?: AbortSignal): Promise<SceneFrameEvidence>;
};
/** Joins text, video jobs and private-media evidence under the existing durable Worker lifecycle. */
export function createGenerationExecutor(dependencies: GenerationExecutorDependencies): GenerationExecutor {
  const director = createSceneDirector(dependencies);
  return {
    assertProfile(profile) {director.assertProfile(profile);dependencies.assertVideoProfile(profile);},
    plan: context => director.plan(context, context.signal),
    jobs: dependencies.jobs,
    ...(dependencies.frames ? {frames: dependencies.frames} : {}),
    materialize: dependencies.materialize,
    async validate(context, media) {
      context.signal?.throwIfAborted();
      const evidence = await dependencies.sample(context, media, context.signal);
      context.signal?.throwIfAborted();
      return director.validate(context, media, evidence, context.signal);
    },
  };
}

/** Production composition owns the durable observation sink; callers supply provider/media adapters only. */
export function createPersistedGenerationExecutor(db: PrismaClient, owner: InternalOwnerContext, authority: LocalStoreAuthority,
 dependencies: Omit<GenerationExecutorDependencies, 'observe'>, services?: RuntimeServices): GenerationExecutor {
  return createGenerationExecutor({...dependencies, observe: createTextObservationRecorder(db, owner, authority, services)});
}
