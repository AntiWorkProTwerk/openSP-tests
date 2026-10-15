import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('withdrawn release offers no installer or hosted APP1 image', async ({page, request}) => {
  const servedPage = await request.get('/releases/synth/');
  expect(servedPage.ok()).toBe(true);
  expect(await servedPage.text()).toBe(readFileSync(new URL('../dist/releases/synth/index.html', import.meta.url), 'utf8'));
  await page.goto('/releases/synth/');
  await expect(page.locator('.release-status')).toHaveText(
    'The installer is temporarily unavailable while release artifacts are reviewed.');
  await expect(page.locator('[data-patcher], [data-direct-usb], [data-usb-installer]')).toHaveCount(0);
  const image = await request.head('/opensynth/usb/opensynth-p34-app1.bin');
  expect(image.status()).toBe(404);
});
