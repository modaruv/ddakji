<script>
// ====== game.js (with win flip anim + real GAME OVER) ======

if (typeof Sprites === 'undefined') {
  console.error('Sprites is NOT defined — check that sprites is loaded before game.');
} else {
  console.log('Sprites OK', Object.keys(Sprites));
}

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
    showHelp: true,
    opponentY: 36,
    box: { x: 0, y: 160-48, w: 240, h: 48 },
    meter: { rightPad: 6, gap: 4, powerW: 72, powerH: 10, aimSize: 40 }
  }
};

function loadImg(src) {
  return new Promise(res => {
    if (!src) return res(null);
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => { console.warn('Image failed:', src); res(null); };
    i.src = src;
  });
}

const W=240,H=160;
const ctx = document.getElementById('gba').getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.font = '8px monospace';
ctx.textBaseline = 'top';

let assets = {};
let game;

function resetGame() {
  game = {
    scene:'intro',
    dialog:'Welcome to Kraken Games! Click to start.',
    dialogTick:0,
    dialogDone:false,
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

function drawText(x,y,str){ ctx.fillStyle = "#000"; ctx.fillText(str, x, y); }
function drawDialog(text){
  if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
  const shown = text.slice(0, Math.floor(game.dialogTick/2));
  drawText(8, CFG.ui.box.y + 8, shown);
}

function drawBaseLayer(){
  if (assets.bg) ctx.drawImage(assets.bg,0,0);
  else { ctx.fillStyle = '#121219'; ctx.fillRect(0,0,W,H); }

  if (assets.opponent) ctx.drawImage(assets.opponent, 180, CFG.ui.opponentY);
  if (assets.player)   ctx.drawImage(assets.player, 20, 70);
  if (assets.tileRed)  ctx.drawImage(assets.tileRed, 160, 65);
  if (assets.tileBlue) ctx.drawImage(assets.tileBlue, 60, 110);
}

function render(){
  // Hearts
  function renderHearts(){
    if (!CFG.ui.showHearts) return;
    for (let i = 0; i < 5; i++) {
      const hx = 8 + i * 12, hy = 8;
      if (i < game.hearts) {
        if (assets.heart) ctx.drawImage(assets.heart, hx, hy);
      } else if (assets.heartEmpty) {
        ctx.drawImage(assets.heartEmpty, hx, hy);
      }
    }
  }

  // Scene renders
  if (game.scene==='menu'){
    drawBaseLayer(); renderHearts();
    drawDialog("What will you do?");
    for(let i=0;i<menuItems.length;i++){
      drawText(18, H-30+i*10, (game.selection===i?"> ":"  ")+menuItems[i]);
    }
  }
  else if (game.scene==='throwMeter'){
    drawBaseLayer(); renderHearts();

    const prompt = game.meterPhase===0 ? "Tap to lock POWER…" :
                   game.meterPhase===1 ? "Tap to lock AIM X…" :
                                         "Tap to lock AIM Y…";
    drawDialog(prompt);

    const bx = CFG.ui.box.x, by = CFG.ui.box.y, bw = CFG.ui.box.w, bh = CFG.ui.box.h;
    const padR = CFG.ui.meter.rightPad, aimS = CFG.ui.meter.aimSize, gap = CFG.ui.meter.gap;

    const aimX = bx + bw - padR - aimS;
    const aimY = by + Math.floor((bh - aimS)/2);

    const pW = CFG.ui.meter.powerW, pH = CFG.ui.meter.powerH;
    const pX = aimX - 6 - pW, pY = aimY - gap - pH;

    const segs = Math.floor(game.power*10);
    for(let i=0;i<10;i++){
      const img = (i<segs)? assets.tileBlue: assets.tileRed;
      if(img) ctx.drawImage(img, pX + i * Math.floor(pW/10), pY, Math.floor(pW/10), pH);
    }

    if(assets.tileRed){
      ctx.drawImage(assets.tileRed, aimX, aimY);
      ctx.drawImage(assets.tileRed, aimX + aimS - 15, aimY);
      ctx.drawImage(assets.tileRed, aimX, aimY + aimS - 15);
      ctx.drawImage(assets.tileRed, aimX + aimS - 15, aimY + aimS - 15);
    }
    if(assets.tileBlue){
      const cx = aimX + Math.floor(game.aimX * (aimS - 8));
      const cy = aimY + Math.floor(game.aimY * (aimS - 8));
      ctx.drawImage(assets.tileBlue, cx, cy, 8, 8);
    }
  }
  else if (game.scene==='anim'){
    // Player's blue tile travel
    drawBaseLayer(); renderHearts();
    drawDialog(game.lastOutcome==='win'?"A perfect hit!":"Miss… The tile didn’t flip.");
    const t = Math.min(game.animT/30,1);
    const bx = 60 + (150-60)*t;
    const by = 110 + (90-110)*t;
    if(assets.tileBlue) ctx.drawImage(assets.tileBlue, bx, by);
  }
  else if (game.scene==='winFlip'){
    // Red tile fancy flip: fly up, spin, land flipped
    drawBaseLayer(); renderHearts();

    const d = 60; // frames for flip anim
    const u = Math.min(game.animT / d, 1);
    // Simple bezier-ish arc: from (160,65) up towards (140,40) then back to (160,65)
    const start = {x:160, y:65};
    const apex  = {x:140, y:40};
    const end   = {x:160, y:65};
    // quadratic interpolation
    const x = (1-u)*(1-u)*start.x + 2*(1-u)*u*apex.x + u*u*end.x;
    const y = (1-u)*(1-u)*start.y + 2*(1-u)*u*apex.y + u*u*end.y;
    const angle = u * Math.PI * 6; // 3 full spins

    // Draw spinning red tile (or its "back" if provided at end)
    ctx.save();
    ctx.translate(x+8, y+8);   // center for a 16x16 tile
    ctx.rotate(angle);
    const tileImg = (u>=0.95 && assets.tileRedBack) ? assets.tileRedBack : assets.tileRed;
    if (tileImg) ctx.drawImage(tileImg, -8, -8, 16, 16);
    ctx.restore();

    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "Tile flipped!");

  }
  else if (game.scene==='slap'){
    // Lose animation
    const amp = 2, shake = Math.sin(game.animT * 0.8) * amp;
    ctx.save(); ctx.translate(shake, 0);
    drawBaseLayer();
    ctx.restore();

    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "SLAP!");
    // Hearts draw AFTER slap text, so you still see remaining lives on HUD:
    if (CFG.ui.showHearts) {
      for (let i = 0; i < 5; i++) {
        const hx = 8 + i * 12, hy = 8;
        if (i < game.hearts) { if (assets.heart) ctx.drawImage(assets.heart, hx, hy); }
        else if (assets.heartEmpty) ctx.drawImage(assets.heartEmpty, hx, hy);
      }
    }
  }
  else if (game.scene==='gameOver'){
    // Lock input except for Play Again
    drawBaseLayer();
    if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
    drawText(8, CFG.ui.box.y + 8, "GAME OVER. Tap to Play Again.");
    // Draw hearts as zeroed
    if (CFG.ui.showHearts) {
      for (let i = 0; i < 5; i++) {
        const hx = 8 + i * 12, hy = 8;
        if (assets.heartEmpty) ctx.drawImage(assets.heartEmpty, hx, hy);
      }
    }
  }
  else { // intro or dialog
    drawBaseLayer(); 
    if (CFG.ui.showHearts) {
      for (let i = 0; i < 5; i++) {
        const hx = 8 + i * 12, hy = 8;
        if (i < game.hearts) { if (assets.heart) ctx.drawImage(assets.heart, hx, hy); }
        else if (assets.heartEmpty) ctx.drawImage(assets.heartEmpty, hx, hy);
      }
    }
    drawDialog(game.dialog);
  }
}

