import type {B2ImageBundle,ImageRole} from './model.ts';
import {resolveQualifiedImage} from './release.ts';
import {resolveBenchImage} from './local-bench-v1.ts';

export function resolveAdmittedImage(bundle:B2ImageBundle,role:ImageRole) {
  if(role==='restoration'){
    try{return resolveQualifiedImage(bundle,role);}catch{/* A registered bench token also carries the exact admitted restoration. */}
  }
  try{return resolveBenchImage(bundle,role);}catch{
    throw new TypeError('Only this module\'s admitted exact P6S restoration or root-sealed LOCALBENCH candidate may be transferred');
  }
}
