// Drop-zone front end for the openSynth patcher. The work runs in a Web Worker;
// the visitor's file is read locally and never uploaded.
import type {PatcherReply} from './opensynth-patcher-worker';

type Stage = 'reading' | 'verifying' | 'patching' | 'checking';
const STAGES: Stage[] = ['reading', 'verifying', 'patching', 'checking'];
const WEIGHT: Record<Stage, [number, number]> = {reading: [0, 25], verifying: [25, 55], patching: [55, 85], checking: [85, 100]};

const root = document.querySelector<HTMLElement>('[data-patcher]');
if (root) {
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  const drop = root.querySelector<HTMLElement>('[data-patcher-drop]')!;
  const progress = root.querySelector<HTMLProgressElement>('progress')!;
  const percent = root.querySelector<HTMLElement>('[data-patcher-percent]')!;
  const status = root.querySelector<HTMLElement>('[data-patcher-status]')!;
  const fileName = root.querySelector<HTMLElement>('[data-patcher-file]')!;
  const save = root.querySelector<HTMLAnchorElement>('[data-patcher-save]')!;
  const sha = root.querySelector<HTMLElement>('[data-patcher-sha]')!;
  const reset = root.querySelector<HTMLButtonElement>('[data-patcher-reset]')!;
  const messages = JSON.parse(root.dataset.messages!) as Record<Stage | 'done', string>;
  let worker: Worker | undefined, url: string | undefined, depth = 0;

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
    url = undefined; save.removeAttribute('href'); sha.textContent = '';
  }

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
        url = URL.createObjectURL(new Blob([reply.output], {type: 'application/octet-stream'}));
        save.href = url; save.download = reply.name;
        sha.textContent = reply.sha256;
        progress.value = 100; percent.textContent = '100%';
        root!.querySelectorAll<HTMLElement>('[data-stage]').forEach(item => { item.dataset.status = 'done'; item.removeAttribute('aria-current'); });
        status.textContent = messages.done;
        setState('done');
        worker?.terminate(); worker = undefined;
        save.focus();
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
}
