import {parentPort, workerData} from 'node:worker_threads';
import {isolatedWorker} from './test-emulator-firmware.mjs';

try {
  const result = await isolatedWorker(new Uint8Array(workerData.bytes), workerData.volume, workerData.runtimeDirectory);
  parentPort.postMessage({result});
} catch (error) {
  parentPort.postMessage({error: `${error.name}: ${error.message}`});
}
