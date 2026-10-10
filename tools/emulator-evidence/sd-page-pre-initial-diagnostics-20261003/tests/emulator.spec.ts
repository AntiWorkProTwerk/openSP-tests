import {test, expect, type Locator, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync} from 'node:fs';

const route = '/emulator/';
const action = (session: Locator, name: string) => session.locator(`[data-action="${name}"]`);

interface RecordedCommand {
  command: string;
  id: number;
  format?: string;
  imageLength?: number;
  report?: number[];
  input?: Record<string, unknown>;
}

interface RecordedWorker {
  url: string;
  terminated: boolean;
  commands: RecordedCommand[];
}

interface HeldWorkerStatus {
  worker: number;
  command: string;
  reply: Record<string, unknown>;
}

// These checks replace the ARM worker to isolate browser controls and routing.
// The file below is UI input only; loading it here establishes no firmware boot.
const uiFile = (name = 'local-ui-fixture.bin') => ({
  name, mimeType: 'application/octet-stream', buffer: Buffer.from([0x00, 0x20, 0xfd, 0xe7]),
});

async function installWorkerMock(page: Page) {
  await page.addInitScript(() => {
    type Request = {id: number; command: string; image?: ArrayBuffer; format?: string; name?: string; report?: number[]; input?: Record<string, unknown>};
    type WorkerRecord = {url: string; terminated: boolean; commands: {
      id: number; command: string; format?: string; imageLength?: number; report?: number[]; input?: Record<string, unknown>;
    }[]};
    const records: WorkerRecord[] = [];
    const instances: EventTarget[] = [];
    const pendingStatuses: {worker: number; command: string; reply: Record<string, unknown>}[] = [];
    Object.defineProperty(window, '__emulatorWorkerRecords', {value: records});
    Object.defineProperty(window, '__emulatorWorkerInstances', {value: instances});
    Object.defineProperty(window, '__emulatorSilentCommands', {value: [] as string[], writable: true});
    Object.defineProperty(window, '__emulatorHeldStatuses', {value: [] as string[], writable: true});
    Object.defineProperty(window, '__emulatorPendingStatuses', {value: pendingStatuses});
    class MockWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      private record: WorkerRecord;
      private readonly index: number;
      private state = 'loaded';
      private pc = 0x60081040;
      private instructions = 0;
      private hash: string;
      private firmwareName = '';
      private readonly unknownMmio = [{address: 0x40044000, width: 4, operation: 'read', count: 2}];

      constructor(url: string | URL) {
        super();
        this.index = records.length;
        this.hash = (records.length % 2 ? 'b' : 'a').repeat(64);
        this.record = {url: String(url), terminated: false, commands: []};
        records.push(this.record);
        instances.push(this);
      }

      private snapshot() {
        return {
          state: this.state, pc: this.pc, instructions: this.instructions,
          firmwareHash: this.hash, unknownMmio: this.unknownMmio,
          display: Array.from({length: 1024}, (_, index) => index === 0 ? 0xff : 0),
          displayOn: true, powered: true, frames: 1, unknownMmioOverflow: 17,
          cpuBackendFailed: false, mailboxCached: false,
        };
      }

      private publish(request: Request, reply: Record<string, unknown>) {
        if (reply.type === 'status' &&
          (window as Window & {__emulatorHeldStatuses?: string[]}).__emulatorHeldStatuses!.includes(request.command)) {
          pendingStatuses.push({worker: this.index, command: request.command, reply});
          return;
        }
        const event = new MessageEvent('message', {data: reply});
        this.onmessage?.(event);
        this.dispatchEvent(event);
      }

      postMessage(request: Request) {
        this.record.commands.push({
          command: request.command, id: request.id, format: request.format,
          imageLength: request.image?.byteLength, report: request.report && [...request.report],
          input: request.input && {...request.input},
        });
        queueMicrotask(() => {
          if (this.record.terminated) return;
          if ((window as Window & {__emulatorSilentCommands?: string[]}).__emulatorSilentCommands!.includes(request.command)) return;
          let response: Record<string, unknown>;
          if (request.command === 'load' && request.image && new Uint8Array(request.image)[0] === 0xee) {
            response = {id: request.id, type: 'error', message: 'Unsupported image header'};
          } else if (request.command === 'usb') {
            response = {id: request.id, type: 'usb', report: [0x53, 0x50, ...(request.report ?? Array(62).fill(0)).slice(0, 62)]};
          } else if (request.command === 'trace') {
            response = {id: request.id, type: 'trace', trace: {
              firmwareName: this.firmwareName, firmwareHash: this.hash,
              state: this.state, pc: this.pc, instructions: this.instructions, unknownMmio: this.unknownMmio,
              unknownMmioOverflow: 17,
            }};
          } else {
            if (request.command === 'run') {this.state = 'running'; this.instructions += 128; this.pc += 4;}
            if (request.command === 'pause') this.state = 'paused';
            if (request.command === 'step') {this.state = 'paused'; this.instructions++; this.pc += 2;}
            if (request.command === 'reset' || request.command === 'load') {
              this.state = 'loaded'; this.instructions = 0; this.pc = 0x60081040;
              if (request.command === 'load') this.firmwareName = request.name || '';
            }
            response = {
              id: request.id, type: request.command === 'load' ? 'loaded' : 'status',
              ...this.snapshot(),
            };
          }
          this.publish(request, response);
          if (response.type === 'loaded' || response.type === 'usb') {
            this.publish(request, {id: request.id, type: 'status', ...this.snapshot()});
          }
        });
      }

      terminate() {this.record.terminated = true;}
    }
    Object.defineProperty(window, 'Worker', {configurable: true, value: MockWorker});
  });
}

