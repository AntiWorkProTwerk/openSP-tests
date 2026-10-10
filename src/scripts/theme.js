(() => {
  const media=matchMedia('(prefers-color-scheme: dark)');
  let preference='light';
  try { preference=localStorage.getItem('opensp-theme')||'light'; } catch {}
  if(!['light','dark','system'].includes(preference))preference='light';
  function apply(){
    document.documentElement.dataset.theme=preference==='system'?(media.matches?'dark':'light'):preference;
    document.querySelectorAll('[data-theme-picker]').forEach(el=>el.value=preference);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    apply();
    document.querySelectorAll('.theme-control').forEach(el=>el.hidden=false);
    document.querySelectorAll('[data-theme-picker]').forEach(el=>el.addEventListener('change',()=>{
      preference=el.value;try{localStorage.setItem('opensp-theme',preference)}catch{}apply();
    }));
  });
  media.addEventListener('change',apply);
  addEventListener('storage',event=>{if(event.key==='opensp-theme'){preference=['light','dark','system'].includes(event.newValue)?event.newValue:'light';apply();}});
  apply();
})();
