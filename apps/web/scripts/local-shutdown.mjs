/** Own shutdown of this listener only; never inspect or stop other processes. */
export function createLocalShutdown(server, closeApp, {exit = process.exit, graceMs = 5000, timeoutMs = 10000, onStopping = async () => {}} = {}) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const requests = new Set();
  let pending;
  const shutdown = () => pending ??= new Promise(resolve => {
    const background = Promise.resolve().then(onStopping);
    void background.catch(() => {});
    let finished = false;
    const finish = code => {
      if (finished) return;
      finished = true;
      clearTimeout(drain);
      clearTimeout(deadline);
      resolve(code);
      exit(code);
    };
    // server.close() alone does not close upgraded/HMR connections. First allow
    // active requests to finish, then drain only sockets owned by this server.
    const drain = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, graceMs);
    const deadline = setTimeout(() => finish(1), timeoutMs);
    server.close(() => {
      // A disconnected socket is not a completed write. Await handler promises
      // before application cleanup; the hard deadline still reports failure.
      void Promise.allSettled([...requests]).then(() => background).then(closeApp).then(() => finish(0), () => finish(1));
    });
  });
  shutdown.track = work => {
    if (pending) return Promise.reject(Error('Local server is stopping'));
    const request = Promise.resolve().then(work);
    requests.add(request);
    void request.then(() => requests.delete(request), () => requests.delete(request));
    return request;
  };
  return shutdown;
}
