// ヌリタクル ゲーム本体（盤面・ブキ・弾・描画・ループ）
// 画面まわり(DOM)は ui.js、CPU は ai.js

// =====================================================
//  CONFIG
// =====================================================
const COLS = 30, ROWS = 18;
let CELL = 20, BTN_SIZE = 34, FIRE_SIZE = 48;

const RESPAWN_MS  = 2000;
const MOVE_CD     = 120;
const BTICK_MS    = 80;

const INK_MAX  = 100;
const INK_COST = { shooter:6, charger:20, bomb:20, roller:5, spinner:0,
                   eel:12, tornado:5,
                   mine:20, curling:15,
                   tackle:10,
                   sensui:16 };
const INK_REGEN_RATE = 2;
const BOMB_RANGE = 1;
const BOMB_STEPS = 3;

const CHARGER_MIN_RANGE  = 6;
const CHARGER_MAX_RANGE  = 12;
const CHARGER_MAX_CHARGE = 1200;

const WCD   = { shooter:300, charger:200, bomb:1100, roller:0, spinner:0,
                eel:500, tornado:0,
                mine:1200, curling:600,
                tackle:200,
                sensui:800 };
const WICON = { shooter:'🔫', charger:'🎯', bomb:'💣', roller:'🖌️', spinner:'🌀',
                eel:'⚡', tornado:'🌪️',
                mine:'💥', curling:'🎿',
                tackle:'🏃',
                sensui:'🌊' };
const WNAME = { shooter:'シューター', charger:'チャージャー', bomb:'ボム',
                roller:'ローラー', spinner:'スピナー',
                eel:'デンキウナギ', tornado:'タツマキ',
                mine:'マイン', curling:'カーリング',
                tackle:'タックル',
                sensui:'センスイ' };

const SPINNER_SPINUP  = 1500;
const SPINNER_INK_PER_BULLET = 2;
const SPINNER_COOLDOWN = 200;

// スタート地点：0=左下 1=右上 2=左上 3=右下（チーム戦は 0・2 が左チーム、1・3 が右チーム）
const SPAWNS = [ {x:1,y:ROWS-2}, {x:COLS-2,y:1}, {x:1,y:1}, {x:COLS-2,y:ROWS-2} ];
const RP1 = SPAWNS[0], RP2 = SPAWNS[1];


// =====================================================
//  MODE
// =====================================================
let cpuMode = false;

// =====================================================
//  STATE
// =====================================================
let grid=[], walls=new Set(), stationSet=new Set(), inkStations=[];
let bullets=[], fxList=[], mines=[];
let mineChainQueue=[]; // [{x,y,color,owner,delay}] 連鎖爆発キュー
let sensuiWaves=[];    // [{x,y,color,owner,radius,ms}] センスイ波紋キュー
let p1, p2;           // 互換用：players[0]・players[1]
let players = [];     // 試合に出ている全員
// 試合の設定（ui.js が startGame の前に入れる）：[{slot, color, weapon, human, keys, name}]
let matchSlots = [
  {slot:0,color:1,weapon:'shooter',human:true,name:'P1'},
  {slot:1,color:2,weapon:'shooter',human:false,name:'CPU'},
];
let timer=100, timerInt=null, running=false, isPaused=false, raf=null;
let w1='shooter', w2='shooter';
let btick=0;
let totalPaintable=0;

// CPU AI instance
let gameAI = null;
const CPU_THINK_MS = 450; // 戦略再計算間隔

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// =====================================================

// =====================================================
//  START OVERLAY
// =====================================================
// ★ 武器追加時のルール:
//   1. このWEAPONS配列の末尾に追加（選択画面に自動反映）
//   2. INK_COST / WCD / WICON / WNAME に対応エントリを追加
//   3. fire() switch に case を追加
//   4. GameAI に武器別思考を追加（_think, _doShoot, _shouldEnterCombat等）
//   5. 遊び方テーブルに行を追加
const WEAPONS=[
  // ── 既存武器（1行目グループ）──
  {id:'shooter',   name:'🔫 シューター',      desc:'前方3マス / コスト6'},
  {id:'charger',   name:'🎯 チャージャー',    desc:'溜め→射程6〜12 貫通'},
  {id:'bomb',      name:'💣 ボム',            desc:'投擲→3×3爆発 貫通'},
  {id:'roller',    name:'🖌️ ローラー',        desc:'移動でT字自動塗り'},
  {id:'spinner',   name:'🌀 スピナー',        desc:'長押し→扇形1〜15発'},
  {id:'eel',       name:'⚡ デンキウナギ',    desc:'無限反射する電撃弾'},
  {id:'tornado',   name:'🌪️ タツマキ',        desc:'長押しで周囲を塗る 貫通'},
  {id:'mine',      name:'💥 マイン',          desc:'5×5爆発 連鎖誘爆あり'},
  {id:'curling',   name:'🎿 カーリング',      desc:'壁まで直進しながら全マス塗る'},
  {id:'tackle',    name:'🏃 タックル',        desc:'前方5マス無敵突進 敵インク無視'},
  // ── 新規追加武器はここから（2行目グループ）──
  {id:'sensui',    name:'🌊 センスイ',        desc:'チャージ→前方ワープ+波紋塗り'},
];

// =====================================================
//  HELPERS
// =====================================================
function ib(x,y){return x>=0&&x<COLS&&y>=0&&y<ROWS;}
function ky(x,y){return `${x},${y}`;}
// スタート地点のまわり（3×3）は安全地帯。who＝プレイヤー（その人の地点）か色番号（その色の全員の地点）
function safeZone(x,y,who){
  const list = typeof who==='object' ? [who.spawn] : players.filter(p=>p.color===who).map(p=>p.spawn);
  return list.some(rp=>rp&&Math.abs(x-rp.x)<=1&&Math.abs(y-rp.y)<=1);
}
// 敵どうしか（色が違えば敵。チーム戦は味方が同じ色）
function isEnemy(a,b){ return a!==b && a.color!==b.color; }
function enemiesOf(p){ return players.filter(o=>isEnemy(p,o)); }
// (x,y) にいる敵を倒す。倒したら true
function hitEnemyAt(owner,x,y){
  let hit=false;
  players.forEach(o=>{
    if(!isEnemy(owner,o)||o.respawning) return;
    if(o.x===x&&o.y===y&&!safeZone(x,y,o)){ doRespawn(o); hit=true; }
  });
  return hit;
}
function paintCell(x,y,color){
  if(!ib(x,y)||walls.has(ky(x,y))||stationSet.has(ky(x,y))) return;
  grid[y][x]=color;
}
function paintArea(cx,cy,color,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++) paintCell(cx+dx,cy+dy,color);
}
// ひし形塗り（マンハッタン距離 |dx|+|dy| ≤ R）
function paintDiamond(cx,cy,color,R){
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++)
    if(Math.abs(dx)+Math.abs(dy)<=R) paintCell(cx+dx,cy+dy,color);
}
// ひし形範囲内の敵にダメージ
function checkDamageInDiamond(cx,cy,R,owner){
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
    if(Math.abs(dx)+Math.abs(dy)>R) continue;
    const nx=cx+dx, ny=cy+dy;
    if(ib(nx,ny)) hitEnemyAt(owner,nx,ny);
  }
}
function cellColor(x,y){
  if(!ib(x,y)) return -1;
  if(walls.has(ky(x,y))||stationSet.has(ky(x,y))) return -1;
  return grid[y][x];
}

// Stage wall helpers
function spawnSafe(x,y){
  if(x<=3&&y>=13) return true;   // P1 spawn area
  if(x>=COLS-4&&y<=4) return true; // P2 spawn area
  if(x<=3&&y<=4) return true;        // 3人目（左上）
  if(x>=COLS-4&&y>=13) return true;  // 4人目（右下）
  return false;
}
function addWall(x,y){ if(ib(x,y)&&!spawnSafe(x,y)) walls.add(ky(x,y)); }
function addRect(x,y,w,h){ for(let j=0;j<h;j++) for(let i=0;i<w;i++) addWall(x+i,y+j); }
// Diagonal symmetric: mirror of (x,y,w,h) for 30×18
function addSym(x,y,w,h){ addRect(x,y,w,h); addRect(COLS-x-w,ROWS-y-h,w,h); }

