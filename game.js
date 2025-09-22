// ===== Kraken Games — Ddakji (GBA-style) =====
// Adds: tutorial intro, dramatic Game Over fade, win dialog + card animation, replay messaging.

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

// ----------------- CONFIG -----------------
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
    liftUp: -28,   // arc height (negative = up)
    shiftX: -12,   // left shift at apex
    spins:  3,
    frames: 60
  },
  slap: {
    tApproach: 26,  tWindup: 18,  tHit: 16,  tRetreat: 26,
    oppBaseX: 180,  oppNearX:  92,
    handSize: 40,
    hitAnchor:  { x: 20 + 18, y: 70 + 12 },
    startOffset:{ x: 28, y: -4 },
    arc: { liftUp: -10, dipDown: 18, forward: 10 },
    flashAlpha: 0.65
  },
  faint: {
    fadeFrames: 45, // how long to fade to black when hearts reach 0
    maxAlpha:   0.85, // how dark the fade gets
    lockFrames: 30    // time before we accept Enter/Space to restart
  },
  card: {
    flyFrames: 36,  // how long the card flies to the player
    startOffset: { x: -8, y: 22 }, // from opponent sprite corner
    endOffset:   { x: 16, y: -2 }  // near player's hands
  }
};

// Dialog layout config
const DIALOG = {
  padX: 8,         // left/right padding inside box
  padY: 8,         // top padding inside box
  lineHeight: 10,  // for 8px font, 10px line spacing looks right
  maxLines: 3      // how many lines fit in the 48px-tall box
};

const smooth = x => x*x*(3-2*x); // smoothstep

// ----------------- tiny utils -----------------
function loadImg(src){
  return new Promise(res=>{
    if(!src){ res(null); return; }
    const i=new Image();
    i.onload=()=>res(i);
    i.onerror=()=>{ console.warn('Image failed:', String(src).slice(0,120)); res(null); };
    i.src=src;
  });
}

// ----------------- audio bank -----------------
const SND = {
  ready:false, tracks:{},
  _mk(src, loop, vol){ if(!src) return null; const a=new Audio(src); a.preload='auto'; a.loop=!!loop; a.volume=vol!=null?vol:1; return a; },
  add(name, src, opts){ opts=opts||{}; if(!src) return; const pool=[], n=opts.pool||3; for(let i=0;i<n;i++) pool.push(this._mk(src, !!opts.loop && i===0, opts.vol==null?1:opts.vol)); this.tracks[name]={pool,idx:0}; },
  init(){ if(this.ready) return; try{
      this.add('bgm',    window.Sounds.bgm,    { loop:true, vol:0.35, pool:1 });
      this.add('throw',  window.Sounds.throw);
      this.add('impact', window.Sounds.impact);
      this.add('slap',   window.Sounds.slap);
      this.add('win',    window.Sounds.win);
      this.add('lose',   window.Sounds.lose);
    }catch(_){}
    this.ready=true;
  },
  start(name){ const t=this.tracks[name]; if(!t||!t.pool[0])return; try{ t.pool[0].currentTime=0; t.pool[0].play().catch(()=>{});}catch(_){} },
  play(name){ const t=this.tracks[name]; if(!t) return; const a=t.pool[t.idx=(t.idx+1)%t.pool.length]; if(!a) return; try{ a.currentTime=0; a.play().catch(()=>{});}catch(_){} }
};
let audioUnlocked=false;

// ----------------- state -----------------
let assets = {};
let game;
function resetGame(){
  game = {
    scene:'introDialog',       // start with tutorial dialog
    dialog:'', dialogTick:0, dialogDone:false,
    selection:0,
    hearts:CFG.hearts,
    power:0, aimX:0.5, aimY:0.5,
    meterPhase:0,
    animT:0,
    lastOutcome:null,
    password:null,
    hasWon:false,
    wonPassword:null,
    faintAlpha:0,
    canRestart:false,
    introStep:0,               // tutorial step index
    preSlapStep:0,
    cardAnim:false,            // card animation toggle
    cardPos:{x:0,y:0}
  };
}
resetGame();

const menuItems = ["THROW TILE","STATS","HELP","QUIT"];

