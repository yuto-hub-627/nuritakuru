// =====================================================
//  画面まわり（タイトル〜結果）・入力・HUD
//  ゲーム本体は engine.js、CPU は ai.js
// =====================================================

const $ = id => document.getElementById(id);

// ---------- 入力（キーボード） ----------
const K1 = {up:0,down:0,left:0,right:0,shoot:0};
const K2 = {up:0,down:0,left:0,right:0,shoot:0};
const P1KEYS = {'w':'up','a':'left','s':'down','d':'right',' ':'shoot'};
const P2KEYS = {'ArrowUp':'up','ArrowLeft':'left','ArrowDown':'down','ArrowRight':'right','Enter':'shoot'};

// ---------- 状態 ----------
const UI = {
  current: null,
  history: [],
  setup: { kind:'solo', cpu:1, rule:'ffa', stage:0, randomStage:false },
  room: null,
};

// ---------- 設定（BGM・効果音） ----------
function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem('nuri-settings')||'{}');
    if(typeof s.bgm==='boolean') bgmOn = s.bgm;
    if(typeof s.se==='boolean')  seOn  = s.se;
  }catch(e){}
}
function saveSettings(){
  try{ localStorage.setItem('nuri-settings', JSON.stringify({bgm:bgmOn, se:seOn})); }catch(e){}
}
function renderSettings(){
  document.querySelectorAll('[data-set]').forEach(b=>{
    const on = b.dataset.set==='bgm' ? bgmOn : seOn;
    b.classList.toggle('sel', (b.dataset.val==='1')===on);
  });
}

// =====================================================
//  画面遷移
// =====================================================
function setScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active', s.id===id));
  UI.current = id;
}
function go(id){
  if(UI.current) UI.history.push(UI.current);
  setScreen(id);
  onEnter(id);
}
function goBack(){
  if(!UI.history.length) return;
  const prev = UI.history.pop();
  if(UI.current==='scr-room') UI.room = null;
  setScreen(prev);
  onEnter(prev);
}
function goModeSelect(){
  UI.history = ['scr-title'];
  setScreen('scr-mode');
  onEnter('scr-mode');
}
function onEnter(id){
  if(id==='scr-rule')   renderRule();
  if(id==='scr-weapon') renderWeapons();
  if(id==='scr-lobby')  renderLobby();
  if(id==='scr-room')   renderRoom();
}

// ---------- モーダル ----------
function openModal(id){ $(id).classList.add('open'); }
function closeModal(id){ $(id).classList.remove('open'); }
function openModalId(){ const m=document.querySelector('.modal.open'); return m?m.id:null; }

// =====================================================
//  モード選択
// =====================================================
function bindModeScreen(){
  document.querySelectorAll('[data-cpu]').forEach(b=>{
    b.addEventListener('click',()=>{
      UI.setup.cpu = +b.dataset.cpu;
      document.querySelectorAll('[data-cpu]').forEach(x=>x.classList.toggle('sel', x===b));
    });
  });
  $('btnSolo').addEventListener('click',()=>{ UI.setup.kind='solo'; cpuMode=true; go('scr-rule'); });
  $('btnLocal').addEventListener('click',()=>{ UI.setup.kind='local'; cpuMode=false; go('scr-rule'); });
  $('btnFriendCreate').addEventListener('click',()=>{ UI.room = makeRoom({isPublic:false, isHost:true}); go('scr-room'); });
  $('btnFriendJoin').addEventListener('click',()=>{
    $('joinCode').value=''; $('joinError').textContent='';
    openModal('joinModal'); setTimeout(()=>$('joinCode').focus(),0);
  });
  $('btnOnlineFind').addEventListener('click',()=>go('scr-lobby'));
  $('btnOnlineCreate').addEventListener('click',()=>{ UI.room = makeRoom({isPublic:true, isHost:true}); go('scr-room'); });

  $('joinForm').addEventListener('submit',e=>{
    e.preventDefault();
    const code = $('joinCode').value.trim().toUpperCase();
    if(!/^[A-Z0-9]{6}$/.test(code)){
      $('joinError').textContent='部屋番号は英数字6文字です';
      return;
    }
    closeModal('joinModal');
    UI.room = makeRoom({isPublic:false, isHost:false, code});
    go('scr-room');
  });
}

