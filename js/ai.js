// CPU の思考
// =====================================================
//  CPU AI  ―  GameAI class
// =====================================================
class GameAI {
  constructor(){
    this.faceDir      = 'left';
    this.moveDir      = 'left';   // 最後に実際に移動した方向
    this.state        = 'paint';  // 'paint'|'attack'|'refill'
    this.target       = null;     // {x,y}
    this.thinkTimer   = 0;
    this.shootPhase   = 'idle';   // charger/spinner チャージ状態
    this.shootHeld    = 0;
    this.lastX        = -1;
    this.lastY        = -1;
    this.stuckMs      = 0;
    // 経路阻まれ検出
    this.blockedMs    = 0;        // A*が最近接止まり（到達不能）の継続時間
    this.inkClearDir  = null;     // 敵インクを塗り切り開く方向
    // P1静止検出
    this.humanLastX   = -1;
    this.humanLastY   = -1;
    this.humanStillMs = 0;        // P1が同座標にいる時間
    this.flankAngle   = 0;        // 回り込み方向（+1/-1）
    // ヒステリシス（慣性）
    this.targetLockMs  = 0;       // 残りロック時間 — ロック中は再思考しない
    // レレレ移動（シューター系）
    this.strafe        = 1;       // 横移動方向（+1/-1）
    this.strafeTimer   = 0;       // 次に向き変換するまでの時間
    // 振動検出（A↔B ループ検知）
    this.posHistory    = [];      // 最新 6 位置 [{x,y}]
    // 倦怠防止（同一エリア長期滞在）
    this.boredomMs     = 0;       // 同 3×3 領域に滞在した累計時間
    this.boredomRegion = null;    // 現在の 3×3 領域 {rx,ry}
  }

  update(dt){
    const cpu=p2, human=p1;
    cpu.shootCd=Math.max(0,cpu.shootCd-dt);

    if(cpu.respawning){
      this.target=null; this.thinkTimer=0; this.stuckMs=0;
      this.blockedMs=0; this.inkClearDir=null;
      this.humanStillMs=0; this.flankAngle=0;
      this.targetLockMs=0; this.posHistory=[];
      this.boredomMs=0; this.boredomRegion=null;
      this.state='paint'; this.shootPhase='idle'; this.shootHeld=0;
      cpu.sensuiHeld=0;
      return;
    }

    // ─ 2a. 位置履歴・スタック・振動検出 ─
    if(cpu.x!==this.lastX||cpu.y!==this.lastY){
      this.lastX=cpu.x; this.lastY=cpu.y; this.stuckMs=0;
      // 振動検出用に最新 6 位置を記録
      this.posHistory.push({x:cpu.x,y:cpu.y});
      if(this.posHistory.length>6) this.posHistory.shift();
    } else {
      this.stuckMs+=dt;
    }
    // A↔B 往復振動を検知 → ターゲットをリセットして即座に再思考（_escapeStuckは moveCd ゲート外で呼ばない）
    if(this._isOscillating()){
      this.posHistory=[];
      this.targetLockMs=0;
      this.target=null; // 次の思考フェーズで新ターゲットを選定
    }

    // ─ 2b. P1静止検出 ─
    if(!human.respawning){
      if(human.x===this.humanLastX&&human.y===this.humanLastY){
        this.humanStillMs+=dt;
      } else {
        this.humanLastX=human.x; this.humanLastY=human.y;
        this.humanStillMs=0; this.flankAngle=0;
      }
    } else {
      this.humanStillMs=0;
    }

    // ─ 3. ヒステリシス・倦怠・思考 ─
    this.thinkTimer+=dt;
    this.targetLockMs=Math.max(0,this.targetLockMs-dt);

    // 倦怠防止: 同 3×3 領域に 3 秒以上いたら遠い塗りターゲットへ強制移動
    const _rx=Math.floor(cpu.x/3), _ry=Math.floor(cpu.y/3);
    if(this.boredomRegion&&this.boredomRegion.rx===_rx&&this.boredomRegion.ry===_ry){
      this.boredomMs+=dt;
    } else {
      this.boredomRegion={rx:_rx,ry:_ry}; this.boredomMs=0;
    }
    // 倦怠: P1が静止しているときや近くにいるときは遠征しない
    if(this.boredomMs>3000&&this.state==='paint'&&this.humanStillMs<1500){
      this.target=this._findDistantPaintTarget(cpu);
      this.boredomMs=0; this.targetLockMs=1000;
    }

    const t=this.target;
    const atTarget=t&&cpu.x===t.x&&cpu.y===t.y;
    // ヒステリシス: ロック中は再思考しない（ただし到達済み・ターゲットなしは除く）
    if((this.thinkTimer>=CPU_THINK_MS&&this.targetLockMs<=0)||!this.target||atTarget){
      this.thinkTimer=0;
      this._think(cpu,human);
    }

    // ─ 4. 移動 ─
    cpu.moveCd=Math.max(0,cpu.moveCd-dt);
    if(cpu.moveCd<=0&&!(cpu.sniperWindMs>0)){
      cpu.moveCd=MOVE_CD;

      // ★ スタック1秒超 → リフィルステーションへ強制移動してリセット
      if(this.stuckMs>1000){
        this.target=this._findRefillTarget(cpu);
        this.state='refill';
        this.stuckMs=0; this.blockedMs=0; this.inkClearDir=null;
        this._escapeStuck(cpu);
      } else {
        // 弾回避チェック（最優先）
        const dodgeDir=this._checkDodge(cpu);
        if(dodgeDir){
          this._move(cpu,dodgeDir);
          this.blockedMs=0;
        } else if(this.target){
          // ★ コスト重み付きA*（敵インク=高コスト）で経路探索
          const moveDir=this._aStarWeighted(cpu.x,cpu.y,this.target.x,this.target.y);

          // 到達不能カウント
          if(!moveDir&&!(cpu.x===this.target.x&&cpu.y===this.target.y)){
            this.blockedMs+=dt;
          } else {
            this.blockedMs=0; this.inkClearDir=null;
          }

          if(this.blockedMs>500){
            // 敵インクを射撃で切り開く
            const clearDir=this._findInkClearDir(cpu,this.target);
            if(clearDir){
              this.inkClearDir=clearDir;
              this.moveDir=clearDir;
            } else {
              this._escapeStuck(cpu);
              this.blockedMs=0;
            }
          } else if(moveDir){
            this.inkClearDir=null;
            this._move(cpu,moveDir);
          }
        }
      }

      // 向きは移動方向を反映してから射撃方向で上書き
      this._updateFaceDir(cpu,human);
      cpu.dir=this.faceDir;
      if(cpu.weapon==='roller'&&!cpu.respawning) rollerPaint(cpu);

      // ★ シューター系: 攻撃中は横方向のレレレ移動を追加
      const isShooter=cpu.weapon==='shooter';
      if(isShooter&&this.state==='attack'&&!this._checkDodge(cpu)){
        this.strafeTimer-=MOVE_CD;
        if(this.strafeTimer<=0){
          this.strafeTimer=300+Math.random()*400;
          this.strafe=(Math.random()<0.5?1:-1);
        }
        const fd=DIR[this.faceDir];
        const perpDir=this.strafe>0
          ?{x:-fd.y,y:fd.x}:{x:fd.y,y:-fd.x};
        const lateralDirs=Object.entries(DIR).filter(([,d])=>d.x===perpDir.x&&d.y===perpDir.y);
        if(lateralDirs.length>0){
          const [lDir]=lateralDirs[0];
          const lx=cpu.x+perpDir.x, ly=cpu.y+perpDir.y;
          const lk=ky(lx,ly);
          if(ib(lx,ly)&&!walls.has(lk)&&(stationSet.has(lk)||grid[ly][lx]!==1)){
            this._move(cpu,lDir);
          } else {
            this.strafe=-this.strafe;
          }
        }
      }
    }

    // ─ 5. 射撃 ─
    this._doShoot(cpu,human,dt);
    tickSpinnerQueue(cpu,dt);
  }

