import {shifted} from './test-typescript-loader-relative.ts';
import type {Note} from './test-typescript-loader-relative.ts';

export enum RunnerMode {Idle = 2, Selected}

export class RunnerOwner {
  constructor(public readonly token: number, private readonly current: () => number) {}
  isCurrent(): boolean {return this.current() === this.token;}
}

export function relativeValue(pitch: number): number {
  const note = {pitch} satisfies Note;
  return shifted(note as Note);
}