// =====================================================
//  ルール設定
// =====================================================
function renderRule(){
  const s = UI.setup;
  $('ruleTag').textContent = s.kind==='local' ? 'LOCAL 2P' : `SOLO ・ CPU ${s.cpu}`;
  document.querySelectorAll('[data-rule]').forEach(b=>b.classList.toggle('sel', b.dataset.rule===s.rule));
  document.querySelectorAll('.stage-btn').forEach(b=>{
    const v = b.dataset.stage;
    b.classList.toggle('sel', s.randomStage ? v==='random' : v===String(s.stage));
  });
  const stageName = s.randomStage ? 'ランダム' : STAGE_DATA[s.stage].name;
  const who = s.kind==='local' ? 'P1 vs P2（このPCで2人）' : `あなた vs CPU ${s.cpu}体`;
  $('ruleSummary').textContent = `${who} ／ 個人戦 ／ ステージ：${stageName}`;
}
function buildStageGrid(){
  const grid = $('stageGrid'); grid.innerHTML='';
  STAGE_DATA.forEach((st,i)=>{
    const b = document.createElement('button');
    b.type='button'; b.className='stage-btn'; b.dataset.stage=String(i);
    const cv = document.createElement('canvas');
    cv.width=COLS*6; cv.height=ROWS*6;
    drawStagePreview(cv,i);
    const label = document.createElement('span'); label.textContent = st.name;
    b.append(cv,label);
    b.addEventListener('click',()=>{ UI.setup.stage=i; UI.setup.randomStage=false; renderRule(); });
    grid.appendChild(b);
  });
  const r = document.createElement('button');
  r.type='button'; r.className='stage-btn'; r.dataset.stage='random';
  r.innerHTML='<span class="rnd">?</span><span>ランダム</span>';
  r.addEventListener('click',()=>{ UI.setup.randomStage=true; renderRule(); });
  grid.appendChild(r);
}
// ステージの形を小さく描く（壁とスタート地点だけ）
function drawStagePreview(cv,idx){
  const saved = walls;
  walls = new Set();
  STAGE_DATA[idx].fn();
  const w = walls;
  walls = saved;
  const c = cv.getContext('2d'), s = 6;
  c.fillStyle='#2A2A2A'; c.fillRect(0,0,cv.width,cv.height);
  c.fillStyle=BRICK_HI;
  w.forEach(k=>{ const [x,y]=k.split(',').map(Number); c.fillRect(x*s,y*s,s,s); });
  c.fillStyle=C1; c.fillRect((RP1.x-1)*s,(RP1.y-1)*s,s*3,s*3);
  c.fillStyle=C2; c.fillRect((RP2.x-1)*s,(RP2.y-1)*s,s*3,s*3);
}

// =====================================================
//  ブキ選択
// =====================================================
function renderWeapons(){
  const local = UI.setup.kind==='local';
  const cols = $('weaponCols'); cols.innerHTML='';
  const players = [
    {pn:1, label: local?'P1':'あなた', keys:'W A S D で移動 / Space で攻撃'},
    {pn:2, label: local?'P2':'CPU',    keys: local?'↑ ← ↓ → で移動 / Enter で攻撃':'CPU のブキ'},
  ];
  players.forEach(p=>{
    const col = document.createElement('div');
    col.className = `weapon-col c${p.pn}`;
    col.innerHTML = `<div class="weapon-col-head"><span class="player-badge c${p.pn}">${p.label}</span><span class="keys">${p.keys}</span></div>`;
    const grid = document.createElement('div'); grid.className='weapon-grid';
    WEAPONS.forEach(wp=>{
      const b = document.createElement('button');
      b.type='button'; b.className='weapon-btn';
      const cur = p.pn===1?w1:w2;
      if(cur===wp.id) b.classList.add('sel');
      b.innerHTML = `<span class="wi">${WICON[wp.id]}</span><span class="wn">${WNAME[wp.id]}</span><span class="wd">${wp.desc}</span>`;
      b.addEventListener('click',()=>{ if(p.pn===1) w1=wp.id; else w2=wp.id; renderWeapons(); });
      grid.appendChild(b);
    });
    const r = document.createElement('button');
    r.type='button'; r.className='weapon-btn';
    r.innerHTML = '<span class="wi">?</span><span class="wn">ランダム</span><span class="wd">12種類からおまかせ</span>';
    r.addEventListener('click',()=>{
      const id = WEAPONS[Math.floor(Math.random()*WEAPONS.length)].id;
      if(p.pn===1) w1=id; else w2=id;
      renderWeapons();
    });
    grid.appendChild(r);
    col.appendChild(grid);
    cols.appendChild(col);
  });
  $('weaponSummary').textContent = `${local?'P1':'あなた'}：${WNAME[w1]} ／ ${local?'P2':'CPU'}：${WNAME[w2]}`;
}

