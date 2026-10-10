import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const imageFiles = {
  R13: process.env.OPENSP_EMULATOR_R13 || path.resolve('../sp404mk2/sdk/examples/original_r13/build/original_r13.bin'),
  R14: process.env.OPENSP_EMULATOR_R14 || path.resolve('../sp404mk2/sdk/examples/original_r14/build/original_r14.bin'),
};
const firmware = {
  R13: {sha256: '4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a', marker: 0x523d0001},
  R14: {sha256: 'b8e582ce74fb28b209dc9b14eccc9c175745bcb20648efe0ca9a0053c9e92695', marker: 0x523e0001},
};
const sources = ['src/lib/emulator/worker-rpc.ts', 'src/lib/emulator/update.ts', 'src/scripts/emulator-worker.ts',
  'src/lib/emulator/session.ts', 'src/lib/emulator/cpu.ts', 'src/lib/emulator/image.ts', 'src/lib/emulator/board.ts',
  'src/lib/emulator/oscillator.ts',
  'src/lib/emulator/flash.ts', 'src/lib/emulator/usb.ts', 'src/lib/emulator/exceptions.ts',
  'src/lib/emulator/exception-return.ts', 'tests/emulator-worker-roundtrip.spec.ts'];
const pins = () => Object.fromEntries(sources.map(file => [file, digest(readFileSync(file))]));
const retain = (report: unknown, failed = false) => {
  mkdirSync('tools/emulator-evidence/history', {recursive: true});
  const destination = failed
    ? `tools/emulator-evidence/failed-worker-rpc-browser-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}.json`
    : 'tools/emulator-evidence/worker-rpc-browser-roundtrip.json';
  if (!failed && existsSync(destination)) {
    const previous = readFileSync(destination), previousHash = digest(previous);
    const archived = `tools/emulator-evidence/history/worker-rpc-browser-roundtrip-${previousHash.slice(0, 16)}.json`;
    if (existsSync(archived)) expect(readFileSync(archived)).toEqual(previous);
    else writeFileSync(archived, previous, {flag: 'wx'});
  }
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  return destination;
};

