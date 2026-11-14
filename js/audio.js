// 効果音・BGM（Web Audio）
//  AUDIO
// =====================================================
let bgmOn=true, seOn=true; // せってい画面で切り替え
let audioCtx=null, bgmPlaying=false, bgmNextTime=0, bgmNoteIndex=0, bgmSchedTimer=null;
const BGM_BEAT = 60/150; // 150 BPM in seconds
const BGM_MELODY = [
  [659,.5],[784,.5],[659,.5],[523,.5],
  [587,.5],[698,.5],[587,.5],[493,.5],
  [523,.5],[659,.5],[784,.5],[659,.5],
  [698,1],[0,.5],[523,.5],
  [440,.5],[523,.5],[587,.5],[659,.5],
  [587,.5],[523,.5],[493,.5],[440,.5],
  [392,.5],[493,.5],[587,.5],[523,.5],
  [493,1.5],[0,.5],
];

function initAudio(){
  if(audioCtx) return;
  try{ audioCtx=new(window.AudioContext||window.webkitAudioContext)(); }catch(e){}
}

function playSE(type){
  if(!audioCtx||!seOn) return;
  const t=audioCtx.currentTime;
  function beep(freq,dur,vol,shape='square'){
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type=shape; o.frequency.value=freq;
    g.gain.setValueAtTime(vol,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t+dur+.01);
  }
  switch(type){
    case 'shoot':   beep(660,.08,.06); break;
    case 'bomb':    beep(200,.3,.1); beep(120,.25,.07); break;
    case 'hit': {
      const o=audioCtx.createOscillator(),g=audioCtx.createGain();
      o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(60,t+.4);
      g.gain.setValueAtTime(.1,t); g.gain.exponentialRampToValueAtTime(.001,t+.4);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+.4); break;
    }
    case 'refill':
      [523,659,784].forEach((f,i)=>{
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.type='square'; o.frequency.value=f;
        const st=t+i*.08;
        g.gain.setValueAtTime(0,st); g.gain.linearRampToValueAtTime(.07,st+.03);
        g.gain.exponentialRampToValueAtTime(.001,st+.15);
        o.connect(g); g.connect(audioCtx.destination); o.start(st); o.stop(st+.16);
      }); break;
    case 'tick':    beep(1100,.04,.05,'sine'); break;
    case 'countdown': beep(880,.2,.1); break;
    case 'go':
      [880,1100,1320].forEach((f,i)=>{
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.type='square'; o.frequency.value=f;
        const st=t+i*.09;
        g.gain.setValueAtTime(.1,st); g.gain.exponentialRampToValueAtTime(.001,st+.3);
        o.connect(g); g.connect(audioCtx.destination); o.start(st); o.stop(st+.31);
      }); break;
    case 'end':
      [523,0,659,0,784,659,523].forEach((f,i)=>{
        if(!f) return;
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.type='square'; o.frequency.value=f;
        const st=t+i*.13;
        g.gain.setValueAtTime(.08,st); g.gain.exponentialRampToValueAtTime(.001,st+.2);
        o.connect(g); g.connect(audioCtx.destination); o.start(st); o.stop(st+.21);
      }); break;
  }
}

function startBGM(){
  if(!audioCtx||bgmPlaying||!bgmOn) return;
  bgmPlaying=true; bgmNextTime=audioCtx.currentTime+.1; bgmNoteIndex=0;
  scheduleBGM();
}
function scheduleBGM(){
  if(!bgmPlaying||!audioCtx) return;
  while(bgmNextTime<audioCtx.currentTime+.15){
    const[freq,beats]=BGM_MELODY[bgmNoteIndex%BGM_MELODY.length];
    const dur=beats*BGM_BEAT;
    if(freq>0){
      const o=audioCtx.createOscillator(),g=audioCtx.createGain();
      o.type='square'; o.frequency.value=freq*.5;
      g.gain.setValueAtTime(.025,bgmNextTime);
      g.gain.setValueAtTime(.025,bgmNextTime+dur*.85);
      g.gain.linearRampToValueAtTime(0,bgmNextTime+dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(bgmNextTime); o.stop(bgmNextTime+dur+.01);
    }
    bgmNextTime+=dur; bgmNoteIndex++;
  }
  bgmSchedTimer=setTimeout(scheduleBGM,50);
}
function stopBGM(){ bgmPlaying=false; clearTimeout(bgmSchedTimer); }
