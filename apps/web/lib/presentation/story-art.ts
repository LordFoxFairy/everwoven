import type {Story} from '../../../../packages/domain/src/story';
export const images:Record<string,string>={
 sea:'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1800&q=85',
 city:'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1200&q=85',
 forest:'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1200&q=85',
 room:'https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=1200&q=85'
};
export const characterArt:Record<string,string>={linzhou:'/art/linzhou-v1.png'};
export function storyArtwork(story:Story){return (story.artId&&characterArt[story.artId])||images[story.image]||images.sea;}
