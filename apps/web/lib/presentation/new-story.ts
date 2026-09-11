import {createEntityId} from '../../../../packages/domain/src/id';
import type {Story} from '../../../../packages/domain/src/story';
export const blankStory=():Story=>({id:createEntityId(),title:'',world:'',opening:'',character:'',personality:'',genre:'浪漫',image:'sea'});