// =====================================================
//  オンライン（見た目だけのサンプル）
// =====================================================
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(){ let s=''; for(let i=0;i<6;i++) s+=CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]; return s; }

const SAMPLE_ROOM_NAMES = ['ぬりぬり部屋','初心者歓迎','ローラー縛り','まったり4人戦','チーム戦やろう','深夜のヌリタクル','ガチ勢あつまれ','1戦だけ'];
function makeSampleRooms(){
  const names = SAMPLE_ROOM_NAMES.slice().sort(()=>Math.random()-.5).slice(0,6);
  return names.map(n=>({
    name:n, code:randomCode(),
    rule: Math.random()<.5?'ffa':'team',
    players: 1+Math.floor(Math.random()*4),
    stage: Math.floor(Math.random()*STAGE_DATA.length),
  }));
}
function renderLobby(){
  const list = $('lobbyList'); list.innerHTML='';
  makeSampleRooms().forEach(r=>{
    const row = document.createElement('div'); row.className='room-row';
    const full = r.players>=4;
    row.innerHTML = `
      <div><div class="rn"></div><div class="rc">#${r.code} ・ サンプル</div></div>
      <div class="meta">${r.rule==='team'?'チーム戦':'個人戦'}</div>
      <div class="meta ${full?'full':''}">${r.players} / 4 人${full?'（満員）':''}</div>
      <div class="meta">${STAGE_DATA[r.stage].name}</div>`;
    row.querySelector('.rn').textContent = r.name;
    const b = document.createElement('button');
    b.type='button'; b.className='btn'+(full?'':' btn-primary'); b.textContent = full?'満員':'入る';
    b.disabled = full;
    b.addEventListener('click',()=>{
      UI.room = makeRoom({isPublic:true, isHost:false, code:r.code, rule:r.rule, stage:r.stage, others:r.players});
      go('scr-room');
    });
    row.appendChild(b);
    list.appendChild(row);
  });
}

