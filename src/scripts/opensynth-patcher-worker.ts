// Runs the openSynth patch off the main thread. The visitor's file never leaves this browser.
import {buildFirmware, PatchError} from '../lib/opensynth/patcher';
import {inspectStockUsbRouteImage, type StockUsbRouteImage} from '../lib/opensynth/usb-route';

export type PatcherRequest = {file: File; patchUrl: string; patchSha256: string};
export type PatcherReply =
  | {type: 'progress'; stage: 'reading' | 'verifying' | 'patching' | 'checking'; fraction: number}
  | {type: 'done'; output: ArrayBuffer; sha256: string; name: string; usbRoute: StockUsbRouteImage}
  | {type: 'error'; message: string; code: string};

const post = (reply: PatcherReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(reply, transfer);

async function readFile(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > 64 * 1024 * 1024) throw new PatchError("This file is too large to be Roland's v5.52 update. Drop the ZIP from Roland, or the SP404MKII_APP1.bin inside it.", 'too-large');
  const out = new Uint8Array(file.size), reader = file.stream().getReader();
  let o = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    if (o + value.length > out.length) throw new PatchError("The file changed while it was being read. Drop it again.", 'read');
    out.set(value, o); o += value.length;
    post({type: 'progress', stage: 'reading', fraction: out.length ? o / out.length : 1});
  }
  if (o !== out.length) throw new PatchError("The file changed while it was being read. Drop it again.", 'read');
  return out;
}

self.onmessage = async (event: MessageEvent<PatcherRequest>) => {
  const {file, patchUrl, patchSha256} = event.data;
  try {
    post({type: 'progress', stage: 'reading', fraction: 0});
    const [patch, input] = await Promise.all([
      fetch(patchUrl).then(async response => {
        if (!response.ok) throw new PatchError("The openSynth patch didn't load. Check your connection and try again.", 'patch-fetch');
        return new Uint8Array(await response.arrayBuffer());
      }).catch(error => { throw error instanceof PatchError ? error : new PatchError("The openSynth patch didn't load. Check your connection and try again.", 'patch-fetch'); }),
      readFile(file),
    ]);
    const result = await buildFirmware(patch, input, patchSha256, (stage, fraction) => post({type: 'progress', stage, fraction}));
    let usbRoute: StockUsbRouteImage;
    try { usbRoute = inspectStockUsbRouteImage(result.output); }
    catch (error) { throw new PatchError('The finished file did not match the held USB-install envelope, so it was not offered.', 'usb-route'); }
    post({type: 'done', output: result.output.buffer, sha256: result.sha256, name: result.name, usbRoute}, [result.output.buffer]);
  } catch (error) {
    if (error instanceof PatchError) post({type: 'error', message: error.message, code: error.code});
    else { console.error(error); post({type: 'error', message: 'Something went wrong while building the file, so nothing was saved. Reload the page and try again.', code: 'unexpected'}); }
  }
};
