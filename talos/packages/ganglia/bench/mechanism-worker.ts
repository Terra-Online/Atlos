import { serveWorker } from '#@/bench/adapters/ganglia-v1/worker-host.ts';
import { loadMechanismScene } from '#@/bench/mechanism-scene.ts';

serveWorker(loadMechanismScene);