function makeRoom({isPublic,isHost,code,rule='ffa',stage=0,others=1}){
  return { isPublic, isHost, code: code||randomCode(), rule, stage, others: isHost?0:others };
}
function renderRoom(){
  const r = UI.room; if(!r) return;
  $('roomTitle').textContent = r.isHost ? '待合室（あなたがホスト）' : '待合室';
  $('roomTag').textContent = r.isPublic ? 'PUBLIC ROOM' : 'PRIVATE ROOM';
  $('roomCode').textContent = r.code;
  $('roomVis').textContent = r.isPublic
    ? 'オンラインの部屋一覧に表示されます。だれでも入れます。'
    : '一覧には出ません。部屋番号を知っている人だけが入れます。';
  // 参加者
  const slots = [];
  const colors = ['var(--p1)','var(--p2)','#FFE14D','#7FB2FF'];
  if(r.isHost){
    slots.push({name:'あなた', st:'準備OK', host:true});
  } else {
    slots.push({name:'ホスト', st:'準備OK', host:true});
    for(let i=1;i<r.others;i++) slots.push({name:`プレイヤー${i+1}`, st:'準備OK'});
    slots.push({name:'あなた', st:'準備OK'});
  }
  const box = $('roomSlots'); box.innerHTML='';
  for(let i=0;i<4;i++){
    const s = slots[i];
    const d = document.createElement('div');
    if(s){
      d.className='slot';
      d.innerHTML = `<span class="sw" style="background:${colors[i]}"></span><div><div class="nm"></div><div class="st">${s.st}</div></div>${s.host?'<span class="host">HOST</span>':''}`;
      d.querySelector('.nm').textContent = s.name;
    } else {
      d.className='slot empty';
      d.textContent='参加を待っています…';
    }
    box.appendChild(d);
  }
  $('roomCount').textContent = `${Math.min(4,slots.length)} / 4 人`;
  // ルール（ホストだけ変えられる）
  document.querySelectorAll('[data-room-rule]').forEach(b=>{
    b.classList.toggle('sel', b.dataset.roomRule===r.rule);
    b.disabled = !r.isHost;
  });
  const sel = $('roomStage');
  if(!sel.options.length){
    STAGE_DATA.forEach((s,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=s.name; sel.appendChild(o); });
  }
  sel.value = String(r.stage);
  sel.disabled = !r.isHost;
  $('roomHostNote').textContent = r.isHost ? '' : '（ホストだけが変えられます）';
}
function bindRoomScreen(){
  document.querySelectorAll('[data-room-rule]').forEach(b=>{
    b.addEventListener('click',()=>{ if(UI.room){ UI.room.rule=b.dataset.roomRule; renderRoom(); } });
  });
  $('roomStage').addEventListener('change',e=>{ if(UI.room) UI.room.stage=+e.target.value; });
  $('btnCopyCode').addEventListener('click',async()=>{
    const btn = $('btnCopyCode');
    try{ await navigator.clipboard.writeText(UI.room.code); btn.textContent='コピーしました'; }
    catch(e){ btn.textContent='コピーできませんでした'; }
    setTimeout(()=>{ btn.textContent='番号をコピー'; },1500);
  });
  $('btnLobbyRefresh').addEventListener('click',renderLobby);
  $('btnLobbyCreate').addEventListener('click',()=>{ UI.room = makeRoom({isPublic:true, isHost:true}); go('scr-room'); });
}

// =====================================================
//  HUD（engine.js から呼ばれる）
// =====================================================
function layout(){
  const wrap = $('boardWrap');
  let W = wrap.clientWidth - 48 - 20;
  let H = wrap.clientHeight - 36 - 20;
  if(W<=0||H<=0){ W=900; H=540; }
  CELL = Math.max(8, Math.floor(Math.min(W/COLS, H/ROWS)));
  canvas.width = CELL*COLS; canvas.height = CELL*ROWS;
}
function updateWeaponUI(){
  const local = UI.setup.kind==='local';
  $('who1').textContent = local ? 'P1' : 'YOU';
  $('who2').textContent = local ? 'P2' : 'CPU';
  $('wpn1').textContent = `${WICON[w1]} ${WNAME[w1]}`;
  $('wpn2').textContent = `${WICON[w2]} ${WNAME[w2]}`;
}
function updateScores(){
  let s1=0, s2=0;
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    if(walls.has(ky(c,r))||stationSet.has(ky(c,r))) continue;
    if(grid[r][c]===1) s1++; else if(grid[r][c]===2) s2++;
  }
  const total = totalPaintable||1;
  const pct1 = (s1/total*100).toFixed(1);
  const pct2 = (s2/total*100).toFixed(1);
  $('score1').textContent = pct1+'%';
  $('score2').textContent = pct2+'%';
  return {s1,s2,pct1,pct2};
}
function updateInkUI(){
  [[p1,1],[p2,2]].forEach(([p,n])=>{
    if(!p) return;
    const fill = $('ink'+n);
    fill.style.width = (p.ink/INK_MAX*100).toFixed(1)+'%';
    fill.classList.toggle('full', p.weapon==='tornado' && p.ink>=INK_MAX);
    const charging = (p.chargeHeld||0)>0 || (p.spinnerHeld||0)>0 || (p.sensuiHeld||0)>0;
    $('pcard'+n).classList.toggle('charging', charging);
  });
}

