/* openSynth page screen renders: the released openSynth display code (sp_p6_view.c, the REC modal
 * view sp_p6_rec_modal_view.c and the pattern chooser view sp_p6_pattern_transport_view.c) fed by
 * the real voice DSP and volume code. Writes 128x64 MSB-first frames <out>/<name>.bin. Built by
 * render.py; no device access, no Roland firmware. Scenario helpers follow the SP404MK2 visuals
 * host harness. The stubs below stand in for native SP state only (pattern slots, REC session
 * diagnostics); every pixel is drawn by the openSynth view functions. */
#include "sp_p6_view.h"
#include "sp_p6_volume.h"
#include "sp_p6_rec_modal.h"
#include "sp_p6_pattern_transport_v552.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static SpSynthPreviewVoice V;
static char outdir[512];
typedef struct { int param; unsigned value; } Edit;
typedef struct { unsigned pad; unsigned down_ms,up_ms; } Note;
static int mono_override=-1;

/* Native-state stubs. Pattern chooser: one bank's slots, current/next; the diagnostic status line
 * reports no pad press, so the view draws its own hint line. REC: zeroed save diagnostics. */
static SpP6PatternTransportView pattern_state;
static int click_on=1;
int sp_p6_pattern_transport_v552_view(SpP6PatternTransportView *out){*out=pattern_state;return 1;}
int sp_p6_pattern_transport_v552_diag(char out[32]){(void)out;return 0;}
int sp_p6_metronome_v552_capture_click_enabled(void){return click_on;}
void sp_p6_rec_session_save_diag(uint32_t out[8]){memset(out,0,8*sizeof *out);}
uint32_t sp_p6_rec_native_v552_save_diag(void){return 0;}
uint32_t sp_p6_rec_native_v552_context_failure(void){return 0;}
uint32_t sp_p6_save_v552_diag[3];

static void dump(const char *name,const uint8_t *f){
    char p[700];snprintf(p,sizeof p,"%s/%s.bin",outdir,name);
    FILE *o=fopen(p,"wb");if(!o){perror(p);exit(5);}fwrite(f,1,1024,o);fclose(o);printf("%s\n",name);
}
/* Run the voice from a fresh init and return the newest completed snapshot at at_ms. */
static void run(unsigned preset,const Edit *e,unsigned ne,const Note *n,unsigned nn,unsigned at_ms,SpPreviewVisualSnapshot *s){
    memset(&V,0,sizeof V);sp_synth_preview_voice_init(&V,48000);sp_synth_preview_voice_admit(&V,1);
    sp_synth_preview_voice_preset(&V,preset);
    if(mono_override>=0)sp_synth_preview_voice_mono(&V,mono_override);
    for(unsigned i=0;i<ne;++i)sp_synth_preview_voice_parameter(&V,(unsigned)e[i].param,e[i].value);
    SpPreviewVisualReader r;memset(&r,0,sizeof r);sp_synth_preview_visual_reader_init(&r);
    uint32_t ticket[16]={0};int16_t b[128];
    memset(s,0,sizeof *s);
    for(uint32_t frame=0;frame<at_ms*48u;frame+=64){
        unsigned ms=frame/48u;
        for(unsigned i=0;i<nn;++i){
            if(ms>=n[i].down_ms && !ticket[n[i].pad] && ms<n[i].up_ms)ticket[n[i].pad]=sp_synth_preview_voice_down(&V,n[i].pad);
            if(ms>=n[i].up_ms && ticket[n[i].pad]){sp_synth_preview_voice_up(&V,n[i].pad,ticket[n[i].pad]);ticket[n[i].pad]=UINT32_MAX;}
        }
        if(sp_synth_preview_voice_render(&V,b,128,64)!=SP_PREVIEW_OK){puts("render fault");exit(3);}
        SpPreviewVisualSnapshot t;
        if(sp_synth_preview_voice_visual_read(&V,&r,&t)!=SP_VISUAL_INVALID && t.sequence)*s=t;
    }
}
static void view_for(SpPreviewNativeView *v,unsigned preset,unsigned page,const Edit *e,unsigned ne,const SpPreviewVisualSnapshot *s){
    memset(v,0,sizeof *v);v->state=SP_PREVIEW_NATIVE_ACTIVE;
    SpP4ControlView *c=&v->controls;
    c->preset=preset;c->page=page;c->mono=mono_override>=0?(unsigned)mono_override:sp_synth_preview_preset_mono(preset);c->octave=sp_synth_preview_preset_octave(preset);
    for(unsigned i=0;i<12;++i)c->values[i]=sp_synth_preview_preset_value(preset,i);
    for(unsigned i=0;i<ne;++i){c->values[e[i].param]=(uint16_t)e[i].value;c->modified=1;}
    c->known_mask=7;for(unsigned k=0;k<3;++k)c->knobs[k]=c->values[page*3+k];
    c->command_ticket=c->command_ack=s?s->command_ticket:0;
}
/* Render once with the preset values (so the view's last-moved tracker sees the page), then
 * with the edits applied; the final edit in the list is the knob "just moved". */
