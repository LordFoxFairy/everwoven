import type {Story} from '../../../packages/domain/src/story';

// Frontend fixtures only: never seeded into user data or imported by the server.
const examples:Story[]=[
 {id:'demo-sea',artId:'linzhou',appearance:'深色短发、暖棕色眼睛，偏爱浅色针织衫。',speakingStyle:'语气温和，认真倾听，不急着替你下结论。',relationship:'初次相遇',boundaries:'尊重距离，不预设亲密关系，不替玩家表达情感。',title:'在潮声之间',world:'一座安静的海边小镇。你刚搬到这里，一切关系都尚未开始。',opening:'傍晚，你走进一家临海的书店。接下来由你决定。',character:'林舟',personality:'温和、细心，有自己的边界。',genre:'浪漫',image:'sea'},
 {id:'demo-city',title:'城市还没睡',world:'夜晚的现代都市，陌生人的生活偶然交汇。',opening:'末班车刚刚离站，你看见一个熟悉的身影。',character:'季白',personality:'理性、坦诚，偶尔幽默。',genre:'都市',image:'city'},
 {id:'demo-forest',title:'森林的另一端',world:'一片会随记忆改变的森林，没有预设的终点。',opening:'小径分向两侧，一位旅人停下来向你问路。',character:'遥',personality:'好奇、独立，珍惜承诺。',genre:'奇幻',image:'forest'},
 {id:'demo-room',title:'和你一起的日常',world:'一家开放到深夜的小店。故事发生在平凡的日常里。',opening:'今天是你第一次来这里。窗边还有一个空位。',character:'许言',personality:'自在、真诚，喜欢认真倾听。',genre:'日常',image:'room'}
];

export function listExampleStories(): Story[] {return structuredClone(examples);}