  // ── 思考：状態とターゲットを更新 ──────────────────
  _think(cpu,human){
    const inkPct=cpu.ink/INK_MAX;

    // インク不足 → リフィル
    if(inkPct<0.20){
      this.state='refill';
      this.target=this._findRefillTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=1000; // ヒステリシス
      return;
    }
    // リフィル完了判定
    if(this.state==='refill'&&inkPct>=0.80){
      this.state='paint';
      this.blockedMs=0; this.inkClearDir=null;
    }

    // ── 武器別専用ロジック ─────────────────────────────

    // ★ ローラー: 常に密着突進。リスポーン中は塗りジグザグ
    if(cpu.weapon==='roller'){
      const humanSafeR=human.respawning||safeZone(human.x,human.y,1);
      if(!humanSafeR&&inkPct>=0.20){
        this.state='attack';
        this.target=this._getCombatTarget(cpu,human);
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=400;
        return;
      }
      // リスポーン中 or インク不足 → 塗り残しジグザグ
      this.state='paint';
      this.target=this._findPaintTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=600;
      return;
    }

    // ★ チャージャー/スナイパー: 壁際の角で陣取り、LoSが通る場所を探す
    if(cpu.weapon==='charger'||cpu.weapon==='sniper'){
      const humanSafe2=human.respawning||safeZone(human.x,human.y,1);
      if(!humanSafe2&&inkPct>=0.25){
        const los=this.hasLineOfSight(cpu.x,cpu.y,human.x,human.y);
        if(los){
          // 射線あり: 距離を保ちながら狙う
          this.state='attack';
          this.target=this._getSniperHoldTarget(cpu,human);
          this.blockedMs=0; this.inkClearDir=null;
          this.targetLockMs=1200;
          return;
        }
        // 射線なし: LoSが通る壁際の角を探す
        const wp=this._findSniperPerch(cpu,human);
        if(wp){
          this.state='attack';
          this.target=wp;
          this.blockedMs=0; this.inkClearDir=null;
          this.targetLockMs=1200;
          return;
        }
      }
      // LoS不可 or 無敵 → 塗り
      this.state='paint';
      this.target=this._findPaintTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=1000;
      return;
    }

    // ★ ボム: 通路やインクステーション付近に設置してトラップ
    if(cpu.weapon==='bomb'){
      const humanSafe3=human.respawning||safeZone(human.x,human.y,1);
      if(!humanSafe3&&inkPct>=0.30){
        const trapTarget=this._findTrapTarget(cpu,human);
        if(trapTarget){
          this.state='attack';
          this.target=trapTarget;
          this.blockedMs=0; this.inkClearDir=null;
          this.targetLockMs=900;
          return;
        }
      }
      this.state='paint';
      this.target=this._findPaintTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=900;
      return;
    }
    // ★ 地雷: 積極的にトラップを設置（キル・陣地・ステーション防衛）
    if(cpu.weapon==='mine'){
      const humanSafe3m=human.respawning||safeZone(human.x,human.y,1);
      if(inkPct>=0.10){
        const mineTarget=this._findMineTrapTarget(cpu,human,humanSafe3m);
        this.state=humanSafe3m?'paint':'attack';
        this.target=mineTarget||this._findPaintTarget(cpu);
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=400; // 短いロック: 素早く配置転換
        return;
      }
      this.state='refill';
      this.target=this._findRefillTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=600;
      return;
    }

    // ★ タツマキ/タックル: インク満タン時に突撃
    if(cpu.weapon==='tornado'||cpu.weapon==='tackle'){
      const humanSafe5=human.respawning||safeZone(human.x,human.y,1);
      if(!humanSafe5&&inkPct>=0.85){
        this.state='attack';
        this.target=this._getCombatTarget(cpu,human);
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=600;
        return;
      }
      // インク不足/無敵 → 塗り or リフィル
      if(inkPct<0.60){
        this.state='refill';
        this.target=this._findRefillTarget(cpu);
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=800;
        return;
      }
      this.state='paint';
      this.target=this._findPaintTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=800;
      return;
    }

    // ★ センスイ: インクが20%以上あれば積極的にワープ攻撃
    if(cpu.weapon==='sensui'){
      const humanSafeSe=human.respawning||safeZone(human.x,human.y,1);
      if(!humanSafeSe&&inkPct>=0.20){
        this.state='attack';
        this.target=this._getCombatTarget(cpu,human);
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=600;
        return;
      }
      this.state='paint';
      this.target=this._findPaintTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=800;
      return;
    }

    // ★ デンキウナギ: 状況に応じて柔軟な運用（直接攻撃・反射待ち伏せ・塗り）
    if(cpu.weapon==='eel'){
      const humanSafe6=human.respawning||safeZone(human.x,human.y,1);
      if(!humanSafe6&&inkPct>=0.15){
        // 射線が通っている場合: 60%の確率で直接攻撃（ゆらぎ）
        const los=this.hasLineOfSight(cpu.x,cpu.y,human.x,human.y);
        if(los&&Math.random()<0.6){
          this.state='attack';
          this.target=this._getCombatTarget(cpu,human);
          this.blockedMs=0; this.inkClearDir=null;
          this.targetLockMs=600;
          return;
        }
        // 壁が多いエリアで待ち伏せ（反射狙い）
        const eelPos=this._findEelAmbushPos(cpu,human);
        if(eelPos){
          this.state='attack';
          this.target=eelPos;
          this.blockedMs=0; this.inkClearDir=null;
          this.targetLockMs=900;
          return;
        }
        // 待ち伏せ位置が見つからない → 直接追撃
        this.state='attack';
        this.target=this._getCombatTarget(cpu,human);
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=600;
        return;
      }
      // 塗り優先（インク不足 or 敵無敵中）
      this.state='paint';
      this.target=this._findPaintTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=900;
      return;
    }

    // 戦闘フェーズ判定（★ 射線チェック付き）
    // リスポーン中 or セーフゾーン（無敵）は攻撃しない
    const humanSafe=human.respawning||safeZone(human.x,human.y,1);
    if(!humanSafe){
      const dist=Math.abs(human.x-cpu.x)+Math.abs(human.y-cpu.y);
      if(this._shouldEnterCombat(cpu.weapon,dist,inkPct)){
        const los=this.hasLineOfSight(cpu.x,cpu.y,human.x,human.y);
        if(los){
          // 射線あり → アンチミラー込みの攻撃目標
          this.state='attack';
          this.target=this._getCombatTarget(cpu,human);
          this.blockedMs=0; this.inkClearDir=null;
          this.targetLockMs=1000; // ヒステリシス
          return;
        } else {
          // ★ 射線なし → 壁を回り込めるウェイポイントを探す
          const wp=this._findFlankWaypoint(cpu,human);
          if(wp){
            this.state='attack';
            this.target=wp;
            this.blockedMs=0; this.inkClearDir=null;
            this.targetLockMs=1000; // ヒステリシス
            return;
          }
          // ウェイポイントが遠すぎる/なし → 塗りに専念
          this.state='paint';
        }
      }
    }

    // P1がリスポーン中 or セーフゾーン（無敵）のときは塗りを優先
    if(humanSafe) this.state='paint';

    // ★ P1 が静止している間は積極的に接近・攻撃（射程外でも向かう）
    // 無敵中は除外
    if(!humanSafe&&this.humanStillMs>1500&&this.state!=='refill'&&inkPct>=0.25){
      const los=this.hasLineOfSight(cpu.x,cpu.y,human.x,human.y);
      if(los){
        // 射線あり → 直接攻撃状態へ
        this.state='attack';
        this.target=this._getCombatTarget(cpu,human);
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=800;
        return;
      }
      // 射線なし → フランクウェイポイントで回り込む
      const wp=this._findFlankWaypoint(cpu,human);
      if(wp){
        this.state='attack';
        this.target=wp;
        this.blockedMs=0; this.inkClearDir=null;
        this.targetLockMs=800;
        return;
      }
      // フランク不可でも直接向かう（射程外OK）
      this.state='attack';
      this.target=this._getCombatTarget(cpu,human);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=800;
      return;
    }

    // 塗りターゲット
    if(this.state==='paint'||!this.target){
      this.target=this._findPaintTarget(cpu);
      this.blockedMs=0; this.inkClearDir=null;
      this.targetLockMs=1000; // ヒステリシス
    }
  }

