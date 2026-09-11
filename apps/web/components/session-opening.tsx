import type {Story} from '../../../packages/domain/src/story';
import styles from './live-session.module.css';

/** Shared context: engine setup never replaces the player's story. */
export function SessionOpening({story}:{story:Story}){
 return <div className={styles.opening}><span className={styles.eyebrow}>你的故事 · 即将发生</span><h1 id="prepare-title">{story.title}</h1><div className={styles.character}><span>{story.character.slice(0,1)}</span><div>{story.character}<small>{story.relationship||'关系由你们的行动展开'}</small></div></div><p className={styles.openingText}>{story.opening}</p><details><summary>世界与人物</summary><p>{story.world}</p><p>{story.personality}</p><p>{story.boundaries}</p></details></div>;
}