// =====================================================
//  STAGE BUILDERS
// =====================================================
function stageSquare(){
  // Scattered symmetric 2×2 blocks
  [[5,2],[10,2],[14,2],
   [5,6],[12,5],
   [7,9],[14,8]].forEach(([x,y])=>addSym(x,y,2,2));
  addRect(13,8,4,2); // center
}

function stageChannel(){
  // 3 horizontal lanes separated by wall strips with off-center gaps
  // Top separator (y=5-6): gap at cols 12-14
  addRect(0,5,12,2); addRect(15,5,15,2);
  // Bottom separator (y=11-12): gap at cols 15-17 (asymmetric gap for interest)
  addRect(0,11,15,2); addRect(18,11,12,2);
  // Lane obstacles
  addSym(5,2,3,2);   // top lane blocks
  addSym(5,8,2,2);   // center lane
  addSym(12,7,2,3);
}

function stageFort(){
  // Vertical fortress walls with gaps at center
  // Left wall: x=5-6, y=4-13 (gap at y=8-9)
  addRect(5,4,2,4); addRect(5,10,2,4);
  // Right wall: mirror x=22-23
  addRect(COLS-7,4,2,4); addRect(COLS-7,10,2,4);
  // Horizontal cross walls
  addSym(7,4,6,2);   // top horizontal
  addSym(7,12,6,2);  // bottom horizontal
  // Center obstacles
  addSym(10,7,2,4);
  addRect(13,8,4,2);
}

function stageArena(){
  // Open center with ring of 2×2 pillar pairs
  [[3,3],[9,2],[15,2],[21,2],
   [3,8],
   [3,13],[9,13],[15,13],[21,13]].forEach(([x,y])=>addSym(x,y,2,2));
  // Extra center obstacles
  addSym(8,7,2,2);
  addRect(13,7,4,4);
}

function stageLabyrinth(){
  // L-shaped and corridor walls
  addSym(4,2,1,6); addSym(4,2,7,1);   // top-left L
  addSym(9,2,1,4);                      // inner vertical
  addSym(12,4,1,4);                     // inner vertical 2
  addSym(6,7,4,1); addSym(6,7,1,4);   // center L
  addRect(13,6,4,1); addRect(14,7,2,4); // center cross
  addSym(9,10,4,1); addSym(8,10,1,3);  // lower L
}

function stageIsland(){
  // 中央大島 + 対称小島
  addRect(11,6,8,6);      // 中央大島
  addSym(3,3,5,3);        // 対称コーナー島
  addSym(3,9,5,2);        // 対称中段島
}

function stageZigzag(){
  // 縦壁ジグザグ配置
  addSym(5,1,2,5);        // 上段縦壁対
  addSym(11,5,2,4);       // 中段縦壁対
  addSym(5,10,2,4);       // 下段縦壁対
  addRect(13,7,4,4);      // 中央
}

function stagePillar(){
  // 対称ピラー配置
  [[4,2],[11,2],[4,7],[11,7]].forEach(([x,y])=>addSym(x,y,2,3));
  addRect(13,7,4,4);      // 中央ブロック
}

function stageBridge(){
  // 縦断壁 + 橋ギャップ（y:7-10）
  addRect(8,0,2,7);  addRect(8,11,2,7);
  addRect(20,0,2,7); addRect(20,11,2,7);
  addSym(4,2,3,4);        // コーナー障害物
  addRect(13,7,4,4);      // 中央ブロック
}

function stageSlope(){
  // L字＋対称階段
  addSym(4,2,8,1);  addSym(4,2,1,7);  // 上L字
  addSym(9,5,4,1);  addSym(9,5,1,4);  // 内L字
  addRect(13,7,4,4);                   // 中央
}

// =====================================================
//  STAGES
// =====================================================
const STAGE_DATA = [
  { name:'スクエア',    icon:'⬛', fn:stageSquare    },
  { name:'チャンネル',  icon:'🔀', fn:stageChannel   },
  { name:'フォート',    icon:'🏰', fn:stageFort      },
  { name:'アリーナ',    icon:'🏟', fn:stageArena     },
  { name:'ラビリンス',  icon:'🌀', fn:stageLabyrinth },
  { name:'アイランド',  icon:'🏝', fn:stageIsland    },
  { name:'ジグザグ',    icon:'⚡', fn:stageZigzag    },
  { name:'ピラー',      icon:'🏛', fn:stagePillar    },
  { name:'ブリッジ',    icon:'🌉', fn:stageBridge    },
  { name:'スロープ',    icon:'📐', fn:stageSlope     },
];
let currentStage = 0;

// =====================================================
//  INIT
// =====================================================
function initGame(){
  layout();
  grid=[]; walls=new Set(); stationSet=new Set(); inkStations=[];
  bullets=[]; fxList=[]; mines=[];
  mineChainQueue=[]; sensuiWaves=[];
  timer=100;

  for(let r=0;r<ROWS;r++){grid[r]=[];for(let c=0;c<COLS;c++) grid[r][c]=0;}

  // Build stage
  STAGE_DATA[currentStage].fn();

  // Players（matchSlots から作る）
  players = matchSlots.map(m=>{
    const sp=SPAWNS[m.slot];
    return {x:sp.x,y:sp.y,spawn:sp,slot:m.slot,dir:sp.x<COLS/2?'right':'left',color:m.color,
      weapon:m.weapon,human:!!m.human,keys:m.keys||null,name:m.name||'',respawning:false,
      shootCd:0,moveCd:0,ink:INK_MAX,chargeHeld:0,spinnerHeld:0,
      spinnerFireCd:0,spinnerCd:0,spinnerQueue:[],spinnerQueueCd:0,tornadoCd:0,
      invincible:false,sensuiHeld:0};
  });
  p1=players[0]; p2=players[1];

  // Paint spawns
  players.forEach(p=>paintArea(p.spawn.x,p.spawn.y,p.color,2));

  // Count paintable cells
  totalPaintable=0;
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++)
    if(!walls.has(ky(c,r))&&!stationSet.has(ky(c,r))) totalPaintable++;

  // Ink stations（ステージごとに固定配置）
  placeFixedStations(currentStage);

  // CPU は1体ずつ思考を持つ
  players.forEach(p=>{ if(!p.human) p.ai=new GameAI(p); });
  gameAI = players.find(p=>p.ai)?.ai || null;


  updateWeaponUI(); updateScores(); updateInkUI();
}

function placeStation(color,ax,ay,minDist,maxDist){
  let placed=false, tries=0;
  while(!placed&&tries<400){
    tries++;
    const angle=Math.random()*Math.PI*2;
    const dist=minDist+Math.random()*(maxDist-minDist);
    const x=Math.round(ax+Math.cos(angle)*dist);
    const y=Math.round(ay+Math.sin(angle)*dist);
    if(!ib(x,y)) continue;
    if(walls.has(ky(x,y))) continue;
    if(safeZone(x,y,1)||safeZone(x,y,2)) continue;
    if(inkStations.some(s=>Math.abs(s.x-x)<=2&&Math.abs(s.y-y)<=2)) continue;
    inkStations.push({x,y,color}); stationSet.add(ky(x,y)); placed=true;
  }
}

function addStation(color,x,y){
  if(!ib(x,y)||walls.has(ky(x,y))) return;
  inkStations.push({x,y,color}); stationSet.add(ky(x,y));
}

