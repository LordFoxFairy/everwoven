import type {Story} from '../../../../packages/domain/src/story';
export const blankStory=():Story=>({id:crypto.randomUUID(),title:'',world:'',opening:'',character:'',personality:'',genre:'浪漫',image:'sea'});
