import {test, expect, type Page} from '@playwright/test';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {diff, encode, FORMAT} from '../tools/opensynth-patcher/make-patch.mjs';
import meta from '../src/content/releases/synth-patch.json' with {type: 'json'};
import usbMeta from '../src/content/releases/synth-usb.json' with {type: 'json'};

const sha = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
const realStockUrl = new URL('../../sp404mk2/firmware/v552/extracted/sp404mk2_sys_v552/SP404MKII_APP1.bin', import.meta.url);
const hasRealStock = existsSync(realStockUrl);
const realStock = hasRealStock ? readFileSync(realStockUrl) : Buffer.alloc(0);
const realStockTest = hasRealStock ? test : test.skip;

// A synthetic official image and B2-shaped target; no Roland bytes are used here.
const official = randomBytes(64 * 1024);
const b2 = 0x288000, target = Buffer.alloc(b2 + 0x1000), targetView = new DataView(target.buffer, target.byteOffset, target.byteLength), h = b2 + 0x200;
targetView.setUint32(0, 0xbffef287, true); target.write('SPUAFW10', h, 'ascii');
for (const [offset, value] of [[8,2],[12,0x1000],[16,0x80000000],[20,0x400],[24,0x400],[28,0x20243000],
  [32,0x32425053],[36,0x800],[40,0x2023f000],[44,0],[48,0x800],[52,0x800]]) targetView.setUint32(h + offset, value, true);
targetView.setUint32(b2 + 0x400, 0x20243000, true); targetView.setUint32(b2 + 0x800, 0x52420201, true);
randomBytes(0x7fc).copy(target, b2 + 0x804);
const patch: Buffer = encode({format: FORMAT, zipEntry: 'SP404MKII_APP1.bin',
  input: {name: 'SP404MKII_APP1.bin', bytes: official.length, sha256: sha(official)},
  output: {name: 'SP404MKII_APP1.bin', bytes: target.length, sha256: sha(target)}}, diff(official, target));

/** Serve the synthetic patch and point the page's pin at it. */
async function useSyntheticPatch(page: Page) {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.route('**/opensynth/patch/*.ospatch', route => route.fulfill({body: patch, contentType: 'application/octet-stream'}));
  await page.route('**/releases/synth/', async route => {
    const response = await route.fetch();
    route.fulfill({response, body: (await response.text())
      .replaceAll(meta.patch.sha256, sha(patch))
      .replaceAll(meta.output.sha256, sha(target))
      .replaceAll(`data-output-bytes="${meta.output.bytes}"`, `data-output-bytes="${target.length}"`)});
  });
  return requests;
}

async function dropFile(page: Page, name: string, bytes: Buffer) {
  const transfer = await page.evaluateHandle(({name, data}) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], name));
    return dt;
  }, {name, data: [...bytes]});
  const zone = page.locator('[data-patcher-drop]');
  await zone.dispatchEvent('dragenter', {dataTransfer: transfer});
  await zone.dispatchEvent('dragover', {dataTransfer: transfer});
  await expect(zone).toHaveAttribute('data-over', 'true');
  await zone.dispatchEvent('drop', {dataTransfer: transfer});
}

