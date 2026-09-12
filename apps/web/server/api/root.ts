import {storyDraftRouter} from './story-drafts';
import {createTRPCRouter, publicMetadataProcedure} from './trpc';
import {readVideoConfiguration} from '../services/video-configuration';
import {videoConfigurationSchema} from '../../contracts/video';

export const appRouter = createTRPCRouter({
  storyDrafts: storyDraftRouter,
  video: createTRPCRouter({
    configuration: publicMetadataProcedure.output(videoConfigurationSchema)
      .query(({ctx}) => readVideoConfiguration(ctx.env)),
  }),
});
export type AppRouter = typeof appRouter;
