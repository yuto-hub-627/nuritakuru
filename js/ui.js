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
// チーム戦ができるか：1人プレイで CPU 2体以上のとき（2体＝1対2、3体＝2対2）
function teamAllowed(){ return UI.setup.kind==='solo' && UI.setup.cpu>=2; }
function renderRule(){
  const s = UI.setup;
  if(!teamAllowed()) s.rule='ffa';
  $('ruleTag').textContent = s.kind==='local' ? 'LOCAL 2P' : `SOLO ・ CPU ${s.cpu}`;
  const teamBtn = document.querySelector('[data-rule="team"]');
  teamBtn.disabled = !teamAllowed();
  teamBtn.textContent = s.kind==='solo'&&s.cpu===2 ? 'チーム戦（1対2）' : 'チーム戦（2対2）';
  $('ruleNote').textContent = s.kind==='local' ? 'このPCで2人のときは個人戦だけです'
    : s.cpu===1 ? 'チーム戦は CPU 2体以上で遊べます'
    : s.cpu===2 ? 'チーム戦は「あなた vs CPU 2体」になります' : 'チーム戦は「あなた＋CPU vs CPU 2体」になります';
  document.querySelectorAll('[data-rule]').forEach(b=>b.classList.toggle('sel', b.dataset.rule===s.rule));
  document.querySelectorAll('.stage-btn').forEach(b=>{
    const v = b.dataset.stage;
    b.classList.toggle('sel', s.randomStage ? v==='random' : v===String(s.stage));
  });
  const stageName = s.randomStage ? 'ランダム' : STAGE_DATA[s.stage].name;
  const who = s.kind==='local' ? 'P1 vs P2（このPCで2人）' : `あなた＋CPU ${s.cpu}体`;
  $('ruleSummary').textContent = `${who} ／ ${s.rule==='team'?'チーム戦':'個人戦'} ／ ステージ：${stageName}`;
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
  // スタート地点（四隅）
  SPAWNS.forEach((sp,i)=>{ c.fillStyle=INKC[i+1]; c.fillRect((sp.x-1)*s,(sp.y-1)*s,s*3,s*3); });
}

// =====================================================
//  ブキ選択
// =====================================================
// ブキの並び（最後は「ランダム」）
const WEAPON_ITEMS = WEAPONS.map(w=>w.id).concat(['random']);
UI.wpick  = {1:0, 2:0};   // 選んでいるブキの番号
UI.wangle = {1:0, 2:0};   // リールの角度（度）。何周しても割り算しない値
UI.wvel   = {1:0, 2:0};   // 回る速さ（度/ミリ秒）。慣性で少しずつ遅くなる
function itemName(id){ return id==='random' ? 'ランダム' : WNAME[id]; }
// ブキのイラスト（assets/weapons/<ブキ>-<1:ピンク|2:緑>.png）。まだ無いブキは絵文字のまま
const WEAPON_ART = ['shooter','charger','bomb','roller','spinner','eel','tornado','mine','curling','tackle','sensui'];
function weaponArt(id,pn){ return WEAPON_ART.includes(id) ? `assets/weapons/${id}-${pn}.png` : null; }
// 色番号ごとのイラスト。黄色・青はイラストが無いので、ピンク・緑の絵の色相をずらして使う
const ART_BASE = [null,1,2,1,2];
const ART_FILTER = [null,'','','hue-rotate(85deg) saturate(1.2)','hue-rotate(70deg)'];
function artTag(id,color,cls){
  const src = weaponArt(id, ART_BASE[color]);
  if(!src) return `<span class="${cls}-emoji">${WICON[id]}</span>`;
  const f = ART_FILTER[color];
  return `<img class="${cls}" src="${src}" alt=""${f?` style="filter:${f}"`:''}>`;
}
function itemIcon(id){ return id==='random' ? '?' : WICON[id]; }
function itemDesc(id){ return id==='random' ? '11種類からおまかせ' : WEAPONS.find(w=>w.id===id).desc; }

