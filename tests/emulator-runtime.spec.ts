import {test, expect, type Locator, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

// This suite uses the production ARM workers. The private image is supplied
// through the browser's file input and is never copied into public/ or dist/.
const imagePath = process.env.OPENSP_EMULATOR_R13 || path.resolve(
  '../sp404mk2/sdk/examples/original_r13/build/original_r13.bin');
const imageAvailable = existsSync(imagePath);
const imageBytes = imageAvailable ? readFileSync(imagePath) : Buffer.alloc(0);
const imageSha256 = createHash('sha256').update(imageBytes).digest('hex');
const results: Array<Record<string, unknown>> = [];
const action = (session: Locator, name: string) => session.locator(`[data-action="${name}"]`);
const hexadecimal = (bytes: number[]) => bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ');
const word = (bytes: number[], offset: number) => new DataView(Uint8Array.from(bytes).buffer).getUint32(offset, true);
const signature = (bytes: number[]) => String.fromCharCode(...bytes.slice(0, 4));
const command = (opcode: number, argument = 0, extra = 0) => {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  bytes[0] = opcode; bytes[1] = 1;
  view.setUint32(4, argument, true); view.setUint32(8, extra, true);
  return Array.from(bytes);
};

async function openEmulator(page: Page) {
  await page.goto('/emulator/');
  await expect(page.locator('[data-file]').first()).toBeEnabled();
  expect(await page.evaluate(() => Function.prototype.toString.call(Worker).includes('[native code]'))).toBe(true);
  return page.locator('[data-emulator]');
}

async function boot(session: Locator) {
  await session.locator('[data-file]').setInputFiles(imagePath);
  await expect(action(session, 'start')).toBeEnabled();
  await action(session, 'start').click();
  await expect(session.locator('[data-diagnostic="marker"]')).toHaveText('0x523D0001', {timeout: 45_000});
  await expect.poll(async () => Number(await session.locator('[data-diagnostic="frames"]').textContent()),
    {timeout: 45_000}).toBeGreaterThan(1);
  await expect(session.locator('[data-session-state]')).toHaveText('Running');
  await expect(session.locator('[data-session-error]')).toBeHidden();
  await expect(session.locator('[data-diagnostic="hash"]')).toHaveText(imageSha256);
  await expect(session.locator('[data-diagnostic="checkpoint"]')).toHaveText('resident-app1-handoff');
}

async function pause(session: Locator) {
  await action(session, 'pause').click();
  await expect(session.locator('[data-session-state]')).toHaveText('Paused');
}

async function usb(session: Locator, report?: number[]) {
  const advanced = session.locator('[data-usb-advanced]');
  if (await advanced.getAttribute('open') === null) await advanced.locator('summary').click();
  const output = session.locator('[data-usb-result]');
  // Repeated replies may be identical. Erasing the previous rendered reply
  // ensures the assertion observes a newly completed firmware transaction.
  await output.evaluate(element => {element.textContent = 'Awaiting actual firmware reply';});
  if (report) {
    await session.locator('[data-usb-report]').fill(hexadecimal(report));
    await session.locator('[data-usb-form] button[type="submit"]').click();
  } else await action(session, 'usb-status').click();
  await expect(output).toHaveText(/^(?:[\da-f]{2} ){63}[\da-f]{2}$/i, {timeout: 45_000});
  await expect(session.locator('[data-session-error]')).toBeHidden();
  return (await output.textContent())!.split(/\s+/).map(byte => Number.parseInt(byte, 16));
}

async function capture(session: Locator) {
  const raw: number[] = [];
  for (let page = 0; page < 3; page++) {
    const reply = await usb(session, command(8, page));
    expect(signature(reply)).toBe('SPIS');
    expect(word(reply, 4)).toBe(page);
    raw.push(...reply.slice(8));
  }
  return {shift: word(raw, 120), scans: word(raw, 8),
    analog: Array.from({length: 32}, (_, index) => raw[56 + index * 2] | raw[57 + index * 2] << 8)};
}

async function input(session: Locator, control: string, value: number) {
  await session.locator('[data-input-control]').selectOption(control);
  await session.locator('[data-input-value]').fill(String(value));
  await session.locator('[data-input-form] button[type="submit"]').click();
  await expect(session.locator('[data-input-result]')).toHaveText(`${control} set to ${value.toFixed(2)}.`);
}

function crc32(bytes: number[]) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function uploadRam(session: Locator, bytes: number[]) {
  const crc = crc32(bytes);
  let reply = await usb(session, command(1, bytes.length, crc));
  expect(signature(reply)).toBe('SP13');
  expect(word(reply, 8)).toBe(1);
  const data = command(2); data[2] = bytes.length; data.splice(8, bytes.length, ...bytes);
  await usb(session, data);
  reply = await usb(session, command(3));
  expect(signature(reply)).toBe('SP13');
  expect(word(reply, 8)).toBe(2);
  expect(word(reply, 12)).toBe(0);
  expect(word(reply, 16)).toBe(bytes.length);
  expect(word(reply, 20)).toBe(bytes.length);
  expect(word(reply, 24)).toBe(crc);
  return crc;
}

test.describe('actual ARM browser runtime with private R13', () => {
  test.describe.configure({mode: 'serial'});
  test.setTimeout(120_000);
  test.skip(!imageAvailable, 'Private R13 fixture absent; production runtime boot is untested in this environment.');

  test('runtime downloads on Start, real R13 draws its OLED and answers virtual USB locally', async ({page}) => {
    const requests: Array<{url: string; method: string; body: Buffer | null}> = [];
    const downloads: Array<Promise<{path: string; sha256: string; bytes: number}>> = [];
    const errors: string[] = [];
    page.context().on('request', request => requests.push({url: request.url(), method: request.method(), body: request.postDataBuffer()}));
    page.context().on('response', response => {
      if (/unicorn-arm\.(?:js|wasm)(?:\?|$)/.test(response.url())) {
        downloads.push(response.body().then(bytes => ({path: new URL(response.url()).pathname,
          sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length})));
      }
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, '__physicalUsbAccesses', {value: [], configurable: true});
      Object.defineProperty(navigator, 'usb', {configurable: true, get() {
        (window as unknown as Window & {__physicalUsbAccesses: string[]}).__physicalUsbAccesses.push('usb');
        throw new Error('Physical WebUSB access is forbidden in this emulator test');
      }});
    });
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    expect(page.workers()).toHaveLength(0);
    await session.locator('[data-file]').setInputFiles(imagePath);
    await expect(action(session, 'start')).toBeEnabled();
    expect(page.workers()).toHaveLength(0);
    expect(requests.filter(request => /emulator-worker|unicorn-arm|\.wasm(?:\?|$)/.test(request.url))).toEqual([]);
    await action(session, 'start').click();
    await expect(session.locator('[data-diagnostic="marker"]')).toHaveText('0x523D0001', {timeout: 45_000});
    await expect.poll(async () => Number(await session.locator('[data-diagnostic="frames"]').textContent()),
      {timeout: 45_000}).toBeGreaterThan(1);
    expect(page.workers()).toHaveLength(1);
    expect(page.workers()[0].url()).toMatch(/emulator-worker/);
    const litPixels = await session.locator('canvas[data-oled]').evaluate(canvas => {
      const data = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 128, 64).data;
      let count = 0;
      for (let pixel = 0; pixel < data.length; pixel += 4) if (data[pixel] > 0) count++;
      return count;
    });
    expect(litPixels).toBeGreaterThan(100);
    const status = await usb(session);
    expect(signature(status)).toBe('SP13');
    expect(word(status, 60)).toBe(0x523d0001);
    const origin = new URL(page.url()).origin;
    const engine = requests.filter(request => /unicorn-arm\.(?:js|wasm)(?:\?|$)/.test(request.url));
    expect(engine.map(request => new URL(request.url).pathname)).toEqual(expect.arrayContaining([
      '/emulator/vendor/unicorn-arm.js', '/emulator/vendor/unicorn-arm.wasm',
    ]));
    expect(engine.every(request => new URL(request.url).origin === origin)).toBe(true);
    const downloadedEngine = await Promise.all(downloads);
    const provenance = JSON.parse(readFileSync('dist/emulator/vendor/provenance.json', 'utf8'));
    expect(downloadedEngine).toHaveLength(2);
    for (const asset of downloadedEngine) {
      const expected = provenance.files[path.basename(asset.path)];
      expect(asset.sha256).toBe(expected.sha256);
      expect(asset.bytes).toBe(expected.bytes);
    }
    expect(requests.every(request => request.method === 'GET' && request.body === null)).toBe(true);
    expect(requests.every(request => new URL(request.url).origin === origin)).toBe(true);
    expect(requests.some(request => /\.(?:bin|img|dat)(?:\?|$)/i.test(request.url))).toBe(false);
    expect(await page.evaluate(() => (window as unknown as Window & {__physicalUsbAccesses: string[]}).__physicalUsbAccesses)).toEqual([]);
    expect(errors).toEqual([]);
    await pause(session);
    results.push({name: 'Demand load, actual R13 OLED and USB status, local-only transport',
      workers: 1, marker: '523D0001', litPixels, usbSignature: signature(status),
      downloadedEngine, outboundPayloadRequests: 0, physicalUsbAccesses: 0});
  });

  test('SHIFT UART and pad pressure reach real firmware snapshots', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await boot(session);
    const baseline = await capture(session);
    expect(baseline.shift).toBe(0);
    expect(baseline.analog[15]).toBe(4083);
    await input(session, 'SHIFT', 1);
    await input(session, 'PAD 1', 0.75);
    let pressed: Awaited<ReturnType<typeof capture>> = baseline;
    await expect.poll(async () => {
      pressed = await capture(session);
      return [pressed.shift, pressed.analog[15]];
    }, {timeout: 45_000, intervals: [100]}).toEqual([1, 1114]);
    await input(session, 'SHIFT', 0);
    await input(session, 'PAD 1', 0);
    let released = pressed;
    await expect.poll(async () => {
      released = await capture(session);
      return [released.shift, released.analog[15]];
    }, {timeout: 45_000, intervals: [100]}).toEqual([0, 4083]);
    expect(released.scans).toBeGreaterThan(baseline.scans);
    await pause(session);
    results.push({name: 'Actual compiled input capture', baseline: {shift: baseline.shift, pad1: baseline.analog[15]},
      pressed: {shift: pressed.shift, pad1: pressed.analog[15]}, released: {shift: released.shift, pad1: released.analog[15]},
      scope: 'Injected UART SHIFT and ADC pad level; physical pressure and velocity remain unverified'});
  });

  test('two production workers keep execution and staged RAM CRC results independent', async ({page}) => {
    const emulator = await openEmulator(page);
    await emulator.locator('[data-add-session]').click();
    const sessions = emulator.locator('[data-session]');
    await Promise.all([boot(sessions.nth(0)), boot(sessions.nth(1))]);
    expect(page.workers()).toHaveLength(2);
    expect(new Set(page.workers()).size).toBe(2);
    await pause(sessions.nth(0));
    const frozenInstructions = await sessions.nth(0).locator('[data-diagnostic="instructions"]').textContent();
    const peerInstructions = Number(await sessions.nth(1).locator('[data-diagnostic="instructions"]').textContent());
    await expect.poll(async () => Number(await sessions.nth(1).locator('[data-diagnostic="instructions"]').textContent())).toBeGreaterThan(peerInstructions);
    expect(await sessions.nth(0).locator('[data-diagnostic="instructions"]').textContent()).toBe(frozenInstructions);
    await pause(sessions.nth(1));
    const first = Array.from({length: 16}, (_, index) => index + 17);
    const second = Array.from({length: 16}, (_, index) => 255 - index);
    const firstCrc = await uploadRam(sessions.nth(0), first);
    const secondCrc = await uploadRam(sessions.nth(1), second);
    expect(firstCrc).not.toBe(secondCrc);
    const statusA = await usb(sessions.nth(0)), statusB = await usb(sessions.nth(1));
    expect(word(statusA, 8)).toBe(2); expect(word(statusB, 8)).toBe(2);
    expect(word(statusA, 24)).toBe(firstCrc); expect(word(statusB, 24)).toBe(secondCrc);
    await usb(sessions.nth(0), command(4));
    const clearedA = await usb(sessions.nth(0)), retainedB = await usb(sessions.nth(1));
    expect(word(clearedA, 8)).toBe(0); expect(word(clearedA, 16)).toBe(0);
    expect(word(retainedB, 8)).toBe(2); expect(word(retainedB, 24)).toBe(secondCrc);
    results.push({name: 'Concurrent actual workers and private RAM state', workers: 2,
      payloadBytesPerWorker: 16, firstCrc32: firstCrc.toString(16), secondCrc32: secondCrc.toString(16),
      verification: 'Guest CRC includes rereading staged RAM; clearing A leaves B verified',
      flashCommandsSent: 0});
  });

  test('real image parser rejects invalid input and the session then boots R13', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await session.locator('[data-file]').setInputFiles({name: 'invalid-header.bin',
      mimeType: 'application/octet-stream', buffer: Buffer.from([0xff, 0xff, 0xff, 0xff])});
    await action(session, 'start').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Stopped on error');
    await expect(session.locator('[data-session-error]')).toBeVisible();
    expect(await session.locator('[data-diagnostic="instructions"]').textContent()).toBe('0');
    await boot(session);
    expect(page.workers()).toHaveLength(1);
    const status = await usb(session);
    expect(signature(status)).toBe('SP13'); expect(word(status, 60)).toBe(0x523d0001);
    await pause(session);
    results.push({name: 'Actual image parser rejection and worker replacement recovery', marker: '523D0001'});
  });

  test('ordinary guest fetch error retains a trace and permits worker replacement', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    // Original conformance program: load an unmapped Thumb destination and BX.
    // This exercises an ordinary guest error without provoking an engine trap.
    const guest = Buffer.from([1, 0x48, 0, 0x47, 0xfe, 0xe7, 0, 0xbf, 1, 0, 0, 0x90]);
    await session.locator('[data-file]').setInputFiles({name: 'guest-fetch-conformance.bin',
      mimeType: 'application/octet-stream', buffer: guest});
    await action(session, 'start').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Stopped on error');
    await expect(session.locator('[data-session-error]')).toContainText(/unmapped/i);
    await expect(session.locator('[data-file]')).toBeEnabled();
    const downloading = page.waitForEvent('download');
    await action(session, 'export').click();
    const download = await downloading;
    const trace = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(trace.trace.cpuBackendFailed).toBe(false);
    expect(trace.trace.mailboxCached).toBe(false);
    expect(trace.trace.state).toBe('fault');
    expect(trace.trace.pc).toBe(0x90000000);
    expect(trace.trace.instructions).toBe(2);
    await boot(session);
    expect(page.workers()).toHaveLength(1);
    await pause(session);
    results.push({name: 'Ordinary guest fetch error trace and worker replacement',
      guestInstructions: 2, attemptedFetch: '90000000', backendLost: false, replacementMarker: '523D0001'});
  });

  test.afterAll(async ({browser}) => {
    if (results.length !== 5) return;
    const provenance = JSON.parse(readFileSync('dist/emulator/vendor/provenance.json', 'utf8'));
    const build = JSON.parse(readFileSync('dist/build-info.json', 'utf8'));
    const report = {
      schema: 'opensp-emulator-real-browser-verification-v1',
      timestampUtc: new Date().toISOString(),
      browser: {name: 'Chromium', version: browser.version(), isolatedProcess: true},
      page: '/emulator/', privateFirmware: {sha256: imageSha256, bytes: imageBytes.length, published: false},
      runtime: {wasmSha256: provenance.files['unicorn-arm.wasm'].sha256, wrapperCommit: provenance.wrapperCommit,
        coreCommit: provenance.coreCommit, workerAssets: build.emulatorRuntime.workerScripts,
        pageSha256: build.pages.find((page: {path: string}) => page.path === 'emulator/index.html')?.sha256,
        workerScope: 'Production worker, CPU, board and USB models; Worker was not replaced'},
      cases: results,
      separateUiSuite: {file: 'tests/emulator.spec.ts', mockedUiChecks: 19,
        scope: 'Mocked worker interface checks establish no ARM execution or firmware boot'},
      limitations: ['R13 only in this suite; complete stock firmware, sampler, audio and storage remain unfinished',
        'GPT counter-read clock is a fast regression fixture, not hardware timing',
        'Results do not establish physical boot, recovery, USB firmware installation or calibrated input'],
    };
    mkdirSync('tools/emulator-evidence', {recursive: true});
    const destination = 'tools/emulator-evidence/browser-runtime.json';
    if (existsSync(destination)) {
      const previous = readFileSync(destination);
      const previousHash = createHash('sha256').update(previous).digest('hex');
      const history = `tools/emulator-evidence/history/browser-runtime-${previousHash.slice(0, 16)}.json`;
      mkdirSync('tools/emulator-evidence/history', {recursive: true});
      if (existsSync(history)) expect(readFileSync(history)).toEqual(previous);
      else writeFileSync(history, previous, {flag: 'wx'});
    }
    writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  });
});