// ステージごとの固定インクステーション配置
// 各ステージ: P1色(1)×3か所、P2色(2)×3か所
// 配置: 自陣寄り・中央・敵陣寄り を対称に配置
// ※ spawnSafe な座標はaddWallがスキップするので通行可能
function placeFixedStations(stage){
  // [color, x, y]
  const layouts = [
    // 0: スクエア ─ walls: (21,7)-(22,8), (13,8)-(16,9), (5,6)-(6,7) etc.
    [ [1, 3,13],[1, 8,11],[1,11, 7],
      [2,26, 4],[2,20, 6],[2,15,11] ],
    // 1: チャンネル ─ horizontal walls y=5-6, y=11-12
    [ [1, 3,14],[1, 7, 8],[1,14, 3],
      [2,26, 3],[2,21, 9],[2,15,14] ],
    // 2: フォート ─ walls: left/right fort x=5-6,x=23-24, (17,4)-(22,5), (7,12)-(12,13)
    [ [1, 3,13],[1, 8, 8],[1,15, 3],
      [2,26, 4],[2,21, 9],[2,13,14] ],
    // 3: アリーナ ─ walls: (13,7)-(16,10), (9,13)-(10,14), (3,8)-(4,9)
    [ [1, 3,14],[1, 8, 9],[1,11, 9],
      [2,26, 3],[2,21, 8],[2,12,12] ],
    // 4: ラビリンス ─ walls: (4,2)-(10,2), (14,7)-(15,10), (6,7)-(6,10)
    [ [1, 3,13],[1, 7,11],[1,13, 8],
      [2,26, 4],[2,22, 6],[2,16, 9] ],
    // 5: アイランド ─ 中央(11-18,6-11), コーナー島
    [ [1, 4,15],[1, 8,13],[1, 9, 4],
      [2,25, 2],[2,21, 4],[2,20,14] ],
    // 6: ジグザグ ─ 縦壁ジグザグ
    [ [1, 3,15],[1, 8,12],[1,10, 4],
      [2,26, 2],[2,21, 5],[2,18,13] ],
    // 7: ピラー ─ 均等ピラー
    [ [1, 3,14],[1, 8,12],[1, 9, 5],
      [2,26, 3],[2,21, 5],[2,20,12] ],
    // 8: ブリッジ ─ 縦断壁 (x=8-9,x=20-21)
    [ [1, 3,14],[1, 5, 8],[1,11, 3],
      [2,26, 3],[2,24, 9],[2,18,14] ],
    // 9: スロープ ─ L字階段
    [ [1, 3,15],[1, 7,13],[1,11, 9],
      [2,26, 2],[2,22, 4],[2,18, 8] ],
  ];
  const defs = layouts[stage] || layouts[0];
  // レイアウトの色1＝左下（slot0）用、色2＝右上（slot1）用。slot2・3 は上下に反転して使う
  players.forEach(p=>{
    const base = (p.slot===0||p.slot===2) ? 1 : 2;
    defs.filter(d=>d[0]===base).forEach(([,x,y])=>{
      const ty = (p.slot>=2) ? ROWS-1-y : y;
      const at = nearestFree(x,ty);
      if(at) addStation(p.color,at.x,at.y);
    });
  });
}
// (x,y) から一番近い、壁でも他のステーションでもスタート地点でもないマス
function nearestFree(x,y){
  for(let r=0;r<6;r++) for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    const nx=x+dx, ny=y+dy;
    if(!ib(nx,ny)||walls.has(ky(nx,ny))||stationSet.has(ky(nx,ny))) continue;
    if(players.some(p=>Math.abs(nx-p.spawn.x)<=1&&Math.abs(ny-p.spawn.y)<=1)) continue;
    return {x:nx,y:ny};
  }
  return null;
}

// =====================================================
//  DIRS
// =====================================================
const DIR={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}};
function fanDirs(d){
  const o=['up','right','down','left'], i=o.indexOf(d);
  return [d,o[(i+3)%4],o[(i+1)%4]];
}

// =====================================================
//  MOVEMENT
// =====================================================
function move(player,dir){
  player.dir=dir;
  if(player.respawning) return;
  const d=DIR[dir];
  const nx=player.x+d.x, ny=player.y+d.y;
  if(!ib(nx,ny)) return;
  if(walls.has(ky(nx,ny))) return;
  const g=grid[ny][nx];
  if(!stationSet.has(ky(nx,ny))&&g!==0&&g!==player.color) return; // 敵の色には入れない
  if(players.some(o=>o!==player&&!o.respawning&&o.x===nx&&o.y===ny)) return;
  player.x=nx; player.y=ny;
  paintCell(nx,ny,player.color);
  const si=inkStations.findIndex(s=>s.x===nx&&s.y===ny);
  if(si>=0&&inkStations[si].color===player.color){
    player.ink=INK_MAX;
    playSE('refill');
    fxList.push({type:'refill',x:nx,y:ny,color:player.color,life:20,max:20});
  }
}

// =====================================================
//  INK REGEN
// =====================================================
function tickInk(player,dt){
  if(player.respawning) return;
  if(!ib(player.x,player.y)) return;
  if(cellColor(player.x,player.y)===player.color)
    player.ink=Math.min(INK_MAX,player.ink+INK_REGEN_RATE*(dt/1000));
}

// =====================================================
//  ROLLER
// =====================================================
function rollerPaint(player){
  const d=DIR[player.dir];
  const perp=[{x:-d.y,y:d.x},{x:d.y,y:-d.x}];
  const front={x:player.x+d.x,y:player.y+d.y};
  const left={x:front.x+perp[0].x,y:front.y+perp[0].y};
  const right={x:front.x+perp[1].x,y:front.y+perp[1].y};
  const cells=[front,left,right];
  // T字3マスが全て自分の色なら消費0
  const allOwn=cells.every(c=>ib(c.x,c.y)&&grid[c.y]?.[c.x]===player.color);
  const cost=allOwn?0:INK_COST.roller;
  if(player.ink<cost) return;
  player.ink=Math.max(0,player.ink-cost);
  cells.forEach(c=>{
    paintCell(c.x,c.y,player.color);
    hitEnemyAt(player,c.x,c.y);
  });
}

// =====================================================
//  WEAPONS
// =====================================================
function fire(player){
  if(player.respawning) return;
  if(player.weapon==='roller') return;
  if(player.weapon==='tackle') return; // handled on shoot hold
  if(player.weapon==='charger') return;
  if(player.weapon==='spinner') return;
  if(player.weapon==='sensui') return; // handled separately
  const cost=INK_COST[player.weapon];
  if(player.ink<cost){ fxList.push({type:'nink',x:player.x,y:player.y,life:14,max:14}); return; }
  player.ink=Math.max(0,player.ink-cost);
  switch(player.weapon){
    case'shooter':    playSE('shoot'); doShooter(player);    break;
    case'bomb':       playSE('bomb');  doBomb(player);       break;
    case'eel':        playSE('shoot'); doEel(player);        break;
    case'mine':       playSE('bomb');  doMine(player);       break;
    case'curling':    playSE('shoot'); doCurling(player);    break;
  }
}

function releaseCharger(player){
  if(player.respawning) return;
  const cost=INK_COST.charger;
  if(player.ink<cost){ fxList.push({type:'nink',x:player.x,y:player.y,life:14,max:14}); player.chargeHeld=0; return; }
  player.ink=Math.max(0,player.ink-cost);
  const chargeFrac=Math.min(1,player.chargeHeld/CHARGER_MAX_CHARGE);
  const range=Math.round(CHARGER_MIN_RANGE+chargeFrac*(CHARGER_MAX_RANGE-CHARGER_MIN_RANGE));
  playSE('shoot'); doCharger(player,range); player.chargeHeld=0;
}