for (const theme of ['light', 'dark']) test(`dropping the update builds a checked download (${theme})`, async ({page}) => {
  const requests = await useSyntheticPatch(page);
  await page.goto('/releases/synth/');
  await page.getByLabel('Color theme', {exact: true}).selectOption(theme);
  const patcher = page.locator('[data-patcher]');
  await expect(patcher).toHaveAttribute('data-ready', 'true');
  await expect(patcher).toBeVisible();
  await expect(page.locator('#patch a[href^="https://www.roland.com/"]')).toBeVisible();
  // Nothing is fetched until a file is supplied.
  expect(requests.some(url => url.includes('.ospatch'))).toBe(false);
  await dropFile(page, 'sp404mk2_sys_v552.bin', official);
  await expect(patcher).toHaveAttribute('data-state', 'done');
  await expect(page.locator('[data-patcher-sha]')).toHaveText(sha(target));
  await expect(page.locator('[data-usb-installer]')).toBeVisible();
  await expect(page.locator('[data-usb-action]')).toContainText('Begin guided USB install');
  await expect(page.locator('[data-usb-action]')).toBeEnabled();
  await expect(page.locator('[data-usb-existing]')).toContainText('already-running R51');
  await expect(page.locator('.usb-installer-steps li')).toHaveCount(3);
  await expect(page.locator('[data-usb-stock-check], [data-usb-stock-run], [data-usb-connect], [data-usb-install]')).toHaveCount(0);
  await expect(page.locator('[data-usb-installer] .usb-installer-warning')).toContainText('Connect only one SP-404MKII');
  await expect(page.locator('[data-usb-installer]')).toContainText('guarded R51 writer');
  await expect(page.locator('[data-usb-normal]')).toHaveCount(0);
  await expect(page.locator('[data-usb-b2]')).toHaveCount(0);
  await expect(page.locator('[data-stage]')).toHaveCount(4);
  for (const stage of await page.locator('[data-stage]').all()) await expect(stage).toHaveAttribute('data-status', 'done');
  await expect(page.locator('.patcher-progress progress')).toHaveJSProperty('value', 100);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-patcher-save]').click()]);
  expect(download.suggestedFilename()).toBe('SP404MKII_APP1.bin');
  expect(sha(readFileSync((await download.path())!))).toBe(sha(target));
  // Only the patch itself was requested; the visitor's file is never sent anywhere.
  expect(requests.filter(url => !/\/releases\/synth\/$|\.(?:css|js|png|woff2?|svg|json)(?:\?|$)|\.ospatch$|\/@|node_modules|\/src\//.test(url))).toEqual([]);
});

realStockTest('the first guided action opens only the stock serial picker', async ({page}) => {
  await page.addInitScript(() => {
    const calls = {usb: 0, serial: 0};
    Object.defineProperty(navigator, 'usb', {value: {
      getDevices: async () => [],
      requestDevice: async () => { calls.usb++; throw new Error('WebUSB picker must not open'); },
    }, configurable: true});
    Object.defineProperty(navigator, 'serial', {value: {getPorts: async () => [], requestPort: async () => {
      calls.serial++; const error = new DOMException('cancelled', 'NotFoundError'); throw error;
    }}, configurable: true});
    Object.defineProperty(navigator, 'hid', {value: {}, configurable: true});
    (window as any).__pickerCalls = calls;
  });
  await page.goto('/releases/synth/');
  await dropFile(page, 'SP404MKII_APP1.bin', realStock);
  const action = page.locator('[data-usb-action]');
  await expect(action).toBeEnabled();
  await action.click();
  await expect(page.locator('[data-patcher]')).toHaveAttribute('data-usb-step', 'stock-check');
  expect(await page.evaluate(() => (window as any).__pickerCalls)).toEqual({usb: 0, serial: 1});
});

test('the stock installer starts without a firmware file and opens only the serial picker', async ({page}) => {
  await page.addInitScript(() => {
    const calls = {serial: 0, hid: 0};
    Object.defineProperty(navigator, 'serial', {value: {getPorts: async () => [], requestPort: async () => {
      calls.serial++; const error = new DOMException('cancelled', 'NotFoundError'); throw error;
    }}, configurable: true});
    Object.defineProperty(navigator, 'hid', {value: {getDevices: async () => [], requestDevice: async () => {
      calls.hid++; throw new Error('HID picker must not open during the stock step');
    }}, configurable: true});
    (window as any).__directPickerCalls = calls;
  });
  await page.goto('/releases/synth/');
  const action = page.locator('[data-direct-usb-action]');
  await expect(action).toBeEnabled();
  await action.click();
  await expect(page.locator('[data-direct-usb-status]')).toContainText('No stock SP serial port was selected');
  expect(await page.evaluate(() => (window as any).__directPickerCalls)).toEqual({serial: 1, hid: 0});
});

for (const {resumeAfterReload, failPassiveReturn, failCommitStatus} of [
  {resumeAfterReload:false,failPassiveReturn:false,failCommitStatus:false},
  {resumeAfterReload:true,failPassiveReturn:false,failCommitStatus:false},
  {resumeAfterReload:true,failPassiveReturn:true,failCommitStatus:false},
  {resumeAfterReload:true,failPassiveReturn:false,failCommitStatus:true},
]) test(failCommitStatus
  ? 'closing during COMMIT leaves a durable lock and cannot resend COMMIT after reload'
  : failPassiveReturn
  ? 'a failed passive P34 return after R51 reset remains locked after reload without a second COMMIT'
  : resumeAfterReload
    ? 'the direct R51 install resumes a carrier-complete claim after reload without repeating the stock handoff'
    : 'the pinned stock route reaches R51, flashes P34 and proves the reboot without a firmware file', async ({page}) => {
  test.setTimeout(90_000);
  const r51 = [...readFileSync(new URL('../public/opensynth/usb/stock-r51-v1.osr51', import.meta.url))];
  await page.addInitScript(({r51Bytes, resumeAfterReload, failPassiveReturn, failCommitStatus}) => {
    const state: any = {carrierDone: resumeAfterReload, carrierWrites: 0, pickerCalls: 0, serialPickerCalls: 0,
      stockPortOpens: 0, commitRequests: Number(sessionStorage.getItem('test:r51-commits') ?? 0),
      resetRequests: Number(sessionStorage.getItem('test:r51-resets') ?? 0), resetRequested: false,
      hidGranted: false, app1FetchStarted: false};
    const realFetch=window.fetch.bind(window);
    window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
      if(String(input).includes('/opensynth/usb/opensynth-p34-app1.bin'))state.app1FetchStarted=true;
      return realFetch(input,init);
    }) as typeof window.fetch;
    const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(part => [...part]));
    const raw = (value: string) => Uint8Array.from(value.match(/../g)!.map(byte => Number.parseInt(byte, 16)));
    const u32 = (value: number) => { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out; };
    const encode5 = (value: number) => Uint8Array.of((value >> 28) & 0x7f, (value >> 21) & 0x7f,
      (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f);
    const wrap = (magic: string, payload: Uint8Array) => concat(raw(magic), new Uint8Array(8), u32(payload.length), payload);
    const ack = (result: number, errno = 0) => wrap('13e06006', concat(raw('f0417a7a'), encode5(result), encode5(errno), Uint8Array.of(0xf7)));
    const data = (handle: number, body: Uint8Array) => wrap('13e06006', concat(raw('f0417a02'), encode5(handle),
      Uint8Array.of(0x40), encode5(body.length).subarray(1), body, Uint8Array.of(0xf7)));
    const startup = () => concat(
      wrap('13e06b05', raw('7e00000000000000ffffffff00020000000b33')),
      wrap('13e00005', raw('010000ffff00000000')),
      wrap('13e00005', raw('010000ffff00000000')),
    );
    const crc32 = (body: Uint8Array) => {
      let crc = 0xffffffff;
      for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
      return (crc ^ 0xffffffff) >>> 0;
    };
    const stock = {vendorId: 0x0582, productId: 0x02e7, configurations: [{configurationValue: 1, interfaces: [{interfaceNumber: 1,
      alternates: [{alternateSetting: 0, interfaceClass: 0x0a, interfaceSubclass: 0, interfaceProtocol: 0,
        endpoints: [{endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 512},
          {endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 512}]}]}]}]};
    const image = Uint8Array.from(r51Bytes);
    const stockPort: any = {readable: null, writable: null, sessions: 0,
      getInfo: () => ({usbVendorId: 0x0582, usbProductId: 0x02e7}),
      async open() {
        state.stockPortOpens++;
        const session = this.sessions++; let controller: ReadableStreamDefaultController<Uint8Array>, readOffset = 0;
        this.readable = new ReadableStream({start(value) { controller = value; }});
        this.controller = controller!;
        this.writable = new WritableStream({write(chunk: Uint8Array) {
          const packet = Uint8Array.from(chunk);
          if (session === 2) { if (++state.carrierWrites === 54) state.carrierDone = true; return; }
          if (packet.length === 25 && packet[0] === 0x13 && packet[1] === 0x60 && packet[3] === 0x05) {
            controller.enqueue(startup()); return;
          }
          if (packet.length < 16 || packet[0] !== 0x13 || packet[1] !== 0x60 || packet[3] !== 0x06) return;
          const txid = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(8, true);
          if (txid === 0x30000001) controller.enqueue(ack(-1, 2));
          else if (txid === 0x30000002) controller.enqueue(ack(7));
          else if (txid >= 0x30000100 && txid < 0x30001000) controller.enqueue(ack(packet.length - 32));
          else if (txid === 0x30000004 || txid === 0x31000004) controller.enqueue(ack(0));
          else if (txid === 0x31000001) controller.enqueue(ack(7));
          else if (txid >= 0x31000100 && txid < 0x31001000) {
            const part = image.subarray(readOffset, readOffset + 20 * 1024); readOffset += part.length; controller.enqueue(data(7, part));
          } else if (txid === 0x31000003) controller.enqueue(ack(0));
        }});
      },
      async setSignals() {},
      async close() { try { this.controller?.close(); } catch {} this.readable = null; this.writable = null; },
    };
    const fields = ['version','state','error','length','received','crc32','maximum','capabilities','jedec','flash_status',
      'flash_error','programmed','flash_ready','flash_crc32','build_marker'];
    const status: Record<string, number> = Object.fromEntries(fields.map(field => [field, 0]));
    Object.assign(status, {version: 2, maximum: 0x37f000, capabilities: 3, build_marker: 0x52650001});
    let expectedCrc = 0; const upload: number[] = []; let armed = false;
    const writer: any = {vendorId: 0xcafe, productId: 0x404f, productName: 'SP404 STOCK FLASH R51', opened: false,
      collections: [{usagePage: 0xff00, usage: 1}],
      async open() { this.opened = true; }, async close() { this.opened = false; },
      async receiveFeatureReport() {
        if (failCommitStatus && status.state === 6) return new DataView(new ArrayBuffer(8));
        const bytes = new Uint8Array(64); bytes.set([0x53,0x50,0x35,0x31]); const view = new DataView(bytes.buffer);
        fields.forEach((field, index) => view.setUint32(4 + index * 4, status[field] >>> 0, true)); return view;
      },
      async sendFeatureReport(_id: number, value: BufferSource) {
        const bytes = new Uint8Array(value instanceof ArrayBuffer ? value : value.buffer, value instanceof ArrayBuffer ? 0 : value.byteOffset,
          value instanceof ArrayBuffer ? value.byteLength : value.byteLength);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), opcode = bytes[0], count = bytes[2], argument = view.getUint32(4, true);
        if (opcode === 5) Object.assign(status, {jedec: 0xc22016, flash_status: 0x40, flash_ready: 1});
        else if (opcode === 1) { expectedCrc = view.getUint32(8, true); upload.length = 0; Object.assign(status, {state: 1, length: argument, received: 0}); }
        else if (opcode === 2) { for (const byte of bytes.subarray(8, 8 + count)) upload.push(byte); status.received = upload.length; }
        else if (opcode === 3) { status.crc32 = crc32(Uint8Array.from(upload)); status.state = 2; }
        else if (opcode === 6) { state.commitRequests++; sessionStorage.setItem('test:r51-commits', String(state.commitRequests));
          Object.assign(status, {state: 6, programmed: Math.ceil(upload.length / 4096) * 4096, flash_crc32: expectedCrc}); }
        else if (opcode === 13) armed = true;
        else if (opcode === 14 && armed) { state.resetRequests++; sessionStorage.setItem('test:r51-resets', String(state.resetRequests)); state.resetRequested = true; }
        else throw new Error(`Unexpected R51 opcode ${opcode}`);
      },
    };
    const session = new Uint8Array(68), sessionView = new DataView(session.buffer); session.set([0x53,0x50,0x47,0x31]);
    session[4] = 1; session[5] = 1; sessionView.setUint16(8, 32, true); sessionView.setUint16(10, 32, true);
    sessionView.setUint32(12, 0x12345678, true); sessionView.setUint32(16, 1, true); sessionView.setUint32(32, 23, true);
    sessionView.setUint32(36, 0x05520001, true); sessionView.setUint32(44, 1124, true); sessionView.setUint16(48, 128, true);
    sessionView.setUint16(50, 64, true); sessionView.setUint16(52, 2, true); sessionView.setUint16(54, 64, true);
    sessionView.setUint32(60, 0x4f534731, true); sessionView.setUint32(64, crc32(session.subarray(0, 64)), true);
    const p34Port: any = {readable: null, writable: null, getInfo: () => ({usbVendorId: 0x0582, usbProductId: 0x02e7}),
      async open() { this.readable = new ReadableStream({start(controller) { if (!failPassiveReturn) controller.enqueue(session); controller.close(); }}); },
      async setSignals() {}, async close() { this.readable = null; }};
    Object.defineProperty(navigator, 'usb', {value: {getDevices: async () => [stock], requestDevice: async () => { state.pickerCalls++; throw new Error('USB picker opened'); }}, configurable: true});
    Object.defineProperty(navigator, 'serial', {value: {getPorts: async () => state.carrierDone ? [p34Port] : [],
      requestPort: async () => { state.pickerCalls++; state.serialPickerCalls++; return stockPort; }}, configurable: true});
    Object.defineProperty(navigator, 'hid', {value: {getDevices: async () => ((!resumeAfterReload&&state.carrierDone)||state.hidGranted) ? [writer] : [],
      requestDevice: async () => { state.pickerCalls++; if (resumeAfterReload) {
        if(state.app1FetchStarted)throw new Error('HID permission was requested after firmware fetch consumed activation');
        state.hidGranted=true;return [writer];
      } throw new Error('HID picker opened'); }}, configurable: true});
    localStorage.setItem('opensp:r51-webhid-permission-v1', 'granted');
    (window as any).__oneActionState = state;
  }, {r51Bytes: r51, resumeAfterReload, failPassiveReturn, failCommitStatus});
  await page.goto('/releases/synth/');
  if (resumeAfterReload) {
    await page.evaluate(({stagePath, writerSha256, carrierSha256}) => localStorage.setItem(
      `opensp:stock-r51v:${carrierSha256}`,
      JSON.stringify({format:'opensp-stock-r51v-claim-v1',state:'carrier-complete',stagePath,writerSha256,carrierSha256,
        retryAllowed:false,updatedAt:new Date().toISOString()})),
      {stagePath:usbMeta.stock.stagePath,writerSha256:usbMeta.r51.sha256,carrierSha256:usbMeta.carrier.sha256});
    await page.reload();
    await expect(page.locator('[data-direct-usb-action]')).toHaveText('Continue with R51 and install OpenSynth');
    await expect(page.locator('[data-direct-usb-status]')).toContainText('The stock handoff is complete');
  }
  await page.locator('[data-direct-usb-action]').click();
  const claimKey=`opensp:stock-r51v:${usbMeta.carrier.sha256}`;
  if (failCommitStatus) {
    await expect(page.locator('[data-direct-usb-status]')).toContainText('Do not resend the carrier or restart the flash');
    await expect(page.locator('[data-direct-usb-action]')).toBeDisabled();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, claimKey)).toBe('app1-commit-started');
    expect(await page.evaluate(() => (window as any).__oneActionState)).toMatchObject({commitRequests:1,resetRequests:0,stockPortOpens:0,carrierWrites:0});
    await page.reload();
    await expect(page.locator('[data-direct-usb-action]')).toHaveText('Installation stopped');
    await expect(page.locator('[data-direct-usb-action]')).toBeDisabled();
    await expect(page.locator('[data-direct-usb-status]')).toContainText('APP1 COMMIT boundary was reached');
    await page.locator('[data-direct-usb-action]').evaluate((button: HTMLButtonElement) => button.click());
    expect(await page.evaluate(() => (window as any).__oneActionState)).toMatchObject({commitRequests:1,resetRequests:0,
      pickerCalls:0,serialPickerCalls:0,stockPortOpens:0,carrierWrites:0});
    return;
  }
  if (failPassiveReturn) {
    await expect(page.locator('[data-direct-usb-status]')).toContainText('pinned passive firmware identity was not observed');
    await expect(page.locator('[data-direct-usb-status]')).toContainText('Do not resend the carrier or restart the flash');
    await expect(page.locator('[data-direct-usb-action]')).toBeDisabled();
    await expect(page.locator('[data-direct-usb-receipt]')).toBeHidden();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, claimKey)).toBe('app1-reset-sent');
    expect(await page.evaluate(() => (window as any).__oneActionState)).toMatchObject({commitRequests:1,resetRequests:1,stockPortOpens:0,carrierWrites:0});
    await page.reload();
    await expect(page.locator('[data-direct-usb-action]')).toHaveText('Installation stopped');
    await expect(page.locator('[data-direct-usb-action]')).toBeDisabled();
    await expect(page.locator('[data-direct-usb-status]')).toContainText('APP1 was committed and the guarded reset was sent');
    await page.locator('[data-direct-usb-action]').evaluate((button: HTMLButtonElement) => button.click());
    expect(await page.evaluate(() => (window as any).__oneActionState)).toMatchObject({commitRequests:1,resetRequests:1,
      pickerCalls:0,serialPickerCalls:0,stockPortOpens:0,carrierWrites:0});
    return;
  }
  await expect(page.locator('[data-direct-usb-status]')).toContainText('Installation complete', {timeout: 60_000});
  await expect(page.locator('[data-direct-usb-progress] progress')).toHaveJSProperty('value', 100);
  await expect(page.locator('[data-direct-usb-receipt]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__oneActionState)).toMatchObject({pickerCalls: 1,
    serialPickerCalls: resumeAfterReload ? 0 : 1, stockPortOpens: resumeAfterReload ? 0 : 3,
    carrierWrites: resumeAfterReload ? 0 : 54, commitRequests: 1, resetRequests: 1, resetRequested: true});
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, claimKey)).toBe('installation-complete');
  await page.reload();
  await expect(page.locator('[data-direct-usb-action]')).toHaveText('Installation complete');
  await expect(page.locator('[data-direct-usb-action]')).toBeDisabled();
  await expect(page.locator('[data-direct-usb-status]')).toContainText('recorded a verified OpenSynth P34 installation');
  expect(await page.evaluate(() => (window as any).__oneActionState)).toMatchObject({commitRequests:1,resetRequests:1,pickerCalls:0,stockPortOpens:0,carrierWrites:0});
});

