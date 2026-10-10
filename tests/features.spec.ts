import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import {blankSelection,defaultChoice,exportSelection,STORAGE_KEY,type Selection} from '../src/lib/features/selection';

for(const width of [320,390,768,1440])for(const theme of ['light','dark'])test(`feature picker ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/features/');await expect(page.locator('[data-feature-picker]')).toHaveAttribute('data-ready','true');await page.getByLabel('Color theme',{exact:true}).selectOption(theme);
  await expect(page.getByRole('heading',{name:'Choose your features'})).toBeVisible();await expect(page.locator('[data-choice="autotune"]')).toBeDisabled();await expect(page.locator('[data-choice="stem-splitting"]')).toBeDisabled();await expect(page.locator('[data-build]')).toBeDisabled();await expect(page.locator('[data-upload]')).toBeDisabled();
  await page.locator('[data-choice="synth"]').check();await page.locator('[data-choice="usb-recorder"]').check();await expect(page.locator('[data-export]')).toBeEnabled();await expect(page.locator('[data-shortcut="synth"]')).toBeVisible();
  await expect(page.locator('[data-shortcut-scope="sampler-idle"]')).toContainText('idle sampler/Generator lifecycle');await expect(page.locator('[data-shortcut-scope="sampler-idle"]')).toContainText('does not require audio transport to stop');await expect(page.locator('[data-shortcut-scope="normal-ui"]')).toContainText('sampler, pattern, FX or utility');await expect(page.locator('[data-shortcut-scope="normal-ui"]')).toContainText('says nothing about USB audio transport');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if([390,1440].includes(width)){const axe=await new AxeBuilder({page}).analyze();expect(axe.violations).toEqual([]);await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();scrollTo(0,0);});await page.screenshot({path:`test-results/feature-picker-${width}-${theme}.png`,fullPage:true});}
});
test('chord collision prevents export and chooser resolves it',async({page})=>{await page.goto('/features/');await page.locator('[data-choice="synth"]').check();await page.locator('[data-choice="usb-recorder"]').check();await page.locator('[data-chord-feature="usb-recorder"][data-position="1"]').selectOption('RECORD_SETTING');await expect(page.locator('[data-validation-errors]')).toContainText('overlapping shortcuts');await expect(page.locator('[data-export]')).toBeDisabled();await page.locator('[data-entry="usb-recorder"]').selectOption('chooser');await expect(page.locator('[data-export]')).toBeEnabled();await expect(page.locator('[data-shortcut-preview="usb-recorder"]')).toHaveText('Shared feature chooser');});
test('selection persists and export/import is transactional',async({page})=>{
  await page.goto('/features/');await page.locator('[data-choice="synth"]').check();await page.reload();await expect(page.locator('[data-choice="synth"]')).toBeChecked();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-export]').click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('opensp-feature-selection-v2.json');
  const s=blankSelection();s.features=[defaultChoice('usb-recorder')];s.features[0].shortcut=null;await page.locator('[data-import]').setInputFiles({name:'configuration.json',mimeType:'application/json',buffer:Buffer.from(exportSelection(s))});await expect(page.locator('[data-choice="synth"]')).not.toBeChecked();await expect(page.locator('[data-choice="usb-recorder"]')).toBeChecked();
  const legacy=JSON.parse(exportSelection(blankSelection()));legacy.version=1;delete legacy.catalogDigest;await page.locator('[data-import]').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await expect(page.locator('[data-import-error]')).toContainText('Version 1 selections are archived and cannot be reinterpreted');await expect(page.locator('[data-choice="usb-recorder"]')).toBeChecked();
  await page.locator('[data-import]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"schema":"bad"}')});await expect(page.locator('[data-import-error]')).toBeVisible();await expect(page.locator('[data-choice="usb-recorder"]')).toBeChecked();
});
test('legacy browser storage is retained and never reinterpreted',async({page})=>{await page.addInitScript(()=>localStorage.setItem('opensp.feature-selection.v1','{"schema":"opensp-feature-selection","version":1}'));await page.goto('/features/');await expect(page.locator('[data-import-error]')).toContainText('Version 1 cannot be reinterpreted');await expect(page.locator('[data-choice="synth"]')).not.toBeChecked();});
test('profile change gives adapter limit without enabling build or upload',async({page})=>{await page.goto('/features/');await page.locator('[data-choice="synth"]').check();await page.locator('[data-profile]').selectOption('original-app1');await expect(page.locator('[data-build-blockers]')).toContainText('No selected-feature adapter');await expect(page.locator('[data-export]')).toBeEnabled();await expect(page.locator('[data-build]')).toBeDisabled();await expect(page.locator('[data-upload]')).toBeDisabled();});
test('static page keeps statuses and update limits without script',async({browser})=>{const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto('/features/');await expect(page.getByText('Enable JavaScript to edit, import or export a configuration.',{exact:false})).toBeVisible();await expect(page.locator('[data-choice="synth"]')).toBeDisabled();await expect(page.getByText('First installation from untouched stock over normal USB is unverified.',{exact:false})).toBeVisible();await context.close();});

test('receipt errors stay local and clear without enabling firmware actions',async({page})=>{
  await page.goto('/features/');
  await expect(page.locator('[data-receipt-clear]')).toBeDisabled();
  await page.locator('[data-receipt]').setInputFiles({name:'private-path.json',mimeType:'application/json',buffer:Buffer.from('{"private":"C:/private/never-display"')});
  await expect(page.locator('[data-receipt-status]')).toContainText('supported OpenSP build receipt');
  await expect(page.locator('[data-receipt-result]')).not.toContainText('never-display');
  await page.locator('[data-receipt-clear]').click();
  await expect(page.locator('[data-receipt-status]')).toHaveText('No receipt selected.');
  await page.locator('[data-receipt]').setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.alloc(128*1024+1,32)});
  await expect(page.locator('[data-receipt-status]')).toHaveText('Build receipts must be 128 KiB or smaller.');
  await expect(page.locator('[data-build]')).toBeDisabled();await expect(page.locator('[data-upload]')).toBeDisabled();
});

test('receipt read completion cannot restore a result after choices change',async({page})=>{
  await page.addInitScript(()=>{
    const read=File.prototype.text;
    File.prototype.text=function(){
      if(this.name==='delayed-receipt.json')return new Promise<string>(resolve=>{(window as any).finishReceiptRead=()=>resolve('{}');});
      return read.call(this);
    };
  });
  await page.goto('/features/');
  await page.locator('[data-receipt]').setInputFiles({name:'delayed-receipt.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await expect(page.locator('[data-receipt-status]')).toHaveText('Reading the local receipt.');
  await page.locator('[data-choice="synth"]').check();
  await expect(page.locator('[data-receipt-status]')).toHaveText('No receipt selected.');
  await page.evaluate(()=>(window as any).finishReceiptRead());
  await expect(page.locator('[data-receipt-status]')).toHaveText('No receipt selected.');
  await expect(page.locator('[data-receipt-issues]')).toBeHidden();
});

test('actual disabled local receipt matches choices and is invalidated on shortcut edit',async({page})=>{
  const local=process.env.OPENSP_TEST_LOCAL_BUILD_RECEIPT;
  test.skip(!local,'Optional private local package receipt is not supplied.');
  await page.goto('/features/');
  await page.locator('[data-choice="synth"]').check();await page.locator('[data-choice="usb-recorder"]').check();
  await page.locator('[data-receipt]').setInputFiles({name:'local-build-receipt.json',mimeType:'application/json',buffer:fs.readFileSync(local!)});
  await expect(page.locator('[data-receipt-status]')).toContainText('confirms receipt metadata for this selection');
  await expect(page.locator('[data-receipt-status]')).toContainText('Package contents and device qualification remain unverified');
  await expect(page.locator('[data-build]')).toBeDisabled();await expect(page.locator('[data-upload]')).toBeDisabled();
  await page.locator('[data-entry="synth"]').selectOption('chooser');
  await expect(page.locator('[data-receipt-status]')).toHaveText('No receipt selected.');
});

async function delayConfigurationImports(page:Page){
  await page.addInitScript(()=>{
    const read=File.prototype.text;
    (window as any).configurationReads={};
    File.prototype.text=function(){
      if(!this.name.startsWith('slow-config-'))return read.call(this);
      return new Promise<string>((resolve,reject)=>{
        read.call(this).then(text=>{
          (window as any).configurationReads[this.name]={resolve:()=>resolve(text),reject:()=>reject(Error('Stale configuration read failed.'))};
        },reject);
      });
    };
  });
}
async function startConfigurationImport(page:Page,name:string,selection:Selection){
  await page.locator('[data-import]').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(exportSelection(selection))});
  await expect.poll(()=>page.evaluate(name=>Boolean((window as any).configurationReads[name]),name)).toBe(true);
}
async function finishConfigurationImport(page:Page,name:string,reject=false){
  await page.evaluate(async({name,reject})=>{
    (window as any).configurationReads[name][reject?'reject':'resolve']();
    await new Promise<void>(resolve=>queueMicrotask(resolve));
  },{name,reject});
}
for(const action of ['profile','feature','shortcut','reset'])test(`pending configuration import cannot undo ${action} changes`,async({page})=>{
  await delayConfigurationImports(page);await page.goto('/features/');
  await page.locator('[data-choice="synth"]').check();
  const imported=blankSelection();imported.features=[defaultChoice('usb-recorder')];
  await startConfigurationImport(page,'slow-config-edit.json',imported);
  if(action==='profile')await page.locator('[data-profile]').selectOption('original-app1');
  if(action==='feature')await page.locator('[data-choice="usb-recorder"]').check();
  if(action==='shortcut')await page.locator('[data-entry="synth"]').selectOption('chooser');
  if(action==='reset')await page.locator('[data-reset]').click();
  const saved=await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY);
  await finishConfigurationImport(page,'slow-config-edit.json');
  expect(await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY)).toBe(saved);
  await expect(page.locator('[data-import-error]')).toBeHidden();
  await page.reload();
  if(action==='reset')await expect(page.locator('[data-choice="synth"]')).not.toBeChecked();
  else await expect(page.locator('[data-choice="synth"]')).toBeChecked();
  if(action==='profile')await expect(page.locator('[data-profile]')).toHaveValue('original-app1');
  if(action==='shortcut')await expect(page.locator('[data-entry="synth"]')).toHaveValue('chooser');
});

for(const staleRejects of [false,true])test(`latest configuration import survives older ${staleRejects?'rejection':'completion'}`,async({page})=>{
  await delayConfigurationImports(page);await page.goto('/features/');
  const old=blankSelection();old.features=[defaultChoice('usb-recorder')];
  const latest=blankSelection();latest.features=[defaultChoice('synth')];
  await startConfigurationImport(page,'slow-config-old.json',old);
  await startConfigurationImport(page,'slow-config-new.json',latest);
  await finishConfigurationImport(page,'slow-config-new.json');
  await expect(page.locator('[data-choice="synth"]')).toBeChecked();
  const saved=await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY);
  await finishConfigurationImport(page,'slow-config-old.json',staleRejects);
  expect(await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY)).toBe(saved);
  await expect(page.locator('[data-choice="usb-recorder"]')).not.toBeChecked();
  await expect(page.locator('[data-import-error]')).toBeHidden();
});

test('invalid latest import cannot revive an older pending selection',async({page})=>{
  await delayConfigurationImports(page);await page.goto('/features/');
  await page.locator('[data-choice="synth"]').check();
  const old=blankSelection();old.features=[defaultChoice('usb-recorder')];
  await startConfigurationImport(page,'slow-config-old.json',old);
  await page.locator('[data-import]').setInputFiles({name:'bad-config.json',mimeType:'application/json',buffer:Buffer.from('{')});
  await expect(page.locator('[data-import-error]')).toBeVisible();
  const message=await page.locator('[data-import-error]').textContent();
  await finishConfigurationImport(page,'slow-config-old.json');
  await expect(page.locator('[data-import-error]')).toHaveText(message!);
  await expect(page.locator('[data-choice="synth"]')).toBeChecked();await expect(page.locator('[data-choice="usb-recorder"]')).not.toBeChecked();
});

test('import status acknowledges unavailable browser storage',async({page})=>{
  await page.goto('/features/');
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('Storage unavailable.');};});
  const selection=blankSelection();selection.features=[defaultChoice('synth')];
  await page.locator('[data-import]').setInputFiles({name:'configuration.json',mimeType:'application/json',buffer:Buffer.from(exportSelection(selection))});
  await expect(page.locator('[data-choice="synth"]')).toBeChecked();
  await expect(page.locator('[data-save-status]')).toContainText('Configuration imported. Browser storage is unavailable.');
  await expect(page.locator('[data-save-status]')).not.toContainText('saved in this browser');
  await expect(page.locator('[data-export]')).toBeEnabled();
});
