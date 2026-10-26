// Isolated routing worker. The hook runs this in a worker thread so that a slow index
// build can be abandoned on deadline instead of overrunning the host hook timeout.
import {parentPort, workerData} from 'node:worker_threads';
import {routeTaskV4, formatAgentContextV4} from './advisor-v4.mjs';

try {
  const result = routeTaskV4(workerData.prompt, {
    host: workerData.host,
    taskContext: workerData.taskContext,
    runtimeSkills: workerData.runtimeSkills,
    runtimeCapabilities: workerData.runtimeCapabilities,
    projectRoot: workerData.projectRoot,
  });
  parentPort.postMessage({ok: true, context: formatAgentContextV4(result)});
} catch (error) {
  parentPort.postMessage({ok: false, error: String(error?.message || error)});
}
