// ===== Kraken Games — Ddakji (GBA-style) =====
// Full loop with meter, aim, throw, win/lose anims, hearts, game-over, and audio hooks.

// Crash visibility
window.addEventListener('error', e => console.error('Error:', e.error || e.message));
window.addEventListener('unhandledrejection', e => console.error('Rejection:', e.reason));

// Ensure globals exist if sprites.js didn't load for some reason
if (typeof window.Sprites === 'undefined') window.Sprites = {};
if (typeof window.Sounds  === 'undefined') window.Sounds  = {};

const W = 240, H = 160;
const canvas = document.getElementById('gba');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.font = '8px monospace';
ctx.textBaseline = 'top';

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
    redPos:    { x: 160, y: 65 }   // <-- ensure this matches your art layout
  }
};

// ---------- tiny image loader ----------
function loadImg(src){
  return new Promise(res=>{
    if(!src){ res(null); return; }
    const i = new Image();
    i.onload = ()=>res(i);
    i.onerror = ()=>{ console.warn('Image failed:', String(src).slice(0,120)); res(null); };
    i.src = src;
  });
}

// ---------- simple audio bank ----------
const SND = {
  ready:false, tracks:{},
  _mk(src, loop, vol){
    if(!src) return null;
    const a = new Audio(src);
    a.preload = 'auto';
    a.loop = !!loop;
    a.volume = vol != null ? vol : 1;
    return a;
  },
  add(name, src, opts){
    opts = opts || {};
    if(!src) return;
    const poolSize = opts.pool || 3;
    const p = [];
    for(let i=0;i<poolSize;i++){
      p.push(this._mk(src, !!opts.loop && i===0, opts.vol==null?1:opts.vol));
    }
    this.tracks[name] = { pool:p, idx:0, loop:!!opts.loop };
  },
  init(){
    if(this.ready) return;
    try{
      this.add('bgm',    window.Sounds && window.Sounds.bgm,    { loop:true, vol:0.35, pool:1 });
      this.add('throw',  window.Sounds && window.Sounds.throw,  { vol:1 });
      this.add('impact', window.Sounds && window.Sounds.impact, { vol:1 });
      this.add('slap',   window.Sounds && window.Sounds.slap,   { vol:1 });
      this.add('win',    window.Sounds && window.Sounds.win,    { vol:1 });
      this.add('lose',   window.Sounds && window.Sounds.lose,   { vol:1 });
    }catch(_){}
    this.ready = true;
  },
  start(name){
    const t=this.tracks[name]; if(!t||!t.pool[0]) return;
    try{ t.pool[0].currentTime=0; t.pool[0].play().catch(()=>{}); }catch(_){}
  },
  stop(name){
    const t=this.tracks[name]; if(!t) return;
    t.pool.forEach(a=>{ try{ a.pause(); a.currentTime=0; }catch(_){} });
  },
  play(name){
    const t=this.tracks[name]; if(!t) return;
    const a=t.pool[t.idx=(t.idx+1)%t.pool.length];
    if(!a) return;
    try{ a.currentTime=0; a.play().catch(()=>{}); }catch(_){}
  }
};
let audioUnlocked = false;

// ---------- state ----------
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

// ---------- helpers ----------
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
function drawBase(){
  if (assets.bg) ctx.drawImage(assets.bg,0,0); else { ctx.fillStyle='#121219'; ctx.fillRect(0,0,W,H); }
  if (assets.opponent) ctx.drawImage(assets.opponent, 180, CFG.ui.opponentY);
  if (assets.player)   ctx.drawImage(assets.player,   20,  70);
  if (assets.tileRed)  ctx.drawImage(assets.tileRed,  CFG.tiles.redPos.x, CFG.tiles.redPos.y);
  if (assets.tileBlue) ctx.drawImage(assets.tileBlue, CFG.tiles.blueStart.x, CFG.tiles.blueStart.y);
}

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

