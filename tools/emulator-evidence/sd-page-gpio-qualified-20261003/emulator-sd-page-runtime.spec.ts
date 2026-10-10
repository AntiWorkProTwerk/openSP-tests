import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';

const firmwarePath = process.env.OPENSP_EMULATOR_R13 || path.resolve('../sp404mk2/sdk/examples/original_r13/build/original_r13.bin');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const firmwareSha = '4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a';
const sources = ['src/scripts/emulator.ts', 'src/pages/emulator.astro', 'src/lib/emulator/worker-rpc.ts',
  'src/scripts/emulator-worker.ts', 'src/lib/emulator/session.ts', 'src/lib/emulator/sd-fixtures.ts',
  'src/lib/emulator/cpu.ts', 'src/lib/emulator/image.ts', 'src/lib/emulator/board.ts', 'src/lib/emulator/gpio-read.ts',
  'src/lib/emulator/flash.ts', 'src/lib/emulator/usb.ts', 'src/lib/emulator/usdhc.ts',
  'src/lib/emulator/oscillator.ts', 'src/lib/emulator/dcdc.ts', 'src/lib/emulator/pll-arm.ts',
  'src/lib/emulator/pll-usb2.ts', 'src/lib/emulator/pll-video.ts', 'src/lib/emulator/pll-audio.ts',
  'src/lib/emulator/exceptions.ts', 'src/lib/emulator/exception-return.ts',
  'src/content/emulator.json', 'tests/emulator-sd-page-runtime.spec.ts'];
