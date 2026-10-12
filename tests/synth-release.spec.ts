import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import screens from '../src/content/releases/opensynth-screens.json' with {type:'json'};
import copy from '../src/content/releases/synth.json' with {type:'json'};
const features=copy.sections.find(s=>s.id==='features')!.rows! as Array<{label:string;text:string;screen:string;screenCaption?:string}>;

for(const width of [390,1440])for(const theme of ['light','dark']){
  test(`openSynth page structure ${width}px ${theme}`,async({page})=>{
    await page.setViewportSize({width,height:1000});await page.goto('/releases/synth/');
    await page.getByLabel('Color theme',{exact:true}).selectOption(theme);
    await expect(page.locator('main h1')).toHaveText('openSynth for the SP-404MKII');
    await expect(page.locator('.release-status')).toContainText('firmware v5.52');
    await expect(page.locator('main')).not.toContainText(/in testing|pending review|not yet|\bP1\d\b/i);
    await expect(page.locator('main .release-section h2')).toHaveText(['Features and how to use them','How to patch',"Why it won't brick your SP"]);
    await expect(page.locator('opensynth-screens')).toHaveAttribute('data-ready','true');
    await expect(page.locator('opensynth-screens [data-screen]')).toHaveCount(features.length+1);
    await expect(page.locator('.opensynth-hero [data-screen="detune"]')).toHaveCount(1);
    const rows=page.locator('#features .release-feature');
    await expect(rows).toHaveCount(features.length);
    for(const [i,row] of features.entries()){
      const item=rows.nth(i),animation=screens.animations.find(a=>a.id===row.screen)!;
      await expect(item.locator('h3')).toHaveText(row.label);
      await expect(item.locator(`[data-screen="${row.screen}"] img`)).toHaveAttribute('alt',`${animation.title}: ${(row as {screenCaption?:string}).screenCaption??animation.caption}`);
      await expect(item.locator('figcaption')).not.toBeEmpty();
    }
    await expect(page.locator('#features')).toContainText('SHIFT and turn VALUE');
    await expect(page.locator('#features')).toContainText('Press REC and choose an empty pad. Press REC to start');
    await expect(page.locator('#features')).toContainText('PW is greyed out');
    await expect(page.locator('.release-feature-status')).toHaveCount(0);
    await expect(page.locator('#patch')).toContainText('You do not need to download or drop a firmware file');
    await expect(page.locator('#patch [data-patcher]')).toHaveAttribute('data-ready','true');
    await expect(page.locator('#patch [data-patcher-drop]')).toContainText('Drop the v5.52 update file here');
    await expect(page.locator('#patch a[href="https://www.roland.com/global/support/by_product/sp-404mk2/updates_drivers/174cc2fc-ddb2-4128-87a0-848b882cdcea/"]')).toBeVisible();
    await expect(page.locator('#patch [data-source-patcher]')).toHaveCount(0);
    await expect(page.locator('#patch .release-steps > li')).toHaveCount(6);
    await expect(page.locator('#patch')).toContainText('stages OpenSynth P34');
    await expect(page.locator('#patch')).toContainText('reads every programmed sector back');
    await expect(page.locator('#safety')).toContainText('never writes the bootloader, APP0 or the fuses');
    await expect(page.locator('#safety')).toContainText('keep an SD card ready');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex');
    for(const img of await page.locator('opensynth-screens [data-screen] img').all()){
      await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth)).toBe(128);
      // Whole-pixel zoom keeps the 1-bit frames crisp.
      const zoom=await img.evaluate((i:HTMLImageElement)=>i.getBoundingClientRect().width/128);expect(Number.isInteger(zoom)).toBe(true);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const axe=await new AxeBuilder({page}).include('main').analyze();expect(axe.violations).toEqual([]);
  });
}
test('screens show a static first frame and full copy without scripts',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:1000}}),page=await context.newPage();await page.goto('/releases/synth/');
  await expect(page.locator('opensynth-screens img').first()).toBeVisible();
  for(const toggle of await page.locator('[data-screens-toggle]').all())await expect(toggle).toBeHidden();
  await expect(page.locator('#features .release-feature [data-screen] img')).toHaveCount(features.length);
  await expect(page.locator('#features')).toContainText('Press VALUE to go to the next page');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await context.close();
});
test('screen animations respect reduced motion, toggle, and pause offscreen',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/releases/synth/');
  const toggle=page.locator('.opensynth-hero [data-screens-toggle]'),featureToggle=page.locator('#features [data-screens-toggle]'),frame=()=>page.locator('[data-screen="detune"] img').evaluate((i:HTMLElement)=>i.style.transform);
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  await page.locator('.opensynth-hero').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);expect(await frame()).toBe('');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(featureToggle).toHaveAttribute('aria-pressed','true');
  await expect.poll(frame,{timeout:2000}).not.toBe('');
  const record=()=>page.locator('[data-screen="record"] img').evaluate((i:HTMLElement)=>i.style.transform);
  expect(await record()).toBe('');
  await page.locator('[data-screen="record"]').scrollIntoViewIfNeeded();
  await expect.poll(record,{timeout:3000}).not.toBe('');
  await page.locator('footer').scrollIntoViewIfNeeded();await page.waitForTimeout(150);const paused=await frame();await page.waitForTimeout(500);expect(await frame()).toBe(paused);
  await featureToggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');await expect(featureToggle).toHaveAttribute('aria-pressed','false');
});
test('screens play by default without reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/releases/synth/');
  await expect(page.locator('.opensynth-hero [data-screens-toggle]')).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>page.locator('[data-screen="detune"] img').evaluate((i:HTMLElement)=>i.style.transform),{timeout:2000}).not.toBe('');
});
