// ===== Kraken Games — Ddakji (GBA-style) =====

// Crash visibility
window.addEventListener('error', e => console.error('Error:', e.error || e.message));
window.addEventListener('unhandledrejection', e => console.error('Rejection:', e.reason));

// Ensure globals exist if sprites.js didn't load
if (typeof window.Sprites === 'undefined') window.Sprites = {};
if (typeof window.Sounds  === 'undefined') window.Sounds  = {};

const W = 240, H = 160;
const canvas = document.getElementById('gba');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.font = '8px monospace';
ctx.textBaseline = 'top';

// ----------------- CONFIG (edit here, no code chasing) -----------------
const CFG = {
  hearts: 5,
  throw: {
    powerTarget: 0.75,
    powerTol: 0.12,
    aimRadius: 0.22,
    luck: 0.08,
    animFrames: 60
  },
  ui: {
    showHearts: true,
    opponentY: 36,
    box: { x: 0, y: 160 - 48, w: 240, h: 48 },
    meter: { rightPad: 6, gap: 4, powerW: 72, powerH: 10, aimSize: 40 }
  },
  tiles: {
    blueStart: { x: 60,  y: 110 },
    redPos:    { x: 160, y: 65 }     // red tile rest position
  },
  winFlip: {
    // arc for red tile flip (on win)
    liftUp: -28,   // how high the arc goes (negative = up)
    shiftX: -12,   // left shift at apex
    spins:  3,     // number of full spins
    frames: 60
  },
  slap: {
    // timings (frames @ ~60fps) — slower & readable
    tApproach: 26,   // opponent rushes in
    tWindup:   18,   // hand wind-up
    tHit:      16,   // impact window (flash+shake)
    tRetreat:  26,   // opponent retreats
    // positions
    oppBaseX:  180,
    oppNearX:   92,   // how close opponent gets (smaller = closer)
    // hand sprite & motion
    handSize:   40,   // slap hand size (px)
    hitAnchor:  { x: 20 + 18, y: 70 + 12 }, // where the hit lands (player face)
    startOffset:{ x: 28, y:  -4 },          // where the hand starts relative to opponent (near)
    arc: { liftUp: -10, dipDown: 18, forward: 10 }, // curve shaping
    // impact flash
    flashAlpha: 0.65
  }
};

// ----------------- utilities -----------------
function loadImg(src){
  return new Promise(res=>{
    if(!src){ res(null); return; }
    const i=new Image();
    i.onload=()=>res(i);
    i.onerror=()=>{ console.warn('Image failed:', String(src).slice(0,120)); res(null); };
    i.src=src;
  });
}
const smooth = x => x*x*(3-2*x); // smoothstep

// ----------------- audio bank -----------------
const SND = {
  ready:false, tracks:{},
  _mk(src, loop, vol){
    if(!src) return null;
    const a=new Audio(src); a.preload='auto'; a.loop=!!loop; a.volume=vol!=null?vol:1; return a;
  },
  add(name, src, opts){ opts=opts||{}; if(!src) return;
    const pool = []; const n = opts.pool||3;
    for(let i=0;i<n;i++) pool.push(this._mk(src, !!opts.loop && i===0, opts.vol==null?1:opts.vol));
    this.tracks[name] = { pool, idx:0 };
  },
  init(){
    if(this.ready) return;
    try{
      this.add('bgm',    window.Sounds.bgm,    { loop:true, vol:0.35, pool:1 });
      this.add('throw',  window.Sounds.throw);
      this.add('impact', window.Sounds.impact);
      this.add('slap',   window.Sounds.slap);
      this.add('win',    window.Sounds.win);
      this.add('lose',   window.Sounds.lose);
    }catch(_){}
    this.ready = true;
  },
  start(name){ const t=this.tracks[name]; if(!t||!t.pool[0])return; try{ t.pool[0].currentTime=0; t.pool[0].play().catch(()=>{});}catch(_){}} ,
  play(name){ const t=this.tracks[name]; if(!t) return; const a=t.pool[t.idx=(t.idx+1)%t.pool.length]; if(!a) return; try{ a.currentTime=0; a.play().catch(()=>{});}catch(_){}} 
};
let audioUnlocked=false;