test('the file picker works and a wrong file is refused with a clear message', async ({page}) => {
  await useSyntheticPatch(page);
  await page.setViewportSize({width: 390, height: 900});
  await page.goto('/releases/synth/');
  const input = page.locator('[data-patcher] input[type=file]');
  await input.focus();
  await expect(page.locator('[data-patcher-drop]')).toHaveCSS('outline-style', 'solid');
  const wrong = Buffer.from(official); wrong[7] ^= 1;
  await input.setInputFiles({name: 'SP404MKII_APP1.bin', mimeType: 'application/octet-stream', buffer: wrong});
  await expect(page.locator('[data-patcher]')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-patcher-status]')).toContainText("isn't Roland's SP-404MKII v5.52 update");
  await expect(page.locator('[data-patcher-save]')).toBeHidden();
  await input.setInputFiles({name: 'SP404MKII_APP1.bin', mimeType: 'application/octet-stream', buffer: official});
  await expect(page.locator('[data-patcher]')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('[data-patcher-save]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-patcher-reset]').click();
  await expect(page.locator('[data-patcher]')).toHaveAttribute('data-state', 'idle');
});

test('the real patch is published and pinned', async ({request}) => {
  const response = await request.get(meta.patch.url);
  expect(response.status()).toBe(200);
  expect(sha(await response.body())).toBe(meta.patch.sha256);
  expect((await request.get('/opensynth/patches/p6s.json')).status()).toBe(404);
});

test('only the stock carrier is published at its exact pin', async ({request}) => {
  for (const item of [usbMeta.carrier]) {
    const response = await request.get(item.url);
    expect(response.status()).toBe(200); expect((await response.body()).length).toBe(item.bytes);
    expect(sha(await response.body())).toBe(item.sha256);
  }
});

test('legacy Synth URL reaches the patcher page', async ({page}) => {
  await page.goto('/opensynth/');
  await expect(page).toHaveURL(/\/releases\/synth\/$/);
  await expect(page.locator('[data-patcher]')).toHaveAttribute('data-ready', 'true');
});

test('without JavaScript the page explains that the patcher needs it', async ({browser}) => {
  const context = await browser.newContext({javaScriptEnabled: false}), page = await context.newPage();
  await page.goto('/releases/synth/');
  await expect(page.locator('[data-patcher]')).toBeHidden();
  await expect(page.locator('.patcher-noscript')).toBeVisible();
  await expect(page.locator('.patcher-noscript')).toContainText('needs JavaScript');
  await context.close();
});