// =====================================================
//  試合の流れ
// =====================================================
function startTimer(){
  timer = 100;
  clearInterval(timerInt);
  timerInt = setInterval(()=>{
    if(isPaused) return;
    timer--;
    const tb = $('timerBox');
    tb.textContent = timer;
    if(timer<=10){ tb.classList.add('warning'); playSE('tick'); }
    if(timer<=0) endGame();
  },1000);
}

function doCountdown(cb){
  let count = 3;
  const wrap = $('countdown'), num = $('cdNum');
  wrap.style.display='flex';
  function pop(text,isGo){
    num.textContent = text;
    num.classList.toggle('go', !!isGo);
    num.style.animation='none'; void num.offsetWidth; num.style.animation='';
  }
  function tick(){
    if(UI.current!=='scr-game'){ wrap.style.display='none'; return; }
    if(count>0){ pop(count); playSE('countdown'); count--; setTimeout(tick,1000); }
    else{
      pop('GO!',true); playSE('go');
      setTimeout(()=>{ wrap.style.display='none'; if(UI.current==='scr-game') cb(); },700);
    }
  }
  tick();
}

function stopMatch(){
  running=false; isPaused=false;
  clearInterval(timerInt); cancelAnimationFrame(raf);
  stopBGM();
  Object.keys(K1).forEach(k=>{K1[k]=0;K2[k]=0;});
  $('countdown').style.display='none';
}

function startGame(){
  initAudio();
  stopMatch();
  closeModal('resultModal'); closeModal('pauseModal');
  if(UI.current!=='scr-game') go('scr-game');
  if(document.activeElement) document.activeElement.blur();
  if(UI.setup.randomStage) currentStage = Math.floor(Math.random()*STAGE_DATA.length);
  else currentStage = UI.setup.stage;
  const local = UI.setup.kind==='local';
  $('keyHint1').innerHTML = `${local?'P1':'あなた'}：<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動 <kbd>Space</kbd> 攻撃`;
  $('keyHint2').innerHTML = local ? 'P2：<kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> 移動 <kbd>Enter</kbd> 攻撃' : '';
  initGame();
  const tb = $('timerBox'); tb.textContent='100'; tb.classList.remove('warning');
  $('stageBox').textContent = STAGE_DATA[currentStage].name;
  draw();
  doCountdown(()=>{
    running=true; lt=performance.now(); btick=0;
    startTimer(); startBGM();
    raf=requestAnimationFrame(loop);
  });
}

function togglePause(){
  if(!running) return;
  isPaused = !isPaused;
  if(isPaused){ openModal('pauseModal'); }
  else{ closeModal('pauseModal'); lt=performance.now(); }
  Object.keys(K1).forEach(k=>{K1[k]=0;K2[k]=0;});
}
function quitMatch(){
  stopMatch();
  closeModal('pauseModal');
  goBack(); // ブキ選択へ
}

function endGame(){
  stopMatch();
  const {s1,s2,pct1,pct2} = updateScores(); draw();
  playSE('end');
  const local = UI.setup.kind==='local';
  const n1 = local?'P1':'あなた', n2 = local?'P2':'CPU';
  const title = $('resultTitle');
  if(s1>s2)      title.innerHTML = `<span class="who" style="background:var(--p1)"></span> の勝ち！`;
  else if(s2>s1) title.innerHTML = `<span class="who" style="background:var(--p2)"></span> の勝ち！`;
  else           title.textContent = '引き分け！';
  const who = title.querySelector('.who'); if(who) who.textContent = s1>s2?n1:n2;

  const total = totalPaintable||1;
  $('resultBar').innerHTML =
    `<div style="width:${s1/total*100}%;background:var(--p1);"></div>`+
    `<div style="flex-grow:1;"></div>`+
    `<div style="width:${s2/total*100}%;background:var(--p2);border-left:3px solid #111;"></div>`;
  $('resultScores').innerHTML = [
    {n:n1,c:'var(--p1)',p:pct1,w:w1,win:s1>s2},
    {n:n2,c:'var(--p2)',p:pct2,w:w2,win:s2>s1},
  ].map(x=>`<div class="rs${x.win?' win':''}"><div class="rh"><span class="sw" style="background:${x.c}"></span>${x.n}</div><div class="rv">${x.p}%</div><div class="rw">${WICON[x.w]} ${WNAME[x.w]}</div></div>`).join('');
  $('resultStage').textContent = `ステージ：${STAGE_DATA[currentStage].name}`;
  openModal('resultModal');
}

