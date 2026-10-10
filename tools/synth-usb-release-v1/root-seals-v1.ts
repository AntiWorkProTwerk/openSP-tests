export interface RootSoftwareBenchSeal {
  readonly manifestBytes:number;
  readonly manifestSha256:string;
  readonly rootSealBytes:number;
  readonly rootSealSha256:string;
}

// Root installs an exact generated entry only after reviewing all concrete qualifying proofs.
// Local CLI output and caller-supplied booleans are not entries in this trust registry.
// N1 admission was withdrawn after the owner's missing-pad report on October 6.
// Preserve its historical seal and storage receipt; no current image is authorized here.
export const ROOT_SEALED_LOCAL_BENCH_AUTHORITIES:readonly RootSoftwareBenchSeal[]=Object.freeze([]);