// Tutorial dialog (opponent explains rules)
const INTRO_LINES = [
  "Recruiter: Hello, want a valuable Prize? lets play Ddakji.",
  "Recruiter: Beat me and i'll Reward you, Lose and i will Slap You!",
  "Recruiter: this is how you play: You throw your blue Folded paper tile at mine.",
  "Recruiter: If you flip my red tile, you win.",
  "Recruiter: If you don't... well, I SLAP YOU ;) ",
  "Recruiter: to throw u must Lock POWER, then AIM left/right, then AIM up/down.",
  "Recruiter: Ready? Let's see what you've got."
];
// Recruiter lines shown BEFORE slap (one line per click)
const PRE_SLAP_LINES = [
  "Recruiter: HaHaHA, Not Good Enough.",
  "Recruiter: Rules are rules.",
  "Recruiter: Brace yourself…"
];



// ----------------- helpers to draw -----------------
// Layout the dialog text into pages of wrapped lines (by width)
function layoutDialog(text) {
  const innerW = CFG.ui.box.w - DIALOG.padX*2;
  const words = text.replace(/\r/g,'').split(/\s+/);
  const lines = [];
  let line = '';

  function pushLine() {
    if (line.length) { lines.push(line); line=''; }
  }

  // support manual line breaks with '\n'
  for (let i=0;i<words.length;i++) {
    const w = words[i];
    if (w.indexOf('\n') !== -1) {
      const parts = w.split('\n');
      for (let j=0;j<parts.length;j++) {
        const piece = parts[j];
        const test = line ? (line + ' ' + piece).trim() : piece;
        if (test && ctx.measureText(test).width > innerW) {
          pushLine();
          // if a single piece is too long, hard-wrap by chars
          let buf = piece;
          while (ctx.measureText(buf).width > innerW && buf.length > 1) {
            let cut = buf.length - 1;
            while (cut > 1 && ctx.measureText(buf.slice(0, cut)).width > innerW) cut--;
            lines.push(buf.slice(0, cut));
            buf = buf.slice(cut);
          }
          line = buf;
        } else {
          line = test;
        }
        if (j < parts.length - 1) pushLine(); // forced break
      }
    } else {
      const test = line ? (line + ' ' + w).trim() : w;
      if (ctx.measureText(test).width > innerW) {
        pushLine();
        // hard-wrap very long word
        let buf = w;
        while (ctx.measureText(buf).width > innerW && buf.length > 1) {
          let cut = buf.length - 1;
          while (cut > 1 && ctx.measureText(buf.slice(0, cut)).width > innerW) cut--;
          lines.push(buf.slice(0, cut));
          buf = buf.slice(cut);
        }
        line = buf;
      } else {
        line = test;
      }
    }
  }
  pushLine();

  // paginate
  const pages = [];
  for (let i=0;i<lines.length;i+=DIALOG.maxLines) {
    pages.push(lines.slice(i, i + DIALOG.maxLines));
  }
  return pages.length ? pages : [['']]; // at least one empty line
}

// Draw dialog with wrapping, paging, and typewriter on current page
function drawDialog(text) {
  // (Re)layout if text changed
  if (game._layoutText !== text) {
    game._layoutText = text;
    game.dialogPages = layoutDialog(text);
    game.dialogPage = 0;
    game.dialogTick = 0;
    game.dialogDone = false;
  }

  if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);

  const color = assets.box ? "#000" : "#fff";
  const lines = game.dialogPages[game.dialogPage] || [''];
  const maxChars = Math.floor(game.dialogTick / 2); // typewriter speed

  // Reveal characters across this page (line by line)
  let shown = 0;
  for (let i=0;i<lines.length;i++) {
    const remaining = Math.max(0, maxChars - shown);
    const toDraw = remaining <= 0 ? '' : lines[i].slice(0, remaining);
    ctx.fillStyle = color;
    ctx.fillText(toDraw, CFG.ui.box.x + DIALOG.padX, CFG.ui.box.y + DIALOG.padY + i*DIALOG.lineHeight);
    shown += lines[i].length;
  }

  // Continue arrow if more pages exist
  const more = game.dialogPage < (game.dialogPages.length - 1);
  if (!more) {
    // mark done when fully revealed
    const pageChars = lines.join('').length + (lines.length-1)*0; // simple char count
    if (maxChars >= pageChars) game.dialogDone = true;
  } else {
    // tiny "▶" bottom-right
    ctx.fillStyle = color;
    ctx.fillText('▶', CFG.ui.box.x + CFG.ui.box.w - DIALOG.padX - 6, CFG.ui.box.y + CFG.ui.box.h - DIALOG.padY - 10);
  }
}