function doShooter(p){
  const d=DIR[p.dir];
  bullets.push({x:p.x,y:p.y,dx:d.x,dy:d.y,color:p.color,owner:p,steps:3,type:'s'});
}
function doCharger(p,range){
  const d=DIR[p.dir]; let cx=p.x,cy=p.y;
  let actualLen=0;
  for(let i=0;i<range;i++){
    cx+=d.x; cy+=d.y;
    if(!ib(cx,cy)||walls.has(ky(cx,cy))) break;
    actualLen++;
    paintCell(cx,cy,p.color);
    hitEnemyAt(p,cx,cy); // 貫通: breakしない
  }
  fxList.push({type:'beam',x:p.x+d.x,y:p.y+d.y,dx:d.x,dy:d.y,color:p.color,
               life:10,max:10,len:Math.max(1,actualLen)});
}
function releaseSpinner(player){
  if(player.respawning){ player.spinnerHeld=0; return; }
  const chargeFrac=Math.min(1,(player.spinnerHeld||0)/SPINNER_SPINUP);
  if(chargeFrac<=0){ player.spinnerHeld=0; return; }
  const count=Math.max(1,Math.ceil(chargeFrac*15));
  const actualCount=Math.min(count,Math.floor(player.ink/SPINNER_INK_PER_BULLET));
  if(actualCount<=0){ fxList.push({type:'nink',x:player.x,y:player.y,life:14,max:14}); player.spinnerHeld=0; return; }
  player.ink=Math.max(0,player.ink-actualCount*SPINNER_INK_PER_BULLET);
  const BASE_ANGLES={right:0,down:Math.PI/2,left:Math.PI,up:-Math.PI/2};
  const baseAng=BASE_ANGLES[player.dir];
  player.spinnerQueue=[];
  for(let i=0;i<actualCount;i++){
    const ang=baseAng+(Math.random()-.5)*Math.PI/2;
    const dx=Math.cos(ang), dy=Math.sin(ang);
    player.spinnerQueue.push({fxdx:dx,fxdy:dy,steps:3+Math.floor(Math.random()*4),speed:.6+Math.random()*.4});
  }
  playSE('shoot');
  player.spinnerQueueCd=0; player.spinnerHeld=0; player.spinnerCd=SPINNER_COOLDOWN;
}
function doBomb(p){
  const d=DIR[p.dir];
  bullets.push({x:p.x,y:p.y,dx:d.x,dy:d.y,color:p.color,owner:p,steps:BOMB_STEPS,type:'b'});
}
function explodeBomb(bx,by,color,owner){
  fxList.push({type:'exp',x:bx,y:by,color,life:12,max:12,r:2});
  paintDiamond(bx,by,color,2);
  checkDamageInDiamond(bx,by,2,owner);
}
function eelClockwise(dx,dy){ return {x:-dy,y:dx}; }
function doEel(p){
  const d=DIR[p.dir];
  // straightLeft: 直進残りマス(3), postLeft: 反射後残りマス(9), bounces: 反射回数(max3)
  bullets.push({x:p.x,y:p.y,dx:d.x,dy:d.y,color:p.color,owner:p,
    type:'eel',straightLeft:3,postLeft:9,bounces:0});
}
function tickTornado(player,dt){
  if(player.weapon!=='tornado') return;
  player.tornadoCd=Math.max(0,(player.tornadoCd||0)-dt);
}
function doTornadoPaint(player){
  if(player.ink<INK_COST.tornado){ fxList.push({type:'nink',x:player.x,y:player.y,life:10,max:10}); return; }
  const full=player.ink>=INK_MAX, range=full?2:1;
  player.ink=Math.max(0,player.ink-INK_COST.tornado);
  for(let dy=-range;dy<=range;dy++) for(let dx=-range;dx<=range;dx++){
    if(dx===0&&dy===0) continue;
    const nx=player.x+dx, ny=player.y+dy;
    paintCell(nx,ny,player.color);
    if(ib(nx,ny)) hitEnemyAt(player,nx,ny);
  }
  fxList.push({type:'tornado',x:player.x,y:player.y,color:player.color,range,life:10,max:10});
}

// 💥 MINE: 足元に地雷設置（個数制限なし）
function doMine(p){
  mines.push({x:p.x,y:p.y,color:p.color,owner:p,life:600,ownerCd:15});
  fxList.push({type:'refill',x:p.x,y:p.y,color:p.color,life:12,max:12});
}
// 地雷専用5×5爆発（設置者はダメージなし・連鎖誘爆あり）
function explodeMine(bx,by,color,owner){
  fxList.push({type:'exp',x:bx,y:by,color,life:14,max:14});
  playSE('bomb');
  for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
    const nx=bx+dx, ny=by+dy;
    paintCell(nx,ny,color);
    // 敵のみダメージ（オーナーと味方は無敵）
    if(ib(nx,ny)) hitEnemyAt(owner,nx,ny);
  }
  // 爆発範囲内の他の地雷を200ms後に連鎖誘爆
  mines.forEach(m=>{
    if(Math.abs(m.x-bx)<=2&&Math.abs(m.y-by)<=2){
      // まだキューに入っていない地雷のみ追加
      if(!mineChainQueue.some(q=>q.mineRef===m)){
        mineChainQueue.push({mineRef:m,delay:200});
      }
    }
  });
}


// 🎿 CURLING: 壁まで直進しながら全マスを塗る
function doCurling(p){
  const d=DIR[p.dir];
  bullets.push({x:p.x,y:p.y,dx:d.x,dy:d.y,color:p.color,owner:p,steps:99,type:'curl'});
}

// 🌊 SENSUI: 近接BFS（壁を避けた着地点を返す）
function sensuiBFS(tx,ty){
  tx=Math.max(0,Math.min(COLS-1,tx)); ty=Math.max(0,Math.min(ROWS-1,ty));
  if(!walls.has(ky(tx,ty))) return {x:tx,y:ty};
  const visited=new Set([ky(tx,ty)]);
  const queue=[{x:tx,y:ty}];
  while(queue.length>0){
    const c=queue.shift();
    for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
      const nx=c.x+ddx,ny=c.y+ddy;
      if(!ib(nx,ny)) continue;
      const nk=ky(nx,ny);
      if(visited.has(nk)) continue;
      visited.add(nk);
      if(!walls.has(nk)) return {x:nx,y:ny};
      queue.push({x:nx,y:ny});
    }
  }
  return null;
}

// 🌊 SENSUI: ワープ発動（proc/CPUから呼ばれる・インク消費は呼び出し元で行う）
function releaseSensui(player){
  const held=player.sensuiHeld||0;
  player.sensuiHeld=0;
  const dist=Math.max(1,Math.min(10,Math.max(1,Math.round(held/150))));
  const d=DIR[player.dir];
  const tx=player.x+d.x*dist, ty=player.y+d.y*dist;
  const land=sensuiBFS(tx,ty);
  if(!land) return;
  player.x=land.x; player.y=land.y;
  paintDiamond(land.x,land.y,player.color,1);
  checkDamageInDiamond(land.x,land.y,1,player);
  fxList.push({type:'sensui',x:land.x,y:land.y,color:player.color,life:14,max:14,radius:1});
  playSE('shoot');
  if(dist>=4)  sensuiWaves.push({x:land.x,y:land.y,color:player.color,owner:player,radius:2,ms:200});
  if(dist>=9)  sensuiWaves.push({x:land.x,y:land.y,color:player.color,owner:player,radius:3,ms:400});
}

// 🌊 SENSUI: 波紋キューを処理（ゲームループから毎フレーム呼ぶ）
function tickSensui(dt){
  const done=[];
  sensuiWaves.forEach((w,i)=>{
    w.ms-=dt;
    if(w.ms<=0){
      paintDiamond(w.x,w.y,w.color,w.radius);
      checkDamageInDiamond(w.x,w.y,w.radius,w.owner);
      fxList.push({type:'sensui',x:w.x,y:w.y,color:w.color,life:12,max:12,radius:w.radius});
      done.push(i);
    }
  });
  for(let i=done.length-1;i>=0;i--) sensuiWaves.splice(done[i],1);
}


