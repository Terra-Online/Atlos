import { loadScene } from '#@/bench/adapters/ganglia-v1/scene.ts';
import { serveWorker } from '#@/bench/adapters/ganglia-v1/worker-host.ts';
import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';

serveWorker((setup, onRegion, checkpoint) =>
  loadScene(
    setup.dataRoot,
    setup.extractor,
    1,
    setup.scene,
    setup.preparation
      ? async (request) => {
          const files = await exportPhysicalRegion(
            {
              dataRoot: setup.dataRoot,
              extractor: setup.extractor,
              ...setup.preparation!,
            },
            request,
          );
          onRegion(files);
          return files;
        }
      : undefined,
    { onProgress: checkpoint },
  ),
);
