/// <reference lib="webworker" />
import type {EmulatorSession} from '../lib/emulator/session.ts';
import {WorkerRunScheduler} from '../lib/emulator/run-scheduler.ts';

type Request = {id: number; command: string; image?: ArrayBuffer; format?: 'app1' | 'flash'; name?: string; sd1?: ArrayBuffer; sd2?: ArrayBuffer; instructions?: number; report?: number[]; input?: Record<string, unknown>; target?: unknown};
const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: EmulatorSession | undefined;

let queue = Promise.resolve();
const scheduler = new WorkerRunScheduler({session: () => session,
  timers: {set: (callback, delay) => setTimeout(callback, delay), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => performance.now()},
  publish: (snapshot, runScheduling, running) => send(0, 'status', {...snapshot, runScheduling, state: running ? 'running' : snapshot.state}),
  error: error => {send(0, 'error', {message: error instanceof Error ? error.message : String(error)}); publish();},
});

function send(id: number, type: string, details: object = {}) {
  scope.postMessage({id, type, ...details});
}
function publish(id = 0) {
  if (session) send(id, 'status', {...session.snapshot(), runScheduling: scheduler.diagnostics(), state: scheduler.running ? 'running' : session.state});
}
function stop() {scheduler.stop();}

async function handle(request: Request) {
  const {id, command} = request;
  if (!Number.isSafeInteger(id)) throw new Error('Worker requests require an integer ID.');
  if (command === 'load') {
    if (!(request.image instanceof ArrayBuffer)) throw new Error('Choose a firmware file before starting.');
    if (request.format !== 'app1' && request.format !== 'flash') throw new Error('Choose APP1 or full flash.');
    const {ownSdFixtures} = await import('../lib/emulator/sd-fixtures');
    const cards = ownSdFixtures(request);
    stop();
    const {createSession} = await import('../lib/emulator/session');
    const {STOCK_AUDIO_PRESET} = await import('../lib/emulator/audio-preset');
    const replacement = await createSession(new Uint8Array(request.image), {format: request.format, name: request.name, ...cards, audioPreset: STOCK_AUDIO_PRESET, cpuOptions: {vendorUrl: new URL('/emulator/vendor/unicorn-arm.js', import.meta.url).href}});
    session?.close();
    session = replacement;
    send(id, 'loaded', session.snapshot());
    publish(id);
    return;
  }
  if (!session) throw new Error('Load a firmware file first.');
  switch (command) {
    case 'run': scheduler.start(); publish(id); break;
    case 'pause': stop(); publish(id); break;
    case 'step': {
      stop();
      const count = request.instructions ?? 1000;
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) throw new Error('Step count must be between 1 and 1,000,000.');
      session.step(count); publish(id); break;
    }
    case 'reset': {
      let target;
      if (request.target !== undefined) {
        const {validateApp1ResetContract} = await import('../lib/emulator/image');
        target = validateApp1ResetContract(request.target);
      }
      stop(); await session.reset(target); publish(id); break;
    }
    case 'status': publish(id); break;
    case 'usb': {
      const resume = scheduler.suspendForUsb();
      try {
        const report = session.usbReport(request.report);
        send(id, 'usb', {report: Array.from(report)});
        publish(id);
      } finally {
        scheduler.resumeAfterUsb(resume);
      }
      break;
    }
    case 'input': {
      const activity = scheduler.captureInput();
      session.setInput(request.input ?? {});
      publish(id); scheduler.rearmAfterInput(activity); break;
    }
    case 'trace': send(id, 'trace', {trace: session.trace()}); break;
    default: throw new Error(`Unknown emulator command: ${command}`);
  }
}

scope.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  queue = queue.then(() => handle(request)).catch(error => {
    send(request?.id ?? 0, 'error', {message: error instanceof Error ? error.message : String(error)});
  });
});