// ---------- render ----------
function render(){
  if (game.scene==='menu'){
    drawBase(); drawHearts();
    drawDialog("What will you do?");
    for(let i=0;i<menuItems.length;i++){
      drawText(18, H-30+i*10, (game.selection===i?"> ":"  ")+menuItems[i], assets.box?"#000":"#fff");
    }
    return;
  }

  if (game.scene==='throwMeter'){
    drawBase(); drawHearts();

    const prompt = game.meterPhase===0 ? "Tap to lock POWER…"
                   : game.meterPhase===1 ? "Tap to lock AIM X…"
                   : "Tap to lock AIM Y…";
    drawDialog(prompt);

    const bx = CFG.ui.box.x, by = CFG.ui.box.y, bw = CFG.ui.box.w, bh = CFG.ui.box.h;
    const padR = CFG.ui.meter.rightPad, aimS = CFG.ui.meter.aimSize, gap = CFG.ui.meter.gap;

    // Aim square (inside dialog box, right side)
    const aimX = bx + bw - padR - aimS;
    const aimY = by + ((bh - aimS) >> 1);

    // Power bar sits above-left of aim area
    const pW = CFG.ui.meter.powerW, pH = CFG.ui.meter.powerH;
    const pX = aimX - 6 - pW, pY = aimY - gap - pH;

    // Power segments (10)
    const segs = Math.floor(game.power * 10);
    for (let i=0;i<10;i++){
      const img = (i < segs) ? assets.tileBlue : assets.tileRed;
      if (img) ctx.drawImage(img, pX + i * Math.floor(pW/10), pY, Math.floor(pW/10), pH);
    }

    // Aim corners (red tiles)
    if (assets.tileRed){
      const c = assets.tileRed, s = 15;
      ctx.drawImage(c, aimX,           aimY);
      ctx.drawImage(c, aimX + aimS - s,aimY);
      ctx.drawImage(c, aimX,           aimY + aimS - s);
      ctx.drawImage(c, aimX + aimS - s,aimY + aimS - s);
    }
    // Aim dot (blue tile)
    if (assets.tileBlue){
      const cx = aimX + Math.floor(game.aimX * (aimS - 8));
      const cy = aimY + Math.floor(game.aimY * (aimS - 8));
      ctx.drawImage(assets.tileBlue, cx, cy, 8, 8);
    }
    return;
  }

  if (game.scene==='anim'){ // blue tile flight toward the red tile
    drawBase(); drawHearts();
    drawDialog(game.lastOutcome==='win' ? "A perfect hit!" : "Miss…");
    const t = Math.min(game.animT / 30, 1);

    // Quadratic flight curve toward red tile
    const sx = CFG.tiles.blueStart.x, sy = CFG.tiles.blueStart.y;
    const ex = CFG.tiles.redPos.x + 2, ey = CFG.tiles.redPos.y + 10; // slight offset for nicer look
    const mx = (sx + ex) / 2 - 12, my = (sy + ey) / 2 - 24;          // control point to arc upward

    const x = (1-t)*(1-t)*sx + 2*(1-t)*t*mx + t*t*ex;
    const y = (1-t)*(1-t)*sy + 2*(1-t)*t*my + t*t*ey;

    if (assets.tileBlue) ctx.drawImage(assets.tileBlue, x, y);
    return;
  }

  if (game.scene==='winFlip'){
    drawBase(); drawHearts();

    // Spin the red tile in place, then land flipped
    const d = 60, u = Math.min(game.animT / d, 1);
    const cx = CFG.tiles.redPos.x + 8, cy = CFG.tiles.redPos.y + 8;
    const angle = u * Math.PI * 6; // 3 spins

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const img = (u >= 0.95 && assets.tileRedBack) ? assets.tileRedBack : assets.tileRed;
    if (img) ctx.drawImage(img, -8, -8, 16, 16);
    ctx.restore();

    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "Tile flipped!", assets.box ? "#000" : "#fff");
    return;
  }

  if (game.scene==='slap'){
    const amp = 2, shake = Math.sin(game.animT * 0.8) * amp;
    ctx.save(); ctx.translate(shake, 0); drawBase(); ctx.restore();

    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "SLAP!", assets.box ? "#000" : "#fff");
    drawHearts(); // show remaining after slap
    return;
  }

  if (game.scene==='gameOver'){
    drawBase();
    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "GAME OVER. Tap to Play Again.", assets.box ? "#000" : "#fff");
    // draw zeroed hearts
    if (CFG.ui.showHearts) for(let i=0;i<5;i++){ const hx=8+i*12, hy=8; if(assets.heartEmpty) ctx.drawImage(assets.heartEmpty,hx,hy); }
    return;
  }

  // intro / dialog fallback
  drawBase(); drawHearts(); drawDialog(game.dialog);
}

