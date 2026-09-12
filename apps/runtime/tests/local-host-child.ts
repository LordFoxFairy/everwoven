import {initializeLocalHost, exchangeConnectionCode, authenticateSession, withLocalStories} from '../src/host/index.js';
let data = ''; for await (const chunk of process.stdin) data += chunk;
try {
  const {action, directory, code, token, id} = JSON.parse(data);
  if (action === 'init') {
    const m = await initializeLocalHost(directory, 'dev'); process.send?.({ok: true, ownerId: m.ownerId});
  } else if (action === 'exchange') {
    await exchangeConnectionCode(directory, 'dev', code); process.send?.({ok: true});
  } else if (action === 'authenticate') {
    const owner = await authenticateSession(directory, 'dev', token); process.send?.({ok: true, ...owner});
  } else if (action === 'get') {
    const story = await withLocalStories(directory, 'dev', token, (s, o) => s.get(o, id)); process.send?.({ok: true, title: story.title});
  } else {process.send?.({ok: false});}
} catch {process.send?.({ok: false});}
process.disconnect?.();
