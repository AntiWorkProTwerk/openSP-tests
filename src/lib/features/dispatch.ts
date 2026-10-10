import {parseSelection,type Selection,type ShortcutScope} from './selection.ts';

/** UI/lifecycle classes only. The offline model has no audio-transport input. */
export type PanelContext='sampler-panel'|'pattern-panel'|'fx-panel'|'utility-panel'|'unknown'|'modal'|'update';
const normalPanelContexts=new Set<PanelContext>(['sampler-panel','pattern-panel','fx-panel','utility-panel']);
const scopeAdmits=(required:ShortcutScope,context:PanelContext)=>required==='sampler-idle'?context==='sampler-panel':normalPanelContexts.has(context);

/** Offline reference semantics. It is not an installed firmware dispatcher. */
export class ShortcutDispatcher{
  private held=new Map<string,boolean>();
  private latched=new Set<string>();
  private uncertain=new Set<string>();
  private selection:Selection;
  constructor(selection:Selection){this.selection=parseSelection(selection);}
  gap(){this.held.clear();for(const f of this.selection.features)if(f.shortcut){this.uncertain.add(f.id);this.latched.add(f.id);}}
  event(control:string,pressed:boolean,context:PanelContext):string|null{
    const was=this.held.get(control)===true;
    this.held.set(control,pressed);
    for(const f of this.selection.features){
      const s=f.shortcut;if(!s)continue;
      if(s.controls.every(c=>this.held.get(c)===false)){this.latched.delete(f.id);this.uncertain.delete(f.id);}
    }
    if(!pressed||was) return null;
    for(const f of this.selection.features){
      const s=f.shortcut;if(!s||this.latched.has(f.id)||this.uncertain.has(f.id)||!scopeAdmits(s.scope,context))continue;
      if(s.controls.at(-1)===control&&s.controls.every(c=>this.held.get(c)===true)){this.latched.add(f.id);return f.id;}
    }
    return null;
  }
}