static void shot(const char *name,unsigned preset,unsigned page,const Edit *e,unsigned ne,const Note *n,unsigned nn,unsigned at_ms){
    SpPreviewVisualSnapshot s;run(preset,e,ne,n,nn,at_ms,&s);
    SpPreviewNativeView v;SpP6MenuView m;memset(&m,0,sizeof m);uint8_t f[1024];
    const SpPreviewVisualSnapshot *sp=s.sequence?&s:NULL;
    for(unsigned k=0;k<=ne;++k){
        view_for(&v,preset,page,e,k,sp);
        if(!sp_p6_view_render(&v,sp,&m,f)){printf("REJECT %s\n",name);exit(4);}
    }
    dump(name,f);
    printf("  t=%ums seq=%u flags=%u voices=%u held=%04x peak=%u stage=%u/%u/%u/%u env=%u/%u/%u/%u\n",at_ms,s.sequence,s.flags,s.active_voices,
        s.held_pad_mask,s.peak_i16,s.envelope_stage[0],s.envelope_stage[1],s.envelope_stage[2],s.envelope_stage[3],
        s.envelope[0],s.envelope[1],s.envelope[2],s.envelope[3]);
}
/* Synth level: move the real volume state to step and start its on-screen indication. */
static unsigned volume_now=SP_P6_VOLUME_DEFAULT;
static void volume_to(unsigned step){
    while(volume_now!=step){int d=(int)step-(int)volume_now;if(d>4)d=4;if(d<-4)d=-4;volume_now=sp_p6_volume_step(d);}
}
/* Let the indication time out the way the audio owner does (HUD_FRAMES of rendered audio). */
static void volume_hud_off(void){
    int16_t b[128]={0};uint32_t step;
    for(unsigned i=0;i<2000 && sp_p6_volume_hud(&step);++i)sp_p6_volume_apply(b,64);
}
static void rec(const char *name,uint32_t phase,uint32_t pad,uint64_t frames){
    SpP6RecModalView m;memset(&m,0,sizeof m);m.modal=1;
    m.session.phase=phase;m.session.bank=0;m.session.pad=pad;m.session.destination_valid=pad<16;
    m.session.empty_mask16=0xFFF4u;m.session.occupied_mask16=0x000Bu;m.session.frames=frames;
    if(phase>=SP_P6_REC_RECORDING)m.session.take_token=1;
    uint8_t f[1024];if(!sp_p6_rec_modal_render(&m,f)){printf("REJECT %s\n",name);exit(4);}
    dump(name,f);
}
static void pattern(const char *name,uint32_t current,uint32_t next){
    pattern_state=(SpP6PatternTransportView){0,0x003Fu,current,next,0};
    uint8_t f[1024];memset(f,0,sizeof f);
    if(!sp_p6_pattern_transport_v552_draw(f)){printf("REJECT %s\n",name);exit(4);}
    dump(name,f);
}
#define N(x) (sizeof(x)/sizeof((x)[0]))
int main(int argc,char **argv){
    if(argc<2)return 2;snprintf(outdir,sizeof outdir,"%s",argv[1]);
    enum{TONE,OSC,AMP,MOD};
    static const Note pad7[]={{7,0,3000}};
    shot("scope-1",6,TONE,NULL,0,pad7,1,2500);
    shot("scope-2",6,TONE,NULL,0,pad7,1,3200);
    shot("scope-3",6,TONE,NULL,0,pad7,1,3700);
    shot("scope-4",6,TONE,NULL,0,pad7,1,4200);
    shot("scope-5",6,TONE,NULL,0,pad7,1,4500);
    shot("scope-6",6,TONE,NULL,0,pad7,1,6000);
    shot("amp-1",6,AMP,NULL,0,pad7,1,400);
    shot("amp-2",6,AMP,NULL,0,pad7,1,1100);
    shot("amp-3",6,AMP,NULL,0,pad7,1,2600);
    shot("amp-4",6,AMP,NULL,0,pad7,1,3800);
    static const Note held[]={{7,0,9000}};
    static const Edit det64[]={{SP_PREVIEW_PARAM_OSC_MIX,2048},{SP_PREVIEW_PARAM_DETUNE,2064}};
    char name[32];
    for(unsigned i=0;i<6;++i){snprintf(name,sizeof name,"detune-%u",i+1);shot(name,0,OSC,det64,N(det64),held,1,1000+i*44);}
    static const Edit mix0[]={{SP_PREVIEW_PARAM_OSC_MIX,0}};
    static const Edit mix50[]={{SP_PREVIEW_PARAM_OSC_MIX,2048}};
    static const Edit mix100[]={{SP_PREVIEW_PARAM_OSC_MIX,4095}};
    shot("mix-1",13,OSC,mix0,N(mix0),held,1,1000);
    shot("mix-2",13,OSC,mix50,N(mix50),held,1,1000);
    shot("mix-3",13,OSC,mix100,N(mix100),held,1,1000);
    static const Edit pw10[]={{SP_PREVIEW_PARAM_PULSE_WIDTH,0}};
    static const Edit pw50[]={{SP_PREVIEW_PARAM_PULSE_WIDTH,2048}};
    static const Edit pw90[]={{SP_PREVIEW_PARAM_PULSE_WIDTH,4095}};
    static const Note acid[]={{0,0,9000}};
    shot("pw-1",3,OSC,pw10,N(pw10),acid,1,600);
    shot("pw-2",3,OSC,pw50,N(pw50),acid,1,600);
    shot("pw-3",3,OSC,pw90,N(pw90),acid,1,600);
    shot("pwlock-1",0,OSC,NULL,0,held,1,600);
    shot("pwlock-2",1,OSC,NULL,0,held,1,600);
    shot("pwlock-3",4,OSC,NULL,0,held,1,600);
    /* Sixteen sounds: VALUE picks the sound, pads play it. */
    static const Note pad0[]={{0,0,9000}},pad2[]={{2,0,9000}},pad9[]={{9,0,9000}};
    static const Note chord[]={{0,0,9000},{4,0,9000},{7,0,9000}};
    shot("sounds-1",0,TONE,NULL,0,pad0,1,600);
    shot("sounds-2",4,TONE,NULL,0,chord,3,700);
    shot("sounds-3",3,TONE,NULL,0,pad2,1,500);
    shot("sounds-4",6,TONE,NULL,0,pad7,1,1500);
    shot("sounds-5",13,TONE,NULL,0,pad9,1,600);
    shot("sounds-6",9,TONE,NULL,0,pad0,1,500);
    /* Pages: VALUE click steps TONE, OSC, AMP, MOD with a chord held. */
    shot("pages-1",4,TONE,NULL,0,chord,3,1200);
    shot("pages-2",4,OSC,NULL,0,chord,3,1200);
    shot("pages-3",4,AMP,NULL,0,chord,3,1200);
    shot("pages-4",4,MOD,NULL,0,chord,3,1200);
    /* VOICE: the same chord in POLY4, then in MONO. */
    shot("voice-1",4,TONE,NULL,0,chord,3,900);
    mono_override=1;shot("voice-2",4,TONE,NULL,0,chord,3,900);mono_override=-1;
    /* Fixed velocity: Pluck hit on four pads in turn; the synth voice takes no velocity. */
    static const Note hits[]={{0,0,150},{4,600,750},{7,1200,1350},{9,1800,1950}};
    shot("velocity-1",5,TONE,NULL,0,hits,4,120);
    shot("velocity-2",5,TONE,NULL,0,hits,4,720);
    shot("velocity-3",5,TONE,NULL,0,hits,4,1320);
    shot("velocity-4",5,TONE,NULL,0,hits,4,1920);
    shot("velocity-5",5,TONE,NULL,0,hits,4,3400);
    /* Patterns: openSynth's chooser (bank A, six patterns), then the play page over the pattern. */
    pattern("patterns-1",UINT32_MAX,UINT32_MAX);
    pattern("patterns-2",2,UINT32_MAX);
    pattern("patterns-3",2,5);
    shot("patterns-4",4,TONE,NULL,0,chord,3,700);
    /* Record to a pad: the REC modal from prompt to SAVED (pad 3 of bank A). */
    rec("record-1",SP_P6_REC_CHOOSE,UINT32_MAX,0);
    rec("record-2",SP_P6_REC_ARMED,2,0);
    rec("record-3",SP_P6_REC_RECORDING,2,48000);
    rec("record-4",SP_P6_REC_RECORDING,2,144000);
    rec("record-5",SP_P6_REC_RECORDING,2,240000);
    rec("record-6",SP_P6_REC_SAVED,2,240000);
    /* Synth level last: SHIFT+VALUE steps the level; the footer shows VOL and its bar. */
    static const unsigned level[]={22,18,14,18,22,26};
    shot("level-1",4,TONE,NULL,0,pad0,1,800);
    for(unsigned i=0;i<N(level);++i){volume_to(level[i]);snprintf(name,sizeof name,"level-%u",i+2);shot(name,4,TONE,NULL,0,pad0,1,800);}
    volume_to(SP_P6_VOLUME_DEFAULT);volume_hud_off();
    return 0;
}
