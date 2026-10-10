import {test, expect, type Page} from '@playwright/test';
import {createHash, randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {diff, encode, FORMAT} from '../tools/opensynth-patcher/make-patch.mjs';
import meta from '../src/content/releases/synth-patch.json' with {type: 'json'};

const sha = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');

// A synthetic "official" image and target; no Roland bytes are used here.
const official = randomBytes(48 * 1024);
const target = Buffer.concat([official.subarray(0, 30000), Buffer.from('openSynth test module '.repeat(30)), official.subarray(31000), randomBytes(99)]);
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
    route.fulfill({response, body: (await response.text()).replaceAll(meta.patch.sha256, sha(patch))});
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
  await expect(page.locator('[data-stage]')).toHaveCount(4);
  for (const stage of await page.locator('[data-stage]').all()) await expect(stage).toHaveAttribute('data-status', 'done');
  await expect(page.locator('progress')).toHaveJSProperty('value', 100);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-patcher-save]').click()]);
  expect(download.suggestedFilename()).toBe('SP404MKII_APP1.bin');
  expect(sha(readFileSync((await download.path())!))).toBe(sha(target));
  // Only the patch itself was requested; the visitor's file is never sent anywhere.
  expect(requests.filter(url => !/\/releases\/synth\/$|\.(?:css|js|png|woff2?|svg|json)(?:\?|$)|\.ospatch$|\/@|node_modules|\/src\//.test(url))).toEqual([]);
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
