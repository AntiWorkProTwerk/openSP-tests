import {test, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const website = fileURLToPath(new URL('../', import.meta.url));
const packages = fileURLToPath(new URL('../../sp404mk2/custom_firmware/build/', import.meta.url));
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fixture = async (name: string) => {
  const folder = path.join(packages, `original_${name.toLowerCase()}`);
  const manifestFile = path.join(folder, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const imageFile = path.resolve(folder, manifest.usb_install.file);
  assert.ok(imageFile.startsWith(`${folder}${path.sep}`));
  const bytes = await fs.readFile(imageFile);
  assert.equal(bytes.length, manifest.usb_install.bytes);
  assert.equal(hash(bytes), manifest.usb_install.sha256);
  return {name, manifestFile, imageFile, marker: parseInt(manifest.usb_marker, 16),
    sha256: manifest.usb_install.sha256, length: bytes.length};
};

test('public virtual APP1 updater runs R13 to R14 and back with verified receipts', async ({page, browser}, info) => {
  test.setTimeout(270000);
  test.skip(!existsSync(path.join(packages, 'original_r13/manifest.json')) ||
    !existsSync(path.join(packages, 'original_r14/manifest.json')), 'Adjacent private firmware packages are required.');
  const [r13, r14] = await Promise.all([fixture('R13'), fixture('R14')]);
  const buildBytes = await fs.readFile(path.join(website, 'dist/build-info.json'));
  const build = JSON.parse(buildBytes.toString());
  const workerAsset = build.emulatorRuntime.workerScripts.find((row: {path: string}) => /(?:^|\/)emulator-worker[.-]/.test(row.path));
  assert.ok(workerAsset);
  const reportFile = process.env.OPENSP_VISIBLE_UPDATE_REPORT ?? info.outputPath('public-update.json');
  await fs.mkdir(path.dirname(reportFile), {recursive: true});
  const origin = new URL(String(process.env.OPENSP_TEST_URL ?? info.project.use.baseURL ?? 'http://127.0.0.1:4321')).origin;
  const errors: string[] = [], network: {path: string; local: boolean; method: string; payload: boolean}[] = [];
  const deliveries: Promise<{bytes: number; sha256: string}>[] = [];
  page.on('pageerror', error => {if (errors.length < 16) errors.push(error.message.slice(0, 512));});
  page.on('request', request => {
    assert.ok(network.length < 2048);
    const url = new URL(request.url());
    network.push({path: url.pathname, local: url.origin === origin, method: request.method(), payload: request.postDataBuffer() !== null});
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname === `/${workerAsset.path}`)
      deliveries.push(response.body().then(bytes => ({bytes: bytes.length, sha256: hash(bytes)})));
  });
  await page.addInitScript(() => {
    const observed = {workers: 0, nativeWorkers: 0, statuses: 0, failures: [] as string[], physical: [] as string[]};
    Object.defineProperty(window, '__visibleUpdateEvidence', {value: observed});
    for (const api of ['hid', 'usb', 'serial']) Object.defineProperty(navigator, api, {configurable: true, get() {
      observed.physical.push(api); throw new Error(`Unexpected physical ${api} access`);
    }});
    const NativeWorker = window.Worker;
    if (!Function.prototype.toString.call(NativeWorker).includes('[native code]')) throw new Error('Expected a native Worker');
    window.Worker = new Proxy(NativeWorker, {construct(target, args) {
      const worker = Reflect.construct(target, args, target);
      observed.workers++; if (worker instanceof NativeWorker) observed.nativeWorkers++;
      worker.addEventListener('message', (event: MessageEvent) => {
        const value = event.data;
        if (value?.type === 'error') observed.failures.push(String(value.message).slice(0, 512));
        if (value?.type === 'status' || value?.type === 'loaded') {
          observed.statuses++;
          if (value.cpuBackendFailed !== false || value.mailboxCached !== false || value.fault)
            observed.failures.push('Unhealthy guest status');
        }
      });
      return worker;
    }});
  });
  await page.goto('/emulator/');
  const session = page.locator('[data-session]').first();
  await expect(session.locator('[data-update-image]')).toBeDisabled();
  await expect(session.locator('[data-usb-advanced]')).not.toHaveAttribute('open', '');
  assert.equal(page.workers().length, 0);
  await session.locator('[data-format]').selectOption('app1');
  await session.locator('[data-file]').setInputFiles(r13.imageFile);
  await expect(session).toHaveAttribute('data-state', 'ready');
  assert.equal(page.workers().length, 0);
  const runtimePaths = new Set([
    ...build.emulatorRuntime.workerScripts, ...build.emulatorRuntime.clientBridgeScripts,
    ...build.emulatorRuntime.updaterScripts, ...build.emulatorRuntime.artifacts,
  ].map((row: {path: string}) => `/${row.path}`));
  assert.equal(network.some(row => runtimePaths.has(row.path)), false);
  await session.locator('[data-action="start"]').click();
  await expect(session.locator('[data-diagnostic="marker"]')).toHaveText(/523D0001/, {timeout: 45000});
  await session.locator('[data-action="pause"]').click();
  await expect(session).toHaveAttribute('data-state', 'paused');
  const legs = [];
  for (const [from, target] of [[r13, r14], [r14, r13]]) {
    await session.locator('[data-update-image]').setInputFiles(target.imageFile);
    await session.locator('[data-update-manifest]').setInputFiles(target.manifestFile);
    const submit = session.locator('[data-update-form] button[type="submit"]');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(session.locator('[data-update-phase]')).toHaveText('Update and fresh boot verified', {timeout: 120000});
    await expect(session.locator('[data-update-error]')).not.toBeVisible();
    await expect(session.locator('[data-diagnostic="marker"]')).toHaveText(new RegExp(target.marker.toString(16).toUpperCase()));
    await expect(session).toHaveAttribute('data-state', 'paused');
    const downloadPromise = page.waitForEvent('download');
    await session.locator('[data-action="export"]').click();
    const downloaded = await downloadPromise, downloadFile = await downloaded.path();
    assert.ok(downloadFile);
    const trace = JSON.parse(await fs.readFile(downloadFile, 'utf8'));
    const receipt = trace.virtualUpdate?.receipt;
    assert.equal(receipt?.scope, 'virtual APP1 update');
    assert.equal(receipt.before.build_marker, from.marker);
    assert.equal(receipt.image.sha256, target.sha256); assert.equal(receipt.image.length, target.length);
    assert.equal(receipt.flashVerified.state, 6); assert.equal(receipt.flashVerified.error, 0);
    assert.equal(receipt.flashReadback.verifiedBytes, Math.ceil(target.length / 4096) * 4096);
    assert.equal(receipt.separateStatus.state, 6); assert.equal(receipt.separateStatus.error, 0);
    assert.equal(receipt.bootStatus.state, 0); assert.equal(receipt.bootStatus.error, 0);
    assert.equal(receipt.bootStatus.build_marker, target.marker); assert.equal(receipt.snapshot.firmwareHash, target.sha256);
    legs.push({from: from.name, to: target.name, image: receipt.image, verifiedBytes: receipt.flashReadback.verifiedBytes,
      flashState: receipt.flashVerified.state, separateState: receipt.separateStatus.state,
      bootState: receipt.bootStatus.state, bootMarker: receipt.bootStatus.build_marker});
  }
  const screenshots = [];
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({width, height: 1000});
    await page.getByLabel('Color theme', {exact: true}).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const imageFile = path.join(path.dirname(reportFile), `page-${width}-${theme}.png`);
    await page.screenshot({path: imageFile, fullPage: true});
    screenshots.push({name: path.basename(imageFile), sha256: hash(await fs.readFile(imageFile))});
    const updateImageFile = path.join(path.dirname(reportFile), `update-${width}-${theme}.png`);
    await session.locator('.emulator-usb').screenshot({path: updateImageFile});
    screenshots.push({name: path.basename(updateImageFile), sha256: hash(await fs.readFile(updateImageFile))});
  }
  const observed = await page.evaluate(() => (window as unknown as {__visibleUpdateEvidence: {
    workers: number; nativeWorkers: number; statuses: number; failures: string[]; physical: string[];
  }}).__visibleUpdateEvidence);
  assert.equal(observed.workers, 1); assert.equal(observed.nativeWorkers, 1);
  assert.deepEqual(observed.failures, []); assert.deepEqual(observed.physical, []); assert.deepEqual(errors, []);
  const downloaded = await Promise.all(deliveries);
  assert.ok(downloaded.length > 0); assert.ok(downloaded.every(row => row.sha256 === workerAsset.sha256 && row.bytes === workerAsset.bytes));
  assert.ok(network.every(row => row.local && row.method === 'GET' && !row.payload && !/\.(bin|img|dat|raw|zip)$/i.test(row.path)));
  const report = {passed: true, scope: 'Visible public APP1 updater controls, local file inputs and executed native Worker firmware',
    browser: {version: browser.version(), isolatedProcess: true}, buildInfoSha256: hash(buildBytes), workerAsset,
    legs, observed, screenshots, sourceSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    physicalDeviceAccess: false, firmwareBytesPublished: false, sdBytesPublished: false,
    declaredApp1Restored: true, wholeNorRestored: false, fullSamplerVerified: false, deployed: false};
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
});
