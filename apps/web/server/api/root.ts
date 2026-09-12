import {assetRouter} from './assets';
import {characterRouter} from './characters';
import {storyDraftRouter} from './story-drafts';
import {createTRPCRouter, publicMetadataProcedure} from './trpc';
import {readVideoConfiguration} from '../services/video-configuration';
import {videoConfigurationSchema} from '../../contracts/video';

export const appRouter = createTRPCRouter({
  assets: assetRouter,
  storyDrafts: storyDraftRouter,
  characters: characterRouter,
  video: createTRPCRouter({
    configuration: publicMetadataProcedure.output(videoConfigurationSchema)
      .query(({ctx}) => readVideoConfiguration(ctx.env)),
  }),
});
export type AppRouter = typeof appRouter;
