import { parentPort } from 'node:worker_threads';

import type { RecorderWorkerRequest } from './workerProtocol';
import { createRecorderWorkerServer, type PvRecorderConstructor } from './workerServer';

/**
 * Worker entry for every native audio call. It is bundled to out/recorderWorker.js
 * so `require('./vendor/pvrecorder-node')` resolves next to out/extension.js.
 */

let recorderConstructor: PvRecorderConstructor | null = null;

function loadPvRecorder(): PvRecorderConstructor {
  if (recorderConstructor) return recorderConstructor;
  try {
    // The native addon must remain lazy: it is optional on unsupported systems
    // and is bundled as an external platform-specific package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('./vendor/pvrecorder-node') as { PvRecorder: PvRecorderConstructor };
    recorderConstructor = module.PvRecorder;
    return recorderConstructor;
  } catch (error) {
    throw new Error("Voice Input's bundled audio recorder could not be loaded on this system.", { cause: error });
  }
}

const port = parentPort;
if (!port) {
  throw new Error('The Voice Input audio worker must run on a worker thread.');
}

const server = createRecorderWorkerServer({
  loadRecorder: loadPvRecorder,
  post: (message, transfer) => {
    port.postMessage(message, transfer ? [...transfer] : undefined);
  },
});

port.on('message', (request: RecorderWorkerRequest) => {
  server.handle(request);
});
