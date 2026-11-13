import { writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';

// Only the solving process receives phase markers. Profiling the coordinator
// would record IPC waits instead of the algorithm's CPU work.
const filename = process.env.GANGLIA_PROFILE;
if (filename && process.send) {
  const session = new Session();
  session.connect();
  const error = console.error;
  let ready: Promise<unknown> | undefined;
  console.error = (...args: unknown[]) => {
    error(...args);
    if (typeof args[0] === 'string' && args[0].startsWith('{"phase":"batch",')) {
      ready = session.post('Profiler.enable').then(() => session.post('Profiler.start'));
    }
  };
  process.once('beforeExit', async () => {
    if (ready) {
      await ready;
      const { profile } = await session.post('Profiler.stop');
      await writeFile(filename, JSON.stringify(profile));
    }
    session.disconnect();
  });
}