// ----------------- state -----------------
let assets = {};
let game;
function resetGame(){
  game = {
    scene:'intro',
    dialog:'Welcome to Kraken Games! Click to start.',
    dialogTick:0, dialogDone:false,
    selection:0,
    hearts:CFG.hearts,
    power:0, aimX:0.5, aimY:0.5,
    meterPhase:0,
    animT:0,
    lastOutcome:null,
    password:null
  };
}
resetGame();

const menuItems = ["THROW TILE","STATS","HELP","QUIT"];

// ----------------- helpers to draw -----------------
function drawText(x,y,str,color){ ctx.fillStyle=color||"#fff"; ctx.fillText(str,x,y); }
function drawDialog(text){
  if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
  const color = assets.box ? "#000" : "#fff";
  const shown = text.slice(0, Math.floor(game.dialogTick/2));
  drawText(8, CFG.ui.box.y + 8, shown || '...', color);
}
function drawHearts(){
  if(!CFG.ui.showHearts) return;
  for(let i=0;i<5;i++){
    const hx=8+i*12, hy=8;
    if(i<game.hearts){ if(assets.heart) ctx.drawImage(assets.heart,hx,hy); }
    else if(assets.heartEmpty) ctx.drawImage(assets.heartEmpty,hx,hy);
  }
}
function drawBase(opts){
  opts = opts || {};
  if (assets.bg) ctx.drawImage(assets.bg,0,0); else { ctx.fillStyle='#121219'; ctx.fillRect(0,0,W,H); }
  if (assets.opponent && !opts.omitOpp) ctx.drawImage(assets.opponent, CFG.slap.oppBaseX, CFG.ui.opponentY);
  if (assets.player   && !opts.omitPlayer) ctx.drawImage(assets.player, 20, 70);
  if (assets.tileRed  && !opts.omitRed) ctx.drawImage(assets.tileRed, CFG.tiles.redPos.x, CFG.tiles.redPos.y);
  if (assets.tileBlue && !opts.omitBlue) ctx.drawImage(assets.tileBlue, CFG.tiles.blueStart.x, CFG.tiles.blueStart.y);
}

// outcome
function computeHit(power,x,y){
  const dp = Math.abs(power-CFG.throw.powerTarget);
  const okP = dp < CFG.throw.powerTol;
  const r = Math.hypot(x-0.5, y-0.5);
  const okA = r < CFG.throw.aimRadius;
  const luck = Math.random()*CFG.throw.luck;
  return (okP?CFG.throw.powerTol-dp:-(dp-CFG.throw.powerTol))
       + (okA?CFG.throw.aimRadius-r:-(r-CFG.throw.aimRadius))
       + luck > 0.02;
}
function localPassword(){
  const verbs=["flying","dancing","sneaky","roaring","dashing","clever","mighty","swift","silent","sparkling","wild","brave","cosmic","arcane","stormy"];
  const animals=["fox","otter","kraken","wolf","tiger","owl","falcon","panther","shark","dragon","lynx","bear","eagle","viper","phoenix"];
  return `the${verbs[(Math.random()*verbs.length)|0]}${animals[(Math.random()*animals.length)|0]}`;
}