// 3D のリール：カードを円柱のまわりに並べ、円柱ごと回す
const REEL_R = 470;
const STEP_DEG = 360 / WEAPON_ITEMS.length; // カード1枚ぶんの角度
// 慣性（スライドすると、最初は速く、だんだん遅くなって止まる）
const WHEEL_GAIN = 0.0012;   // ホイール 1px あたりに足す速さ
const DRAG_DEG_PER_PX = STEP_DEG / 220; // ドラッグ 220px でカード1枚
const MAX_VEL  = 1.1;        // いちばん速いとき（度/ミリ秒）
const FRICTION = 0.93;       // 1フレームごとに速さに掛ける値（小さいほど早く止まる）
const STOP_VEL = 0.02;       // これより遅くなったら、近いカードにピタッと止める
// 止まり方：小さく動いたときはそのまま止める。大きく回ったときだけ少し行きすぎて戻る（オーバーシュート）
const EASE_PLAIN  = 'transform .7s cubic-bezier(.12,.8,.25,1)';
const EASE_BOUNCE = 'transform .8s cubic-bezier(.18,.9,.28,1.22)';
const BIG_MOVE_CARDS = 3;    // これ以上の枚数を動いたら「大きい動き」
UI.wtravel = {1:0, 2:0};     // 今回の回転で動いた角度

function stepWeapon(pn,d){
  UI.wvel[pn] = 0;
  UI.wangle[pn] = (Math.round(UI.wangle[pn]/STEP_DEG)+d)*STEP_DEG;
  setDrum(pn, Math.abs(d)>=BIG_MOVE_CARDS ? 'bounce' : 'plain');
}
function reelRow(pn){ return $('weaponCols').querySelector(`.wslot-row[data-pn="${pn}"]`); }
// リールの角度を画面に反映。mode：false=すぐ反映／'plain'=なめらかに止まる／'bounce'=少し行きすぎて戻る
function setDrum(pn, mode){
  const row = reelRow(pn); if(!row) return;
  const drum = row.querySelector('.wdrum');
  drum.style.transition = mode==='bounce' ? EASE_BOUNCE : mode ? EASE_PLAIN : 'none';
  drum.style.transform = `translateZ(-${REEL_R}px) rotateY(${-UI.wangle[pn]}deg)`;
  highlightReel(pn);
}
// いちばん手前のカードを「選択中」にする（回っている途中でも切り替わる）
function highlightReel(pn, force){
  const n = WEAPON_ITEMS.length;
  const idx = ((Math.round(UI.wangle[pn]/STEP_DEG)%n)+n)%n;
  if(idx===UI.wpick[pn] && !force) return;
  UI.wpick[pn] = idx;
  const row = reelRow(pn); if(!row) return;
  row.querySelectorAll('.wcard').forEach(c=>{
    const on = +c.dataset.i===idx;
    c.classList.toggle('center', on);
    c.style.transform = `rotateY(${c.dataset.i*STEP_DEG}deg) translateZ(${REEL_R+(on?40:0)}px)`+(on?' scale(1.08)':'');
  });
  const local = UI.setup.kind==='local';
  $('weaponSummary').textContent = `${local?'P1':'あなた'}：${itemName(WEAPON_ITEMS[UI.wpick[1]])} ／ ${local?'P2':'CPU'}：${itemName(WEAPON_ITEMS[UI.wpick[2]])}`;
}
// 慣性で回すループ
let reelRaf = 0, reelLast = 0;
function kickReel(pn, addVel){
  if(!UI.wvel[pn]) UI.wtravel[pn] = 0;
  UI.wvel[pn] = Math.max(-MAX_VEL, Math.min(MAX_VEL, UI.wvel[pn] + addVel));
  if(!reelRaf){ reelLast = performance.now(); reelRaf = requestAnimationFrame(reelTick); }
}
function reelTick(now){
  const dt = Math.min(50, now - reelLast); reelLast = now;
  let moving = false;
  [1,2].forEach(pn=>{
    const v = UI.wvel[pn];
    if(!v) return;
    UI.wangle[pn] += v*dt;
    UI.wtravel[pn] += Math.abs(v*dt);
    UI.wvel[pn] = v*Math.pow(FRICTION, dt/16.67);
    if(Math.abs(UI.wvel[pn]) < STOP_VEL){
      UI.wvel[pn] = 0;
      // 回っていた向きの先のカードで止める（逆戻りしないように）
      const pos = UI.wangle[pn]/STEP_DEG;
      UI.wangle[pn] = (v>0 ? Math.ceil(pos-.35) : Math.floor(pos+.35))*STEP_DEG;
      setDrum(pn, UI.wtravel[pn] >= BIG_MOVE_CARDS*STEP_DEG ? 'bounce' : 'plain');
    } else {
      setDrum(pn, false);
      moving = true;
    }
  });
  reelRaf = moving ? requestAnimationFrame(reelTick) : 0;
}