function update(){
  if(['intro','menu','dialog'].includes(game.scene)){
    if(!game.dialogDone) game.dialogTick++;
  }
  if(game.scene==='throwMeter'){
    if(game.meterPhase===0) game.power = 0.5 + 0.5*Math.sin(performance.now()/200);
    if(game.meterPhase===1) game.aimX  = 0.5 + 0.5*Math.sin(performance.now()/350);
    if(game.meterPhase===2) game.aimY  = 0.5 + 0.5*Math.sin(performance.now()/280);
  }
  if(game.scene==='anim'){
    game.animT++;
    if(game.animT>CFG.throw.animFrames){
      if(game.lastOutcome==='win'){
        // After blue tile reaches, start the red tile flip anim
        game.animT = 0;
        game.scene = 'winFlip';
      } else {
        // Fail path → slap
        game.animT = 0;
        game.scene = 'slap';
      }
    }
  }
  if(game.scene==='winFlip'){
    game.animT++;
    if (game.animT >= 60) {
      // After flip finishes, show success + password
      fetchPassword()
        .then(pw => { game.password=pw; showPassword(); })
        .catch(()  => { game.password=localPassword(); showPassword(); });
      game.scene = 'dialog';
      game.dialog = "Tile flipped successfully!"; // will be immediately replaced by showPassword()
      game.dialogTick=0; game.dialogDone=false;
    }
  }
  if(game.scene==='slap'){
    game.animT++;
    if (game.animT >= 24) {
      game.hearts = Math.max(0, game.hearts - 1);
      if (game.hearts === 0) {
        // Lock the game on GAME OVER
        game.scene = 'gameOver';
      } else {
        game.dialog = "Ouch! You lost a heart.";
        game.dialogTick=0; game.dialogDone=false; game.scene='dialog';
      }
    }
  }
}