// 🏃 TACKLE: 前方5マスダッシュ・無敵・敵インク無視
function doTackle(player){
  if(player.respawning) return;
  if(player.ink<INK_COST.tackle){ fxList.push({type:'nink',x:player.x,y:player.y,life:14,max:14}); return; }
  player.ink=Math.max(0,player.ink-INK_COST.tackle);
  player.invincible=true; // 無敵フラグON
  const d=DIR[player.dir];
  for(let i=0;i<5;i++){
    const nx=player.x+d.x, ny=player.y+d.y;
    if(!ib(nx,ny)||walls.has(ky(nx,ny))) break;
    // 敵インクも通過可（地形無視）
    player.x=nx; player.y=ny;
    paintCell(nx,ny,player.color);
    if(hitEnemyAt(player,nx,ny)){
      fxList.push({type:'exp',x:nx,y:ny,color:player.color,life:10,max:10});
      break;
    }
  }
  player.invincible=false; // 無敵フラグOFF（突進完了）
  playSE('shoot');
  fxList.push({type:'tackle',x:player.x,y:player.y,color:player.color,life:8,max:8});
}


// =====================================================
//  BULLET TICK
// =====================================================
function tickBullets(){
  const dead=[];
  bullets.forEach((b,i)=>{
    if(b.type==='spin'){
      if(b.steps<=0){ dead.push(i); return; }
      b.fx+=b.fxdx*b.speed; b.fy+=b.fxdy*b.speed;
      const nx=Math.round(b.fx-.5), ny=Math.round(b.fy-.5);
      if(!ib(nx,ny)||walls.has(ky(nx,ny))){ dead.push(i); return; }
      if(nx!==b.x||ny!==b.y){
        b.x=nx; b.y=ny; b.steps--;
        paintCell(nx,ny,b.color);
        if(hitEnemyAt(b.owner,nx,ny)) dead.push(i);
      }
      return;
    }
    if(b.type==='eel'){
      const nx=b.x+b.dx, ny=b.y+b.dy;
      if(!ib(nx,ny)||walls.has(ky(nx,ny))){
        // 壁に衝突
        if(b.bounces>=3){ dead.push(i); return; } // 反射上限
        const r=eelClockwise(b.dx,b.dy);
        const nx2=b.x+r.x, ny2=b.y+r.y;
        if(!ib(nx2,ny2)||walls.has(ky(nx2,ny2))){ dead.push(i); return; }
        b.dx=r.x; b.dy=r.y; b.bounces++;
        b.straightLeft=0;   // 直進フェーズ終了
        b.postLeft=9;       // 反射のたびに9マスにリセット
        b.x=nx2; b.y=ny2;
        paintCell(nx2,ny2,b.color);
        fxList.push({type:'eelBounce',x:nx2,y:ny2,color:b.color,life:7,max:7});
        if(hitEnemyAt(b.owner,nx2,ny2)) dead.push(i);
        return;
      }
      // 前進
      if(b.straightLeft>0){
        // 直進フェーズ
        b.straightLeft--;
        if(b.straightLeft===0&&b.bounces===0){
          // 3マス直進完了 → 壁に一度も当たらなかったので消滅
          dead.push(i);
          b.x=nx; b.y=ny; paintCell(nx,ny,b.color); return;
        }
      } else {
        // 反射後フェーズ
        b.postLeft--;
        if(b.postLeft<=0){
          b.x=nx; b.y=ny; paintCell(nx,ny,b.color); dead.push(i); return;
        }
      }
      b.x=nx; b.y=ny;
      paintCell(nx,ny,b.color);
      if(hitEnemyAt(b.owner,nx,ny)) dead.push(i);
      return;
    }
    // --- CURLING: 壁に当たるまで直進しながら全マスを塗る ---
    if(b.type==='curl'){
      const nx=b.x+b.dx, ny=b.y+b.dy;
      if(!ib(nx,ny)||walls.has(ky(nx,ny))){ dead.push(i); return; }
      b.x=nx; b.y=ny; b.steps--;
      paintCell(nx,ny,b.color);
      if(hitEnemyAt(b.owner,nx,ny)) dead.push(i);
      return;
    }
    if(b.steps<=0){ if(b.type==='b') explodeBomb(b.x,b.y,b.color,b.owner); dead.push(i); return; }
    const nx=b.x+b.dx, ny=b.y+b.dy;
    if(!ib(nx,ny)||walls.has(ky(nx,ny))){
      if(b.type==='b') explodeBomb(b.x,b.y,b.color,b.owner);
      dead.push(i); return;
    }
    b.x=nx; b.y=ny; b.steps--;
    paintCell(nx,ny,b.color);
    if(hitEnemyAt(b.owner,b.x,b.y)){
      if(b.type!=='b') dead.push(i); // ボム貫通: 爆発せず敵を倒して通過
    }
  });
  for(let i=dead.length-1;i>=0;i--) bullets.splice(dead[i],1);
  fxList.forEach(f=>f.life--);
  fxList=fxList.filter(f=>f.life>0);
}

// =====================================================
//  MINES TICK
// =====================================================
function tickMines(){
  const TICK_MS=BTICK_MS; // 1tickあたりのms
  const dead=new Set();
  // 連鎖キューを処理（200msディレイ）
  mineChainQueue.forEach((q,qi)=>{
    q.delay-=TICK_MS;
    if(q.delay<=0){
      const mi=mines.indexOf(q.mineRef);
      if(mi>=0&&!dead.has(mi)){
        dead.add(mi);
        explodeMine(q.mineRef.x,q.mineRef.y,q.mineRef.color,q.mineRef.owner);
      }
      mineChainQueue.splice(qi,1);
    }
  });
  mines.forEach((m,i)=>{
    if(dead.has(i)) return;
    m.life--;
    if(m.ownerCd>0) m.ownerCd--;
    if(m.life<=0){ dead.add(i); return; }
    // 敵が踏んだ
    if(players.some(o=>isEnemy(m.owner,o)&&!o.respawning&&o.x===m.x&&o.y===m.y&&!safeZone(m.x,m.y,o))){
      explodeMine(m.x,m.y,m.color,m.owner); dead.add(i); return;
    }
    // 設置者本人が踏んだ（ownerCd>0の間は誤爆防止）
    if(m.ownerCd<=0&&!m.owner.respawning&&m.owner.x===m.x&&m.owner.y===m.y){
      explodeMine(m.x,m.y,m.color,m.owner); dead.add(i);
    }
  });
  const deadArr=[...dead].sort((a,b)=>b-a);
  deadArr.forEach(i=>mines.splice(i,1));
}


// =====================================================
//  RESPAWN
// =====================================================
function doRespawn(player){
  if(player.invincible) return; // タックル無敵中は無効
  playSE('hit');
  player.respawning=true; player.x=-99; player.y=-99;
  player.sensuiHeld=0;
  setTimeout(()=>{
    const rp=player.spawn;
    player.x=rp.x; player.y=rp.y;
    player.respawning=false; player.ink=INK_MAX;
    paintArea(rp.x,rp.y,player.color,1);
  },RESPAWN_MS);
}