// =====================================================
//  キー操作
// =====================================================
function bindKeyboard(){
  document.addEventListener('keydown',e=>{
    const inGame = UI.current==='scr-game';
    if(e.key==='Escape'){
      if(inGame){ if(running) togglePause(); return; }
      const m = openModalId();
      if(m){ closeModal(m); return; }
      goBack(); return;
    }
    if(inGame){
      if(!running||isPaused) return;
      const lk = e.key.toLowerCase();
      if(P1KEYS[lk]!==undefined){ e.preventDefault(); K1[P1KEYS[lk]]=1; }
      else if(!cpuMode && P2KEYS[e.key]!==undefined){ e.preventDefault(); K2[P2KEYS[e.key]]=1; }
      return;
    }
    if(UI.current==='scr-title' && !openModalId() && (e.key===' '||e.key==='Enter')){
      e.preventDefault(); initAudio(); go('scr-mode');
    }
  });
  document.addEventListener('keyup',e=>{
    if(UI.current!=='scr-game') return;
    const lk = e.key.toLowerCase();
    if(P1KEYS[lk]!==undefined){ e.preventDefault(); K1[P1KEYS[lk]]=0; }
    else if(P2KEYS[e.key]!==undefined){ e.preventDefault(); K2[P2KEYS[e.key]]=0; }
  });
  window.addEventListener('blur',()=>{ Object.keys(K1).forEach(k=>{K1[k]=0;K2[k]=0;}); });
}

// =====================================================
//  起動
// =====================================================
function isTouchOnly(){
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function boot(){
  if(isTouchOnly()){ setScreen('scr-mobile'); return; }
  loadSettings();
  renderSettings();

  document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',goBack));
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openModal(b.dataset.open)));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.closest('.modal').id)));
  document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{
    if(e.target===m && !['pauseModal','resultModal'].includes(m.id)) closeModal(m.id);
  }));
  document.querySelectorAll('[data-set]').forEach(b=>b.addEventListener('click',()=>{
    const on = b.dataset.val==='1';
    if(b.dataset.set==='bgm'){ bgmOn=on; if(!on) stopBGM(); else if(running) startBGM(); }
    else seOn=on;
    saveSettings(); renderSettings();
  }));

  $('btnPlay').addEventListener('click',()=>{ initAudio(); go('scr-mode'); });
  bindModeScreen();
  bindRoomScreen();
  buildStageGrid();
  document.querySelectorAll('[data-rule]').forEach(b=>b.addEventListener('click',()=>{ UI.setup.rule=b.dataset.rule; renderRule(); }));
  $('btnRuleNext').addEventListener('click',()=>go('scr-weapon'));
  $('btnStart').addEventListener('click',startGame);

  $('pauseBtn').addEventListener('click',togglePause);
  $('btnResume').addEventListener('click',togglePause);
  $('btnQuit').addEventListener('click',quitMatch);
  $('btnAgain').addEventListener('click',startGame);
  $('btnChangeWeapon').addEventListener('click',()=>{ closeModal('resultModal'); goBack(); });
  $('btnToMode').addEventListener('click',()=>{ closeModal('resultModal'); goModeSelect(); });

  bindKeyboard();
  window.addEventListener('resize',()=>{ if(UI.current==='scr-game'){ layout(); draw(); } });

  setScreen('scr-title');
}

boot();