function showPassword(){ 
  game.dialog = `You win! Password: ${game.password}`; 
  game.dialogTick=0; game.dialogDone=false; 
}

function onClick(){
  if(game.scene==='intro'){ game.scene='menu'; game.dialog="What will you do?"; game.dialogTick=0; return; }
  if(game.scene==='menu'){
    const choice = menuItems[game.selection];
    if(choice==='THROW TILE'){ game.meterPhase=0; game.scene='throwMeter'; game.dialogTick=0; return; }
    if(choice==='HELP'){ game.scene='dialog'; game.dialog="Tap to lock POWER, then AIM X, then AIM Y."; game.dialogTick=0; return; }
    if(choice==='STATS'){ game.scene='dialog'; game.dialog=`Hearts: ${game.hearts}`; game.dialogTick=0; return; }
    if(choice==='QUIT'){ game.scene='dialog'; game.dialog="See you at Kraken Games!"; game.dialogTick=0; return; }
  }
  if(game.scene==='throwMeter'){
    if(game.meterPhase<2){ game.meterPhase++; return; }
    const success = computeHit(game.power, game.aimX, game.aimY);
    game.lastOutcome = success? 'win':'fail'; game.animT=0; game.scene='anim'; return;
  }
  if(game.scene==='dialog'){ game.scene='menu'; game.dialog="What will you do?"; game.selection=0; return; }
  if(game.scene==='gameOver'){ 
    // Play Again → reset everything
    resetGame(); 
    return; 
  }
}
function onKey(e){
  if(game.scene==='menu'){
    if(e.key==='ArrowDown') game.selection=(game.selection+1)%menuItems.length;
    if(e.key==='ArrowUp')   game.selection=(game.selection-1+menuItems.length)%menuItems.length;
    if(e.key==='Enter' || e.key===' ') onClick();
  } else if(game.scene==='throwMeter' && (e.key==='Enter' || e.key===' ')){ onClick(); }
  else if((game.scene==='intro' || game.scene==='dialog' || game.scene==='gameOver') && (e.key==='Enter'||e.key===' ')){ onClick(); }
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

function fetchPassword(){
  return new Promise((resolve,reject)=>{
    const hasGAS = typeof google !== 'undefined' && google.script && google.script.run;
    if(!hasGAS) return reject(new Error('No GAS'));
    google.script.run.withSuccessHandler(resolve).withFailureHandler(()=>reject(new Error('GAS error'))).getPassword();
  });
}
function localPassword(){
  const verbs=["flying","dancing","sneaky","roaring","dashing","clever","mighty","swift","silent","sparkling"];
  const animals=["fox","otter","kraken","wolf","tiger","owl","falcon","panther","shark","dragon"];
  return `the${verbs[Math.floor(Math.random()*verbs.length)]}${animals[Math.floor(Math.random()*animals.length)]}`;
}

function loop(){ update(); render(); requestAnimationFrame(loop); }

window.addEventListener('load', async () => {
  loop();
  assets.bg        = await loadImg(Sprites.bg);
  assets.player    = await loadImg(Sprites.player);
  assets.opponent  = await loadImg(Sprites.opponent);
  assets.tileBlue  = await loadImg(Sprites.tileBlue);
  assets.tileRed   = await loadImg(Sprites.tileRed);
  assets.tileRedBack = await loadImg(Sprites.tileRedBack); // optional "back" face
  assets.card      = await loadImg(Sprites.card);
  assets.box       = await loadImg(Sprites.box);
  assets.heart     = await loadImg(Sprites.heart);
  assets.heartEmpty= await loadImg(Sprites.heartEmpty);
  assets.slapHand  = await loadImg(Sprites.slapHand);

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
});
</script>