async function workers(page: Page): Promise<RecordedWorker[]> {
  return page.evaluate(() => (window as Window & {__emulatorWorkerRecords?: RecordedWorker[]}).__emulatorWorkerRecords!);
}

async function silenceCommands(page: Page, commands: string[]) {
  await page.evaluate(commands => {
    (window as Window & {__emulatorSilentCommands?: string[]}).__emulatorSilentCommands = commands;
  }, commands);
}

async function holdStatuses(page: Page, commands: string[]) {
  await page.evaluate(commands => {
    (window as Window & {__emulatorHeldStatuses?: string[]}).__emulatorHeldStatuses = commands;
  }, commands);
}

async function heldStatuses(page: Page): Promise<HeldWorkerStatus[]> {
  return page.evaluate(() => (window as Window & {__emulatorPendingStatuses?: HeldWorkerStatus[]}).__emulatorPendingStatuses!);
}

async function publishReply(page: Page, worker: number, reply: Record<string, unknown>) {
  await page.evaluate(({worker, reply}) => {
    const instances = (window as Window & {__emulatorWorkerInstances?: EventTarget[]}).__emulatorWorkerInstances!;
    instances[worker].dispatchEvent(new MessageEvent('message', {data: reply}));
  }, {worker, reply});
}

async function releaseStatus(page: Page, worker: number, command: string) {
  await page.evaluate(({worker, command}) => {
    const pending = (window as Window & {__emulatorPendingStatuses?: HeldWorkerStatus[]}).__emulatorPendingStatuses!;
    const index = pending.findIndex(status => status.worker === worker && status.command === command);
    if (index < 0) throw new Error(`No held ${command} status for worker ${worker}`);
    const [status] = pending.splice(index, 1);
    const instances = (window as Window & {__emulatorWorkerInstances?: EventTarget[]}).__emulatorWorkerInstances!;
    instances[worker].dispatchEvent(new MessageEvent('message', {data: status.reply}));
  }, {worker, command});
}

async function openWithPausedClock(page: Page) {
  await page.clock.install({time: new Date('2026-10-02T12:00:00Z')});
  const emulator = await openEmulator(page);
  await page.clock.pauseAt(new Date('2026-10-02T12:01:00Z'));
  return emulator;
}

async function openEmulator(page: Page) {
  await page.goto(route);
  const emulator = page.locator('[data-emulator]');
  await expect(emulator).toBeVisible();
  await expect(emulator.locator('[data-session]')).toHaveCount(1);
  return emulator;
}

async function startSession(session: Locator, name?: string) {
  await session.locator('[data-file]').setInputFiles(uiFile(name));
  await expect(action(session, 'start')).toBeEnabled();
  await action(session, 'start').click();
  await expect(session.locator('[data-session-state]')).toHaveText(/running/i);
}

test('emulator introduction stays readable without JavaScript', async ({browser}) => {
  const context = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}});
  try {
    const page = await context.newPage();
    await page.goto(route);
    await expect(page.locator('h1')).toContainText(/emulator/i);
    await expect(page.locator('main')).toContainText(/firmware/i);
    await expect(page.locator('.emulator-no-script')).toContainText(/JavaScript/i);
    await expect(page.locator('.emulator-no-script')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {await context.close();}
});

