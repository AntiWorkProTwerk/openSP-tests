import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for(const width of [390,1440])for(const theme of ['light','dark'])test(`Full15 source picker ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await page.goto('/features/source-preview-full15/');
  await expect(page.locator('[data-feature-picker]')).toHaveAttribute('data-ready','true');
  await page.getByLabel('Color theme',{exact:true}).selectOption(theme);
  await expect(page.locator('[data-build]')).toBeDisabled();
  await page.locator('[data-choice="synth"]').check();
  await expect(page.locator('[data-build]')).toBeEnabled();
  await expect(page.locator('[data-export]')).toBeEnabled();
  await expect(page.locator('[data-upload]')).toBeDisabled();
  await expect(page.locator('[data-entry="synth"]')).toHaveValue('chooser');
  await expect(page.locator('[data-choice="usb-recorder"]')).toBeEnabled();
  await page.locator('[data-choice="usb-recorder"]').check();
  await expect(page.locator('[data-selection-count]')).toHaveText('2 source features selected');
  await expect(page.locator('[data-shortcut-preview="usb-recorder"]')).toHaveText('PC recorder');
  await expect(page.locator('[data-build]')).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const axe=await new AxeBuilder({page}).analyze();expect(axe.violations).toEqual([]);
  await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();scrollTo(0,0);});
  await page.screenshot({path:`test-results/feature-source-preview-full15-${width}-${theme}.png`,fullPage:true});
});

test('Full14 selection stays separate and reaches its source helper',async({page})=>{
  await page.goto('/features/');await page.locator('[data-choice="synth"]').check();
  await page.goto('/features/source-preview/');
  await expect(page.locator('[data-feature-picker]')).toHaveAttribute('data-ready','true');
  await expect(page.locator('[data-choice="synth"]')).not.toBeChecked();
  await page.locator('[data-choice="synth"]').check();await page.locator('[data-choice="usb-recorder"]').check();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-export]').click();
  expect((await downloadPromise).suggestedFilename()).toBe('opensp-full14-source-selection.json');
  await page.locator('[data-chord-feature="synth"][data-position="1"]').selectOption('REMAIN');
  await expect(page.locator('[data-validation-errors]')).toContainText('Custom');await expect(page.locator('[data-build]')).toBeDisabled();
  await page.locator('[data-chord-feature="synth"][data-position="1"]').selectOption('RECORD_SETTING');
  await page.locator('[data-build]').click();
  await expect(page).toHaveURL(/\/features\/source-preview\/local-build\/$/);
  await expect(page.locator('[data-source-selection-status]')).toHaveText('full14-source-preview-global');
  await expect(page.locator('[data-source-build]')).toBeDisabled();
  await page.locator('[data-source-connection]').fill('http://example.invalid/#bad');
  await page.locator('[data-source-connect]').click();
  await expect(page.locator('[data-source-error]')).toContainText('exact loopback connection');
  await expect(page.locator('[data-source-build]')).toBeDisabled();
  await page.goto('/features/');await expect(page.locator('[data-choice="synth"]')).toBeChecked();
  await expect(page.locator('[data-choice="usb-recorder"]')).not.toBeChecked();
});

test('Full15 custom chord exports and restores without changing Full14 choices',async({page})=>{
  await page.goto('/features/source-preview/');await page.locator('[data-choice="synth"]').check();
  await page.goto('/features/source-preview-full15/');
  await expect(page.locator('[data-choice="synth"]')).not.toBeChecked();
  await page.locator('[data-choice="synth"]').check();
  await page.locator('[data-entry="synth"]').selectOption('chord');
  await page.locator('[data-chord-feature="synth"][data-position="1"]').selectOption('PAD_1');
  await page.locator('[data-chord-feature="synth"][data-position="2"]').selectOption('REMAIN');
  await page.locator('[data-choice="usb-recorder"]').check();
  await expect(page.locator('[data-build]')).toBeEnabled();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-export]').click();
  expect((await downloadPromise).suggestedFilename()).toBe('opensp-full15-synth-shortcut-source-selection.json');
  await page.reload();
  await expect(page.locator('[data-chord-feature="synth"][data-position="1"]')).toHaveValue('PAD_1');
  await expect(page.locator('[data-chord-feature="synth"][data-position="2"]')).toHaveValue('REMAIN');
  await page.locator('[data-chord-feature="synth"][data-position="2"]').selectOption('');
  await page.locator('[data-chord-feature="synth"][data-position="1"]').selectOption('PAD_13');
  await expect(page.locator('[data-validation-errors]')).toContainText('stock Utility');
  await expect(page.locator('[data-build]')).toBeDisabled();
  await page.locator('[data-chord-feature="synth"][data-position="1"]').selectOption('PAD_1');
  await page.locator('[data-build]').click();
  await expect(page).toHaveURL(/\/features\/source-preview-full15\/local-build\/$/);
  await expect(page.locator('[data-source-selection-status]')).toHaveText('full15-shortcut-optional-global-source-preview');
  await expect(page.locator('[data-source-build]')).toBeDisabled();
  await page.goto('/features/source-preview/');
  await expect(page.locator('[data-choice="synth"]')).toBeChecked();
  await expect(page.locator('[data-chord-feature="synth"][data-position="1"]')).toHaveValue('RECORD_SETTING');
});

for(const route of ['/features/source-preview/','/features/source-preview-full15/'])test(`${route} remains readable without JavaScript`,async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:1000}});
  const page=await context.newPage();await page.goto(route);
  await expect(page.locator('[data-no-script]')).toBeVisible();
  await expect(page.locator('[data-choice="synth"]')).toBeDisabled();
  await expect(page.getByText('Source compilation needs no SP connection.',{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await context.close();
});
