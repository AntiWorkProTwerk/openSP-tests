export interface Note {pitch: number}

export const offset = 4;
export function shifted(note: Note): number {return note.pitch + offset;}