// ----------------- RENDER -----------------
function render(){
  // MENU
  if (game.scene==='menu'){
    drawBase(); drawHearts();
    drawDialog("What will you do?");
    for(let i=0;i<menuItems.length;i++){
      drawText(18, H-30+i*10, (game.selection===i?"> ":"  ")+menuItems[i], assets.box?"#000":"#fff");
    }
    return;
  }

  // METER
  if (game.scene==='throwMeter'){
    drawBase(); drawHearts();
    const prompt = game.meterPhase===0 ? "Tap to lock POWER…"
                 : game.meterPhase===1 ? "Tap to lock AIM X…"
                 : "Tap to lock AIM Y…";
    drawDialog(prompt);

    const bx=CFG.ui.box.x, by=CFG.ui.box.y, bw=CFG.ui.box.w, bh=CFG.ui.box.h;
    const padR=CFG.ui.meter.rightPad, aimS=CFG.ui.meter.aimSize, gap=CFG.ui.meter.gap;

    // Aim square at right of dialog box
    const aimX = bx + bw - padR - aimS;
    const aimY = by + ((bh - aimS)>>1);

    // Power bar above-left of aim square
    const pW = CFG.ui.meter.powerW, pH = CFG.ui.meter.powerH;
    const pX = aimX - 6 - pW, pY = aimY - gap - pH;

    // power segments
    const segs = Math.floor(game.power*10);
    for(let i=0;i<10;i++){
      const img = (i<segs)? assets.tileBlue: assets.tileRed;
      if(img) ctx.drawImage(img, pX + i * Math.floor(pW/10), pY, Math.floor(pW/10), pH);
    }

    // aim corners
    if (assets.tileRed){
      const s=15;
      ctx.drawImage(assets.tileRed, aimX, aimY);
      ctx.drawImage(assets.tileRed, aimX+aimS-s, aimY);
      ctx.drawImage(assets.tileRed, aimX, aimY+aimS-s);
      ctx.drawImage(assets.tileRed, aimX+aimS-s, aimY+aimS-s);
    }
    // aim dot
    if (assets.tileBlue){
      const cx = aimX + Math.floor(game.aimX * (aimS - 8));
      const cy = aimY + Math.floor(game.aimY * (aimS - 8));
      ctx.drawImage(assets.tileBlue, cx, cy, 8, 8);
    }
    return;
  }

  // BLUE TILE FLIGHT
  if (game.scene==='anim'){
    drawBase(); drawHearts();
    drawDialog(game.lastOutcome==='win' ? "A perfect hit!" : "Miss…");
    const t = Math.min(game.animT / 30, 1);

    // quadratic arc from blueStart -> near redPos
    const sx = CFG.tiles.blueStart.x, sy = CFG.tiles.blueStart.y;
    const ex = CFG.tiles.redPos.x + 2, ey = CFG.tiles.redPos.y + 10;
    const mx = (sx + ex)/2 - 12, my = (sy + ey)/2 - 24;

    const x = (1-t)*(1-t)*sx + 2*(1-t)*t*mx + t*t*ex;
    const y = (1-t)*(1-t)*sy + 2*(1-t)*t*my + t*t*ey;

    if (assets.tileBlue) ctx.drawImage(assets.tileBlue, x, y);
    return;
  }

  // WIN: RED TILE FLIES UPWARD & SPINS (hide base red tile)
  if (game.scene==='winFlip'){
    drawBase({ omitRed:true }); drawHearts();

    const u = Math.min(game.animT / CFG.winFlip.frames, 1);
    const start = { x: CFG.tiles.redPos.x, y: CFG.tiles.redPos.y };
    const apex  = { x: start.x + CFG.winFlip.shiftX, y: start.y + CFG.winFlip.liftUp };
    const end   = { x: start.x, y: start.y };

    // quadratic arc
    const x = (1-u)*(1-u)*start.x + 2*(1-u)*u*apex.x + u*u*end.x;
    const y = (1-u)*(1-u)*start.y + 2*(1-u)*u*apex.y + u*u*end.y;

    // spin
    const angle = u * Math.PI * 2 * CFG.winFlip.spins;
    const img = (u >= 0.95 && assets.tileRedBack) ? assets.tileRedBack : assets.tileRed;

    ctx.save();
    ctx.translate(x+8, y+8);
    ctx.rotate(angle);
    if (img) ctx.drawImage(img, -8, -8, 16, 16);
    ctx.restore();

    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "Tile flipped!", assets.box ? "#000" : "#fff");
    return;
  }

  // SLAP SEQUENCE (dash-in, windup+arc swing, impact flash+shake, retreat)
  if (game.scene==='slap'){
    const T1=CFG.slap.tApproach, T2=T1+CFG.slap.tWindup, T3=T2+CFG.slap.tHit, T4=T3+CFG.slap.tRetreat;
    const t = game.animT;

    // draw world sans static opponent; we draw moving one next
    drawBase({ omitOpp:true }); 
    drawHearts();

    // opponent X
    let oppX = CFG.slap.oppBaseX;
    if      (t <= T1) { const u=t/T1; oppX = CFG.slap.oppBaseX + (CFG.slap.oppNearX - CFG.slap.oppBaseX) * u; }
    else if (t <= T3) { oppX = CFG.slap.oppNearX; }
    else if (t <= T4) { const u=(t-T3)/CFG.slap.tRetreat; oppX = CFG.slap.oppNearX + (CFG.slap.oppBaseX - CFG.slap.oppNearX) * u; }
    // shake strongest at hit
    let shakeX=0, shakeY=0;
    if (t > T2 && t <= T3){
      const p=(t-T2)/Math.max(1, CFG.slap.tHit);
      const s = 3 * (1 - Math.abs(0.5 - p)*2); // 0→1→0
      shakeX = (Math.random()*2-1)*s;
      shakeY = (Math.random()*2-1)*s;
    }

    // draw moving opponent (shaken)
    ctx.save();
    ctx.translate(shakeX, shakeY);
    if (assets.opponent) ctx.drawImage(assets.opponent, oppX, CFG.ui.opponentY);

    // hand swing along downward arc during windup+hit
    if ((t > T1) && (t <= T3) && assets.slapHand){
      const size = CFG.slap.handSize;
      const start = { x: oppX + CFG.slap.startOffset.x, y: CFG.ui.opponentY + CFG.slap.startOffset.y };
      const hit   = { x: CFG.slap.hitAnchor.x, y: CFG.slap.hitAnchor.y };

      // control points for cubic Bézier
      const midX = (start.x + hit.x)*0.5;
      const midY = (start.y + hit.y)*0.5;
      const c1 = { x: start.x + 8,                        y: start.y + CFG.slap.arc.liftUp };
      const c2 = { x: midX    + CFG.slap.arc.forward,     y: midY    + CFG.slap.arc.dipDown };

      const total = CFG.slap.tWindup + CFG.slap.tHit;
      const phase = (t - T1) / Math.max(1,total);
      const u = smooth(Math.max(0, Math.min(1, phase)));

      // cubic Bézier pos
      const bx = (1-u)**3*start.x + 3*(1-u)**2*u*c1.x + 3*(1-u)*u**2*c2.x + u**3*hit.x;
      const by = (1-u)**3*start.y + 3*(1-u)**2*u*c1.y + 3*(1-u)*u**2*c2.y + u**3*hit.y;
      // tangent for rotation
      const dx = 3*(1-u)**2*(c1.x-start.x) + 6*(1-u)*u*(c2.x-c1.x) + 3*u**2*(hit.x-c2.x);
      const dy = 3*(1-u)**2*(c1.y-start.y) + 6*(1-u)*u*(c2.y-c1.y) + 3*u**2*(hit.y-c2.y);
      const ang = Math.atan2(dy, dx);

      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(ang);
      ctx.drawImage(assets.slapHand, -size*0.2, -size*0.2, size, size);
      ctx.restore();
    }
    ctx.restore();

    // flash during hit window (longer & eased)
    if (t > T2 && t <= T3){
      const p=(t-T2)/Math.max(1, CFG.slap.tHit);          // 0..1
      const s = smooth(p);                                // ease
      const a = CFG.slap.flashAlpha * (1 - Math.abs(0.5 - s)*2);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0,0,W,H);
    }

    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "SLAP!", assets.box ? "#000" : "#fff");
    return;
  }

  // intro / dialog
  drawBase(); drawHearts(); drawDialog(game.dialog);
}

