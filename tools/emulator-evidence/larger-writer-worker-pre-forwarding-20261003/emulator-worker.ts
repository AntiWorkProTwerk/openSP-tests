/// <reference lib="webworker" />
import type {EmulatorSession} from '../lib/emulator/session';

type Request = {id: number; command: string; image?: ArrayBuffer; format?: 'app1' | 'flash'; name?: string; instructions?: number; report?: number[]; input?: Record<string, unknown>};
const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: EmulatorSession | undefined;
let running = false;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let queue = Promise.resolve();
let lastPublication = 0;
const sliceInstructions = 25000;

function send(id: number, type: string, details: object = {}) {
  scope.postMessage({id, type, ...details});
}
function publish(id = 0) {
  if (session) send(id, 'status', {...session.snapshot(), state: running ? 'running' : session.state});
  lastPublication = performance.now();
}
function stop() {
  running = false;
  if (scheduled !== undefined) clearTimeout(scheduled);
  scheduled = undefined;
  session?.pause();
}
function schedule() {
  if (!running || scheduled !== undefined) return;
  scheduled = setTimeout(() => {
    scheduled = undefined;
    if (!running || !session) return;
    try {
      const result = session.step(sliceInstructions);
      if (result.reason === 'fault' || result.reason === 'stopped') stop();
      if (!running || performance.now() - lastPublication >= 100) publish();
      schedule();
    } catch (error) {
      stop();
      send(0, 'error', {message: error instanceof Error ? error.message : String(error)});
      publish();
    }
  }, 0);
}

async function handle(request: Request) {
  const {id, command} = request;
  if (!Number.isSafeInteger(id)) throw new Error('Worker requests require an integer ID.');
  if (command === 'load') {
    stop();
    if (!(request.image instanceof ArrayBuffer)) throw new Error('Choose a firmware file before starting.');
    if (request.format !== 'app1' && request.format !== 'flash') throw new Error('Choose APP1 or full flash.');
    const {createSession} = await import('../lib/emulator/session');
    const replacement = await createSession(new Uint8Array(request.image), {format: request.format, name: request.name});
    session?.close();
    session = replacement;
    send(id, 'loaded', session.snapshot());
    publish(id);
    return;
  }
  if (!session) throw new Error('Load a firmware file first.');
  switch (command) {
    case 'run': running = true; schedule(); publish(id); break;
    case 'pause': stop(); publish(id); break;
    case 'step': {
      stop();
      const count = request.instructions ?? 1000;
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) throw new Error('Step count must be between 1 and 1,000,000.');
      session.step(count); publish(id); break;
    }
    case 'reset': stop(); await session.reset(); publish(id); break;
    case 'status': publish(id); break;
    case 'usb': {
      const resume = running;
      stop();
      try {
        const report = session.usbReport(request.report);
        send(id, 'usb', {report: Array.from(report)});
        publish(id);
      } finally {
        if (resume && session.state !== 'fault') {running = true; schedule();}
      }
      break;
    }
    case 'input': session.setInput(request.input ?? {}); publish(id); break;
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