// =====================================================
//  DRAW
// =====================================================
// ストリート風の盤面：アスファルトの地面・レンガの壁・スプレーで塗ったインク
const C1='#FF3D8B',C1D='#B0125A',C1B='#FF5FA2';
const C2='#39FF88',C2D='#0E8C45',C2B='#5CFFA0';
const C2S='#39FF88'; // P2 ステーション用
const C3='#FFE14D',C3D='#A88A00',C3B='#FFEA7A';
const C4='#3DA9FF',C4D='#0B5FA8',C4B='#73C2FF';
// 色番号 → 色（0 は未使用）
const INKC=[null,C1,C2,C3,C4], INKD=[null,C1D,C2D,C3D,C4D], INKB=[null,C1B,C2B,C3B,C4B];
const INKGLOW=[null,'#ffffaa','#aaffff','#fff2b0','#b8e4ff'];
const ASPHALT='#2A2A2A', ASPHALT_LINE='rgba(255,255,255,.045)';
const BRICK='#6E3B30', BRICK_HI='#8A4C3E', MORTAR='#3A2420';
// マスごとに決まった乱数（毎フレーム同じ値になるので、ちらつかない）
function cellHash(c,r,k=0){ let h=(c*73856093)^(r*19349663)^(k*83492791); h=(h^(h>>>13))*1274126177; return ((h^(h>>>16))>>>0)/4294967295; }

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#161616'; ctx.fillRect(0,0,canvas.width,canvas.height);

  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const x=c*CELL, y=r*CELL;
    if(walls.has(ky(c,r))){ drawWall(x,y,c,r); }
    else if(stationSet.has(ky(c,r))){ drawGround(x,y,c,r); }
    else{
      const v=grid[r][c];
      if(v>0) drawInk(x,y,c,r,INKC[v]);
      else drawGround(x,y,c,r);
    }
  }

  const t=Date.now();
  inkStations.forEach(s=>{
    const x=s.x*CELL, y=s.y*CELL;
    const col=INKC[s.color];
    const pulse=.65+.35*Math.sin(t*.004+(s.x*3+s.y));
    ctx.fillStyle='#1B1B1B'; ctx.fillRect(x,y,CELL,CELL);
    ctx.save(); ctx.globalAlpha=.30*pulse; ctx.fillStyle=col; ctx.fillRect(x,y,CELL,CELL); ctx.restore();
    ctx.strokeStyle=col; ctx.lineWidth=2.5; ctx.strokeRect(x+2,y+2,CELL-4,CELL-4); ctx.lineWidth=1;
    const cx=x+CELL/2, cy=y+CELL/2, arm=CELL*.3;
    ctx.fillStyle=col;
    ctx.fillRect(cx-arm,cy-arm*.26,arm*2,arm*.52);
    ctx.fillRect(cx-arm*.26,cy-arm,arm*.52,arm*2);
  });

  players.forEach(p=>drawGlow(p.spawn.x,p.spawn.y,INKC[p.color]));

  fxList.forEach(f=>{
    const ft=f.life/f.max;
    if(f.type==='exp'){
      ctx.save(); ctx.globalAlpha=ft*.65; ctx.fillStyle=INKC[f.color];
      if(f.r!==undefined){
        // ひし形爆発
        const R=f.r;
        for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
          if(Math.abs(dx)+Math.abs(dy)<=R){
            const nx=f.x+dx,ny=f.y+dy; if(ib(nx,ny)) ctx.fillRect(nx*CELL,ny*CELL,CELL,CELL);
          }
        }
      } else {
        for(let dy=-BOMB_RANGE;dy<=BOMB_RANGE;dy++) for(let dx=-BOMB_RANGE;dx<=BOMB_RANGE;dx++){
          const nx=f.x+dx,ny=f.y+dy; if(ib(nx,ny)) ctx.fillRect(nx*CELL,ny*CELL,CELL,CELL);
        }
      }
      ctx.restore();
    } else if(f.type==='beam'){
      ctx.save(); ctx.globalAlpha=ft*.5; ctx.fillStyle=INKC[f.color];
      let cx=f.x,cy=f.y;
      for(let i=0;i<(f.len||6);i++){
        if(!ib(cx,cy)) break;
        if(!walls.has(ky(cx,cy))) ctx.fillRect(cx*CELL,cy*CELL,CELL,CELL);
        cx+=f.dx; cy+=f.dy;
      }
      ctx.restore();
    } else if(f.type==='tornado'){
      ctx.save(); ctx.globalAlpha=ft*.7;
      const tc=INKC[f.color];
      const tx=f.x*CELL+CELL/2, ty=f.y*CELL+CELL/2;
      const t2=Date.now()*.015, range=f.range||1;
      const orbs=range===2?12:8;
      for(let i=0;i<orbs;i++){
        const ang=t2+i*(Math.PI*2/orbs);
        const rad=CELL*range*.9*ft;
        const sx=tx+Math.cos(ang)*rad, sy=ty+Math.sin(ang)*rad*.65;
        ctx.beginPath(); ctx.arc(sx,sy,CELL*(range===2?.22:.2),0,Math.PI*2);
        ctx.fillStyle=tc; ctx.fill();
      }
      ctx.restore();
    } else if(f.type==='eelBounce'){
      ctx.save(); ctx.globalAlpha=ft*.9;
      const ec=INKGLOW[f.color];
      const ex=f.x*CELL+CELL/2, ey=f.y*CELL+CELL/2;
      ctx.shadowColor=ec; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.arc(ex,ey,CELL*(.5-ft*.2),0,Math.PI*2);
      ctx.strokeStyle=ec; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
    } else if(f.type==='nink'){
      ctx.save(); ctx.globalAlpha=ft*.9;
      ctx.font=`bold ${Math.floor(CELL*.7)}px Arial`;
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#ff2222';
      ctx.fillText('✕',f.x*CELL+CELL/2,f.y*CELL+CELL/2-CELL*(.4*(1-ft)));
      ctx.restore();
    } else if(f.type==='refill'){
      ctx.save(); ctx.globalAlpha=ft*.95;
      ctx.font=`bold ${Math.floor(CELL*.65)}px Arial`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle=INKC[f.color];
      ctx.fillText('FULL!',f.x*CELL+CELL/2,f.y*CELL+CELL/2-CELL*(.7*(1-ft)));
      ctx.restore();
    } else if(f.type==='gren'){
      // グレネード大爆発 5×5
      ctx.save(); ctx.globalAlpha=ft*.75; ctx.fillStyle=INKC[f.color];
      for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
        const nx=f.x+dx, ny=f.y+dy;
        if(ib(nx,ny)) ctx.fillRect(nx*CELL,ny*CELL,CELL,CELL);
      }
      ctx.restore();
      // 爆発リング
      ctx.save(); ctx.globalAlpha=ft*.9;
      ctx.strokeStyle=INKGLOW[f.color];
      ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(f.x*CELL+CELL/2,f.y*CELL+CELL/2,CELL*(2.5*(1-ft)+.5),0,Math.PI*2);
      ctx.stroke(); ctx.restore();
    } else if(f.type==='tackle'){
      ctx.save(); ctx.globalAlpha=ft*.7;
      ctx.fillStyle=INKC[f.color];
      ctx.fillRect(f.x*CELL-CELL*.5,f.y*CELL-CELL*.5,CELL*2,CELL*2);
      ctx.restore();
    } else if(f.type==='sensui'){
      ctx.save();
      const sc=INKC[f.color];
      const R=f.radius||1;
      ctx.globalAlpha=ft*.45;
      ctx.fillStyle=sc;
      for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
        if(Math.abs(dx)+Math.abs(dy)<=R){
          const nx=f.x+dx,ny=f.y+dy;
          if(ib(nx,ny)) ctx.fillRect(nx*CELL+1,ny*CELL+1,CELL-2,CELL-2);
        }
      }
      ctx.globalAlpha=ft*.8;
      ctx.strokeStyle=sc; ctx.lineWidth=2.5;
      const ringR=(R+.4)*CELL*(1-ft*.35)+CELL*.2;
      ctx.beginPath(); ctx.arc(f.x*CELL+CELL/2,f.y*CELL+CELL/2,ringR,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  });

  bullets.forEach(b=>{
    const bx=b.x*CELL+CELL/2, by=b.y*CELL+CELL/2;
    if(b.type==='b'){
      ctx.beginPath(); ctx.arc(bx,by,CELL*.36,0,Math.PI*2); ctx.fillStyle='#111'; ctx.fill();
      ctx.beginPath(); ctx.arc(bx,by,CELL*.22,0,Math.PI*2); ctx.fillStyle='#555'; ctx.fill();
      ctx.beginPath(); ctx.arc(bx-CELL*.07,by-CELL*.12,CELL*.09,0,Math.PI*2); ctx.fillStyle='#ff9900'; ctx.fill();
    } else if(b.type==='eel'){
      ctx.save(); ctx.shadowColor=INKC[b.color]; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(bx,by,CELL*.28,0,Math.PI*2);
      ctx.fillStyle=INKGLOW[b.color]; ctx.fill();
      ctx.beginPath(); ctx.arc(bx,by,CELL*.14,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
      ctx.restore();
    } else if(b.type==='spin'){
      const sc=INKC[b.color];
      ctx.beginPath(); ctx.arc(b.fx*CELL,b.fy*CELL,CELL*.22,0,Math.PI*2); ctx.fillStyle=sc; ctx.fill();
      ctx.beginPath(); ctx.arc(b.fx*CELL-1,b.fy*CELL-1,CELL*.09,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,.85)'; ctx.fill();
    } else if(b.type==='curl'){
      // カーリング: 黒枠+自分色の弾
      const cc=INKC[b.color];
      ctx.save();
      ctx.beginPath(); ctx.arc(bx,by,CELL*.44,0,Math.PI*2); ctx.fillStyle='#111'; ctx.fill();
      ctx.shadowColor=cc; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(bx,by,CELL*.32,0,Math.PI*2); ctx.fillStyle=cc; ctx.fill();
      ctx.shadowBlur=0;
      ctx.beginPath(); ctx.arc(bx-CELL*.08,by-CELL*.1,CELL*.11,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,.5)'; ctx.fill();
      ctx.restore();
    } else {
      const r=CELL*.3;
      const col=INKD[b.color];
      ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
      ctx.beginPath(); ctx.arc(bx-1,by-1,r*.35,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,.75)'; ctx.fill();
    }
  });

  // Mines
  mines.forEach(m=>{
    const mx=m.x*CELL, my=m.y*CELL;
    const col=INKC[m.color];
    const pulse=.4+.6*Math.sin(Date.now()*.012+(m.x+m.y));
    ctx.save();
    ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(mx+CELL/2,my+CELL/2,CELL*.35,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=pulse; ctx.fillStyle=col;
    ctx.beginPath(); ctx.arc(mx+CELL/2,my+CELL/2,CELL*.22,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1; ctx.fillStyle='#fff';
    ctx.font=`${Math.floor(CELL*.35)}px Arial`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('💥',mx+CELL/2,my+CELL/2);
    ctx.restore();
  });

  players.forEach(p=>drawSensuiPreview(p,INKC[p.color]));
  players.forEach(p=>drawPlayer(p,INKB[p.color],INKD[p.color]));
  players.forEach(p=>{ drawChargerAim(p,INKC[p.color]); drawTornadoRing(p,INKC[p.color]); drawSpinnerGauge(p,INKC[p.color]); });
}

function drawSensuiPreview(player,col){
  if(player.respawning||player.weapon!=='sensui') return;
  const held=player.sensuiHeld||0;
  if(held<=0) return;
  const dist=Math.max(1,Math.min(10,Math.max(1,Math.round(held/150))));
  const d=DIR[player.dir];
  const land=sensuiBFS(player.x+d.x*dist, player.y+d.y*dist);
  if(!land) return;
  const frac=Math.min(1,held/1500);
  const pulse=.55+.45*Math.sin(Date.now()*.022);
  ctx.save();
  // 破線：現在地 → 着地点
  ctx.globalAlpha=(.4+frac*.35)*pulse;
  ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
  ctx.beginPath();
  ctx.moveTo(player.x*CELL+CELL/2,player.y*CELL+CELL/2);
  ctx.lineTo(land.x*CELL+CELL/2,land.y*CELL+CELL/2);
  ctx.stroke(); ctx.setLineDash([]);
  // 着地点 ○マーカー
  ctx.globalAlpha=(.65+frac*.3)*pulse;
  ctx.strokeStyle=col; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.arc(land.x*CELL+CELL/2,land.y*CELL+CELL/2,CELL*(.38+frac*.12),0,Math.PI*2);
  ctx.stroke();
  // 距離数字
  ctx.globalAlpha=.9;
  ctx.fillStyle=col; ctx.font=`bold ${Math.floor(CELL*.42)}px Arial`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(dist,land.x*CELL+CELL/2,land.y*CELL+CELL/2);
  ctx.restore();
}
function drawTornadoRing(player,col){
  if(player.respawning||player.weapon!=='tornado') return;
  if(!fxList.some(f=>f.type==='tornado'&&f.color===player.color)) return;
  const px=player.x*CELL+CELL/2, py=player.y*CELL+CELL/2;
  ctx.save(); ctx.globalAlpha=.4+.2*Math.sin(Date.now()*.02);
  ctx.strokeStyle=col; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.arc(px,py,CELL*1.1,0,Math.PI*2); ctx.stroke(); ctx.restore();
}
function drawChargerAim(player,col){
  if(player.respawning||player.weapon!=='charger') return;
  const held=player.chargeHeld||0; if(held<=0) return;
  const chargeFrac=Math.min(1,held/CHARGER_MAX_CHARGE);
  const range=Math.round(CHARGER_MIN_RANGE+chargeFrac*(CHARGER_MAX_RANGE-CHARGER_MIN_RANGE));
  const d=DIR[player.dir]; let cx=player.x, cy=player.y;
  ctx.save();
  for(let i=0;i<range;i++){
    cx+=d.x; cy+=d.y;
    if(!ib(cx,cy)||walls.has(ky(cx,cy))) break;
    const alpha=(.15+chargeFrac*.35)*(1-i/range*.5);
    ctx.globalAlpha=alpha; ctx.fillStyle=col;
    ctx.fillRect(cx*CELL+CELL*.15,cy*CELL+CELL*.15,CELL*.7,CELL*.7);
    ctx.globalAlpha=alpha*1.5; ctx.strokeStyle=col; ctx.lineWidth=1.5;
    ctx.setLineDash([3,3]); ctx.strokeRect(cx*CELL+1,cy*CELL+1,CELL-2,CELL-2); ctx.setLineDash([]);
  }
  ctx.restore();
}
function drawSpinnerGauge(player,col){
  if(player.respawning||player.weapon!=='spinner') return;
  const frac=Math.min(1,(player.spinnerHeld||0)/SPINNER_SPINUP); if(frac<=0) return;
  const px=player.x*CELL+CELL/2, py=player.y*CELL+CELL/2, r=CELL*.48;
  ctx.save(); ctx.globalAlpha=.85;
  ctx.beginPath(); ctx.arc(px,py,r,-Math.PI/2,Math.PI*1.5);
  ctx.strokeStyle='rgba(255,255,255,.2)'; ctx.lineWidth=3; ctx.stroke();
  ctx.beginPath(); ctx.arc(px,py,r,-Math.PI/2,-Math.PI/2+Math.PI*2*frac);
  ctx.strokeStyle=col; ctx.lineWidth=3; ctx.stroke();
  if(frac>=1){
    const t=Date.now()*.01;
    for(let i=0;i<4;i++){
      const ang=t+i*Math.PI/2;
      ctx.beginPath(); ctx.arc(px+Math.cos(ang)*(r+4),py+Math.sin(ang)*(r+4),2.5,0,Math.PI*2);
      ctx.fillStyle=col; ctx.fill();
    }
  }
  ctx.restore();
}
// アスファルト：マスごとに明るさを少し変え、小石の点を散らす
function drawGround(x,y,c,r){
  const n=cellHash(c,r);
  const g=38+Math.floor(n*8);
  ctx.fillStyle=`rgb(${g},${g},${g})`; ctx.fillRect(x,y,CELL,CELL);
  ctx.fillStyle='rgba(255,255,255,.07)';
  for(let i=0;i<3;i++){
    const px=cellHash(c,r,i+1)*CELL, py=cellHash(c,r,i+7)*CELL;
    ctx.fillRect(x+px,y+py,Math.max(1,CELL*.07),Math.max(1,CELL*.07));
  }
  ctx.strokeStyle=ASPHALT_LINE; ctx.strokeRect(x+.5,y+.5,CELL-1,CELL-1);
}
// インク：スプレーで塗ったように、マスごとに濃さを少し変え、細かい飛沫を足す
function drawInk(x,y,c,r,col){
  ctx.fillStyle=col; ctx.fillRect(x,y,CELL,CELL);
  const n=cellHash(c,r,3);
  ctx.fillStyle=n<.5?`rgba(0,0,0,${(.5-n)*.22})`:`rgba(255,255,255,${(n-.5)*.18})`;
  ctx.fillRect(x,y,CELL,CELL);
  ctx.fillStyle='rgba(255,255,255,.22)';
  for(let i=0;i<2;i++){
    const px=cellHash(c,r,i+11)*CELL, py=cellHash(c,r,i+17)*CELL;
    ctx.beginPath(); ctx.arc(x+px,y+py,Math.max(1,CELL*.06),0,Math.PI*2); ctx.fill();
  }
}
// 壁：レンガ（段ごとに目地をずらす）
function drawWall(x,y,c=0,r=0){
  ctx.fillStyle=MORTAR; ctx.fillRect(x,y,CELL,CELL);
  const rows=2, bh=CELL/rows, m=Math.max(1,Math.round(CELL*.07));
  for(let i=0;i<rows;i++){
    const off=((r*rows+i)%2)?CELL/2:0;
    for(let k=-1;k<2;k++){
      const bx=x+off+k*CELL, by=y+i*bh;
      const l=Math.max(bx,x), rr=Math.min(bx+CELL,x+CELL);
      if(rr-l<=m) continue;
      const shade=cellHash(c*3+k,r*2+i,5);
      ctx.fillStyle=shade<.5?BRICK:BRICK_HI;
      ctx.fillRect(l+(l===bx?m/2:0),by+m/2,rr-l-(l===bx?m/2:0)-(rr===bx+CELL?m/2:0),bh-m);
    }
  }
  ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fillRect(x,y,CELL,Math.max(1,CELL*.06));
  ctx.fillStyle='rgba(0,0,0,.28)'; ctx.fillRect(x,y+CELL-Math.max(1,CELL*.08),CELL,Math.max(1,CELL*.08));
}
function drawGlow(cx,cy,col){
  ctx.save(); ctx.globalAlpha=.15+.05*Math.sin(Date.now()*.005); ctx.fillStyle=col;
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    const nx=cx+dx, ny=cy+dy;
    if(ib(nx,ny)&&!walls.has(ky(nx,ny))&&!stationSet.has(ky(nx,ny)))
      ctx.fillRect(nx*CELL,ny*CELL,CELL,CELL);
  }
  ctx.restore();
}
function drawPlayer(player,body,outline){
  if(player.respawning) return;
  const px=player.x*CELL+CELL/2, py=player.y*CELL+CELL/2, r=CELL*.4;
  ctx.beginPath(); ctx.arc(px,py,r+CELL*.06,0,Math.PI*2); ctx.fillStyle='#F5F5F0'; ctx.fill();
  ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fillStyle=outline; ctx.fill();
  ctx.beginPath(); ctx.arc(px,py,r*.76,0,Math.PI*2); ctx.fillStyle=body; ctx.fill();
  const d=DIR[player.dir];
  const ex=px+d.x*r*.52, ey=py+d.y*r*.52;
  ctx.beginPath(); ctx.arc(ex,ey,r*.23,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(ex+d.x*r*.08,ey+d.y*r*.08,r*.1,0,Math.PI*2); ctx.fillStyle='#111'; ctx.fill();
  const inkFrac=player.ink/INK_MAX;
  ctx.beginPath(); ctx.arc(px,py,r+2.5,-Math.PI/2,-Math.PI/2+Math.PI*2*inkFrac);
  ctx.strokeStyle=inkFrac>.25?'rgba(255,255,255,.75)':'#ff2222'; ctx.lineWidth=2.5; ctx.stroke(); ctx.lineWidth=1;
}

function tickSpinnerQueue(player,dt){
  if(!player.spinnerQueue||player.spinnerQueue.length===0) return;
  player.spinnerQueueCd=Math.max(0,(player.spinnerQueueCd||0)-dt);
  if(player.spinnerQueueCd>0) return;
  const q=player.spinnerQueue.shift();
  bullets.push({
    x:player.x,y:player.y,fxdx:q.fxdx,fxdy:q.fxdy,
    dx:Math.round(q.fxdx)||(q.fxdx>0?1:-1),
    dy:Math.round(q.fxdy)||(q.fxdy>0?1:-1),
    color:player.color,owner:player,steps:q.steps,type:'spin',
    fx:player.x+.5,fy:player.y+.5,speed:q.speed
  });
  player.spinnerQueueCd=150;
}


// =====================================================
//  GAME LOOP
// =====================================================
let lt=0;
function loop(ts){
  if(!running) return;
  if(isPaused){ lt=ts; raf=requestAnimationFrame(loop); return; }
  const dt=ts-lt; lt=ts;
  players.forEach(p=>{
    if(p.human){ proc(p,p.keys,dt); tickSpinnerQueue(p,dt); tickTornado(p,dt); }
    else p.ai.update(dt);   // CPU は自分で弾の発射や回転も進める
  });
  players.forEach(p=>tickInk(p,dt));
  tickSensui(dt);
  btick+=dt;
  if(btick>=BTICK_MS){ btick=0; tickBullets(); tickMines(); }
  players.forEach(p=>{ if(!p.respawning&&ib(p.x,p.y)) paintCell(p.x,p.y,p.color); });
  updateScores(); updateInkUI(); draw();
  raf=requestAnimationFrame(loop);
}

function proc(player,keys,dt){
  player.moveCd=Math.max(0,player.moveCd-dt);
  player.shootCd=Math.max(0,player.shootCd-dt);


  let moved=false;
  if(player.moveCd<=0){
    if     (keys.up)   { move(player,'up');    player.moveCd=MOVE_CD; moved=true; }
    else if(keys.down) { move(player,'down');  player.moveCd=MOVE_CD; moved=true; }
    else if(keys.left) { move(player,'left');  player.moveCd=MOVE_CD; moved=true; }
    else if(keys.right){ move(player,'right'); player.moveCd=MOVE_CD; moved=true; }
  }

  if(player.weapon==='roller'&&moved&&!player.respawning) rollerPaint(player);

  if(player.weapon==='tornado'){
    player.chargeHeld=0; player.spinnerHeld=0;
    player.tornadoCd=Math.max(0,(player.tornadoCd||0)-dt);
    if(keys.shoot&&!player.respawning&&player.tornadoCd<=0){
      doTornadoPaint(player); player.tornadoCd=300;
    }
  } else if(player.weapon==='charger'){
    if(keys.shoot&&!player.respawning){ player.chargeHeld=(player.chargeHeld||0)+dt; }
    else if(!keys.shoot&&(player.chargeHeld||0)>0){
      if(player.shootCd<=0){ releaseCharger(player); player.shootCd=WCD.charger; }
      else{ player.chargeHeld=0; }
    }
  } else if(player.weapon==='spinner'){
    player.chargeHeld=0;
    player.spinnerCd=Math.max(0,(player.spinnerCd||0)-dt);
    if(keys.shoot&&!player.respawning&&player.spinnerCd<=0){ player.spinnerHeld=(player.spinnerHeld||0)+dt; }
    else if(!keys.shoot){
      if((player.spinnerHeld||0)>=SPINNER_SPINUP*.2) releaseSpinner(player);
      else player.spinnerHeld=0;
    }
  } else if(player.weapon==='tackle'){
    player.chargeHeld=0; player.spinnerHeld=0;
    if(keys.shoot&&player.shootCd<=0){ doTackle(player); player.shootCd=WCD.tackle; }
  } else if(player.weapon==='sensui'){
    player.chargeHeld=0; player.spinnerHeld=0;
    if(player.shootCd<=0){
      if(keys.shoot&&!player.respawning){
        player.sensuiHeld=Math.min((player.sensuiHeld||0)+dt,1500);
      } else if(!keys.shoot&&(player.sensuiHeld||0)>0){
        if(player.ink>=INK_COST.sensui){
          player.ink=Math.max(0,player.ink-INK_COST.sensui);
          releaseSensui(player);
          player.shootCd=WCD.sensui;
        } else {
          fxList.push({type:'nink',x:player.x,y:player.y,life:14,max:14});
        }
        player.sensuiHeld=0;
      }
    }
  } else {
    player.chargeHeld=0; player.spinnerHeld=0;
    if(keys.shoot&&player.shootCd<=0){ fire(player); player.shootCd=WCD[player.weapon]; }
  }
}