// ----------------- UPDATE -----------------
function update(){
  if (['intro','menu','dialog'].includes(game.scene)){
    if(!game.dialogDone) game.dialogTick++;
  }
  if (game.scene==='throwMeter'){
    if(game.meterPhase===0) game.power = 0.5 + 0.5*Math.sin(performance.now()/200);
    if(game.meterPhase===1) game.aimX  = 0.5 + 0.5*Math.sin(performance.now()/350);
    if(game.meterPhase===2) game.aimY  = 0.5 + 0.5*Math.sin(performance.now()/280);
  }
  if (game.scene==='anim'){
    game.animT++;
    if (game.animT > CFG.throw.animFrames){
      if (game.lastOutcome==='win'){
        game.animT = 0; game.scene='winFlip'; SND.play('impact');
      } else {
        game.animT = 0; game.scene='slap';    SND.play('slap');
      }
    }
  }
  if (game.scene==='winFlip'){
    game.animT++;
    if (game.animT >= CFG.winFlip.frames){
      game.password = localPassword();
      game.dialog = "You win! Password: " + game.password;
      game.dialogTick = 0; game.dialogDone = false;
      game.scene = 'dialog';
      SND.play('win');
    }
  }
  if (game.scene==='slap'){
    game.animT++;
    const T1=CFG.slap.tApproach, T2=T1+CFG.slap.tWindup, T3=T2+CFG.slap.tHit, T4=T3+CFG.slap.tRetreat;
    if (game.animT === T2 + 1) SND.play('slap'); // first impact frame
    if (game.animT > T4){
      game.hearts = Math.max(0, game.hearts - 1);
      if (game.hearts === 0){ game.scene='gameOver'; SND.play('lose'); }
      else { game.dialog="Ouch! You lost a heart."; game.dialogTick=0; game.dialogDone=false; game.scene='dialog'; }
    }
  }
}

