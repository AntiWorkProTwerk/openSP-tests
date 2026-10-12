// Drop-zone front end for the openSynth patcher. The work runs in a Web Worker;
// the visitor's file is read locally and never uploaded.
import type {PatcherReply} from './opensynth-patcher-worker';
import {BrowserHidError, getAuthorizedR51Writer, requestR51Writer, type BrowserHid} from '../lib/opensynth/browser-hid';
import {R51WebHidError, attestFreshR51, installOpenSynthViaR51,
  type R51FeatureDevice, type R51FreshAttestation, type R51InstallReceipt} from '../lib/opensynth/r51-webhid';
import type {BrowserSerial, StockArtifacts, StockBootstrapReceipt, StockClaimStore, StockR51VArtifacts, StockR51VReceipt,
  StockSerialPort} from '../lib/opensynth/stock-bootstrap';

type Stage = 'reading' | 'verifying' | 'patching' | 'checking';
type UsbStep = 'stock-check' | 'stock-run' | 'r51-connect' | 'install' | 'complete' | 'locked';
const STAGES: Stage[] = ['reading', 'verifying', 'patching', 'checking'];
const WEIGHT: Record<Stage, [number, number]> = {reading: [0, 25], verifying: [25, 55], patching: [55, 85], checking: [85, 100]};
const STOCK_CLAIM_KEY = 'opensp:stock-p34x:65888c144d27cf286bf3d5ea323b4f95e2737ed8ed94dbabe027f586bdd0bda2';
const STOCK_R51V_CLAIM_KEY = 'opensp:stock-r51v:c082ec3733096a99ba55a7aada19388eea1ed0eef2f2d7ff148c5add99669831';
const R51_PERMISSION_KEY = 'opensp:r51-webhid-permission-v1';
const loadStockBootstrap = () => import('../lib/opensynth/stock-bootstrap');