// Advance dialog: next page if any; returns true if it paged, false if no more pages
function advanceDialogPage() {
  if (!game.dialogPages) return false;
  if (game.dialogPage < game.dialogPages.length - 1) {
    game.dialogPage++;
    game.dialogTick = 0;
    game.dialogDone = false;
    return true;
  }
  return false;
}
function getMenuItems(){
  return game.hasWon ? ["READ CARD"] : ["THROW TILE","STATS","HELP","QUIT"];
}




function drawText(x,y,str,color){ ctx.fillStyle=color||"#fff"; ctx.fillText(str,x,y); }

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

// outcome + local pw
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
  // INTRO DIALOG
  if (game.scene==='introDialog'){
    drawBase(); drawHearts();
    const line = INTRO_LINES[game.introStep] || "Recruiter: Let's begin.";
    drawDialog(line);
    return;
  }
  // PRE-SLAP mini dialog (before slap animation)
if (game.scene === 'preSlapDialog'){
  drawBase(); drawHearts();
  const line = PRE_SLAP_LINES[game.preSlapStep] || PRE_SLAP_LINES[PRE_SLAP_LINES.length-1];
  drawDialog(line);   // uses your dialog typewriter & pager
  return;
}


if (game.scene==='menu'){
  drawBase(); drawHearts();

  const items = getMenuItems();
  const msg = game.hasWon
    ? "You already have a passcode. Read card?"
    : "What will you do?";
  drawDialog(msg);

  // clamp selection to menu length
  if (game.selection >= items.length) game.selection = items.length - 1;

  for (let i = 0; i < items.length; i++) {
    drawText(18, H - 30 + i * 10, (game.selection === i ? "> " : "  ") + items[i], assets.box ? "#000" : "#fff");
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

  // WIN: RED TILE FLIES & SPINS (hide base red tile)
  if (game.scene==='winFlip'){
    drawBase({ omitRed:true }); drawHearts();

    const u = Math.min(game.animT / CFG.winFlip.frames, 1);
    const start = { x: CFG.tiles.redPos.x, y: CFG.tiles.redPos.y };
    const apex  = { x: start.x + CFG.winFlip.shiftX, y: start.y + CFG.winFlip.liftUp };
    const end   = { x: start.x, y: start.y };

    const x = (1-u)*(1-u)*start.x + 2*(1-u)*u*apex.x + u*u*end.x;
    const y = (1-u)*(1-u)*start.y + 2*(1-u)*u*apex.y + u*u*end.y;

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

  // WIN DIALOG 1 (opponent line)
  if (game.scene==='winDialog1'){
    drawBase(); drawHearts();
    drawDialog("Recruiter: You flipped it!.\nRecruiter: A promise is a promise.\nRecruiter: Take this card. You'll want to keep it.");
    return;
  }

  // CARD FLY ANIMATION (opponent -> player)
  if (game.scene==='cardFly'){
    drawBase(); drawHearts();

    // compute path
    const start = {
      x: CFG.slap.oppBaseX + (assets.opponent ? assets.opponent.width-1 : 180) + CFG.card.startOffset.x,
      y: CFG.ui.opponentY + CFG.card.startOffset.y
    };
    const end = {
      x: 20 + CFG.card.endOffset.x,
      y: 70 + CFG.card.endOffset.y
    };
    const u = Math.min(game.animT / CFG.card.flyFrames, 1);
    const uu = smooth(u);

    // arc upward a bit
    const mid = { x:(start.x+end.x)/2, y:(start.y+end.y)/2 - 12 };
    const x = (1-uu)*(1-uu)*start.x + 2*(1-uu)*uu*mid.x + uu*uu*end.x;
    const y = (1-uu)*(1-uu)*start.y + 2*(1-uu)*uu*mid.y + uu*uu*end.y;

    if (assets.card) ctx.drawImage(assets.card, x, y, 40, 24);

    // dialog while flying
    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "…", assets.box ? "#000" : "#fff");
    return;
  }

  // SHOW PASSWORD + REMINDER
  if (game.scene==='showPassword'){
    drawBase(); drawHearts();
    const msg = `Card reads: ${game.password}`;
    drawDialog(msg);
    return;
  }
  if (game.scene==='winReminder'){
    drawBase(); drawHearts();
    drawDialog("Recruiter: Write it down. You'll need it.");
    return;
  }

  // SLAP SEQUENCE (dash-in, arc hand, flash/shake, retreat)
  if (game.scene==='slap'){
    const T1=CFG.slap.tApproach, T2=T1+CFG.slap.tWindup, T3=T2+CFG.slap.tHit, T4=T3+CFG.slap.tRetreat;
    const t = game.animT;

    drawBase({ omitOpp:true }); 
    drawHearts();

    // opponent x
    let oppX = CFG.slap.oppBaseX;
    if      (t <= T1) { const u=t/T1; oppX = CFG.slap.oppBaseX + (CFG.slap.oppNearX - CFG.slap.oppBaseX) * u; }
    else if (t <= T3) { oppX = CFG.slap.oppNearX; }
    else if (t <= T4) { const u=(t-T3)/CFG.slap.tRetreat; oppX = CFG.slap.oppNearX + (CFG.slap.oppBaseX - CFG.slap.oppNearX) * u; }

    // shake on hit
    let shakeX=0, shakeY=0;
    if (t > T2 && t <= T3){
      const p=(t-T2)/Math.max(1, CFG.slap.tHit);
      const s = 3 * (1 - Math.abs(0.5 - p)*2);
      shakeX = (Math.random()*2-1)*s;
      shakeY = (Math.random()*2-1)*s;
    }
    ctx.save(); ctx.translate(shakeX, shakeY);
    if (assets.opponent) ctx.drawImage(assets.opponent, oppX, CFG.ui.opponentY);

    // hand swing during windup+hit
    if ((t > T1) && (t <= T3) && assets.slapHand){
      const size = CFG.slap.handSize;
      const start = { x: oppX + CFG.slap.startOffset.x, y: CFG.ui.opponentY + CFG.slap.startOffset.y };
      const hit   = { x: CFG.slap.hitAnchor.x, y: CFG.slap.hitAnchor.y };
      const midX=(start.x+hit.x)*0.5, midY=(start.y+hit.y)*0.5;
      const c1 = { x:start.x+8, y:start.y+CFG.slap.arc.liftUp };
      const c2 = { x:midX+CFG.slap.arc.forward, y:midY+CFG.slap.arc.dipDown };

      const total = CFG.slap.tWindup + CFG.slap.tHit;
      const phase = (t - T1) / Math.max(1,total);
      const u = smooth(Math.max(0, Math.min(1, phase)));

      const bx = (1-u)**3*start.x + 3*(1-u)**2*u*c1.x + 3*(1-u)*u**2*c2.x + u**3*hit.x;
      const by = (1-u)**3*start.y + 3*(1-u)**2*u*c1.y + 3*(1-u)*u**2*c2.y + u**3*hit.y;

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

    // flash during hit
    if (t > T2 && t <= T3){
      const p=(t-T2)/Math.max(1, CFG.slap.tHit);
      const s = smooth(p);
      const a = CFG.slap.flashAlpha * (1 - Math.abs(0.5 - s)*2);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0,0,W,H);
    }

    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "SLAP!", assets.box ? "#000" : "#fff");
    return;
  }

  // FAINT FADE (hearts hit 0 → fade to black, keep dialog box)
  if (game.scene==='faint'){
    drawBase(); drawHearts();
    const a = Math.min(CFG.faint.maxAlpha, game.faintAlpha);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(0,0,W,H);

    // dialog on top
    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "Oh no… you fainted. Game Over.", assets.box ? "#000" : "#fff");
    return;
  }

  // GAME OVER (locked until canRestart=true)
  if (game.scene==='gameOver'){
    drawBase(); // fully dark background
    ctx.fillStyle = `rgba(0,0,0,${CFG.faint.maxAlpha})`;
    ctx.fillRect(0,0,W,H);
    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    const tail = game.canRestart ? " Press Enter to play again." : " …";
    drawText(8, CFG.ui.box.y + 8, "Oh no… you fainted. Game Over." + tail, assets.box ? "#000" : "#fff");
    return;
  }

  // intro / dialog fallback
  drawBase(); drawHearts(); drawDialog(game.dialog);
}