test('the homepage footer opens the emulator with native keyboard navigation and no JavaScript', async ({browser}) => {
  const context = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 844}});
  try {
    const page = await context.newPage();
    await page.goto('/');
    const mainLinks = page.getByRole('navigation', {name: 'Main navigation', exact: true}).getByRole('link');
    await expect(mainLinks).toHaveCount(2);
    await expect(mainLinks).toHaveText(['Releases', 'Guides']);
    const link = page.locator('.footer-links').getByRole('link', {name: 'Firmware emulator', exact: true});
    await expect(link).toHaveAttribute('href', route);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/emulator\/$/);
    await expect(page.locator('h1')).toHaveText('Firmware emulator');
    await expect(page.locator('.emulator-no-script')).toBeVisible();
    await expect(page.locator('.footer-links a[href="/emulator/"]')).toHaveAttribute('aria-current', 'page');
    await expect(mainLinks).toHaveCount(2);
    await expect(mainLinks).toHaveText(['Releases', 'Guides']);
  } finally {await context.close();}
});

test.describe('emulator interface with a mocked ARM worker', () => {
  test.beforeEach(async ({page}) => {await installWorkerMock(page);});

  test('firmware remains local and worker creation waits for Start', async ({page}) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await expect(action(session, 'start')).toBeDisabled();
    await expect(action(session, 'pause')).toBeDisabled();
    await expect(action(session, 'step')).toBeDisabled();
    expect(await workers(page)).toEqual([]);

    await session.locator('[data-file]').setInputFiles(uiFile());
    await expect(session.locator('[data-firmware-name]')).toContainText('local-ui-fixture.bin');
    await expect(action(session, 'start')).toBeEnabled();
    await session.locator('[data-format]').selectOption('flash');
    expect(await workers(page)).toEqual([]);
    expect(requests.filter(url => /worker-rpc|emulator-worker|unicorn|\.wasm(?:\?|$)|\.(?:bin|img|zip|uf2|hex)(?:\?|$)/i.test(url))).toEqual([]);
    await action(session, 'start').click();
    await expect(session.locator('[data-session-state]')).toHaveText(/running/i);
    const recorded = await workers(page);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].commands.filter(message => message.command === 'load')).toEqual([
      expect.objectContaining({format: 'flash', imageLength: 4}),
    ]);
    expect(recorded[0].commands.map(message => message.command)).toContain('run');
    expect(requests.some(url => /worker-rpc/i.test(url))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('load stays busy and cannot run before its trailing same-ID status', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await holdStatuses(page, ['load']);
    await session.locator('[data-file]').setInputFiles(uiFile());
    await action(session, 'start').click();
    await expect.poll(async () => (await heldStatuses(page)).length).toBe(1);
    await expect(session.locator('[data-diagnostic="hash"]')).toHaveText('a'.repeat(64));
    await expect(session).toHaveAttribute('aria-busy', 'true');
    await expect(session.locator('[data-session-state]')).toHaveText('Loading runtime');
    expect((await workers(page))[0].commands.map(request => request.command)).toEqual(['load']);
    const {reply} = (await heldStatuses(page))[0];
    for (const id of [0, Number(reply.id) + 1000]) {
      await publishReply(page, 0, {...reply, id});
      await expect(session).toHaveAttribute('aria-busy', 'true');
      await expect(action(session, 'pause')).toBeDisabled();
      expect((await workers(page))[0].commands.map(request => request.command)).toEqual(['load']);
    }
    await releaseStatus(page, 0, 'load');
    await expect(session.locator('[data-session-state]')).toHaveText('Running');
    await expect(session).toHaveAttribute('aria-busy', 'false');
    expect((await workers(page))[0].commands.map(request => request.command)).toEqual(['load', 'run']);
  });

  test('USB stays busy after its payload until its own status arrives', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await startSession(session);
    await holdStatuses(page, ['usb']);
    await action(session, 'usb-status').click();
    await expect.poll(async () => (await heldStatuses(page)).length).toBe(1);
    await expect(session).toHaveAttribute('aria-busy', 'true');
    await expect(session.locator('[data-usb-result]')).toContainText('Waiting');
    const {reply} = (await heldStatuses(page))[0];
    await publishReply(page, 0, {...reply, id: 0, instructions: 129});
    await expect(session.locator('[data-diagnostic="instructions"]')).toHaveText('129');
    await publishReply(page, 0, {...reply, id: Number(reply.id) + 1000, instructions: 9999});
    await expect(session).toHaveAttribute('aria-busy', 'true');
    await expect(session.locator('[data-usb-result]')).toContainText('Waiting');
    await expect(action(session, 'reset')).toBeDisabled();
    await expect(session.locator('[data-diagnostic="instructions"]')).toHaveText('129');
    await releaseStatus(page, 0, 'usb');
    await expect(session).toHaveAttribute('aria-busy', 'false');
    await expect(session.locator('[data-usb-result]')).toHaveText(['53', '50', ...Array(62).fill('00')].join(' '));
    const recorded = (await workers(page))[0].commands;
    expect(recorded.map(request => request.command)).toEqual(['load', 'run', 'usb']);
    expect(new Set(recorded.map(request => request.id)).size).toBe(recorded.length);
    await expect(session.locator('[data-session-error]')).toBeHidden();
  });

  test('generic stock reset clears stale mailbox fields without stepping guest code', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await startSession(session, 'stock-ui-fixture.bin');
    await publishReply(page, 0, {id: 0, type: 'status', state: 'running', pc: 0x60081044,
      instructions: 128, firmwareHash: 'a'.repeat(64), marker: 0x523d0001,
      heartbeat: 7, firmwareState: 2, cpuBackendFailed: false, mailboxCached: false});
    await expect(session.locator('[data-diagnostic="marker"]')).toHaveText('0x523D0001');
    const beforeReset = (await workers(page))[0].commands.length;
    await action(session, 'reset').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Paused');
    await expect(session).toHaveAttribute('aria-busy', 'false');
    await expect(session.locator('[data-diagnostic="instructions"]')).toHaveText('0');
    await expect(session.locator('[data-diagnostic="marker"]')).toHaveText('—');
    expect((await workers(page))[0].commands.slice(beforeReset).map(request => request.command)).toEqual(['reset']);
    await expect(session.locator('[data-session-error]')).toBeHidden();
    await action(session, 'start').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Running');
    expect(await workers(page)).toHaveLength(1);
    expect((await workers(page))[0].commands.slice(beforeReset).map(request => request.command)).toEqual(['reset', 'run']);
  });

  for (const replacement of ['file', 'remove', 'pagehide'] as const) {
    test(`a completed load cannot publish or run after ${replacement} replaces its session`, async ({page}) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const emulator = await openEmulator(page);
      const session = emulator.locator('[data-session]').first();
      await holdStatuses(page, ['load']);
      await session.locator('[data-file]').setInputFiles(uiFile('old-ui-fixture.bin'));
      await action(session, 'start').click();
      await expect.poll(async () => (await heldStatuses(page)).length).toBe(1);
      await page.evaluate(replacement => {
        const owned = window as Window & {__emulatorPendingStatuses?: HeldWorkerStatus[]; __emulatorWorkerInstances?: EventTarget[]};
        const [status] = owned.__emulatorPendingStatuses!.splice(0, 1);
        owned.__emulatorWorkerInstances![status.worker].dispatchEvent(new MessageEvent('message', {data: status.reply}));
        const element = document.querySelector<HTMLElement>('[data-session]')!;
        if (replacement === 'file') {
          const input = element.querySelector<HTMLInputElement>('[data-file]')!;
          const files = new DataTransfer();
          files.items.add(new File([Uint8Array.of(0, 0x20, 0xfd, 0xe7)], 'replacement-ui-fixture.bin'));
          input.files = files.files; input.dispatchEvent(new Event('change', {bubbles: true}));
        } else if (replacement === 'remove') element.querySelector<HTMLButtonElement>('[data-action="remove"]')!.click();
        else window.dispatchEvent(new PageTransitionEvent('pagehide'));
      }, replacement);
      expect((await workers(page))[0].terminated).toBe(true);
      expect((await workers(page))[0].commands.map(request => request.command)).toEqual(['load']);
      if (replacement === 'remove') {
        await expect(emulator.locator('[data-session]')).toHaveCount(0);
        await expect(emulator.locator('[data-add-session]')).toBeEnabled();
      } else {
        await expect(session.locator('[data-session-state]')).toHaveText('Ready to start');
        await expect(session).toHaveAttribute('aria-busy', 'false');
        await expect(session.locator('[data-session-error]')).toBeHidden();
        await expect(session.locator('[data-diagnostic="hash"]')).toHaveText('Available after load');
        if (replacement === 'file') await expect(session.locator('[data-firmware-name]')).toContainText('replacement-ui-fixture.bin');
        await holdStatuses(page, []);
        await action(session, 'start').click();
        await expect(session.locator('[data-session-state]')).toHaveText('Running');
        await expect(session.locator('[data-diagnostic="hash"]')).toHaveText('b'.repeat(64));
        await publishReply(page, 0, {id: 0, type: 'error', message: 'Stale old-worker error'});
        await expect(session.locator('[data-session-state]')).toHaveText('Running');
        await expect(session.locator('[data-session-error]')).toBeHidden();
      }
      expect(errors).toEqual([]);
    });
  }

  test('replacing a file after USB acknowledgment discards its asynchronous result', async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await startSession(session, 'old-ui-fixture.bin');
    await holdStatuses(page, ['usb']);
    await action(session, 'usb-status').click();
    await expect.poll(async () => (await heldStatuses(page)).length).toBe(1);
    await page.evaluate(() => {
      const owned = window as Window & {__emulatorPendingStatuses?: HeldWorkerStatus[]; __emulatorWorkerInstances?: EventTarget[]};
      const [status] = owned.__emulatorPendingStatuses!.splice(0, 1);
      owned.__emulatorWorkerInstances![status.worker].dispatchEvent(new MessageEvent('message', {data: status.reply}));
      const input = document.querySelector<HTMLInputElement>('[data-session] [data-file]')!;
      const files = new DataTransfer();
      files.items.add(new File([Uint8Array.of(0, 0x20, 0xfd, 0xe7)], 'replacement-ui-fixture.bin'));
      input.files = files.files; input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(session.locator('[data-session-state]')).toHaveText('Ready to start');
    await expect(session).toHaveAttribute('aria-busy', 'false');
    await expect(session.locator('[data-usb-result]')).not.toContainText('53 50');
    await expect(session.locator('[data-session-error]')).toBeHidden();
    await action(session, 'start').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Running');
    await expect(session.locator('[data-diagnostic="hash"]')).toHaveText('b'.repeat(64));
    expect((await workers(page)).map(worker => worker.terminated)).toEqual([true, false]);
    expect(errors).toEqual([]);
  });

  test('keyboard pause, step and reset update diagnostics and the OLED', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await startSession(session);
    await expect(session.locator('[data-diagnostic="hash"]')).toContainText('a'.repeat(64));
    await expect(session.locator('[data-diagnostic="instructions"]')).toContainText('128');
    await expect(session.locator('[data-diagnostic="mmio"]')).toHaveText('2 recorded · 17 unrecorded');
    await expect(session.locator('[data-mmio-details]')).toContainText('17');
    await expect(session.locator('[data-mmio-details]')).toContainText(/capacity/i);
    await action(session, 'pause').focus();
    await page.keyboard.press('Enter');
    await expect(session.locator('[data-session-state]')).toHaveText(/paused/i);
    await action(session, 'step').focus();
    await page.keyboard.press('Space');
    await expect(session.locator('[data-diagnostic="instructions"]')).toContainText('129');
    await expect(session.locator('[data-diagnostic="pc"]')).toContainText(/60081046/i);
    await action(session, 'reset').click();
    await expect(session.locator('[data-session-state]')).toHaveText(/loaded|paused/i);
    await expect(session.locator('[data-diagnostic="instructions"]')).toHaveText('0');
    await expect(session.locator('[data-diagnostic="pc"]')).toContainText(/60081040/i);
    const pixel = await session.locator('canvas[data-oled]').evaluate(canvas => {
      const context = (canvas as HTMLCanvasElement).getContext('2d')!;
      return [...context.getImageData(0, 0, 1, 1).data];
    });
    expect(pixel[3]).toBe(255);
    expect(pixel[0] + pixel[1] + pixel[2]).toBeGreaterThan(300);
  });

  test('sessions use independent workers and removal terminates only its worker', async ({page}) => {
    const emulator = await openEmulator(page);
    const sessions = emulator.locator('[data-session]');
    await emulator.locator('[data-add-session]').click();
    await expect(sessions).toHaveCount(2);
    await sessions.nth(0).locator('[data-session-name]').fill('Original fixture');
    await sessions.nth(1).locator('[data-session-name]').fill('Comparison fixture');
    await startSession(sessions.nth(0), 'first.bin');
    await startSession(sessions.nth(1), 'second.bin');
    await action(sessions.nth(0), 'pause').click();
    await expect(sessions.nth(0).locator('[data-session-state]')).toHaveText(/paused/i);
    await expect(sessions.nth(1).locator('[data-session-state]')).toHaveText(/running/i);
    await expect(sessions.nth(0).locator('[data-diagnostic="hash"]')).toContainText('a'.repeat(64));
    await expect(sessions.nth(1).locator('[data-diagnostic="hash"]')).toContainText('b'.repeat(64));
    const before = await workers(page);
    expect(before).toHaveLength(2);
    expect(before[1].commands.some(message => message.command === 'pause')).toBe(false);
    const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map(node => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    await action(sessions.nth(0), 'remove').click();
    await expect(sessions).toHaveCount(1);
    await expect(sessions.first().locator('[data-session-name]')).toHaveValue('Comparison fixture');
    expect((await workers(page)).map(worker => worker.terminated)).toEqual([true, false]);
    await action(sessions.first(), 'pause').click();
    await expect(sessions.first().locator('[data-session-state]')).toHaveText(/paused/i);
  });

  test('USB reports reject invalid hex and route valid bytes to the chosen session', async ({page}) => {
    const emulator = await openEmulator(page);
    await emulator.locator('[data-add-session]').click();
    const sessions = emulator.locator('[data-session]');
    await startSession(sessions.nth(0));
    await startSession(sessions.nth(1));
    const session = sessions.nth(1);
    const input = session.locator('[data-usb-report]');
    const submit = session.locator('[data-usb-form] button[type="submit"]');
    for (const invalid of ['GG 00', '0 01', '100', '01 zz', '01 00', Array(65).fill('00').join(' '), '']) {
      await input.fill(invalid);
      await submit.click();
      await expect(session.locator('[data-session-error]')).toContainText(/hex|byte|report|required|empty/i);
    }
    expect((await workers(page))[1].commands.filter(message => message.command === 'usb')).toEqual([]);
    const reportBytes = [1, 171, 0, 255, ...Array(60).fill(0)];
    await input.fill(['01', 'aB', '00', 'ff', ...Array(60).fill('00')].join(' '));
    await submit.click();
    await expect(session.locator('[data-usb-result]')).toContainText(/53 50 01 AB 00 FF/i);
    const recorded = await workers(page);
    expect(recorded[0].commands.filter(message => message.command === 'usb')).toEqual([]);
    expect(recorded[1].commands.filter(message => message.command === 'usb')).toEqual([
      expect.objectContaining({report: reportBytes}),
    ]);
  });

  test('trace export carries the session identity, firmware hash and current diagnostics', async ({page}) => {
    const emulator = await openEmulator(page);
    const session = emulator.locator('[data-session]').first();
    await session.locator('[data-session-name]').fill('Candidate comparison');
    await startSession(session, 'candidate.bin');
    await action(session, 'pause').click();
    await action(session, 'step').click();
    const downloadPromise = page.waitForEvent('download');
    await action(session, 'export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/i);
    const path = await download.path();
    expect(path).not.toBeNull();
    const trace = JSON.parse(readFileSync(path!, 'utf8'));
    const serialized = JSON.stringify(trace);
    expect(serialized).toContain('Candidate comparison');
    expect(serialized).toContain('candidate.bin');
    expect(serialized).toContain('a'.repeat(64));
    expect(serialized).toContain('paused');
    expect(serialized).toContain('129');
    expect(trace.limits).toEqual(expect.arrayContaining([expect.stringMatching(/coverage|incomplete|unimplemented|model/i)]));
    expect(trace.trace.unknownMmio).toEqual([{address: 0x40044000, width: 4, operation: 'read', count: 2}]);
    expect(trace.trace.unknownMmioOverflow).toBe(17);
  });

  test('a stalled load stops after 45 seconds and leaves recovery controls available', async ({page}) => {
    const emulator = await openWithPausedClock(page);
    const session = emulator.locator('[data-session]').first();
    await silenceCommands(page, ['load']);
    await session.locator('[data-file]').setInputFiles(uiFile());
    await expect(action(session, 'start')).toBeEnabled();
    await action(session, 'start').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Loading runtime');
    await expect(session.locator('[data-file]')).toBeEnabled();
    await page.clock.fastForward(44_999);
    await expect(session.locator('[data-session-state]')).toHaveText('Loading runtime');
    expect((await workers(page))[0].terminated).toBe(false);
    await page.clock.fastForward(1);
    await expect(session.locator('[data-session-error]')).toContainText('Emulator worker stopped responding during runtime loading');
    await expect(session.locator('[data-session-state]')).toHaveText('Stopped on error');
    expect((await workers(page))[0].terminated).toBe(true);
    await expect(action(session, 'reset')).toBeEnabled();
    await expect(action(session, 'remove')).toBeEnabled();
    await expect(session.locator('[data-file]')).toBeEnabled();
    await action(session, 'remove').click();
    await expect(emulator.locator('[data-session]')).toHaveCount(0);
    await expect(emulator.locator('[data-add-session]')).toBeEnabled();
  });

  test('a stalled USB request stops after 30 seconds and late replies cannot replace a new worker', async ({page}) => {
    const emulator = await openWithPausedClock(page);
    const session = emulator.locator('[data-session]').first();
    await startSession(session);
    await action(session, 'pause').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Paused');
    await silenceCommands(page, ['usb']);
    await session.locator('[data-usb-form] button[type="submit"]').click();
    await expect(session).toHaveAttribute('aria-busy', 'true');
    await expect(session.locator('[data-file]')).toBeEnabled();
    await page.clock.fastForward(29_999);
    await expect(session.locator('[data-session-error]')).toBeHidden();
    expect((await workers(page))[0].terminated).toBe(false);
    await page.clock.fastForward(1);
    await expect(session.locator('[data-session-error]')).toContainText('Emulator worker stopped responding during usb');
    await expect(session.locator('[data-session-state]')).toHaveText('Stopped on error');
    await expect(session).toHaveAttribute('aria-busy', 'false');
    await expect(session.locator('[data-diagnostic="hash"]')).toHaveText('a'.repeat(64));
    await expect(session.locator('[data-diagnostic="instructions"]')).toHaveText('128');
    expect((await workers(page))[0].terminated).toBe(true);
    for (const name of ['reset', 'remove', 'export']) await expect(action(session, name)).toBeEnabled();
    await expect(session.locator('[data-file]')).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await action(session, 'export').click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const cached = JSON.parse(readFileSync(path!, 'utf8'));
    expect(cached.trace.schema).toBe('opensp-emulator-unresponsive-worker-v1');
    expect(cached.trace.failure.command).toBe('usb');
    expect(cached.trace.lastPublishedSnapshot.firmwareHash).toBe('a'.repeat(64));
    expect(cached.trace.lastPublishedSnapshot.unknownMmioOverflow).toBe(17);
    expect(cached.trace.limitation).toContain('last published snapshot');

    const oldId = (await workers(page))[0].commands.at(-1)!.id;
    await action(session, 'reset').click();
    await expect(session.locator('[data-session-state]')).toHaveText('Ready to start');
    await silenceCommands(page, []);
    await startSession(session, 'replacement.bin');
    await expect(session.locator('[data-diagnostic="hash"]')).toHaveText('b'.repeat(64));
    await page.evaluate(id => {
      const stale = (window as Window & {__emulatorWorkerInstances?: EventTarget[]}).__emulatorWorkerInstances![0];
      stale.dispatchEvent(new MessageEvent('message', {data: {id, type: 'status', state: 'fault', pc: 0xbad00000, instructions: 999999, firmwareHash: 'c'.repeat(64)}}));
      stale.dispatchEvent(new MessageEvent('message', {data: {id, type: 'error', message: 'Late reply from the old worker'}}));
    }, oldId);
    await expect(session.locator('[data-session-state]')).toHaveText('Running');
    await expect(session.locator('[data-session-error]')).toBeHidden();
    await expect(session.locator('[data-diagnostic="hash"]')).toHaveText('b'.repeat(64));
    await expect(session.locator('[data-diagnostic="instructions"]')).toHaveText('128');
    expect((await workers(page)).map(worker => worker.terminated)).toEqual([true, false]);
  });

  test('continuous running stops after 15 seconds without a published status', async ({page}) => {
    const emulator = await openWithPausedClock(page);
    const session = emulator.locator('[data-session]').first();
    await startSession(session);
    await page.clock.fastForward(14_999);
    await expect(session.locator('[data-session-state]')).toHaveText('Running');
    expect((await workers(page))[0].terminated).toBe(false);
    await page.clock.fastForward(1);
    await expect(session.locator('[data-session-error]')).toContainText('Emulator worker stopped responding while running');
    await expect(session.locator('[data-session-state]')).toHaveText('Stopped on error');
    expect((await workers(page))[0].terminated).toBe(true);
    await expect(action(session, 'reset')).toBeEnabled();
    await expect(action(session, 'remove')).toBeEnabled();
    await expect(session.locator('[data-file]')).toBeEnabled();
    await action(session, 'reset').click();
    await page.clock.fastForward(60_000);
    await expect(session.locator('[data-session-state]')).toHaveText('Ready to start');
    await expect(session.locator('[data-session-error]')).toBeHidden();
  });

  test('worker load errors are visible and preserve another running session', async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const emulator = await openEmulator(page);
    await emulator.locator('[data-add-session]').click();
    const sessions = emulator.locator('[data-session]');
    await startSession(sessions.nth(0));
    await sessions.nth(1).locator('[data-file]').setInputFiles({name: 'rejected.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0xee])});
    await action(sessions.nth(1), 'start').click();
    await expect(sessions.nth(1).locator('[data-session-error]')).toContainText('Unsupported image header');
    await expect(sessions.nth(0).locator('[data-session-state]')).toHaveText(/running/i);
    expect(errors).toEqual([]);
  });

  test('named controls, momentary pads and virtual power requests stay in their session', async ({page}) => {
    const emulator = await openEmulator(page);
    await emulator.locator('[data-add-session]').click();
    const sessions = emulator.locator('[data-session]');
    const session = sessions.nth(1);
    await expect(session.locator('[data-input-form] button[type="submit"]')).toBeDisabled();
    await expect(action(session, 'power-off')).toBeDisabled();
    await expect(session.locator('[data-pad-control]')).toHaveCount(16);
    for (const pad of await session.locator('[data-pad-control]').all()) await expect(pad).toBeDisabled();
    await startSession(sessions.nth(0));
    await startSession(session);
    const controls = session.locator('[data-input-control]');
    await controls.selectOption('VOLUME');
    await session.locator('[data-input-value]').fill('0.25');
    await session.locator('[data-input-form] button[type="submit"]').click();
    await expect.poll(async () => (await workers(page))[1].commands.filter(message => message.command === 'input').map(message => message.input)).toEqual([
      {control: 'VOLUME', value: 0.25},
    ]);

    const pad = session.locator('[data-pad-control="PAD 1"]');
    await pad.click();
    await pad.focus();
    await page.keyboard.down('Space');
    await expect.poll(async () => (await workers(page))[1].commands.filter(message => message.command === 'input').at(-1)?.input).toEqual({control: 'PAD 1', value: 1});
    const heldCount = (await workers(page))[1].commands.filter(message => message.command === 'input').length;
    await page.keyboard.down('Space');
    expect((await workers(page))[1].commands.filter(message => message.command === 'input')).toHaveLength(heldCount);
    await page.keyboard.up('Space');
    await expect.poll(async () => (await workers(page))[1].commands.filter(message => message.command === 'input').at(-1)?.input).toEqual({control: 'PAD 1', value: 0});
    await action(session, 'power-off').click();
    const recorded = await workers(page);
    expect(recorded[0].commands.filter(message => message.command === 'input')).toEqual([]);
    expect(recorded[1].commands.filter(message => message.command === 'input').map(message => message.input)).toEqual([
      {control: 'VOLUME', value: 0.25},
      {control: 'PAD 1', value: 1}, {control: 'PAD 1', value: 0},
      {control: 'PAD 1', value: 1}, {control: 'PAD 1', value: 0},
      {power: false},
    ]);
    await expect(sessions.nth(0).locator('[data-session-state]')).toHaveText(/running/i);
  });

  test('the four-session limit releases a slot when a session is removed', async ({page}) => {
    const emulator = await openEmulator(page);
    const add = emulator.locator('[data-add-session]');
    const sessions = emulator.locator('[data-session]');
    for (let count = 2; count <= 4; count++) {await add.click(); await expect(sessions).toHaveCount(count);}
    await expect(add).toBeDisabled();
    await expect(emulator.locator('[data-session-limit]')).toContainText(/4.*session/i);
    await action(sessions.nth(3), 'remove').click();
    await expect(sessions).toHaveCount(3);
    await expect(add).toBeEnabled();
    await add.click();
    await expect(sessions).toHaveCount(4);
    await expect(sessions.nth(3).locator('[data-session-name]')).toHaveValue('Session 5');
    await expect(add).toBeDisabled();
    expect(await workers(page)).toEqual([]);
  });
});

for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
  test(`mocked emulator sessions fit ${width}px ${theme} and pass Axe`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await installWorkerMock(page);
    const emulator = await openEmulator(page);
    await startSession(emulator.locator('[data-session]').first(), 'candidate-with-a-long-local-name-for-mobile-layout.bin');
    await page.getByLabel('Color theme', {exact: true}).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await emulator.locator('[data-add-session]').click();
    await expect(emulator.locator('[data-session]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const session of await emulator.locator('[data-session]').all()) {
      const box = await session.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      for (const selector of ['[data-session-name]', '[data-file]', '[data-format]', '[data-usb-report]', '[data-input-control]', '[data-input-value]', 'canvas[data-oled]']) {
        await expect(session.locator(selector)).toHaveAccessibleName(/\S/);
      }
    }
    const report = await new AxeBuilder({page}).analyze();
    expect(report.violations).toEqual([]);
    if ([390, 1440].includes(width)) {
      await page.evaluate(() => {(document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0);});
      await page.screenshot({path: `test-results/emulator-${width}-${theme}.png`, fullPage: true, style: 'astro-dev-toolbar{display:none}'});
    }
  });
}