// ---------- update ----------
function update(){
  if(['intro','menu','dialog'].includes(game.scene)){
    if(!game.dialogDone) game.dialogTick++;
  }
  if(game.scene==='throwMeter'){
    if(game.meterPhase===0) game.power = 0.5 + 0.5 * Math.sin(performance.now()/200);
    if(game.meterPhase===1) game.aimX  = 0.5 + 0.5 * Math.sin(performance.now()/350);
    if(game.meterPhase===2) game.aimY  = 0.5 + 0.5 * Math.sin(performance.now()/280);
  }
  if(game.scene==='anim'){
    game.animT++;
    if(game.animT > CFG.throw.animFrames){
      if(game.lastOutcome==='win'){
        game.animT = 0;
        game.scene = 'winFlip';
        SND.play('impact');
      } else {
        game.animT = 0;
        game.scene = 'slap';
        SND.play('slap');
      }
    }
  }
  if(game.scene==='winFlip'){
    game.animT++;
    if(game.animT >= 60){
      // Show password and go to dialog
      game.password = localPassword();
      game.dialog = "You win! Password: " + game.password;
      game.dialogTick = 0; game.dialogDone = false;
      game.scene = 'dialog';
      SND.play('win');
    }
  }
  if(game.scene==='slap'){
    game.animT++;
    if(game.animT >= 24){
      game.hearts = Math.max(0, game.hearts - 1);
      if (game.hearts === 0){
        game.scene='gameOver';
        SND.play('lose');
      } else {
        game.dialog = "Ouch! You lost a heart.";
        game.dialogTick=0; game.dialogDone=false; game.scene='dialog';
      }
    }
  }
}

// ---------- input ----------
function onClick(){
  // Unlock audio and start BGM on first gesture
  if(!audioUnlocked){
    SND.init();
    audioUnlocked = true;
    SND.start('bgm');
  }

  if(game.scene==='intro'){ game.scene='menu'; game.dialog="What will you do?"; game.dialogTick=0; return; }

  if(game.scene==='menu'){
    const choice = menuItems[game.selection];
    if(choice==='THROW TILE'){ game.meterPhase=0; game.scene='throwMeter'; game.dialogTick=0; return; }
    if(choice==='HELP'){ game.scene='dialog'; game.dialog="Tap to lock POWER, then AIM X, then AIM Y."; game.dialogTick=0; return; }
    if(choice==='STATS'){ game.scene='dialog'; game.dialog='Hearts: '+game.hearts; game.dialogTick=0; return; }
    if(choice==='QUIT'){ game.scene='dialog'; game.dialog='See you at Kraken Games!'; game.dialogTick=0; return; }
  }

  if(game.scene==='throwMeter'){
    if(game.meterPhase < 2){ game.meterPhase++; SND.play('throw'); return; }
    // Final tap → evaluate throw
    const success = computeHit(game.power, game.aimX, game.aimY);
    game.lastOutcome = success ? 'win' : 'fail';
    game.animT = 0;
    game.scene = 'anim';
    SND.play('throw');
    return;
  }

  if(game.scene==='dialog'){ game.scene='menu'; game.dialog="What will you do?"; game.selection=0; return; }

  if(game.scene==='gameOver'){ resetGame(); return; }
}
function onKey(e){
  if(game.scene==='menu'){
    if(e.key==='ArrowDown') game.selection=(game.selection+1)%menuItems.length;
    if(e.key==='ArrowUp')   game.selection=(game.selection-1+menuItems.length)%menuItems.length;
    if(e.key==='Enter' || e.key===' ') onClick();
  } else if(game.scene==='throwMeter' && (e.key==='Enter' || e.key===' ')){
    onClick();
  } else if((game.scene==='intro' || game.scene==='dialog' || game.scene==='gameOver') && (e.key==='Enter'||e.key===' ')){
    onClick();
  }
}

// ---------- main loop ----------
function loop(){ update(); render(); requestAnimationFrame(loop); }

// ---------- boot ----------
(async function start(){
  loop(); // draw immediately
  // load images (safe if empty strings)
  assets.bg        = await loadImg(window.Sprites.bg);
  assets.player    = await loadImg(window.Sprites.player);
  assets.opponent  = await loadImg(window.Sprites.opponent);
  assets.tileBlue  = await loadImg(window.Sprites.tileBlue);
  assets.tileRed   = await loadImg(window.Sprites.tileRed);
  assets.tileRedBack = await loadImg(window.Sprites.tileRedBack);
  assets.box       = await loadImg(window.Sprites.box);
  assets.heart     = await loadImg(window.Sprites.heart);
  assets.heartEmpty= await loadImg(window.Sprites.heartEmpty);

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
})();