// ----------------- UPDATE -----------------
function update(){
  if (['introDialog','menu','dialog','winDialog1','showPassword','winReminder'].includes(game.scene)){
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
      game.preSlapStep = 0;
      game.scene = 'preSlapDialog';
      game.dialogTick = 0; game.dialogDone = false;  
      }
    }
  }
  if (game.scene==='winFlip'){
    game.animT++;
    if (game.animT >= CFG.winFlip.frames){
      // Go to opponent dialog → card fly → show password → reminder
      game.scene='winDialog1'; game.dialogTick=0; game.dialogDone=false; SND.play('win');
    }
  }
  if (game.scene==='slap'){
    game.animT++;
    const T1=CFG.slap.tApproach, T2=T1+CFG.slap.tWindup, T3=T2+CFG.slap.tHit, T4=T3+CFG.slap.tRetreat;
    if (game.animT === T2 + 1) SND.play('slap'); // impact frame
    if (game.animT > T4){
      game.hearts = Math.max(0, game.hearts - 1);
      if (game.hearts === 0){
        // dramatic faint fade
        game.scene='faint';
        game.faintAlpha = 0;
        game.animT = 0;
        SND.play('lose');
      } else {
        game.dialog = "Recruiter: HaHaHa, Not Good Enough. Rules are rules Brace yourself…";
        game.dialogTick=0; game.dialogDone=false;   game.dialogPages = null; // force layout
        game.scene='dialog';
      }
    }
  }
  if (game.scene==='faint'){
    // build up the fade, then lock game-over until explicit restart
    game.animT++;
    game.faintAlpha = Math.min(CFG.faint.maxAlpha, game.animT / CFG.faint.fadeFrames * CFG.faint.maxAlpha);
    if (game.animT >= CFG.faint.fadeFrames){
      game.scene='gameOver';
      game.animT = 0;
      game.canRestart = false;
    }
  }
  if (game.scene==='gameOver'){
    game.animT++;
    if (game.animT >= CFG.faint.lockFrames) game.canRestart = true; // allow Enter/Space only
  }
  if (game.scene==='cardFly'){
    game.animT++;
    if (game.animT >= CFG.card.flyFrames){
      // Now show password then reminder
      game.scene='showPassword'; game.dialogTick=0; game.dialogDone=false;
    }
  }
}

