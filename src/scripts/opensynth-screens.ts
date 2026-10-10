// Frame playback for the openSynth screen sprites. Static first frame without JS;
// reduced motion starts paused; each tile pauses while offscreen and all pause while the page is hidden.
// Every [data-screens-toggle] inside the element plays or pauses every tile.
type Tile = {img: HTMLImageElement; durations: number[]; frame: number; due: number; visible: boolean};

class OpenSynthScreens extends HTMLElement {
  private tiles: Tile[] = [];
  private buttons: HTMLButtonElement[] = [];
  private playing = false;
  private raf = 0;

  connectedCallback() {
    this.buttons = [...this.querySelectorAll<HTMLButtonElement>('[data-screens-toggle]')];
    this.tiles = [...this.querySelectorAll<HTMLElement>('[data-screen]')].map(el => ({
      img: el.querySelector('img')!,
      durations: el.dataset.durations!.split(',').map(Number),
      frame: 0,
      due: 0,
      visible: false,
    }));
    const byElement = new Map(this.tiles.map(t => [t.img.parentElement!, t]));
    const observer = new IntersectionObserver(entries => {
      const now = performance.now();
      for (const e of entries) {
        const t = byElement.get(e.target as HTMLElement);
        if (!t) continue;
        t.visible = e.isIntersecting;
        if (t.visible) t.due = now + t.durations[t.frame];
      }
      this.schedule();
    });
    for (const el of byElement.keys()) observer.observe(el);
    for (const button of this.buttons) {
      button.hidden = false;
      button.addEventListener('click', () => this.set(!this.playing));
    }
    document.addEventListener('visibilitychange', () => this.schedule());
    this.set(!matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.dataset.ready = 'true';
  }

  private set(on: boolean) {
    this.playing = on;
    for (const button of this.buttons) {
      button.setAttribute('aria-pressed', String(on));
      button.textContent = on ? 'Pause animations' : 'Play animations';
    }
    this.dataset.playing = String(on);
    const now = performance.now();
    for (const t of this.tiles) t.due = now + t.durations[t.frame];
    this.schedule();
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.playing && !document.hidden && this.tiles.some(t => t.visible)) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    for (const t of this.tiles) {
      if (!t.visible || now < t.due) continue;
      t.frame = (t.frame + 1) % t.durations.length;
      t.due = now + t.durations[t.frame];
      t.img.style.transform = `translateY(${(-100 * t.frame) / t.durations.length}%)`;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
customElements.define('opensynth-screens', OpenSynthScreens);
