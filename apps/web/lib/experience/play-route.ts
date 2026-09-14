export type PlayRoute = {experienceId: string; datasetId: string; quoteId?: string; confirming?: boolean;forkCommandId?:string};
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Only opaque navigation IDs live in the URL. Story text, API keys and provider URLs never do. */
export function readPlayRoute(hash: string): PlayRoute | null {
 const query = new URLSearchParams(hash.replace(/^#/, '')), experienceId = query.get('play'), datasetId = query.get('dataset'), quoteId = query.get('quote'),forkCommandId=query.get('fork');
 if (!experienceId || !datasetId || !id.test(experienceId) || !id.test(datasetId) || (quoteId !== null && !id.test(quoteId)) || (forkCommandId!==null&&!id.test(forkCommandId))) return null;
 return {experienceId, datasetId,...(forkCommandId?{forkCommandId}:{}), ...(quoteId ? {quoteId, confirming: query.get('confirm') === '1'} : {})};
}
export function writePlayRoute(route: PlayRoute | null) {
 const url = new URL(window.location.href);
 url.hash = route ? new URLSearchParams({play: route.experienceId, dataset: route.datasetId, ...(route.quoteId ? {quote: route.quoteId} : {}), ...(route.confirming ? {confirm: '1'} : {}),...(route.forkCommandId?{fork:route.forkCommandId}:{})}).toString() : '';
 window.history.replaceState(null, '', url);
}