// ----------------- INPUT -----------------
function nextIntro(){
  if (game.introStep < INTRO_LINES.length-1){
    game.introStep++;
    game.dialogTick = 0; game.dialogDone=false;
  } else {
    // intro over → go to menu
    game.scene='menu';
    game.dialogTick=0; game.dialogDone=false;
  }
}

function onClick(){
  if(!audioUnlocked){ SND.init(); audioUnlocked=true; SND.start('bgm'); }

  if (game.scene==='introDialog'){ nextIntro(); return; }

  if (game.scene === 'preSlapDialog'){
  // advance one line at a time (like tutorial)
  if (game.preSlapStep < PRE_SLAP_LINES.length - 1){
    game.preSlapStep++;
    game.dialogTick = 0; game.dialogDone = false;
  } else {
    // finished lines → start slap animation
    game.animT = 0;
    game.scene = 'slap';
  }
  return;
}
if (game.scene==='menu'){
  const items = getMenuItems();
  const choice = items[game.selection];

  if (choice === 'READ CARD'){
    game.dialog = `Card reads: ${game.wonPassword}\nRecruiter: Keep it safe—you'll need it.`;
    game.dialogTick=0; game.dialogDone=false;
    game.dialogPages=null; // force relayout
    game.scene='dialog';
    return;
  }

  if (choice==='THROW TILE'){
    if (game.hasWon){
      game.dialog = `You already have a passcode: ${game.wonPassword}. But sure—play for fun!`;
      game.dialogTick=0; game.dialogDone=false; game.dialogPages=null;
      game.scene='dialog'; return;
    }
    game.meterPhase=0; game.scene='throwMeter'; game.dialogTick=0; return;
  }
  if (choice==='HELP'){ game.scene='dialog'; game.dialog="Lock POWER, then AIM X, then AIM Y. Flip the red tile to win!"; game.dialogTick=0; game.dialogDone=false; game.dialogPages=null; return; }
  if (choice==='STATS'){ game.scene='dialog'; game.dialog=`Hearts: ${game.hearts}` + (game.hasWon?`\nPass: ${game.wonPassword}`:''); game.dialogTick=0; game.dialogDone=false; game.dialogPages=null; return; }
  if (choice==='QUIT'){ game.scene='dialog'; game.dialog='See you at Kraken Games!'; game.dialogTick=0; game.dialogDone=false; game.dialogPages=null; return; }
}

  if (game.scene==='throwMeter'){
    if (game.meterPhase < 2){ game.meterPhase++; SND.play('throw'); return; }
    const success = computeHit(game.power, game.aimX, game.aimY);
    game.lastOutcome = success ? 'win' : 'fail';
    game.animT = 0; game.scene='anim'; SND.play('throw'); return;
  }

  if (game.scene==='winDialog1'){
    // Start card fly
    game.animT=0; game.scene='cardFly';
    // obtain password locally for now (plug your server later)
    game.password = localPassword();
    return;
  }

  if (game.scene==='showPassword'){
    // After showing the text on the card, go to reminder
    game.scene='winReminder'; game.dialogTick=0; game.dialogDone=false;
    return;
  }

  if (game.scene==='winReminder'){
    // Wrap up win → mark as won and return to menu
    game.hasWon = true; game.wonPassword = game.password;
    game.scene='menu'; game.dialogTick=0; game.dialogDone=false;
    return;
  }

  if (game.scene==='dialog'){
    if (advanceDialogPage()) return;
    game.scene='menu'; game.dialog="What will you do?"; game.selection=0; return; }

  // DO NOT restart on generic click after Game Over; require Enter/Space
}
function onKey(e){
  if (game.scene==='menu'){
    const items = getMenuItems();
    if(e.key==='ArrowDown') game.selection=(game.selection+1)%items.length;
    if(e.key==='ArrowUp')   game.selection=(game.selection-1+items.length)%items.length;
    if(e.key==='Enter'||e.key===' ') onClick();
  } 
  else if (game.scene==='throwMeter' && (e.key==='Enter'||e.key===' ')){
    onClick();
  } 
  else if (game.scene==='introDialog' && (e.key==='Enter'||e.key===' ')){
    nextIntro();
  } 
  else if (game.scene === 'preSlapDialog' && (e.key==='Enter' || e.key===' ')){
    if (game.preSlapStep < PRE_SLAP_LINES.length - 1){
      game.preSlapStep++;
      game.dialogTick = 0; 
      game.dialogDone = false;
    } else {
      game.animT = 0;
      game.scene = 'slap';
    }
    return;
  }
  else if ((game.scene==='dialog'||game.scene==='winDialog1'||game.scene==='showPassword'||game.scene==='winReminder') && (e.key==='Enter'||e.key===' ')){
    onClick();
  } 
  else if (game.scene==='gameOver' && (e.key==='Enter'||e.key===' ')){
    if (game.canRestart){ resetGame(); }
  }
}


// ----------------- MAIN LOOP -----------------
function loop(){ update(); render(); requestAnimationFrame(loop); }

// ----------------- BOOT -----------------
(async function start(){
  loop(); // draw immediately

  // load images
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
  assets.card       = await loadImg(window.Sprites.card);

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
})();
