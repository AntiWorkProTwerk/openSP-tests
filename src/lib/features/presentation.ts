/** Fields rendered by the shared picker components, independent of catalog measurements. */
export interface FeatureRowPresentation {
  id:string;
  name:string;
  description:string;
  readiness:string;
  selectable:boolean;
  evidence:string;
  blocker:string;
  requires:readonly string[];
  artifact?:{identity:string;sha256:string}|null;
}

export interface FeatureShortcutPresentation {
  id:string;
  name:string;
  shortcutScope?:string;
  defaultControls:readonly string[];
}