  _shouldEnterCombat(weapon,dist,inkPct){
    if(inkPct<0.15) return false;
    const range={roller:16,tackle:4,sensui:8,
      sniper:14,charger:14,eel:8,
      bomb:5,tornado:4,
      shooter:5,curling:7,mine:3,spinner:5};
    return dist<=(range[weapon]||5);
  }

  // 座標が「CPUが到達可能」かチェック（壁・範囲外はNG）
  _walkable(x,y){
    return ib(x,y)&&!walls.has(ky(x,y));
  }

  // ★ 射線チェック: (x1,y1)→(x2,y2) の間に壁があれば false
  // Bresenham の直線アルゴリズムで各マスを判定
  hasLineOfSight(x1,y1,x2,y2){
    let x=x1, y=y1;
    const dx=Math.abs(x2-x1), dy=Math.abs(y2-y1);
    const sx=x1<x2?1:-1, sy=y1<y2?1:-1;
    let err=dx-dy;
    while(true){
      if(x===x2&&y===y2) return true;
      if(walls.has(ky(x,y))) return false;
      const e2=2*err;
      if(e2>-dy){ err-=dy; x+=sx; }
      if(e2< dx){ err+=dx; y+=sy; }
    }
  }

  // ★ 壁越しに敵を回り込めるウェイポイントを探す
  // P1周辺（半径 r マス）で「CPUから射線が通り、かつ歩いて到達可能」なセルを探す
  _findFlankWaypoint(cpu,human){
    const R=6; // 探索半径
    let bestWp=null, bestCost=9999;
    for(let dy=-R;dy<=R;dy++){
      for(let dx=-R;dx<=R;dx++){
        const wx=human.x+dx, wy=human.y+dy;
        if(!this._walkable(wx,wy)) continue;
        if(safeZone(wx,wy,1)) continue;
        // 敵インクの上は歩けない
        if(!stationSet.has(ky(wx,wy))&&grid[wy][wx]===1) continue;
        // P1に射線が通るか
        if(!this.hasLineOfSight(wx,wy,human.x,human.y)) continue;
        // CPUから歩いて到達可能か（A*コストで判断）
        const cost=Math.abs(wx-cpu.x)+Math.abs(wy-cpu.y);
        if(cost<bestCost){ bestCost=cost; bestWp={x:wx,y:wy}; }
      }
    }
    // 遠すぎる（14マス超）なら諦めて塗りへ
    if(bestCost>14) return null;
    return bestWp;
  }

