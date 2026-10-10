import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import copy from '../design/studies/home-copy.json' with {type:'json'};
import article from '../src/content/first-change.json' with {type:'json'};
import {readFileSync,readdirSync} from 'node:fs';
const journeyDir=new URL('../src/content/journey/',import.meta.url);
const journey=readdirSync(journeyDir).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(new URL(name,journeyDir),'utf8'))).sort((a,b)=>a.order-b.order);
const guideRoutes=['/guides/first-change/',...journey.map(chapter=>`/guides/${chapter.slug}/`)];

for(const width of [320,390,600,720,768,1100,1440,1920])for(const theme of ['light','dark']){
  test(`homepage ${width}px ${theme}`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await page.emulateMedia({reducedMotion:'reduce'});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/');
    await page.getByLabel('Color theme',{exact:true}).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(page.locator('h1')).toHaveText(copy.title);
    await expect(page.locator('.eyebrow')).toHaveText(copy.eyebrow);
    await expect(page.locator('.intro').first()).toHaveText(copy.intro);
    await expect(page.locator('.repository-note')).toHaveText(copy.repository);
    await expect(page.locator('.section-description')).toHaveText([copy.releasesHeading,copy.guidesHeading]);
    await expect(page.locator('.guide')).toHaveCount(0);
    await expect(page.locator('#guides .section-body')).toHaveText('In progress.');
    await expect(page.locator('.opensynth-card')).toHaveAttribute('href','/opensynth/');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const nav=await page.locator('nav').boundingBox();expect(Math.abs(nav!.x+nav!.width/2-width/2)).toBeLessThan(2);
    const box=await page.locator('.instrument').boundingBox();expect(box!.height/box!.width).toBeCloseTo(570/400,2);
    await expect(page.locator('sp-display')).toHaveAttribute('data-ready','true');
    await expect(page.locator('sp-display')).toHaveAttribute('data-state','paused');
    const screen=await page.locator('sp-display').boundingBox();expect(screen!.width/screen!.height).toBeCloseTo(2,2);
    const button=await page.locator('sp-display button').boundingBox();expect(button!.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('[data-component="Knob"]').count()).toBe(5);
    expect(await page.locator('[data-component="Pad - idle"]').count()).toBe(16);
    expect(errors).toEqual([]);
    if([390,1440].includes(width)){
      const report=await new AxeBuilder({page}).analyze();expect(report.violations).toEqual([]);
      await page.screenshot({path:`test-results/home-${width}-${theme}.png`,fullPage:true});
    }
  });
}

test('disclosures, navigation, themes and keyboard playback',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  for(const id of ['releases','guides']){
    const summary=page.locator(`#${id} summary`);await summary.focus();await page.keyboard.press('Enter');
    await expect(page.locator(`#${id}`)).not.toHaveAttribute('open','');
    await page.locator(`nav a[href="#${id}"]`).click();await expect(page.locator(`#${id}`)).toHaveAttribute('open','');
  }
  await page.locator('sp-display').scrollIntoViewIfNeeded();
  const button=page.locator('sp-display button');await button.focus();await page.keyboard.press('Space');
  await expect(page.locator('sp-display')).toHaveAttribute('data-state','playing');
  await page.keyboard.press('Space');await expect(page.locator('sp-display')).toHaveAttribute('data-state','paused');
  await page.getByLabel('Color theme',{exact:true}).selectOption('dark');await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByLabel('Color theme',{exact:true}).selectOption('system');await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('screen playback suspends offscreen and respects motion changes',async({page})=>{
  await page.setViewportSize({width:1440,height:800});await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');
  const screen=page.locator('sp-display');await expect(screen).toHaveAttribute('data-state','playing');
  await expect.poll(()=>screen.getAttribute('data-frame')).not.toBe('0');
  await page.locator('footer').scrollIntoViewIfNeeded();await expect(screen).toHaveAttribute('data-state','suspended');
  const frame=await screen.getAttribute('data-frame');await page.waitForTimeout(100);await expect(screen).toHaveAttribute('data-frame',frame!);
  await screen.scrollIntoViewIfNeeded();await expect(screen).toHaveAttribute('data-state','playing');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(screen).toHaveAttribute('data-state','paused');
});

test('static page works without JavaScript',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('/');
  await expect(page.locator('h1')).toHaveText('OpenSP');await expect(page.locator('.screen-poster')).toBeVisible();
  await expect(page.locator('sp-display button')).toBeHidden();await expect(page.locator('.theme-control')).toBeHidden();
  await page.locator('#releases summary').click();await expect(page.locator('#releases')).not.toHaveAttribute('open','');await context.close();
});

test('failed screen asset keeps its poster',async({page})=>{
  await page.route('**/sprite*.png',route=>route.abort());await page.goto('/');
  await expect(page.locator('sp-display')).toHaveAttribute('data-state','error');await expect(page.locator('.screen-poster')).toBeVisible();
  await expect(page.locator('sp-display button')).toBeHidden();
});

test('published surface has no dead guide links or private design references',async({page,request})=>{
  await page.goto('/');await expect(page.getByText('Planned guides. Not published yet.')).toHaveCount(0);
  for(const route of guideRoutes)expect((await request.get(route)).ok()).toBe(true);
  expect((await request.get('/opensynth/')).ok()).toBe(true);
  expect((await request.get('/guides/first-change/')).ok()).toBe(true);
  expect(await page.locator('a[href*="design/studies"],a[href*="penpot"]').count()).toBe(0);
  for(const target of ['/favicon.svg','/robots.txt','/sitemap-index.xml','/build-info.json','/404.html'])expect((await request.get(target)).ok()).toBe(true);
});