test('production Worker bridge updates private R13 to R14 and back with fresh boots', async ({page, browser}) => {
  test.setTimeout(300_000);
  test.skip(!Object.values(imageFiles).every(existsSync), 'Pinned private R13/R14 fixtures absent; production bridge roundtrip is untested.');
  for (const name of ['R13', 'R14'] as const) expect(digest(readFileSync(imageFiles[name]))).toBe(firmware[name].sha256);
  const sourceSha256 = pins();
  const buildBytes = readFileSync('dist/build-info.json');
  const build = JSON.parse(buildBytes.toString('utf8'));
  const provenance = JSON.parse(readFileSync('dist/emulator/vendor/provenance.json', 'utf8'));
  expect(provenance.files['unicorn-arm.wasm'].sha256).toBe('16599c54af6da32ecce2ce52538890610a83c96e1152796ddffa2533d6440b35');
  const workerAsset = build.emulatorRuntime.workerScripts.find((asset: {path: string}) => /emulator-worker-/.test(asset.path));
  expect(workerAsset).toBeTruthy();
  expect(digest(readFileSync(path.join('dist', workerAsset.path)))).toBe(workerAsset.sha256);
  // Test-only modules are fulfilled locally. No source route or test adapter is built into dist/.
  const modulePrefix = '/__opensp_worker_roundtrip_test__/';
  const deliveredModules: Record<string, string> = {};
  for (const [module, source] of [['worker-rpc.js', sources[0]], ['update.js', sources[1]]]) {
    const output = ts.transpileModule(readFileSync(source, 'utf8'), {
      compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
      fileName: source,
    }).outputText;
    deliveredModules[module] = digest(output);
    await page.route(`**${modulePrefix}${module}`, route => route.fulfill({status: 200, contentType: 'text/javascript', body: output}));
  }
  const network: Array<{url: string; method: string; payload: boolean}> = [];
  const downloaded: Array<Promise<{path: string; sha256: string; bytes: number}>> = [];
  const errors: string[] = [];
  const createdWorkers: string[] = [];
  page.on('worker', worker => createdWorkers.push(new URL(worker.url()).pathname));
  page.context().on('request', request => network.push({url: request.url(), method: request.method(), payload: request.postDataBuffer() !== null}));
  page.context().on('response', response => {
    if (/unicorn-arm\.(?:js|wasm)(?:\?|$)/.test(response.url()) || new URL(response.url()).pathname === `/${workerAsset.path}`) {
      downloaded.push(response.body().then(bytes => ({path: new URL(response.url()).pathname, sha256: digest(bytes), bytes: bytes.length})));
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const accesses: string[] = [];
    Object.defineProperty(window, '__openspPhysicalAccesses', {value: accesses});
    for (const api of ['usb', 'hid', 'serial']) Object.defineProperty(navigator, api, {configurable: true, get() {
      accesses.push(api); throw new Error(`Physical ${api} access is forbidden in this virtual update test`);
    }});
  });
  const report: Record<string, unknown> = {schema: 'opensp-worker-rpc-browser-roundtrip-v1', timestampUtc: new Date().toISOString(),
    passed: false, browser: {name: 'Chromium', version: browser.version(), isolatedProcess: true},
    sourceSha256, buildInfoSha256: digest(buildBytes), deliveredModules, workerAsset,
    runtime: {wrapperCommit: provenance.wrapperCommit, coreCommit: provenance.coreCommit, files: provenance.files},
    firmware, physicalDeviceAccess: false, firmwareBytesPublished: false,
    scope: 'Production browser Worker and source Worker RPC bridge drive executed R13/R14 virtual USB updates and retained-NOR resets.',
    limitations: ['Resident APP1 handoff only; ROM, cold boot and physical recovery are unverified.',
      'Flash IP readback and fresh APP1 identity are observed; browser trace does not expose raw NOR for independent whole-chip byte comparison.',
      'Exact R13/R14 images and the measured C22016/status40 fixture only; timing and busy periods remain model fixtures.',
      'No physical USB, flash endurance, interrupted update, audio route or sampler behavior is established.']};
  try {
    await page.goto('/emulator/');
    expect(await page.evaluate(() => Function.prototype.toString.call(Worker).includes('[native code]'))).toBe(true);
    expect(page.workers()).toHaveLength(0);
    expect(network.some(request => /emulator-worker-|unicorn-arm|\.wasm(?:\?|$)/.test(request.url))).toBe(false);
    await page.evaluate(() => {
      const fixture = document.createElement('div'); fixture.hidden = true; fixture.id = 'worker-roundtrip-fixture';
      for (const name of ['R13', 'R14']) {const input = document.createElement('input'); input.type = 'file'; input.dataset.fixture = name; fixture.append(input);}
      document.body.append(fixture);
    });
    await page.locator('[data-fixture="R13"]').setInputFiles(imageFiles.R13);
    await page.locator('[data-fixture="R14"]').setInputFiles(imageFiles.R14);
    expect(page.workers()).toHaveLength(0);
    const outcome = await page.evaluate(async ({workerUrl, modulePrefix, firmware}) => {
      const {EmulatorWorkerBridge} = await import(`${modulePrefix}worker-rpc.js`) as typeof import('../src/lib/emulator/worker-rpc.ts');
      const {VirtualFirmwareUpdater} = await import(`${modulePrefix}update.js`) as typeof import('../src/lib/emulator/update.ts');
      type Snapshot = import('../src/lib/emulator/worker-rpc.ts').EmulatorWorkerSnapshot;
      type Trace = {flash: {commands: Array<{opcode: number; address: number; length: number; sequence: number; error?: string}>; erases: number[]; pages: number[]}};
      const require = (condition: unknown, message: string) => {if (!condition) throw new Error(message);};
      let sequence = 0;
      const requests: Array<{order: number; id: number; command: string; report?: 'GET' | 'SET'; opcode?: number; instructions?: number}> = [];
      const replies: Array<{order: number; id: number; type: string; state?: string; instructions?: number; marker?: number;
        firmwareState?: number; heartbeat?: number; firmwareHash?: string; cpuBackendFailed?: boolean; mailboxCached?: boolean;
        usbState?: number; usbMarker?: number; signature?: string}> = [];
      const completions: Array<{order: number; id: number; signature: string}> = [];
      const stages: unknown[] = [];
      const worker = new Worker(workerUrl, {type: 'module'});
      worker.addEventListener('message', event => {
        const value = event.data;
        const row = {order: ++sequence, id: value.id, type: value.type, state: value.state, instructions: value.instructions,
          marker: value.marker, firmwareState: value.firmwareState, heartbeat: value.heartbeat, firmwareHash: value.firmwareHash,
          cpuBackendFailed: value.cpuBackendFailed, mailboxCached: value.mailboxCached,
          signature: value.type === 'usb' ? String.fromCharCode(...value.report.slice(0, 4)) : undefined,
          usbState: value.type === 'usb' ? new DataView(Uint8Array.from(value.report).buffer).getUint32(8, true) : undefined,
          usbMarker: value.type === 'usb' ? new DataView(Uint8Array.from(value.report).buffer).getUint32(60, true) : undefined};
        replies.push(row);
      });
      const port: import('../src/lib/emulator/worker-rpc.ts').EmulatorWorkerPort = {
        addEventListener: worker.addEventListener.bind(worker), removeEventListener: worker.removeEventListener.bind(worker),
        terminate: worker.terminate.bind(worker), postMessage: (message, transfer) => {
          requests.push({order: ++sequence, id: message.id, command: message.command,
            report: message.command === 'usb' ? message.report ? 'SET' : 'GET' : undefined,
            opcode: message.report?.[0], instructions: message.instructions});
          worker.postMessage(message, transfer as Transferable[]);
        },
      };
      const bridge = new EmulatorWorkerBridge(port);
      const bound = bridge.asUpdateBridge();
      const transport = async (request?: number[]) => {
        const before = requests.length;
        const payload = await bound.transport(request);
        const sent = requests[before]; require(sent.command === 'usb', 'Each transport owns its outgoing USB RPC');
        completions.push({order: ++sequence, id: sent.id, signature: String.fromCharCode(...payload.slice(0, 4))});
        return payload;
      };
      const compact = (snapshot: Snapshot) => ({state: snapshot.state, pc: snapshot.pc, instructions: snapshot.instructions,
        marker: snapshot.marker, firmwareState: snapshot.firmwareState, heartbeat: snapshot.heartbeat, firmwareHash: snapshot.firmwareHash,
        cpuBackendFailed: snapshot.cpuBackendFailed, mailboxCached: snapshot.mailboxCached,
        unknownMmio: snapshot.unknownMmio, unknownMmioOverflow: snapshot.unknownMmioOverflow, fault: snapshot.fault, flash: snapshot.flash});
      const healthy = (snapshot: Snapshot, candidate: {marker: number; sha256: string}) => {
        require(snapshot.marker === candidate.marker && snapshot.firmwareHash === candidate.sha256 && snapshot.firmwareState === 2,
          'Fresh executed mailbox and image identity must match the pinned candidate');
        require(snapshot.cpuBackendFailed === false && snapshot.mailboxCached === false && !snapshot.fault,
          'Fresh verification requires a healthy backend and uncached mailbox');
        require(Array.isArray(snapshot.unknownMmio) && snapshot.unknownMmio.length === 0 && snapshot.unknownMmioOverflow === 0,
          'No unsupported MMIO or overflow may be hidden by completion');
      };
      try {
        const file = (name: string) => (document.querySelector(`[data-fixture="${name}"]`) as HTMLInputElement).files![0];
        await bridge.load(await file('R13').arrayBuffer(), {format: 'app1', name: 'original_r13.bin'});
        await bridge.reset();
        healthy(await bridge.snapshot(), firmware.R13);
        stages.push({stage: 'initial fresh R13', snapshot: compact(await bridge.snapshot())});
        await bridge.run();
        const deadline = performance.now() + 5000;
        while (!replies.some(reply => reply.id === 0 && reply.type === 'status')) {
          require(performance.now() < deadline, 'Actual continuous run must publish an unsolicited status');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        await Promise.all([bridge.snapshot(), transport()]);
        await bridge.pause();
        const updater = new VirtualFirmwareUpdater({...bound, transport}, {operationTimeoutMs: 45000});
        const legs: unknown[] = [];
        for (const [from, to] of [['R13', 'R14'], ['R14', 'R13']] as const) {
          const beforeTrace = await bridge.trace() as Trace;
          const candidate = new Uint8Array(await file(to).arrayBuffer());
          const startRequest = requests.length, startReply = replies.length;
          const receipt = await updater.update(candidate, {expectedSha256: firmware[to].sha256,
            expectedMarker: firmware[to].marker, expectedRunningMarker: firmware[from].marker});
          const snapshot = await bridge.snapshot(); healthy(snapshot, firmware[to]);
          const trace = await bridge.trace() as Trace;
          const length = receipt.image.paddedLength, start = 0x80000;
          const reads = trace.flash.commands.filter(command => command.opcode === 3 && command.address >= start && command.address < start + length);
          require(reads.length === length / 256 && reads.every((command, index) => command.address === start + index * 256 && command.length === 256 && !command.error),
            'Executed flash IP reads must cover every padded byte sequentially');
          const erases = trace.flash.erases.slice(beforeTrace.flash.erases.length);
          const pages = trace.flash.pages.slice(beforeTrace.flash.pages.length);
          require(erases.length === length / 4096 && erases.at(-1) === start &&
            erases.slice(0, -1).every((address, index) => address === start + (index + 1) * 4096), 'Guest writer erases the first target sector last');
          require(pages.length === length / 256 && pages.every(address => address >= start && address < start + length), 'Page writes stay in occupied target sectors');
          require(trace.flash.commands.every(command => !command.error), 'The retained flash command tail has no errors');
          const legRequests = requests.slice(startRequest), legReplies = replies.slice(startReply);
          const resetRequest = legRequests.find(request => request.command === 'reset'); require(resetRequest, 'Updater must perform a real Worker reset');
          const completed = legReplies.filter(reply => reply.type === 'usb' && reply.signature === `SP${from.slice(1)}` &&
            reply.usbState === 6 && reply.usbMarker === firmware[from].marker);
          const separate = completed.at(-1); require(separate, 'Separate completion status must come from an actual USB reply');
          const separateRequest = legRequests.find(request => request.id === separate!.id);
          require(separateRequest?.report === 'GET' && separate!.order < resetRequest!.order, 'Separate GET_REPORT completes before reset');
          const resetReply = legReplies.find(reply => reply.id === resetRequest!.id && reply.type === 'status');
          require(resetReply?.state === 'loaded' && resetReply.instructions === 0 && resetReply.firmwareState === undefined && resetReply.heartbeat === undefined &&
            resetReply.cpuBackendFailed === false && resetReply.mailboxCached === false, 'Reset clears execution and the firmware mailbox');
          const fresh = legReplies.find(reply => reply.order > resetReply!.order && reply.type === 'status' && reply.firmwareState === 2);
          require(fresh?.state === 'paused' && fresh.instructions! > 0 && typeof fresh.heartbeat === 'number' && fresh.marker === firmware[to].marker &&
            fresh.cpuBackendFailed === false && fresh.mailboxCached === false, 'Bounded guest steps establish a new uncached running mailbox');
          require(legRequests.some(request => request.id === fresh!.id && request.command === 'step'), 'Fresh mailbox must be tied to an executed step request');
          const {phases, ...receiptSummary} = receipt;
          legs.push({from, to, receipt: receiptSummary, progress: {events: phases.length, last: phases.at(-1)},
            snapshot: compact(snapshot), executedFlash: {readbackBytes: reads.reduce((sum, command) => sum + command.length, 0), reads, erases, pages},
            reset: {empty: resetReply, fresh}, separateCompletion: {request: separateRequest, reply: separate}});
          stages.push({stage: `${from} to ${to} complete`, marker: snapshot.marker, sha256: snapshot.firmwareHash});
        }
        require(requests.filter(request => request.command === 'load').length === 1, 'All subsequent image bytes enter through executed firmware feature reports');
        for (const completion of completions) {
          const pair = replies.filter(reply => reply.id === completion.id);
          require(pair.length === 2 && pair[0].type === 'usb' && pair[1].type === 'status' && pair[1].order < completion.order,
            'Every USB transport completion requires its own USB reply followed by its same-ID status');
        }
        const final = await bridge.snapshot(); healthy(final, firmware.R13);
        return {passed: true, stages, legs, requests, replies, completions, unsolicitedStatuses: replies.filter(reply => reply.id === 0).length,
          ignoredResponses: bridge.ignoredResponses, finalSnapshot: compact(final), workerCount: 1};
      } catch (error) {
        return {passed: false, stages, requests, replies, completions, latest: bridge.latestDiagnostics && compact(bridge.latestDiagnostics),
          error: {name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error)}};
      } finally {bridge.close();}
    }, {workerUrl: `/${workerAsset.path}`, modulePrefix, firmware});
    report.outcome = outcome;
    expect(outcome.passed, JSON.stringify(outcome.passed ? undefined : outcome.error)).toBe(true);
    expect(outcome.unsolicitedStatuses).toBeGreaterThan(0);
    const assets = await Promise.all(downloaded); report.downloaded = assets;
    expect([...new Set(assets.filter(asset => /unicorn-arm\.(js|wasm)$/.test(asset.path)).map(asset => asset.path))].sort())
      .toEqual(['/emulator/vendor/unicorn-arm.js', '/emulator/vendor/unicorn-arm.wasm']);
    expect(createdWorkers).toEqual([`/${workerAsset.path}`]); report.createdWorkers = createdWorkers;
    for (const asset of assets) {
      const expected = asset.path === `/${workerAsset.path}` ? workerAsset : provenance.files[path.basename(asset.path)];
      expect(asset.sha256).toBe(expected.sha256); expect(asset.bytes).toBe(expected.bytes);
    }
    const origin = new URL(page.url()).origin;
    expect(network.every(request => new URL(request.url).origin === origin && request.method === 'GET' && !request.payload)).toBe(true);
    expect(network.some(request => /\.(?:bin|img|dat)(?:\?|$)/i.test(request.url))).toBe(false);
    expect(await page.evaluate(() => (window as unknown as {__openspPhysicalAccesses: string[]}).__openspPhysicalAccesses)).toEqual([]);
    expect(errors).toEqual([]);
    expect(pins()).toEqual(sourceSha256); expect(digest(readFileSync('dist/build-info.json'))).toBe(report.buildInfoSha256);
    report.network = {requests: network.map(request => ({...request, url: new URL(request.url).pathname})), physicalApiAccesses: 0, firmwarePayloadRequests: 0};
    report.hostErrors = errors; report.passed = true;
    retain(report);
  } catch (error) {
    report.error = {message: error instanceof Error ? error.message : String(error)};
    report.finalSourceSha256 = pins(); report.hostErrors = errors;
    const retained = retain(report, true);
    throw new Error(`${report.error && (report.error as {message: string}).message}; evidence: ${retained}`);
  }
});