  // ★ コスト重み付きA*
  // 自軍インク=コスト1、白マス=コスト2、敵インク=壁（通行不可）
  // これにより自軍インクの上を優先的に通って回り込む
  _aStarWeighted(sx,sy,tx,ty){
    if(sx===tx&&sy===ty) return null;
    const H=(x,y)=>Math.abs(x-tx)+Math.abs(y-ty);
    const startK=ky(sx,sy);
    const open=[[H(sx,sy),0,sx,sy]];
    const gMap=new Map([[startK,0]]);
    const par =new Map([[startK,null]]);
    let bestKey=null, bestH=H(sx,sy);

    while(open.length>0){
      let mi=0;
      for(let i=1;i<open.length;i++) if(open[i][0]<open[mi][0]) mi=i;
      const[,g,x,y]=open.splice(mi,1)[0];
      const curK=ky(x,y);
      if(x===tx&&y===ty) return this._traceFirst(par,sx,sy,curK);

      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        const nx=x+ddx, ny=y+ddy, nk=ky(nx,ny);
        if(!ib(nx,ny)||walls.has(nk)) continue;
        // 敵インクは壁として通行不可（ステーションは可）
        if(!stationSet.has(nk)&&grid[ny][nx]===1) continue;
        // コスト: 自軍インク=1、白マス=2（敵インクは上で除外済み）
        const cost=grid[ny][nx]===2?1:2;
        const ng=g+cost;
        if(gMap.has(nk)&&gMap.get(nk)<=ng) continue;
        gMap.set(nk,ng);
        par.set(nk,curK);
        const h=H(nx,ny);
        open.push([ng+h,ng,nx,ny]);
        if(h<bestH){bestH=h;bestKey=nk;}
      }
    }
    if(bestKey) return this._traceFirst(par,sx,sy,bestKey);
    return null;
  }

  _getCombatTarget(cpu,human){
    const w=cpu.weapon;
    // ローラー: P1の隣接マス（歩ける・自軍or中立）を最近目標に。移動自体が攻撃になる
    if(w==='roller'){
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        const nx=human.x+ddx, ny=human.y+ddy;
        if(!this._walkable(nx,ny)) continue;
        const nk=ky(nx,ny);
        if(stationSet.has(nk)||grid[ny]?.[nx]!==1) return {x:nx,y:ny};
      }
      // 隣接マスが全て敵インクなら半径2まで広げる
      for(const[ddx,ddy] of [[0,-2],[0,2],[-2,0],[2,0],[-1,-1],[-1,1],[1,-1],[1,1]]){
        const nx=human.x+ddx, ny=human.y+ddy;
        if(!this._walkable(nx,ny)) continue;
        const nk=ky(nx,ny);
        if(stationSet.has(nk)||grid[ny]?.[nx]!==1) return {x:nx,y:ny};
      }
      return {x:RP2.x,y:RP2.y};
    }
    // タックル: 直接P1へ
    if(w==='tackle'){
      if(this._walkable(human.x,human.y)) return {x:human.x,y:human.y};
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        const nx=human.x+ddx, ny=human.y+ddy;
        if(this._walkable(nx,ny)) return {x:nx,y:ny};
      }
      return {x:RP2.x,y:RP2.y};
    }
    // 遠距離系: 適正距離(5-8マス)を保つ
    if(w==='sniper'||w==='charger'){
      const dist=Math.abs(human.x-cpu.x)+Math.abs(human.y-cpu.y);
      if(dist<5){
        const dx=Math.sign(cpu.x-human.x)||1, dy=Math.sign(cpu.y-human.y)||0;
        const ex=cpu.x+dx*3, ey=cpu.y+dy*3;
        if(this._walkable(ex,ey)) return {x:ex,y:ey};
      }
    }
    // ★ アンチミラー: P1の位置を直接ターゲットにせず 2 マスのパーソナルスペースを設ける
    // P1 から CPU 方向に 2 マスずらした座標を目標にする（相手の動きをミラーしない）
    const pdx=Math.sign(cpu.x-human.x)||(Math.random()<0.5?1:-1);
    const pdy=Math.sign(cpu.y-human.y)||(pdx===0?(Math.random()<0.5?1:-1):0);
    // 横方向の分離を優先（左右ずれが大きい方向でパーソナルスペースを確保）
    const SPACE=2;
    const px=human.x+pdx*SPACE, py=human.y+pdy*SPACE;
    // 歩けて、かつ敵インクでない（ステーションは可）
    const pnk=ky(px,py);
    if(this._walkable(px,py)&&(stationSet.has(pnk)||grid[py]?.[px]!==1)){
      return {x:px,y:py};
    }
    // フォールバック: 予測射撃（P1 の移動先 1 マス）
    return this._leadTarget(human)||{x:human.x,y:human.y};
  }

  _leadTarget(human){
    const d=DIR[human.dir];
    if(!d) return null;
    const tx=human.x+d.x, ty=human.y+d.y;
    if(this._walkable(tx,ty)) return {x:tx,y:ty};
    return {x:human.x,y:human.y};
  }

  // ターゲットへの経路が敵インクに阻まれているか判定
  // A*が到達できずbetKeyに落ちた＝目標と現在地のマンハッタン距離 > 到達した最近接の距離
  _isPathBlocked(cpu,target){
    if(!target) return false;
    // 目標への直接ルートで隣接セルが全て壁か敵インクなら阻まれていると判断
    let blockedCount=0, totalCount=0;
    for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
      const nx=cpu.x+ddx, ny=cpu.y+ddy;
      if(!ib(nx,ny)) continue;
      totalCount++;
      const nk=ky(nx,ny);
      if(walls.has(nk)) blockedCount++;
      else if(!stationSet.has(nk)&&grid[ny][nx]===1) blockedCount++;
    }
    // 移動可能な方向がゼロ、またはターゲットへのA*が「そこへは行けない」状態
    if(totalCount>0&&blockedCount===totalCount) return true;
    // ターゲット方向に向かう隣接セルが敵インクかどうか
    const dx=Math.sign(target.x-cpu.x), dy=Math.sign(target.y-cpu.y);
    if(dx!==0){
      const nk=ky(cpu.x+dx,cpu.y);
      if(ib(cpu.x+dx,cpu.y)&&!walls.has(nk)&&!stationSet.has(nk)&&grid[cpu.y][cpu.x+dx]===1) return true;
    }
    if(dy!==0){
      const nk=ky(cpu.x,cpu.y+dy);
      if(ib(cpu.x,cpu.y+dy)&&!walls.has(nk)&&!stationSet.has(nk)&&grid[cpu.y+dy][cpu.x]===1) return true;
    }
    return false;
  }

  // 経路を阻む敵インクを射撃で塗り切り開く方向を返す
  _findInkClearDir(cpu,target){
    if(!target) return null;
    // ターゲット方向を優先、次に敵インクが多い方向
    const dirs=['up','down','left','right'];
    const targetDx=target.x-cpu.x, targetDy=target.y-cpu.y;
    // ターゲット方向に近い順に並び替え
    dirs.sort((a,b)=>{
      const da=DIR[a], db=DIR[b];
      const scoreA=da.x*Math.sign(targetDx)+da.y*Math.sign(targetDy);
      const scoreB=db.x*Math.sign(targetDx)+db.y*Math.sign(targetDy);
      return scoreB-scoreA;
    });
    for(const dir of dirs){
      const d=DIR[dir];
      // その方向に敵インクがあるか確認（壁でないこと）
      let hasEnemyInk=false;
      let cx=cpu.x, cy=cpu.y;
      for(let i=1;i<=4;i++){
        cx+=d.x; cy+=d.y;
        if(!ib(cx,cy)||walls.has(ky(cx,cy))) break;
        if(grid[cy][cx]===1){ hasEnemyInk=true; break; }
      }
      if(hasEnemyInk) return dir;
    }
    return null;
  }

  // P1が静止しているとき、回り込んで射程に収める方向を返す
  _getFlankDir(cpu,human){
    // 現在の向きに対して左右に回り込む
    if(this.flankAngle===0) this.flankAngle=(Math.random()<0.5?1:-1);
    const dirOrder=['right','down','left','up'];
    const curIdx=dirOrder.indexOf(this.moveDir);
    // 回り込む方向（現在の移動方向から90度）
    const flankIdx=(curIdx+this.flankAngle*1+4)%4;
    const flankDir=dirOrder[flankIdx];
    const fd=DIR[flankDir];
    const nx=cpu.x+fd.x, ny=cpu.y+fd.y;
    const nk=ky(nx,ny);
    if(ib(nx,ny)&&!walls.has(nk)&&(stationSet.has(nk)||grid[ny][nx]!==1)){
      return flankDir;
    }
    // その方向が敵インク等で無理なら逆側
    const altIdx=(curIdx-this.flankAngle*1+4)%4;
    const altDir=dirOrder[altIdx];
    const ad=DIR[altDir];
    const ax=cpu.x+ad.x, ay=cpu.y+ad.y;
    const ak=ky(ax,ay);
    if(ib(ax,ay)&&!walls.has(ak)&&(stationSet.has(ak)||grid[ay][ax]!==1)){
      return altDir;
    }
    return null;
  }

  _findRefillTarget(cpu){
    let best=null, bestD=9999;
    inkStations.forEach(s=>{
      if(s.color!==2) return;
      const d=Math.abs(s.x-cpu.x)+Math.abs(s.y-cpu.y);
      if(d<bestD){bestD=d;best=s;}
    });
    return best?{x:best.x,y:best.y}:{x:RP2.x,y:RP2.y};
  }

  _findPaintTarget(cpu){
    let bestScore=-Infinity, bestX=-1, bestY=-1;
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
      if(walls.has(ky(x,y))||stationSet.has(ky(x,y))) continue;
      if(safeZone(x,y,1)) continue;
      const g=grid[y][x];
      if(g===2) continue; // 自軍インクはスキップ
      const dist=Math.abs(x-cpu.x)+Math.abs(y-cpu.y);
      if(dist===0) continue;
      // 白マス(g===0)と敵インク(g===1)を両方ターゲットに。
      // 敵インクマスは踏めないので実効距離を+1（隣接して射撃するため）
      const effectiveDist=(g===1)?dist+1:dist;
      let score=(g===1?22:12)-effectiveDist*0.5;
      score+=Math.max(0,5-Math.abs(x-COLS/2)*0.25-Math.abs(y-ROWS/2)*0.25);
      if(score>bestScore){bestScore=score;bestX=x;bestY=y;}
    }
    if(bestX>=0) return {x:bestX,y:bestY};
    return {x:RP2.x,y:RP2.y};
  }

  // ── 弾回避 ─────────────────────────────────────────
  _checkDodge(cpu){
    const EVADE=[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
    for(const b of bullets){
      if(b.owner===cpu) continue;
      if(b.dx===0&&b.dy===0) continue;
      const h1x=b.x+b.dx, h1y=b.y+b.dy;
      const h2x=b.x+b.dx*2, h2y=b.y+b.dy*2;
      const inPath=(h1x===cpu.x&&h1y===cpu.y)||(h2x===cpu.x&&h2y===cpu.y);
      if(!inPath) continue;
      // 弾と垂直方向を優先した退避先を探す
      const perp=EVADE.filter(([,ddx,ddy])=>!(ddx===b.dx&&ddy===b.dy));
      for(const[dirName,ddx,ddy] of [...perp,...EVADE]){
        const nx=cpu.x+ddx, ny=cpu.y+ddy;
        const nk=ky(nx,ny);
        if(!ib(nx,ny)||walls.has(nk)) continue;
        // 退避先も敵インクは避ける（プレイヤーと同ルール）
        if(!stationSet.has(nk)&&grid[ny][nx]===1) continue;
        if(!p1.respawning&&nx===p1.x&&ny===p1.y) continue;
        if(nx===h1x&&ny===h1y) continue;
        return dirName;
      }
    }
    return null;
  }

  _escapeStuck(cpu){
    const dirs=['up','down','left','right'].sort(()=>Math.random()-.5);
    // タックルなら敵インクも強引に突破できる
    if(cpu.weapon==='tackle'){
      // 敵インクに囲まれているか確認
      let enemyInkAdj=0;
      for(const dir of dirs){
        const d=DIR[dir];
        const nx=cpu.x+d.x, ny=cpu.y+d.y;
        const nk=ky(nx,ny);
        if(ib(nx,ny)&&!walls.has(nk)&&!stationSet.has(nk)&&grid[ny][nx]===1) enemyInkAdj++;
      }
      if(enemyInkAdj>=2){
        // タックルで脱出（cpu.dirを脱出方向に設定してdoTackle）
        for(const dir of dirs){
          const d=DIR[dir];
          const nx=cpu.x+d.x, ny=cpu.y+d.y;
          if(ib(nx,ny)&&!walls.has(ky(nx,ny))){
            cpu.dir=dir; this.faceDir=dir; this.moveDir=dir;
            if(cpu.ink>=INK_COST.tackle) doTackle(cpu);
            return;
          }
        }
      }
    }
    for(const dir of dirs){
      const d=DIR[dir];
      const nx=cpu.x+d.x, ny=cpu.y+d.y;
      const nk=ky(nx,ny);
      if(!ib(nx,ny)||walls.has(nk)) continue;
      // 敵インクも避ける（プレイヤーと同ルール）
      if(!stationSet.has(nk)&&grid[ny][nx]===1) continue;
      if(!p1.respawning&&nx===p1.x&&ny===p1.y) continue;
      this._move(cpu,dir); return;
    }
    // 全方向が壁か敵インクで塞がれている場合 → 隣接する敵インクの方向を向いて射撃で切り開く
    for(const dir of dirs){
      const d=DIR[dir];
      const nx=cpu.x+d.x, ny=cpu.y+d.y;
      if(ib(nx,ny)&&!walls.has(ky(nx,ny))&&grid[ny][nx]===1){
        this.moveDir=dir; break; // 向き更新して_doShootに任せる
      }
    }
  }

  // ── 移動（プレイヤーと同じルール、敵インク踏み越えなし） ───
  _move(cpu,dir){
    const px=cpu.x, py=cpu.y;
    move(cpu,dir);
    // 実際に動けた方向だけ記録（向き更新に使用）
    if(cpu.x!==px||cpu.y!==py) this.moveDir=dir;
  }

  _traceFirst(par,sx,sy,goalKey){
    const startKey=ky(sx,sy);
    let cur=goalKey;
    while(true){
      const prev=par.get(cur);
      if(prev===undefined) return null;
      if(prev===null||prev===startKey) break;
      cur=prev;
    }
    const[fx,fy]=cur.split(',').map(Number);
    const ddx=fx-sx, ddy=fy-sy;
    if(ddy===-1) return 'up';
    if(ddy=== 1) return 'down';
    if(ddx===-1) return 'left';
    if(ddx=== 1) return 'right';
    return null;
  }

  // ── 戦闘用: 敵が射線上にいる方向を返す ─────────────
  _getCombatShootDir(cpu,human){
    // リスポーン中 or セーフゾーン（無敵）には撃たない
    if(human.respawning||safeZone(human.x,human.y,1)) return null;
    const w=cpu.weapon;
    const inkOk=(INK_COST[w]||0)===0||cpu.ink>=(INK_COST[w]||0);
    if(!inkOk) return null;
    const lineRange=
      w==='sniper'?14:
      w==='charger'?14:
      w==='eel'||w==='curling'?10:
      w==='sensui'?8:
      w==='bomb'?5:
      w==='shooter'?4:3;
    for(const[dirName,d] of Object.entries(DIR)){
      let cx=cpu.x,cy=cpu.y;
      for(let i=0;i<lineRange;i++){
        cx+=d.x; cy+=d.y;
        if(!ib(cx,cy)||walls.has(ky(cx,cy))) break;
        if(cx===human.x&&cy===human.y) return dirName;
      }
    }
    const mDist=Math.abs(human.x-cpu.x)+Math.abs(human.y-cpu.y);
    if(w==='tornado'&&mDist<=3){
      const hdx=human.x-cpu.x,hdy=human.y-cpu.y;
      return(Math.abs(hdx)>=Math.abs(hdy))?(hdx>=0?'right':'left'):(hdy>=0?'down':'up');
    }
    if(w==='tackle'&&mDist<=3) return this.faceDir;
    return null;
  }

  // ── 塗り用: 前方に敵インク/白マスがある方向を返す ──
  // 弾が届く射程内に塗れるマスが最も多い方向を選ぶ
  _getPaintShootDir(cpu){
    const w=cpu.weapon;
    if(w==='mine'||w==='tackle'||w==='roller') return null;
    const inkOk=(INK_COST[w]||0)===0||cpu.ink>=(INK_COST[w]||0);
    if(!inkOk) return null;
    const shootRange=
      w==='sniper'?14:
      w==='charger'?14:
      w==='eel'||w==='curling'?10:
      w==='sensui'?8:
      w==='bomb'?4:
      w==='shooter'?4:3;

    let bestDir=null, bestCount=0;
    for(const[dirName,d] of Object.entries(DIR)){
      let cx=cpu.x,cy=cpu.y,count=0;
      for(let i=0;i<shootRange;i++){
        cx+=d.x; cy+=d.y;
        if(!ib(cx,cy)||walls.has(ky(cx,cy))) break;
        const g=grid[cy][cx];
        if(g===0||g===1) count++; // 白マスまたは敵インク
        // 自軍インクを超えても塗れるマスを探す
      }
      if(count>bestCount){bestCount=count;bestDir=dirName;}
    }
    // 少なくとも1マス塗れる方向があれば返す
    return bestCount>0?bestDir:null;
  }

  // ── 向き更新: 戦闘射撃方向 > 移動方向の優先度 ──────
  // ※ 塗り射撃は_doShoot内でcpu.dirを上書きするため_updateFaceDirには含めない
  _updateFaceDir(cpu,human){
    this.faceDir=this.moveDir;
    const sd=this._getCombatShootDir(cpu,human);
    if(sd) this.faceDir=sd;
  }

  // ── 射撃実行 ────────────────────────────────────────
  _doShoot(cpu,human,dt){
    const w=cpu.weapon;
    if(w==='roller') return;
    const inkOk=(INK_COST[w]||0)===0||cpu.ink>=(INK_COST[w]||0);

    // 戦闘射撃判定（P1が射線上にいる）
    const combatDir=this._getCombatShootDir(cpu,human);
    const canCombat=combatDir!==null&&inkOk;

    // 塗り射撃判定（前方に塗れるマス、または経路切り開き方向）
    const rawPaintDir=(!canCombat&&this.state==='paint')?this._getPaintShootDir(cpu):null;
    // inkClearDir（経路阻まれ時）が指定されていれば優先
    const paintDir=this.inkClearDir||rawPaintDir;
    const canPaint=paintDir!==null&&inkOk;

    // eel: 射撃判断 — 壁反射狙いか直接塗りかをランダムに選択（ゆらぎ）
    if(w==='eel'&&!canCombat&&inkOk&&cpu.shootCd<=0){
      const eelDir=this._getEelShootDir(cpu);
      // 30%の確率で直接塗り方向を選択（塗り効率優先のゆらぎ）
      if(eelDir&&Math.random()<0.3&&paintDir){
        cpu.dir=this.faceDir=paintDir; fire(cpu); cpu.shootCd=WCD.eel; return;
      }
      if(eelDir){ cpu.dir=this.faceDir=eelDir; fire(cpu); cpu.shootCd=WCD.eel; return; }
      // 壁が近くにない → 直接塗り方向で射撃
      if(paintDir){ cpu.dir=this.faceDir=paintDir; fire(cpu); cpu.shootCd=WCD.eel; return; }
    }

    // 射撃方向を確定してcpu.dirに反映
    const shootDir=combatDir||paintDir;
    if(shootDir) cpu.dir=this.faceDir=shootDir;

    if(w==='charger'){
      if(cpu.shootCd>0){cpu.chargeHeld=0;this.shootPhase='idle';return;}
      const wantFire=canCombat||canPaint;
      if(this.shootPhase==='idle'&&wantFire){this.shootPhase='charging';this.shootHeld=0;}
      if(this.shootPhase==='charging'){
        cpu.chargeHeld=(cpu.chargeHeld||0)+dt; this.shootHeld+=dt;
        if(this.shootHeld>=700){
          releaseCharger(cpu);cpu.shootCd=WCD.charger;
          cpu.chargeHeld=0;this.shootPhase='idle';this.shootHeld=0;
        }
      } else { cpu.chargeHeld=0; }
      return;
    }
    if(w==='spinner'){
      if(cpu.shootCd>0){cpu.spinnerHeld=0;this.shootPhase='idle';return;}
      const wantFire=canCombat||canPaint;
      if(this.shootPhase==='idle'&&wantFire){this.shootPhase='charging';this.shootHeld=0;}
      if(this.shootPhase==='charging'){
        cpu.spinnerHeld=(cpu.spinnerHeld||0)+dt; this.shootHeld+=dt;
        if(this.shootHeld>=900){
          releaseSpinner(cpu);cpu.shootCd=WCD.spinner||600;
          cpu.spinnerHeld=0;this.shootPhase='idle';this.shootHeld=0;
        }
      } else { cpu.spinnerHeld=0; }
      return;
    }
    if(w==='tornado'){
      cpu.tornadoCd=Math.max(0,(cpu.tornadoCd||0)-dt);
      // 戦闘時は敵が近い場合のみ、塗り時は常に発動
      const nearHuman=!human.respawning&&Math.abs(human.x-cpu.x)<=3&&Math.abs(human.y-cpu.y)<=3;
      const wantFire=inkOk&&cpu.tornadoCd<=0&&(nearHuman||(this.state==='paint'));
      if(wantFire){doTornadoPaint(cpu);cpu.tornadoCd=300;}
      return;
    }
    // sniper: 300ms溜めてから発射（溜め中は移動もキャンセル）
    if(w==='sniper'){
      if((cpu.sniperWindMs||0)>0){
        cpu.sniperWindMs=Math.max(0,(cpu.sniperWindMs||0)-dt);
        if(cpu.sniperWindMs<=0&&cpu.shootCd<=0){
          playSE('shoot'); doSniper(cpu); cpu.shootCd=WCD.sniper;
        }
        return;
      }
      if((canCombat||canPaint)&&cpu.shootCd<=0){
        const dir=combatDir||paintDir;
        if(dir) cpu.dir=this.faceDir=dir;
        cpu.sniperWindMs=300;
      }
      return;
    }
    if(w==='sensui'){
      if(cpu.shootCd>0){ cpu.sensuiHeld=0; return; }
      const wantFire=(canCombat||canPaint)&&inkOk;
      if(!wantFire){ cpu.sensuiHeld=0; return; }
      const dir=combatDir||paintDir;
      if(dir) cpu.dir=this.faceDir=dir;
      const humanDist=Math.abs(human.x-cpu.x)+Math.abs(human.y-cpu.y);
      const warpCells=Math.min(10,Math.max(2,canCombat?Math.min(humanDist-1,8):5));
      cpu.sensuiHeld=(cpu.sensuiHeld||0)+dt;
      if(cpu.sensuiHeld>=warpCells*150&&cpu.ink>=INK_COST.sensui){
        cpu.ink=Math.max(0,cpu.ink-INK_COST.sensui);
        releaseSensui(cpu);
        cpu.shootCd=WCD.sensui;
      }
      return;
    }
    if(cpu.shootCd>0) return;
    if(w==='tackle'){
      if(canCombat){doTackle(cpu);cpu.shootCd=WCD.tackle;}
      return;
    }
    // mine: CDが切れ次第即座に設置（積極的）
    if(w==='mine'){
      if(inkOk){ fire(cpu); cpu.shootCd=WCD.mine; }
      return;
    }
    // 通常武器: 戦闘射撃 or 塗り射撃
    if(canCombat||canPaint){fire(cpu);cpu.shootCd=WCD[w]||300;}
  }

  // ── チャージャー/スナイパー: 現在地で射線が通るなら距離を保つ座標を返す ──
  _getSniperHoldTarget(cpu,human){
    const dist=Math.abs(human.x-cpu.x)+Math.abs(human.y-cpu.y);
    const ideal=9; // 理想距離
    if(dist>=ideal-1) return {x:cpu.x,y:cpu.y}; // 現在地で待機
    // 近すぎる → 後退
    const dx=Math.sign(cpu.x-human.x)||1, dy=Math.sign(cpu.y-human.y)||0;
    const ex=cpu.x+dx*3, ey=cpu.y+dy*3;
    if(this._walkable(ex,ey)) return {x:ex,y:ey};
    return {x:cpu.x,y:cpu.y};
  }

  // ── チャージャー/スナイパー: P1に射線が通る壁際の角を探す ──
  _findSniperPerch(cpu,human){
    let best=null, bestScore=-9999;
    for(let y=1;y<ROWS-1;y++) for(let x=1;x<COLS-1;x++){
      if(!this._walkable(x,y)) continue;
      if(!stationSet.has(ky(x,y))&&grid[y][x]===1) continue;
      if(safeZone(x,y,1)) continue;
      // 壁隣接マス（陣地感）を優先
      let wallAdj=0;
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        if(walls.has(ky(x+ddx,y+ddy))) wallAdj++;
      }
      if(wallAdj<1) continue; // 壁に隣接していない場所は除外
      if(!this.hasLineOfSight(x,y,human.x,human.y)) continue;
      const dist=Math.abs(x-human.x)+Math.abs(y-human.y);
      const cpuDist=Math.abs(x-cpu.x)+Math.abs(y-cpu.y);
      // 理想距離6〜10、CPUから近い、壁隣接多いほど高スコア
      const distScore=-(Math.abs(dist-8)*0.5);
      const score=distScore+wallAdj*2-cpuDist*0.3;
      if(score>bestScore){ bestScore=score; best={x,y}; }
    }
    return best;
  }

  // ── ボム/地雷: 通路やインクステーション付近のトラップポイントを探す ──
  _findTrapTarget(cpu,human){
    // インクステーション付近（敵色のステーション）を優先
    let best=null, bestScore=-9999;
    // 敵のインクステーション付近
    for(const s of inkStations){
      if(s.color===2) continue; // 自分のステーションは除外
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        const x=s.x+ddx, y=s.y+ddy;
        if(!this._walkable(x,y)) continue;
        if(!stationSet.has(ky(x,y))&&grid[y][x]===1) continue;
        const cpuDist=Math.abs(x-cpu.x)+Math.abs(y-cpu.y);
        const enemyDist=Math.abs(x-human.x)+Math.abs(y-human.y);
        const score=10-cpuDist*0.4+enemyDist*0.2;
        if(score>bestScore){ bestScore=score; best={x,y}; }
      }
    }
    if(best) return best;
    // 通路（壁2面以上に囲まれたセル）を探す
    for(let y=1;y<ROWS-1;y++) for(let x=1;x<COLS-1;x++){
      if(!this._walkable(x,y)) continue;
      if(!stationSet.has(ky(x,y))&&grid[y][x]===1) continue;
      let wallAdj=0;
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        if(walls.has(ky(x+ddx,y+ddy))||!ib(x+ddx,y+ddy)) wallAdj++;
      }
      if(wallAdj<2) continue;
      const cpuDist=Math.abs(x-cpu.x)+Math.abs(y-cpu.y);
      const enemyDist=Math.abs(x-human.x)+Math.abs(y-human.y);
      if(enemyDist>10) continue; // 敵から遠すぎる場所は除外
      const score=wallAdj*3-cpuDist*0.3+enemyDist*0.1;
      if(score>bestScore){ bestScore=score; best={x,y}; }
    }
    return best;
  }

  // ── 地雷専用トラップポイント探索 ──────────────────────
  // キル優先（通路・敵進路）、陣地境界、ステーション防衛を複合スコアで評価
  _findMineTrapTarget(cpu,human,humanSafe){
    let best=null, bestScore=-9999;

    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
      if(!this._walkable(x,y)) continue;
      if(safeZone(x,y,2)) continue; // 自スポーン付近は除外
      const nk=ky(x,y);
      if(stationSet.has(nk)) continue;
      if(grid[y][x]===1) continue; // 敵インク上は歩けない
      const cpuDist=Math.abs(x-cpu.x)+Math.abs(y-cpu.y);
      if(cpuDist>14) continue; // 遠すぎは除外

      let score=0;

      // 【キル評価】壁2面以上で囲まれた通路か
      let wallAdj=0;
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        if(walls.has(ky(x+ddx,y+ddy))||!ib(x+ddx,y+ddy)) wallAdj++;
      }
      score+=wallAdj*4; // 通路ボーナス

      // 【キル評価】敵の進路予測: 敵→自スポーン方向の中継点か
      if(!humanSafe){
        const enemyDist=Math.abs(x-human.x)+Math.abs(y-human.y);
        if(enemyDist<=6) score+=Math.max(0,8-enemyDist)*2; // 敵に近いほど高評価
        // 敵の移動方向（dir）の延長線上
        const ed=DIR[human.dir];
        for(let r=1;r<=4;r++){
          if(human.x+ed.x*r===x&&human.y+ed.y*r===y){ score+=12; break; }
        }
      }

      // 【陣地境界評価】隣接マスに自軍インクと敵/白マスが混在する境界線上か
      let ownAdj=0, neutralAdj=0;
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        const nx2=x+ddx, ny2=y+ddy;
        if(!ib(nx2,ny2)) continue;
        if(grid[ny2][nx2]===2) ownAdj++;
        else if(grid[ny2][nx2]===0) neutralAdj++;
      }
      if(ownAdj>0&&neutralAdj>0) score+=6; // 境界ボーナス

      // 【ステーション防衛評価】P1のステーション付近か
      for(const s of inkStations){
        if(s.color!==1) continue;
        const sd=Math.abs(x-s.x)+Math.abs(y-s.y);
        if(sd<=2) score+=10-sd*2;
      }

      // CPUとの距離ペナルティ（近い方がすぐ設置できる）
      score-=cpuDist*0.5;

      if(score>bestScore){ bestScore=score; best={x,y}; }
    }
    return best||(!humanSafe?{x:human.x,y:human.y}:null);
  }

  // ── デンキウナギ: 壁密集エリアのP1側のセルを返す ──
  _findEelAmbushPos(cpu,human){
    // 条件: 4方向のどれかで3マス以内に壁があり（反射発生）、かつ敵の近く
    let best=null, bestScore=-9999;
    for(let y=1;y<ROWS-1;y++) for(let x=1;x<COLS-1;x++){
      if(!this._walkable(x,y)) continue;
      if(!stationSet.has(ky(x,y))&&grid[y][x]===1) continue;
      // 4方向で3マス以内に壁があるか（eel反射が発生しやすい場所）
      let wallInRange=0;
      for(const[ddx,ddy] of [[0,-1],[0,1],[-1,0],[1,0]]){
        for(let r=1;r<=3;r++){
          const wx=x+ddx*r, wy=y+ddy*r;
          if(!ib(wx,wy)||walls.has(ky(wx,wy))){ wallInRange++; break; }
        }
      }
      if(wallInRange<1) continue; // 反射しない場所は除外
      const cpuDist=Math.abs(x-cpu.x)+Math.abs(y-cpu.y);
      const enemyDist=Math.abs(x-human.x)+Math.abs(y-human.y);
      if(enemyDist>12) continue;
      const score=wallInRange*3-cpuDist*0.4-enemyDist*0.3;
      if(score>bestScore){ bestScore=score; best={x,y}; }
    }
    return best;
  }

  // ── eel: 3マス以内に壁がある射撃方向を選ぶ ──────────
  _getEelShootDir(cpu){
    for(const[dirName,d] of Object.entries(DIR)){
      for(let r=1;r<=3;r++){
        const wx=cpu.x+d.x*r, wy=cpu.y+d.y*r;
        if(!ib(wx,wy)||walls.has(ky(wx,wy))) return dirName; // この方向に壁あり
      }
    }
    return null; // どの方向も壁なし
  }

  // ── A↔B 往復振動検出 ────────────────────────────────
  // 最新 4 位置が「AB AB」パターンなら true
  _isOscillating(){
    const h=this.posHistory;
    if(h.length<4) return false;
    const n=h.length;
    const a=h[n-4],b=h[n-3],c=h[n-2],d=h[n-1];
    // A と C が同じ、B と D が同じ、かつ A≠B（実際に動いている）
    return a.x===c.x&&a.y===c.y&&b.x===d.x&&b.y===d.y&&!(a.x===b.x&&a.y===b.y);
  }

  // ── 倦怠防止: 現在地から遠い未塗りエリアを探す ──────
  _findDistantPaintTarget(cpu){
    let bestScore=-Infinity, bestX=-1, bestY=-1;
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
      if(walls.has(ky(x,y))||stationSet.has(ky(x,y))) continue;
      if(safeZone(x,y,1)) continue;
      const g=grid[y][x];
      if(g===2) continue; // 自軍インクはスキップ
      const dist=Math.abs(x-cpu.x)+Math.abs(y-cpu.y);
      if(dist<6) continue; // 近すぎるマスは候補外（遠いエリアを強制）
      // 敵インクを優先しつつ距離ペナルティを軽めに（遠いほど高スコア）
      const score=(g===1?20:10)-dist*0.05;
      if(score>bestScore){bestScore=score;bestX=x;bestY=y;}
    }
    if(bestX>=0) return {x:bestX,y:bestY};
    return this._findPaintTarget(cpu); // フォールバック
  }
}

