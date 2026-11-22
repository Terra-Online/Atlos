import { serveWorker } from '#@/bench/adapters/ganglia-v1/worker-host.ts';
import { loadScenario } from '#@/bench/mechanisms/scenario.ts';

serveWorker((setup, _onRegion, checkpoint) => loadScenario(setup, checkpoint));