const sourcePins = () => Object.fromEntries(sources.map(file => [file, digest(readFileSync(file))]));
interface Asset {path: string; sha256: string; bytes: number}
interface DeliveredAsset extends Partial<Omit<Asset, 'path'>> {path: string; status: number; error?: string}
interface BuildInfo {
  pages: Array<{path: string; sha256: string}>;
  emulatorRuntime: {workerScripts: Asset[]; clientBridgeScripts: Asset[]; artifacts: Asset[]};
}
interface Provenance {wrapperCommit: string; coreCommit: string; files: Record<string, Omit<Asset, 'path'>>}
const diskAsset = (assetPath: string): Asset => {
  const bytes = readFileSync(path.join('dist', assetPath));
  return {path: assetPath, sha256: digest(bytes), bytes: bytes.length};
};
function pageScripts(html: string) {
  const assets = new Map<string, Asset>();
  const visit = (assetPath: string) => {
    if (assets.has(assetPath)) return;
    const asset = diskAsset(assetPath); assets.set(assetPath, asset);
    const source = readFileSync(path.join('dist', assetPath), 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s*(?:[^\("';]*?\bfrom\s*)?["']([^"']+\.js)["']/g)) {
      const child = new URL(match[1], `https://built.invalid/${assetPath}`);
      expect(child.origin).toBe('https://built.invalid'); visit(child.pathname.slice(1));
    }
  };
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+\.js)["']/g)) {
    const script = new URL(match[1], 'https://built.invalid/emulator/');
    expect(script.origin).toBe('https://built.invalid'); visit(script.pathname.slice(1));
  }
  return assets;
}
function cardMetadata(value: unknown) {
  expect(value).not.toBeNull(); expect(typeof value).toBe('object'); expect(Array.isArray(value)).toBe(false);
  const card = value as Record<string, unknown>;
  const numbers = new Set(['imageBytes', 'baseAddress', 'irq', 'blockLength', 'transferBytes', 'transferReadBytes',
    'fifoWords', 'completedCommands', 'completedReads', 'bytesRead', 'unsupportedOverflow']);
  const booleans = new Set(['readOnly', 'irqAsserted', 'inserted']);
  const fields = new Set(['profile', ...numbers, ...booleans, 'cardState', 'cardBusWidth', 'pendingCommand',
    'lastError', 'unsupported', 'limitations']);
  expect(Object.keys(card).every(key => fields.has(key))).toBe(true);
  for (const [key, item] of Object.entries(card)) {
    if (numbers.has(key)) {expect(Number.isSafeInteger(item)).toBe(true); expect(item).toBeGreaterThanOrEqual(0);}
    else if (booleans.has(key)) expect(typeof item).toBe('boolean');
    else if (key === 'profile') expect(item).toBe('synthetic read-only SDSC / CSD v1');
    else if (key === 'cardState') expect(['idle', 'ready', 'identification', 'standby', 'transfer', 'sending-data']).toContain(item);
    else if (key === 'cardBusWidth') expect([1, 4]).toContain(item);
    else if (key === 'pendingCommand') {
      if (item !== null) {expect(Number.isInteger(item)).toBe(true); expect(item).toBeGreaterThanOrEqual(0); expect(item).toBeLessThanOrEqual(63);}
    } else if (key === 'lastError') expect(item === null || typeof item === 'string').toBe(true);
    else if (key === 'unsupported') {
      expect(Array.isArray(item)).toBe(true); const rows = item as Array<Record<string, unknown>>;
      expect(rows.length).toBeLessThanOrEqual(128);
      for (const row of rows) {
        expect(row).not.toBeNull(); expect(typeof row).toBe('object'); expect(Array.isArray(row)).toBe(false);
        expect(Object.keys(row).sort()).toEqual(['count', 'reason']); expect(typeof row.reason).toBe('string');
        expect(Number.isSafeInteger(row.count)).toBe(true); expect(row.count).toBeGreaterThanOrEqual(0);
      }
    } else if (key === 'limitations') {
      expect(Array.isArray(item)).toBe(true); expect((item as unknown[]).every(row => typeof row === 'string')).toBe(true);
    }
  }
  return card;
}

test('product SD selectors deliver two local cards to a real R13 worker and retain them across reset', async ({page, browser}) => {
  test.setTimeout(120_000);
  test.skip(!existsSync(firmwarePath), 'Pinned private R13 fixture absent; production SD page delivery is untested.');
  expect(digest(readFileSync(firmwarePath))).toBe(firmwareSha);
  const before = sourcePins();
  const buildBytes = readFileSync('dist/build-info.json');
  const build = JSON.parse(buildBytes.toString('utf8')) as BuildInfo;
  const provenanceBytes = readFileSync('dist/emulator/vendor/provenance.json');
  const provenance = JSON.parse(provenanceBytes.toString('utf8')) as Provenance;
  const pageRecord = build.pages.find(asset => asset.path === 'emulator/index.html'); expect(pageRecord).toBeTruthy();
  const htmlBytes = readFileSync('dist/emulator/index.html'); expect(digest(htmlBytes)).toBe(pageRecord!.sha256);
  const expectedAssets = pageScripts(htmlBytes.toString('utf8'));
  const requiredAssets = new Set([...expectedAssets.keys()]);
  const runtimeAssets = [...build.emulatorRuntime.workerScripts, ...build.emulatorRuntime.clientBridgeScripts,
    ...build.emulatorRuntime.artifacts.filter(asset => /\.(?:js|wasm)$/.test(asset.path))];
  for (const asset of runtimeAssets) {
    expect(diskAsset(asset.path)).toEqual({path: asset.path, bytes: asset.bytes, sha256: asset.sha256});
    expectedAssets.set(asset.path, {path: asset.path, bytes: asset.bytes, sha256: asset.sha256});
  }
  for (const name of ['unicorn-arm.js', 'unicorn-arm.wasm']) {
    const asset = expectedAssets.get(`emulator/vendor/${name}`); expect(asset).toBeTruthy();
    expect(asset!.sha256).toBe(provenance.files[name].sha256); expect(asset!.bytes).toBe(provenance.files[name].bytes);
  }
  const workerAsset = build.emulatorRuntime.workerScripts.find(asset => /emulator-worker-/.test(asset.path)); expect(workerAsset).toBeTruthy();
  for (const assetPath of [workerAsset!.path, 'emulator/vendor/unicorn-arm.js', 'emulator/vendor/unicorn-arm.wasm']) requiredAssets.add(assetPath);
  const requests: Array<{url: string; method: string; payload: boolean}> = [];
  const downloaded: Array<Promise<DeliveredAsset>> = [];
  const createdWorkers: string[] = [];
  const errors: string[] = [];
  page.on('worker', worker => createdWorkers.push(new URL(worker.url()).pathname));
  page.context().on('request', request => requests.push({url: request.url(), method: request.method(), payload: request.postDataBuffer() !== null}));
  page.context().on('response', response => {
    const assetPath = new URL(response.url()).pathname;
    if (/\.(?:js|wasm)$/.test(assetPath)) downloaded.push(response.body().then(bytes => ({path: assetPath,
      status: response.status(), sha256: digest(bytes), bytes: bytes.length}), error => ({path: assetPath,
      status: response.status(), error: error instanceof Error ? error.message : String(error)})));
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const accesses: string[] = [];
    Object.defineProperty(window, '__sdPhysicalAccesses', {value: accesses});
    for (const api of ['usb', 'hid', 'serial']) Object.defineProperty(navigator, api, {configurable: true, get() {
      accesses.push(api); throw new Error('Physical transport is forbidden in this virtual SD test');
    }});
  });
  const navigation = await page.goto('/emulator/'); expect(navigation).not.toBeNull(); expect(navigation!.status()).toBe(200);
  const deliveredPage = await navigation!.body(); expect(digest(deliveredPage)).toBe(pageRecord!.sha256);
  expect(await page.evaluate(() => Function.prototype.toString.call(Worker).includes('[native code]'))).toBe(true);
  const session = page.locator('[data-session]').first();
  await expect(session.locator('[data-file]')).toBeEnabled();
  await session.locator('[data-file]').setInputFiles(firmwarePath);
  const names = ['private-synthetic-card-a.img', 'private-synthetic-card-b.img'];
  for (const [index, name] of names.entries()) {
    await session.locator(`[data-sd-file="${index + 1}"]`).setInputFiles({name,
      mimeType: 'application/octet-stream', buffer: Buffer.alloc(262144, index ? 0x72 : 0x31)});
    await expect(session.locator(`[data-sd-name="${index + 1}"]`)).toContainText(name);
    await expect(session.locator(`[data-sd-name="${index + 1}"]`)).toContainText('read-only');
  }
  expect(page.workers()).toHaveLength(0);
  expect(requests.some(request => /emulator-worker-|worker-rpc[.-]|unicorn-arm|\.wasm(?:\?|$)/.test(request.url))).toBe(false);
  await session.locator('[data-action="start"]').click();
  await expect(session.locator('[data-diagnostic="marker"]')).toHaveText('0x523D0001', {timeout: 45_000});
  await expect.poll(async () => Number(await session.locator('[data-diagnostic="frames"]').textContent()), {timeout: 45_000}).toBeGreaterThan(1);
  await session.locator('[data-action="pause"]').click();
  await expect(session.locator('[data-session-state]')).toHaveText('Paused');
  const traces: Record<string, unknown>[] = [];
  for (const reset of [false, true]) {
    if (reset) {
      await session.locator('[data-action="reset"]').click();
      await expect(session.locator('[data-session-state]')).toHaveText('Paused');
      await expect(session.locator('[data-diagnostic="instructions"]')).toHaveText('0');
    }
    const downloading = page.waitForEvent('download');
    await session.locator('[data-action="export"]').click();
    const download = await downloading;
    const text = readFileSync((await download.path())!, 'utf8');
    for (const name of names) expect(text).not.toContain(name);
    const envelope = JSON.parse(text); expect(envelope.schema).toBe('opensp-emulator-browser-trace-v1');
    expect(envelope.sourceFile.sha256).toBe(firmwareSha); expect(envelope.firmware.sha256).toBe(firmwareSha);
    const trace = envelope.trace; expect(trace.schema).toBe('opensp-emulator-trace-v1');
    for (const [index, slot] of ['sd1', 'sd2'].entries()) {
      const card = cardMetadata(trace[slot]);
      expect(card).toMatchObject({profile: 'synthetic read-only SDSC / CSD v1', imageBytes: 262144,
        readOnly: true, inserted: true, baseAddress: 0x402c0000 + index * 0x4000, irq: 110 + index,
        completedCommands: 0, completedReads: 0, bytesRead: 0});
    }
    const loadCommands = envelope.commands.retained.filter((command: {command: string}) => command.command === 'load');
    expect(loadCommands).toHaveLength(1);
    for (const command of loadCommands) {
      expect(command.details).not.toHaveProperty('image');
      for (const slot of ['sd1', 'sd2']) {
        const card = command.details[slot]; expect(Object.keys(card).sort()).toEqual(['imageBytes', 'profile', 'readOnly']);
        expect(card).toEqual({profile: 'synthetic read-only SDSC / CSD v1', imageBytes: 262144, readOnly: true});
      }
    }
    expect(trace.cpuBackendFailed).toBe(false);
    expect(trace.mailboxCached).toBe(false); expect(trace.firmwareHash).toBe(firmwareSha);
    expect(trace.state).toBe(reset ? 'loaded' : 'paused');
    expect(Number.isSafeInteger(trace.instructions)).toBe(true);
    if (reset) expect(trace.instructions).toBe(0);
    else expect(trace.instructions).toBeGreaterThan(0);
    traces.push({afterReset: reset, sd1: trace.sd1, sd2: trace.sd2, instructions: trace.instructions});
  }
  expect(page.workers()).toHaveLength(1);
  expect(createdWorkers).toEqual([`/${workerAsset!.path}`]);
  const assets = await Promise.all(downloaded);
  const deliveredPaths = new Set(assets.map(asset => asset.path));
  for (const assetPath of requiredAssets) expect(deliveredPaths.has(`/${assetPath}`)).toBe(true);
  expect(assets.some(asset => build.emulatorRuntime.clientBridgeScripts.some(expected => asset.path === `/${expected.path}`))).toBe(true);
  for (const asset of assets) {
    expect(asset.error).toBeUndefined(); expect(asset.status).toBe(200);
    const expected = expectedAssets.get(asset.path.slice(1)); expect(expected).toBeTruthy();
    expect(asset.sha256).toBe(expected!.sha256); expect(asset.bytes).toBe(expected!.bytes);
    expect(diskAsset(expected!.path)).toEqual(expected);
  }
  expect(errors).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.every(request => new URL(request.url).origin === origin && request.method === 'GET' && !request.payload)).toBe(true);
  expect(requests.some(request => /\.(?:bin|img|dat|raw|iso)(?:\?|$)/i.test(request.url))).toBe(false);
  expect(await page.evaluate(() => (window as unknown as {__sdPhysicalAccesses: string[]}).__sdPhysicalAccesses)).toEqual([]);
  expect(sourcePins()).toEqual(before);
  expect(digest(readFileSync('dist/build-info.json'))).toBe(digest(buildBytes));
  expect(digest(readFileSync('dist/emulator/index.html'))).toBe(pageRecord!.sha256);
  expect(digest(readFileSync('dist/emulator/vendor/provenance.json'))).toBe(digest(provenanceBytes));
  const destination = 'tools/emulator-evidence/sd-page-browser-runtime-20261003.json';
  mkdirSync('tools/emulator-evidence/history', {recursive: true});
  if (existsSync(destination)) {
    const previous = readFileSync(destination);
    const archive = `tools/emulator-evidence/history/sd-page-browser-runtime-${digest(previous).slice(0, 16)}.json`;
    if (existsSync(archive)) expect(readFileSync(archive)).toEqual(previous);
    else writeFileSync(archive, previous, {flag: 'wx'});
  }
  writeFileSync(destination, JSON.stringify({schema: 'opensp-sd-product-browser-runtime-v1', passed: true,
    browser: {name: 'Chromium', version: browser.version(), isolatedProcess: true}, sourceSha256: before,
    buildInfoSha256: digest(buildBytes), page: {path: pageRecord!.path, sha256: digest(deliveredPage), bytes: deliveredPage.length},
    createdWorkers, downloaded: assets, workerAssets: build.emulatorRuntime.workerScripts,
    runtime: {wrapperCommit: provenance.wrapperCommit, coreCommit: provenance.coreCommit, files: provenance.files,
      provenanceSha256: digest(provenanceBytes)},
    firmware: {sha256: firmwareSha, published: false}, sdFixtures: {synthetic: true, slots: 2, imageBytesEach: 262144},
    traces, physicalDeviceAccess: false, sdBytesPublished: false,
    scope: 'Product File selectors deliver optional cards to production Worker/board and retain safe metadata through reset.',
    limitations: ['R13 performs no SD commands here; card reads and filesystem behavior remain unqualified.',
      'Reset retains modeled card presence/state; no physical power-cycle or insertion result is established.']}, null, 2) + '\n');
});