function renderWeapons(){
  const local = UI.setup.kind==='local';
  const box = $('weaponCols'); box.innerHTML='';
  [
    {pn:1, label: local?'P1':'あなた', keys:'<kbd>A</kbd><kbd>D</kbd> かスライド'},
    {pn:2, label: local?'P2':(UI.setup.cpu>1?`CPU ×${UI.setup.cpu}`:'CPU'),    keys:'<kbd>←</kbd><kbd>→</kbd> かスライド'},
  ].forEach(p=>{
    const row = document.createElement('div');
    row.className = `wslot-row c${p.pn}`; row.dataset.pn = p.pn;
    row.innerHTML = `<div class="wslot-label"><span class="player-badge c${p.pn}">${p.label}</span><span class="keys key-hint">${p.keys}</span></div>
      <button class="wslot-arrow" type="button" aria-label="前のブキ"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l-8 8 8 8"/></svg></button>
      <div class="wreel"><div class="wdrum"></div></div>
      <button class="wslot-arrow" type="button" aria-label="次のブキ"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4l8 8-8 8"/></svg></button>`;
    const [prev,next] = row.querySelectorAll('.wslot-arrow');
    prev.addEventListener('click',()=>stepWeapon(p.pn,-1));
    next.addEventListener('click',()=>stepWeapon(p.pn,1));
    const reel = row.querySelector('.wreel');
    const drum = row.querySelector('.wdrum');
    let dragged = false;
    WEAPON_ITEMS.forEach((id,i)=>{
      const card = document.createElement('button');
      card.type='button'; card.className='wcard'; card.dataset.i=i;
      card.style.transform = `rotateY(${i*STEP_DEG}deg) translateZ(${REEL_R}px)`;
      const art = weaponArt(id,p.pn);
      card.innerHTML = art
        ? `<img class="wart" src="${art}" alt="" draggable="false"><span class="wd">${itemDesc(id)}</span>`
        : `<span class="wi">${itemIcon(id)}</span><span class="wn">${itemName(id)}</span><span class="wd">${itemDesc(id)}</span>`;
      card.setAttribute('aria-label', itemName(id));
      card.addEventListener('click',()=>{
        if(dragged) return; // ドラッグのあとのクリックは無視
        const n = WEAPON_ITEMS.length;
        let d = (i - UI.wpick[p.pn] + n) % n; if(d > n/2) d -= n;
        if(d) stepWeapon(p.pn, d);
      });
      drum.appendChild(card);
    });
    // ホイール・トラックパッドのスライド：動かした量だけ勢いを足す
    reel.addEventListener('wheel',e=>{
      e.preventDefault();
      let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if(e.deltaMode===1) d *= 33;
      kickReel(p.pn, d*WHEEL_GAIN);
    },{passive:false});
    // マウスでつかんで横にドラッグ：離したときの速さで回り続ける
    let dragX = null, lastX = 0, lastT = 0, dragVel = 0;
    reel.addEventListener('pointerdown',e=>{
      dragX = e.clientX; lastX = e.clientX; lastT = performance.now(); dragVel = 0; dragged = false;
      UI.wvel[p.pn] = 0;
      reel.setPointerCapture(e.pointerId);
    });
    reel.addEventListener('pointermove',e=>{
      if(dragX===null) return;
      const now = performance.now(), dx = e.clientX - lastX;
      if(Math.abs(e.clientX - dragX) > 6) dragged = true;
      UI.wangle[p.pn] -= dx*DRAG_DEG_PER_PX;
      if(now > lastT) dragVel = (-dx*DRAG_DEG_PER_PX)/(now - lastT);
      lastX = e.clientX; lastT = now;
      setDrum(p.pn, false);
    });
    const endDrag = ()=>{
      if(dragX===null) return;
      dragX = null;
      if(performance.now() - lastT > 80) dragVel = 0; // 止めてから離したら勢いなし
      if(dragged) kickReel(p.pn, dragVel);
      if(!dragged || !UI.wvel[p.pn]){ UI.wangle[p.pn] = Math.round(UI.wangle[p.pn]/STEP_DEG)*STEP_DEG; setDrum(p.pn, 'plain'); }
      setTimeout(()=>{ dragged = false; }, 0);
    };
    reel.addEventListener('pointerup',endDrag);
    reel.addEventListener('pointercancel',endDrag);
    box.appendChild(row);
    UI.wangle[p.pn] = UI.wpick[p.pn]*STEP_DEG;
    UI.wvel[p.pn] = 0;
    setDrum(p.pn, false);
    highlightReel(p.pn, true);
  });
}
// スタート時に選択を確定（ランダムはここで決める）
function applyWeaponPicks(){
  const pick = pn=>{
    const id = WEAPON_ITEMS[UI.wpick[pn]];
    return id==='random' ? WEAPONS[Math.floor(Math.random()*WEAPONS.length)].id : id;
  };
  w1 = pick(1); w2 = pick(2);
  // 試合に出る人を決める（スタート地点：0=左下 1=右上 2=左上 3=右下）
  const s = UI.setup;
  if(s.kind==='local'){
    matchSlots = [
      {slot:0,color:1,weapon:w1,human:true,keys:K1,name:'P1'},
      {slot:1,color:2,weapon:w2,human:true,keys:K2,name:'P2'},
    ];
    return;
  }
  const cpuWeapon = ()=> WEAPON_ITEMS[UI.wpick[2]]==='random' ? pick(2) : w2; // ランダムなら CPU ごとに選び直す
  const name = i => s.cpu===1 ? 'CPU' : `CPU${i}`;
  if(s.rule==='team' && s.cpu===3){
    matchSlots = [
      {slot:0,color:1,weapon:w1,human:true,keys:K1,name:'あなた'},
      {slot:2,color:1,weapon:cpuWeapon(),name:name(1)},
      {slot:1,color:2,weapon:cpuWeapon(),name:name(2)},
      {slot:3,color:2,weapon:cpuWeapon(),name:name(3)},
    ];
  } else if(s.rule==='team' && s.cpu===2){
    matchSlots = [
      {slot:0,color:1,weapon:w1,human:true,keys:K1,name:'あなた'},
      {slot:1,color:2,weapon:cpuWeapon(),name:name(1)},
      {slot:3,color:2,weapon:cpuWeapon(),name:name(2)},
    ];
  } else {
    matchSlots = [{slot:0,color:1,weapon:w1,human:true,keys:K1,name:'あなた'}];
    for(let i=1;i<=s.cpu;i++) matchSlots.push({slot:i,color:i+1,weapon:i===1?w2:cpuWeapon(),name:name(i)});
  }
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
// 「陣営」＝同じ色の人たち（個人戦は1人ずつ、チーム戦は2チーム）
function sides(){
  const map = new Map();
  players.forEach(p=>{ if(!map.has(p.color)) map.set(p.color,[]); map.get(p.color).push(p); });
  return [...map.entries()].map(([color,members])=>({color,members}));
}
function sideName(sd){
  if(sd.members.length===1) return sd.members[0].name;
  return sd.members.some(p=>p.human) ? 'あなたのチーム' : '相手チーム';
}
// HUD を作り直す（試合の始めに呼ばれる）
function updateWeaponUI(){
  const list = sides();
  const half = Math.ceil(list.length/2);
  [['hudLeft',list.slice(0,half)],['hudRight',list.slice(half)]].forEach(([id,arr])=>{
    $(id).innerHTML = arr.map(sd=>`
      <div class="pcard" data-color="${sd.color}">
        <div class="pc-top"><span class="sw" style="background:${INKC[sd.color]}"></span><span class="who">${sideName(sd)}</span><span class="score" data-score="${sd.color}">0%</span></div>
        ${sd.members.map(p=>`<div class="pc-member" data-slot="${p.slot}">${artTag(p.weapon,p.color,'hud-art')}<span class="mname">${sd.members.length>1?p.name:WNAME[p.weapon]}</span><div class="ink-bar"><div class="ink-fill" style="background:${INKC[p.color]}"></div></div></div>`).join('')}
      </div>`).join('');
  });
}
// 色ごとの塗りマス数
function countByColor(){
  const n=[0,0,0,0,0];
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    if(walls.has(ky(c,r))||stationSet.has(ky(c,r))) continue;
    const v=grid[r][c]; if(v>0) n[v]++;
  }
  return n;
}
function updateScores(){
  const n = countByColor(), total = totalPaintable||1;
  document.querySelectorAll('[data-score]').forEach(el=>{ el.textContent = (n[+el.dataset.score]/total*100).toFixed(1)+'%'; });
  return n;
}
function updateInkUI(){
  players.forEach(p=>{
    const row = document.querySelector(`.pc-member[data-slot="${p.slot}"]`); if(!row) return;
    const fill = row.querySelector('.ink-fill');
    fill.style.width = (p.ink/INK_MAX*100).toFixed(1)+'%';
    fill.classList.toggle('full', p.weapon==='tornado' && p.ink>=INK_MAX);
    const charging = (p.chargeHeld||0)>0 || (p.spinnerHeld||0)>0 || (p.sensuiHeld||0)>0;
    row.classList.toggle('charging', charging);
    row.classList.toggle('down', p.respawning);
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
  applyWeaponPicks();
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
  const n = updateScores(); draw();
  playSE('end');
  const total = totalPaintable||1;
  const list = sides().map(sd=>({...sd, cells:n[sd.color]})).sort((a,b)=>b.cells-a.cells);
  const top = list[0], tie = list.length>1 && list[1].cells===top.cells;
  const title = $('resultTitle');
  if(tie) title.textContent = '引き分け！';
  else {
    title.innerHTML = `<span class="who" style="background:${INKC[top.color]}"></span> の勝ち！`;
    title.querySelector('.who').textContent = sideName(top);
  }
  // バーは全員の塗った量の合計を100%として分ける（塗られていない所は出さない）
  const sum = list.reduce((a,b)=>a+b.cells,0);
  $('resultBar').innerHTML = sides().map((sd,i)=>{
    const w = sum ? n[sd.color]/sum*100 : 100/sides().length;
    return `<div style="width:${w}%;background:${INKC[sd.color]};${i?'border-left:3px solid #111;':''}"></div>`;
  }).join('');
  $('resultScores').innerHTML = list.map((sd,rank)=>`
    <div class="rs${!tie&&rank===0?' win':''}">
      <div class="rh"><span class="rank">${rank+1}</span><span class="sw" style="background:${INKC[sd.color]}"></span>${sideName(sd)}</div>
      <div class="rv">${(sd.cells/total*100).toFixed(1)}%</div>
      <div class="rw">${sd.members.map(p=>`<span class="rmem">${artTag(p.weapon,p.color,'res-art')}${sd.members.length>1?p.name+'：':''}${WNAME[p.weapon]}</span>`).join('')}</div>
    </div>`).join('');
  $('resultScores').classList.toggle('many', list.length>2);
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
    if(UI.current==='scr-weapon' && !openModalId()){
      const k = e.key.toLowerCase();
      if(k==='a'){ stepWeapon(1,-1); return; }
      if(k==='d'){ stepWeapon(1,1); return; }
      if(e.key==='ArrowLeft'){ e.preventDefault(); stepWeapon(2,-1); return; }
      if(e.key==='ArrowRight'){ e.preventDefault(); stepWeapon(2,1); return; }
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