// ----------------- INPUT -----------------
function onClick(){
  if(!audioUnlocked){ SND.init(); audioUnlocked=true; SND.start('bgm'); }

  if (game.scene==='intro'){ game.scene='menu'; game.dialog="What will you do?"; game.dialogTick=0; return; }

  if (game.scene==='menu'){
    const c = menuItems[game.selection];
    if (c==='THROW TILE'){ game.meterPhase=0; game.scene='throwMeter'; game.dialogTick=0; return; }
    if (c==='HELP'){ game.scene='dialog'; game.dialog="Tap to lock POWER, then AIM X, then AIM Y."; game.dialogTick=0; return; }
    if (c==='STATS'){ game.scene='dialog'; game.dialog='Hearts: '+game.hearts; game.dialogTick=0; return; }
    if (c==='QUIT'){ game.scene='dialog'; game.dialog='See you at Kraken Games!'; game.dialogTick=0; return; }
  }

  if (game.scene==='throwMeter'){
    if (game.meterPhase < 2){ game.meterPhase++; SND.play('throw'); return; }
    const success = computeHit(game.power, game.aimX, game.aimY);
    game.lastOutcome = success ? 'win' : 'fail';
    game.animT = 0; game.scene='anim'; SND.play('throw'); return;
  }

  if (game.scene==='dialog'){ game.scene='menu'; game.dialog="What will you do?"; game.selection=0; return; }
  if (game.scene==='gameOver'){ resetGame(); return; }
}
function onKey(e){
  if (game.scene==='menu'){
    if(e.key==='ArrowDown') game.selection=(game.selection+1)%menuItems.length;
    if(e.key==='ArrowUp')   game.selection=(game.selection-1+menuItems.length)%menuItems.length;
    if(e.key==='Enter'||e.key===' ') onClick();
  } else if (game.scene==='throwMeter' && (e.key==='Enter'||e.key===' ')){
    onClick();
  } else if ((game.scene==='intro'||game.scene==='dialog'||game.scene==='gameOver') && (e.key==='Enter'||e.key===' ')){
    onClick();
  }
}

// ----------------- MAIN LOOP -----------------
function loop(){ update(); render(); requestAnimationFrame(loop); }

// ----------------- BOOT -----------------
(async function start(){
  loop(); // draw immediately

  // load images (safe if absent)
  assets.bg         = await loadImg(window.Sprites.bg);
  assets.player     = await loadImg(window.Sprites.player);
  assets.opponent   = await loadImg(window.Sprites.opponent);
  assets.tileBlue   = await loadImg(window.Sprites.tileBlue);
  assets.tileRed    = await loadImg(window.Sprites.tileRed);
  assets.tileRedBack= await loadImg(window.Sprites.tileRedBack);
  assets.box        = await loadImg(window.Sprites.box);
  assets.heart      = await loadImg(window.Sprites.heart);
  assets.heartEmpty = await loadImg(window.Sprites.heartEmpty);
  assets.slapHand   = await loadImg(window.Sprites.slapHand);

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
})();