const root = document.querySelector<HTMLElement>('[data-patcher]');
if (root) {
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  const drop = root.querySelector<HTMLElement>('[data-patcher-drop]')!;
  const progress = root.querySelector<HTMLProgressElement>('.patcher-progress progress')!;
  const percent = root.querySelector<HTMLElement>('[data-patcher-percent]')!;
  const status = root.querySelector<HTMLElement>('[data-patcher-status]')!;
  const fileName = root.querySelector<HTMLElement>('[data-patcher-file]')!;
  const save = root.querySelector<HTMLAnchorElement>('[data-patcher-save]')!;
  const sha = root.querySelector<HTMLElement>('[data-patcher-sha]')!;
  const reset = root.querySelector<HTMLButtonElement>('[data-patcher-reset]')!;
  const usbAction = root.querySelector<HTMLButtonElement>('[data-usb-action]')!;
  const usbExisting = root.querySelector<HTMLButtonElement>('[data-usb-existing]')!;
  const usbProgress = root.querySelector<HTMLElement>('[data-usb-progress]')!;
  const usbProgressBar = usbProgress.querySelector<HTMLProgressElement>('progress')!;
  const usbPercent = root.querySelector<HTMLElement>('[data-usb-percent]')!;
  const usbStatus = root.querySelector<HTMLElement>('[data-usb-status]')!;
  const usbReceipt = root.querySelector<HTMLAnchorElement>('[data-usb-receipt]')!;
  const directButton = root.querySelector<HTMLButtonElement>('[data-direct-usb-action]')!;
  const directProgress = root.querySelector<HTMLElement>('[data-direct-usb-progress]')!;
  const directProgressBar = directProgress.querySelector<HTMLProgressElement>('progress')!;
  const directPercent = root.querySelector<HTMLElement>('[data-direct-usb-percent]')!;
  const directStatus = root.querySelector<HTMLElement>('[data-direct-usb-status]')!;
  const directReceipt = root.querySelector<HTMLAnchorElement>('[data-direct-usb-receipt]')!;
  const messages = JSON.parse(root.dataset.messages!) as Record<Stage | 'done', string>;
  let worker: Worker | undefined, url: string | undefined, receiptUrl: string | undefined, directReceiptUrl: string | undefined, depth = 0;
  let candidate: Uint8Array<ArrayBuffer> | undefined, device: R51FeatureDevice | undefined, attestation: R51FreshAttestation | undefined;
  let installReceipt: R51InstallReceipt | undefined;
  let stockPort: StockSerialPort | undefined, stockArtifacts: StockArtifacts | undefined, stockReceipt: StockBootstrapReceipt | undefined;
  let directArtifacts: StockR51VArtifacts | undefined, directImage: Uint8Array<ArrayBuffer> | undefined;
  let directBootstrap: StockR51VReceipt | undefined, directPhase: 'stock'|'r51'|'complete'|'locked' = 'stock';
  let directCommitSent = false;
  let installing = false, usbStep: UsbStep = 'stock-check', stockModuleReady = false;
  let stockModule: Awaited<ReturnType<typeof loadStockBootstrap>> | undefined;
  let stockModulePromise: ReturnType<typeof loadStockBootstrap> | undefined;

  const prepareStockModule = () => stockModulePromise ??= loadStockBootstrap();
  const hasStockApis = () => 'serial' in navigator;
  const hasHidApi = () => 'hid' in navigator;
  const setUsbStep = (step: UsbStep, focus = false) => {
    usbStep = step; root.dataset.usbStep = step;
    const label = step === 'stock-check' ? usbAction.dataset.labelStockCheck :
      step === 'stock-run' ? usbAction.dataset.labelStockRun :
      step === 'r51-connect' ? usbAction.dataset.labelR51Connect :
      step === 'install' ? usbAction.dataset.labelInstall :
      step === 'locked' ? usbAction.dataset.labelLocked : usbAction.dataset.labelComplete;
    if (label) usbAction.textContent = label;
    const supported = step === 'stock-check' || step === 'stock-run' ? hasStockApis() : hasHidApi();
    usbAction.disabled = installing || !candidate || !supported || step === 'complete' || step === 'locked' || (step === 'stock-check' && !stockModuleReady);
    usbExisting.hidden = step !== 'stock-check';
    usbExisting.disabled = installing || !candidate || !hasHidApi();
    if (focus && !usbAction.disabled) usbAction.focus();
  };

  const claimStore: StockClaimStore = {
    load: () => { try { return localStorage.getItem(STOCK_CLAIM_KEY); } catch { throw new Error('This browser cannot preserve the required one-shot claim. Nothing was written.'); } },
    save: value => { try { localStorage.setItem(STOCK_CLAIM_KEY, value); } catch { throw new Error('This browser could not seal the one-shot claim. Nothing was written.'); } },
  };
  const directClaimStore: StockClaimStore = {
    load: () => { try { return localStorage.getItem(STOCK_R51V_CLAIM_KEY); } catch { throw new Error('This browser cannot preserve the required one-shot claim. Nothing was written.'); } },
    save: value => { try { localStorage.setItem(STOCK_R51V_CLAIM_KEY, value); } catch { throw new Error('This browser could not seal the one-shot claim. Nothing was written.'); } },
  };
  const rememberR51Permission = () => { try { localStorage.setItem(R51_PERMISSION_KEY, 'granted'); } catch {/* Reuse is optional. */} };

  const setState = (state: 'idle' | 'working' | 'done' | 'error') => { root.dataset.state = state; };
  const setStage = (stage: Stage, fraction: number) => {
    const [from, to] = WEIGHT[stage], value = Math.round(from + (to - from) * Math.min(1, Math.max(0, fraction)));
    progress.value = Math.max(progress.value, value);
    percent.textContent = `${progress.value}%`;
    root.querySelectorAll<HTMLElement>('[data-stage]').forEach(item => {
      const index = STAGES.indexOf(item.dataset.stage as Stage), current = STAGES.indexOf(stage);
      item.dataset.status = index < current ? 'done' : index === current ? 'active' : 'waiting';
      if (index === current) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    });
    if (status.dataset.current !== stage) { status.dataset.current = stage; status.textContent = messages[stage]; }
  };

  function clear() {
    worker?.terminate(); worker = undefined;
    if (url) URL.revokeObjectURL(url);
    if (receiptUrl) URL.revokeObjectURL(receiptUrl);
    url = undefined; receiptUrl = undefined; save.removeAttribute('href'); usbReceipt.removeAttribute('href'); usbReceipt.hidden = true;
    sha.textContent = ''; candidate = undefined; device = undefined; attestation = undefined;
    stockPort = undefined; stockArtifacts = undefined; stockReceipt = undefined;
    installReceipt = undefined;
    setUsbStep('stock-check');
    usbProgress.hidden = true; usbProgressBar.value = 0; usbPercent.textContent = '0%'; usbStatus.textContent = '';
  }

  const offerReceipt = (body: unknown, filename: string) => {
    if (receiptUrl) URL.revokeObjectURL(receiptUrl);
    receiptUrl = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2) + '\n'], {type: 'application/json'}));
    usbReceipt.href = receiptUrl; usbReceipt.download = filename; usbReceipt.hidden = false;
  };

  const offerDirectReceipt = (body: unknown, filename: string) => {
    if (directReceiptUrl) URL.revokeObjectURL(directReceiptUrl);
    directReceiptUrl = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2) + '\n'], {type: 'application/json'}));
    directReceipt.href = directReceiptUrl; directReceipt.download = filename; directReceipt.hidden = false;
  };

  const setUsbProgress = (phase: 'preflight'|'upload'|'ram-verified'|'commit'|'flash-verified'|'separate-status'|'reset-armed'|'reset-requested', completed: number, total: number) => {
    const value = phase === 'preflight' ? 2 : phase === 'upload' ? 2 + Math.round(58 * completed / total) :
      phase === 'ram-verified' ? 64 : phase === 'commit' ? 64 + Math.round(30 * completed / total) :
      phase === 'flash-verified' ? 96 : phase === 'separate-status' ? 97 : phase === 'reset-armed' ? 99 : 100;
    usbProgressBar.value = Math.max(usbProgressBar.value, Math.min(100, value));
    usbPercent.textContent = `${usbProgressBar.value}%`;
    const labels = {preflight: 'Checking the flash chip and writer.', upload: 'Sending openSynth to verified RAM.',
      'ram-verified': 'RAM checksum verified.', commit: 'Writing APP1 and reading every sector back.',
      'flash-verified': 'Flash readback verified.', 'separate-status': 'Separate final status verified.',
      'reset-armed': 'Verified reboot armed.', 'reset-requested': 'Verified reboot requested.'};
    usbStatus.textContent = labels[phase];
  };

  const setStockProgress = (phase: 'stage'|'stage-readback'|'carrier', completed: number, total: number) => {
    const value = phase === 'stage' ? Math.round(30 * completed / total) :
      phase === 'stage-readback' ? 30 + Math.round(30 * completed / total) : 60 + Math.round(40 * completed / total);
    usbProgressBar.value = Math.max(usbProgressBar.value, Math.min(100, value));
    usbPercent.textContent = `${usbProgressBar.value}%`;
    usbStatus.textContent = phase === 'stage' ? 'Staging exact OpenSynth P34 in the stock update folder.' :
      phase === 'stage-readback' ? 'Reading exact OpenSynth P34 back through a fresh stock session.' :
      `Sending the one-shot stock carrier: ${completed} of ${total} packets.`;
  };

  const setDirectProgress = (phase: 'stage'|'stage-readback'|'carrier', completed: number, total: number) => {
    const value = phase === 'stage' ? Math.round(10 * completed / total) :
      phase === 'stage-readback' ? 10 + Math.round(10 * completed / total) : 20 + Math.round(10 * completed / total);
    directProgressBar.value = Math.max(directProgressBar.value, Math.min(30, value));
    directPercent.textContent = `${directProgressBar.value}%`;
    directStatus.textContent = phase === 'stage' ? 'Staging the pinned R51 writer through the stock file service.' :
      phase === 'stage-readback' ? 'Reading the complete R51 writer back to establish the proven parser phase.' :
      `Starting the guarded R51 writer: ${completed} of ${total} carrier packets.`;
  };

  const setDirectWriterProgress = (phase: 'preflight'|'upload'|'ram-verified'|'commit'|'flash-verified'|'separate-status'|'reset-armed'|'reset-requested', completed: number, total: number) => {
    const value = phase === 'preflight' ? 32 : phase === 'upload' ? 32 + Math.round(38 * completed / total) :
      phase === 'ram-verified' ? 72 : phase === 'commit' ? 72 + Math.round(23 * completed / total) :
      phase === 'flash-verified' ? 96 : phase === 'separate-status' ? 97 : phase === 'reset-armed' ? 99 : 100;
    directProgressBar.value = Math.max(directProgressBar.value, Math.min(100, value));
    directPercent.textContent = `${directProgressBar.value}%`;
    const labels = {preflight: 'Checking the flash chip and R51 writer.', upload: 'Sending the pinned OpenSynth P34 image to verified RAM.',
      'ram-verified': 'R51 verified the complete RAM image.', commit: 'Writing APP1 and reading every sector back.',
      'flash-verified': 'APP1 flash readback verified.', 'separate-status': 'Separate terminal status verified.',
      'reset-armed': 'Guarded reboot armed.', 'reset-requested': 'Guarded reboot requested.'};
    directStatus.textContent = labels[phase];
  };

  const leaveWarning = (event: BeforeUnloadEvent) => {
    if (!installing) return;
    event.preventDefault();
  };

  function run(file: File) {
    clear();
    setState('working'); delete root!.dataset.error;
    fileName.textContent = file.name;
    progress.value = 0; delete status.dataset.current;
    setStage('reading', 0);
    worker = new Worker(new URL('./opensynth-patcher-worker.ts', import.meta.url), {type: 'module'});
    worker.onmessage = (event: MessageEvent<PatcherReply>) => {
      const reply = event.data;
      if (reply.type === 'progress') setStage(reply.stage, reply.fraction);
      else if (reply.type === 'done') {
        candidate = new Uint8Array(reply.output);
        if (candidate.length !== Number(root!.dataset.outputBytes) || reply.sha256 !== root!.dataset.outputSha256) {
          status.textContent = 'The checked result no longer matches this page, so it was discarded. Reload the page and try again.';
          candidate = undefined; setState('error'); worker?.terminate(); worker = undefined; return;
        }
        url = URL.createObjectURL(new Blob([candidate], {type: 'application/octet-stream'}));
        save.href = url; save.download = reply.name;
        sha.textContent = reply.sha256;
        progress.value = 100; percent.textContent = '100%';
        root!.querySelectorAll<HTMLElement>('[data-stage]').forEach(item => { item.dataset.status = 'done'; item.removeAttribute('aria-current'); });
        status.textContent = messages.done;
        setState('done');
        worker?.terminate(); worker = undefined;
        save.focus();
        setUsbStep('stock-check');
        void prepareStockModule().then(module => { stockModule = module; stockModuleReady = true; setUsbStep(usbStep); }).catch(error => {
          usbStatus.textContent = error instanceof Error ? error.message : 'The stock USB installer could not load. The checked download still works.';
        });
        if (!('hid' in navigator)) {
          usbStatus.textContent = 'Direct USB installation needs Chrome or another desktop browser with WebHID. The checked download still works.';
        }
        if (!('serial' in navigator)) {
          usbStatus.textContent = 'Starting from stock needs a desktop Chromium browser with Web Serial. The checked download and an already-running R51 writer still work.';
        }
      } else {
        status.textContent = reply.message;
        root!.dataset.error = reply.code;
        setState('error');
        worker?.terminate(); worker = undefined;
      }
    };
    worker.onerror = () => { status.textContent = 'The patcher stopped unexpectedly, so nothing was saved. Reload the page and try again.'; setState('error'); };
    worker.postMessage({file, patchUrl: root!.dataset.patchUrl, patchSha256: root!.dataset.patchSha256});
  }

  const pick = (files: FileList | null | undefined) => { const file = files?.[0]; if (file) run(file); };
  input.addEventListener('change', () => { pick(input.files); input.value = ''; });
  reset.addEventListener('click', () => { clear(); setState('idle'); status.textContent = ''; input.focus(); });

  const checkStock = async () => {
    if (!candidate || !stockModule || installing) return;
    installing = true; setUsbStep('stock-check'); usbReceipt.hidden = true;
    usbStatus.textContent = 'Loading the pinned stock bootstrap, then opening one picker for the stock SP serial port.';
    try {
      const stock = stockModule;
      stockArtifacts = await stock.fetchPinnedStockCarrier(fetch, candidate, root!.dataset.stockCarrierUrl!);
      if (root!.dataset.outputSha256 !== stock.STOCK_R51.r51Sha256 || root!.dataset.stockCarrierSha256 !== stock.STOCK_R51.carrierSha256) {
        throw new stock.StockBootstrapError('artifacts', 'page-pins', 'The page and stock bootstrap pins differ. Nothing was written.');
      }
      const serial = (navigator as Navigator & {serial?: BrowserSerial}).serial;
      const port = await stock.getAuthorizedStockPort(serial) ?? await stock.requestStockPort(serial);
      installing = false;
      await runStockBootstrap(port);
    } catch (error) {
      stockArtifacts = undefined; installing = false; setUsbStep('stock-check');
      usbStatus.textContent = error instanceof Error ? error.message : 'The stock connection stopped. Nothing was written.';
      if (!((error as {code?:string})?.code === 'cancelled')) console.error(error);
    }
  };

  const runStockBootstrap = async (authorizedPort?: StockSerialPort) => {
    if (!candidate || !stockModule || !stockArtifacts || installing) return;
    installing = true; setUsbStep('stock-run');
    usbProgress.hidden = false; usbProgressBar.value = 0; usbPercent.textContent = '0%';
    window.addEventListener('beforeunload', leaveWarning);
    usbStatus.textContent = 'Choose the matching stock SP serial port. The one-shot claim is sealed before the first storage write.';
    try {
      const stock = stockModule;
      const browser = navigator as Navigator & {serial?: BrowserSerial;locks?: {
        request<T>(name:string, options:{mode:'exclusive';ifAvailable:true}, callback:(lock:object|null)=>Promise<T>):Promise<T>;
      }};
      stockPort = authorizedPort ?? await stock.requestStockPort(browser.serial);
      const run = () => stock.bootstrapStockToR51SerialOnly(stockPort!, stockArtifacts!, claimStore,
        {onProgress: event => setStockProgress(event.phase, event.completed, event.total)});
      if (browser.locks) {
        const result = await browser.locks.request('opensp-stock-p34x-one-shot', {mode:'exclusive', ifAvailable:true}, async lock => lock ? run() : undefined);
        if (!result) throw new stock.StockBootstrapError('claim', 'parallel-tab', 'Another tab is using the stock bootstrap. Nothing was written in this tab.');
        stockReceipt = result;
      } else stockReceipt = await run();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      offerReceipt({format: 'opensp-browser-stock-p34x-receipt-v1', createdAt: new Date().toISOString(),
        bootstrap: stockReceipt}, `opensynth-stock-p34x-${stamp}.json`);
      usbStatus.textContent = 'The direct carrier completed. OpenSynth is being written and read back inside the SP. Keep power connected.';
      usbProgressBar.value = 99; usbPercent.textContent = '99%';
      const openSynthReturn = await stock.waitForOpenSynthP34(browser.serial, {timeoutMs: 180_000});
      offerReceipt({format: 'opensp-browser-opensynth-p34-complete-v2', createdAt: new Date().toISOString(),
        normalIdentity: root!.dataset.normalIdentity, patchSha256: root!.dataset.patchSha256,
        stockBootstrap: stockReceipt, openSynthP34Return: openSynthReturn,
        installationComplete: true}, `opensynth-p34-complete-${stamp}.json`);
      usbStatus.textContent = 'Installation complete. OpenSynth P34 rebooted and its passive serial identity matched.';
      usbProgressBar.value = 100; usbPercent.textContent = '100%'; installing = false; setUsbStep('complete');
    } catch (error) {
      let sealed = false; try { sealed = claimStore.load() !== null; } catch { sealed = true; }
      const uncertain = sealed || Boolean((error as {mutationStarted?:boolean;carrierStarted?:boolean;code?:string})?.mutationStarted ||
        (error as {carrierStarted?:boolean})?.carrierStarted || ['claimed','already-attempted'].includes((error as {code?:string})?.code ?? ''));
      usbStatus.textContent = uncertain ?
        `${error instanceof Error ? error.message : 'The stock bootstrap became uncertain.'} Do not retry the stock step.` :
        `${error instanceof Error ? error.message : 'The stock bootstrap stopped.'} Nothing was written; repeat the read-only stock check to start over.`;
      installing = false; setUsbStep(uncertain ? 'locked' : 'stock-check');
      console.error(error);
    } finally {
      stockPort = undefined; installing = false; window.removeEventListener('beforeunload', leaveWarning);
    }
  };

  const connectR51 = async (authorizedWriter?: R51FeatureDevice) => {
    if (!candidate || installing) return;
    installing = true; setUsbStep('r51-connect'); usbReceipt.hidden = true;
    usbStatus.textContent = 'Approve the R51 picker to attest the writer and install. The page sends no write command until both status checks pass.';
    try {
      const hid = (navigator as Navigator & {hid?: BrowserHid}).hid;
      device = authorizedWriter ?? await requestR51Writer(hid);
      if (!authorizedWriter) rememberR51Permission();
      attestation = await attestFreshR51(device, {powerCycleConfirmed: !stockReceipt,
        stockCarrierConfirmed: Boolean(stockReceipt?.carrierComplete), freshConnectionConfirmed: true});
      if (stockReceipt) {
        if (!stockModule) throw new Error('The stock claim verifier is unavailable. Nothing was written.');
        stockModule.markStockR51Attested(claimStore);
      }
      usbStatus.textContent = 'Fresh R51 writer confirmed with two matching read-only status checks. Starting the verified APP1 installation.';
      installing = false; setUsbStep('install', true);
      await installP34();
    } catch (error) {
      device = undefined; attestation = undefined; installing = false; setUsbStep('r51-connect');
      usbStatus.textContent = error instanceof Error ? error.message : 'The R51 writer could not be checked. Nothing was written.';
      if (!(error instanceof BrowserHidError && error.code === 'cancelled')) console.error(error);
    }
  };

  const installP34 = async () => {
    if (!candidate || !device || !attestation || installing) return;
    installing = true; setUsbStep('install'); usbProgress.hidden = false;
    usbProgressBar.value = 0; usbPercent.textContent = '0%';
    window.addEventListener('beforeunload', leaveWarning);
    usbStatus.textContent = 'Rechecking the writer before the first write.';
    try {
      installReceipt = await installOpenSynthViaR51(device, candidate, {
        expectedSha256: root!.dataset.outputSha256!, attestation,
        onProgress: event => setUsbProgress(event.phase, event.completedBytes, event.totalBytes),
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      offerReceipt({format: 'opensp-browser-opensynth-p34-install-v1', createdAt: new Date().toISOString(),
        normalIdentity: root!.dataset.normalIdentity, patchSha256: root!.dataset.patchSha256,
        stockBootstrap: stockReceipt, install: installReceipt}, `opensynth-p34-usb-receipt-${stamp}.json`);
      usbStatus.textContent = 'APP1 flash and full-sector readback are verified. R51 requested a guarded reboot; waiting for normal Roland USB to return.';
      usbProgressBar.value = 100; usbPercent.textContent = '100%';
      const stock = await loadStockBootstrap();
      const browser = navigator as Navigator & {serial?: BrowserSerial};
      usbStatus.textContent = 'Waiting for OpenSynth P34 to return on the authorized Roland serial port; no serial command is sent.';
      const openSynthReturn = await stock.waitForOpenSynthP34(browser.serial);
      offerReceipt({format: 'opensp-browser-opensynth-p34-complete-v1', createdAt: new Date().toISOString(),
        normalIdentity: root!.dataset.normalIdentity, patchSha256: root!.dataset.patchSha256,
        stockBootstrap: stockReceipt, install: installReceipt,
        normalSerialReturn: {vendorId: openSynthReturn.vendorId, productId: openSynthReturn.productId},
        openSynthP34Return: openSynthReturn,
        installationComplete: true}, `opensynth-p34-complete-${stamp}.json`);
      usbStatus.textContent = 'Installation complete. The verified image rebooted and the passive OpenSynth P34 session identity matched.';
      device = undefined; attestation = undefined;
      installing = false; setUsbStep('complete');
    } catch (error) {
      const verifiedReset = Boolean(installReceipt?.guardedReset);
      const uncertain = verifiedReset || (error instanceof R51WebHidError && error.commitSent);
      usbStatus.textContent = verifiedReset ?
        `APP1 flash and readback were verified and the guarded reboot was sent, but normal USB was not observed: ${error instanceof Error ? error.message : String(error)} Do not retry the flash. Check the SP screen or power-cycle once.` : uncertain ?
        `The result became uncertain after COMMIT: ${error instanceof Error ? error.message : String(error)} Do not retry. Save this screen and recover through the retained APP1 route if the SP does not boot.` :
        `${error instanceof Error ? error.message : 'The USB check stopped.'} No COMMIT was sent; reconnect to begin a fresh read-only check.`;
      installing = false; setUsbStep(uncertain ? 'locked' : 'r51-connect');
      device = undefined; attestation = undefined;
      console.error(error);
    } finally {
      installing = false; window.removeEventListener('beforeunload', leaveWarning);
    }
  };

  const installDirectFromStock = async () => {
    if (installing || directButton.disabled || directPhase === 'complete' || directPhase === 'locked') return;
    installing = true; directButton.disabled = true; directReceipt.hidden = true;
    directProgress.hidden = false;
    window.addEventListener('beforeunload', leaveWarning);
    try {
      const stock = stockModule ?? await prepareStockModule(); stockModule = stock;
      const browser = navigator as Navigator & {serial?: BrowserSerial;locks?: {
        request<T>(name:string, options:{mode:'exclusive';ifAvailable:true}, callback:(lock:object|null)=>Promise<T>):Promise<T>;
      };hid?:BrowserHid};
      if(directPhase==='r51'&&!device){
        device=await getAuthorizedR51Writer(browser.hid)??await requestR51Writer(browser.hid);
        rememberR51Permission();
      }
      if (directPhase==='r51'&&(!directImage||!directBootstrap)) {
        directImage=await stock.fetchPinnedOpenSynthP34(fetch,root.dataset.stockApp1Url!);
        directBootstrap=Object.freeze({format:'opensp-stock-r51v-bootstrap-v1',writerSha256:stock.STOCK_R51_V.writerSha256,
          carrierSha256:stock.STOCK_R51_V.carrierSha256,stagePath:stock.STOCK_R51_V.stagePath,stageReadbackVerified:true,
          alignmentSafeFrames:3,carrierPackets:51,carrierBytes:26112,carrierComplete:true,fullPacketWrites:true,
          retryAllowed:false,remainingCheck:'fresh R51 WebHID attestation'});
      }
      if (directPhase === 'stock') {
        directProgressBar.value = 0; directPercent.textContent = '0%';
        directStatus.textContent = 'Choose the stock SP serial port. No flash write happens in this step.';
        const port = await stock.getAuthorizedStockPort(browser.serial) ?? await stock.requestStockPort(browser.serial);
        [directArtifacts,directImage] = await Promise.all([
          stock.fetchPinnedStockR51VArtifacts(fetch, root.dataset.stockR51Url!, root.dataset.stockR51CarrierUrl!),
          stock.fetchPinnedOpenSynthP34(fetch, root.dataset.stockApp1Url!),
        ]);
        if (root.dataset.stockR51Sha256 !== stock.STOCK_R51_V.writerSha256 ||
            root.dataset.stockR51CarrierSha256 !== stock.STOCK_R51_V.carrierSha256 ||
            root.dataset.stockApp1Sha256 !== stock.OPEN_SYNTH_P34_IMAGE.sha256) {
          throw new stock.StockBootstrapError('artifacts','page-pins','The page and R51 installer pins differ. Nothing was written.');
        }
        const run = () => stock.bootstrapStockToR51VSerialOnly(port,directArtifacts!,directClaimStore,
          {onProgress:event=>setDirectProgress(event.phase,event.completed,event.total)});
        directBootstrap = browser.locks ?
          await browser.locks.request('opensp-stock-r51v-one-shot',{mode:'exclusive',ifAvailable:true},async lock=>lock?run():undefined) : await run();
        if (!directBootstrap)throw new stock.StockBootstrapError('claim','parallel-tab','Another tab is using the stock installer. Nothing was written in this tab.');
        directPhase = 'r51';directProgressBar.value = 30;directPercent.textContent = '30%';
        directButton.textContent = 'Continue with R51 and install OpenSynth';
        directStatus.textContent = 'R51 started. Click Continue once to grant the browser access to the guarded writer; this second permission is required by the browser.';
        const authorized=await getAuthorizedR51Writer(browser.hid);
        if (!authorized)return;
        device=authorized;
      }
      if (!directImage||!directBootstrap)throw new Error('The verified stock handoff is missing. Do not start a new flash.');
      device ??= await requestR51Writer(browser.hid);
      rememberR51Permission();
      const fresh=await attestFreshR51(device,{powerCycleConfirmed:false,stockCarrierConfirmed:true,freshConnectionConfirmed:true});
      const install=await installOpenSynthViaR51(device,directImage,{expectedSha256:stock.OPEN_SYNTH_P34_IMAGE.sha256,
        onBeforeCommit:evidence=>{
          directClaimStore.save(JSON.stringify({format:'opensp-stock-r51v-claim-v1',state:'app1-commit-started',
            stagePath:stock.STOCK_R51_V.stagePath,writerSha256:stock.STOCK_R51_V.writerSha256,
            carrierSha256:stock.STOCK_R51_V.carrierSha256,app1Sha256:evidence.imageSha256,
            app1Crc32:evidence.crc32,app1Bytes:evidence.bytes,retryAllowed:false,updatedAt:new Date().toISOString()}));
          directCommitSent=true;
        },
        attestation:fresh,onProgress:event=>setDirectWriterProgress(event.phase,event.completedBytes,event.totalBytes)});
      directCommitSent=true;
      directClaimStore.save(JSON.stringify({format:'opensp-stock-r51v-claim-v1',state:'app1-reset-sent',
        stagePath:stock.STOCK_R51_V.stagePath,writerSha256:stock.STOCK_R51_V.writerSha256,
        carrierSha256:stock.STOCK_R51_V.carrierSha256,app1Sha256:stock.OPEN_SYNTH_P34_IMAGE.sha256,
        retryAllowed:false,updatedAt:new Date().toISOString()}));
      directProgressBar.value=100;directPercent.textContent='100%';
      directStatus.textContent='APP1 flash and readback are verified. Waiting for the passive OpenSynth P34 identity after the guarded reboot.';
      const returned=await stock.waitForOpenSynthP34(browser.serial,{timeoutMs:180_000});
      directClaimStore.save(JSON.stringify({format:'opensp-stock-r51v-claim-v1',state:'installation-complete',
        stagePath:stock.STOCK_R51_V.stagePath,writerSha256:stock.STOCK_R51_V.writerSha256,
        carrierSha256:stock.STOCK_R51_V.carrierSha256,app1Sha256:stock.OPEN_SYNTH_P34_IMAGE.sha256,
        retryAllowed:false,updatedAt:new Date().toISOString()}));
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      offerDirectReceipt({format:'opensp-browser-stock-r51-complete-v1',createdAt:new Date().toISOString(),
        stockBootstrap:directBootstrap,install,openSynthP34Return:returned,installationComplete:true},
        `opensynth-stock-r51-complete-${stamp}.json`);
      directPhase='complete';directButton.textContent='Installation complete';
      directStatus.textContent='Installation complete. P34 rebooted and its passive OpenSynth identity matched.';
    } catch (error) {
      const commitSent=directCommitSent||(error instanceof R51WebHidError&&error.commitSent);
      let sealed=false;try{sealed=directClaimStore.load()!==null;}catch{sealed=true;}
      if (directPhase==='r51'&&!commitSent) {
        directStatus.textContent=`${error instanceof Error?error.message:'The R51 connection stopped.'} The stock handoff is complete; use Continue to reconnect to R51.`;
      } else if (commitSent||directPhase==='complete'||(sealed&&directPhase==='stock')) {
        directPhase='locked';directButton.textContent='Installation stopped';
        directStatus.textContent=`${error instanceof Error?error.message:'The result became uncertain after a write started.'} Do not resend the carrier or restart the flash.`;
      } else directStatus.textContent=error instanceof Error?error.message:'The stock installer stopped before any write.';
      console.error(error);
    } finally {
      device=undefined;installing=false;
      directButton.disabled=directPhase==='complete'||directPhase==='locked'||(directPhase==='stock'&&(!hasStockApis()||!stockModuleReady))||(directPhase==='r51'&&!hasHidApi());
      window.removeEventListener('beforeunload', leaveWarning);
    }
  };

  usbAction.addEventListener('click', async () => {
    if (usbStep === 'stock-check') await checkStock();
    else if (usbStep === 'stock-run') await runStockBootstrap();
    else if (usbStep === 'r51-connect') await connectR51();
    else if (usbStep === 'install') await installP34();
  });
  directButton.addEventListener('click', installDirectFromStock);
  usbExisting.addEventListener('click', async () => {
    if (!candidate || installing) return;
    stockReceipt = undefined; stockArtifacts = undefined;
    setUsbStep('r51-connect');
    await connectR51();
  });

  // The whole page accepts the file, so a drop that misses the box still works.
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
  window.addEventListener('dragenter', event => { if (!hasFiles(event)) return; event.preventDefault(); depth++; drop.dataset.over = 'true'; });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; delete drop.dataset.over; } });
  window.addEventListener('dragover', event => { if (!hasFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); depth = 0; delete drop.dataset.over;
    if (root.dataset.state === 'working') return;
    drop.scrollIntoView({block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    pick(event.dataTransfer?.files);
  });

  root.hidden = false;
  root.dataset.ready = 'true';
  void prepareStockModule().then(module => {
    stockModule = module; stockModuleReady = true;
    try {
      const saved=directClaimStore.load();
      if(saved){
        const claim=JSON.parse(saved) as {format?:string;state?:string;stagePath?:string;writerSha256?:string;
          carrierSha256?:string;app1Sha256?:string;retryAllowed?:boolean};
        const knownState=['stage-verified','carrier-complete','carrier-started','app1-commit-started','app1-reset-sent','installation-complete'].includes(String(claim.state));
        const validIdentity=claim.format==='opensp-stock-r51v-claim-v1'&&knownState&&claim.retryAllowed===false&&
          claim.stagePath===module.STOCK_R51_V.stagePath&&claim.writerSha256===module.STOCK_R51_V.writerSha256&&
          claim.carrierSha256===module.STOCK_R51_V.carrierSha256&&
          (!['app1-commit-started','app1-reset-sent','installation-complete'].includes(String(claim.state))||claim.app1Sha256===module.OPEN_SYNTH_P34_IMAGE.sha256);
        if(!validIdentity)throw new Error('invalid direct-install claim');
        if(claim.state==='carrier-complete'){
          directPhase='r51';directButton.textContent='Continue with R51 and install OpenSynth';
          directStatus.textContent='The stock handoff is complete. Continue with the guarded R51 writer.';
        }else if(claim.format==='opensp-stock-r51v-claim-v1'&&claim.state==='installation-complete'){
          directPhase='complete';directButton.textContent='Installation complete';
          directStatus.textContent='This browser recorded a verified OpenSynth P34 installation.';
        }else if(claim.state==='stage-verified'){
          directStatus.textContent='The R51 stage was verified. Continue to finish the one-shot stock handoff.';
        }else{
          directPhase='locked';directButton.textContent='Installation stopped';
          directStatus.textContent=claim.state==='app1-reset-sent' ?
            'APP1 was committed and the guarded reset was sent. Do not retry the flash; check the SP or power-cycle it once.' :
            claim.state==='app1-commit-started' ?
            'The APP1 COMMIT boundary was reached. Do not retry the flash; reconnect only for a read-only recovery check.' :
            'The saved stock handoff is uncertain. Do not resend the carrier.';
        }
      }
    }catch{directPhase='locked';directButton.textContent='Installation stopped';directStatus.textContent='The saved stock handoff claim is damaged. Do not retry it.';}
    directButton.disabled = directPhase==='complete'||directPhase==='locked'||(directPhase==='stock'&&!hasStockApis())||(directPhase==='r51'&&!hasHidApi());
    if (!hasStockApis()) directStatus.textContent = 'This installer needs desktop Chrome or another Chromium browser with Web Serial.';
  }).catch(error => {
    directButton.disabled = true;
    directStatus.textContent = error instanceof Error ? error.message : 'The stock USB installer could not load.';
  });
}
