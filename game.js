// ===== Minimal working game (shows intro/menu even with no assets) =====

// Crash visibility
window.addEventListener('error', e => console.error('Error:', e.error||e.message));
window.addEventListener('unhandledrejection', e => console.error('Rejection:', e.reason));

// Ensure globals exist if sprites.js didn't load for some reason
if (typeof window.Sprites === 'undefined') window.Sprites = {};
if (typeof window.Sounds  === 'undefined') window.Sounds  = {};

const W=240, H=160;
const canvas = document.getElementById('gba');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.font = '8px monospace';
ctx.textBaseline = 'top';

const CFG = {
  hearts: 5,
  throw: { powerTarget: 0.75, powerTol: 0.12, aimRadius: 0.22, luck: 0.08, animFrames: 60 },
  ui: { showHearts:true, opponentY:36, box:{x:0,y:160-48,w:240,h:48}, meter:{rightPad:6,gap:4,powerW:72,powerH:10,aimSize:40} }
};

function loadImg(src){
  return new Promise(res=>{
    if(!src){ res(null); return; }
    const i=new Image();
    i.onload=()=>res(i);
    i.onerror=()=>{ console.warn('Image failed:', String(src).slice(0,80)); res(null); };
    i.src=src;
  });
}

// state
let assets = {};
let game = {
  scene:'intro',
  dialog:'Welcome to Kraken Games! Click to start.',
  dialogTick:0, dialogDone:false,
  selection:0,
  hearts:CFG.hearts,
  power:0, aimX:0.5, aimY:0.5,
  meterPhase:0, animT:0, lastOutcome:null, password:null
};
const menuItems = ["THROW TILE","STATS","HELP","QUIT"];

function drawText(x,y,str,color){ ctx.fillStyle=color||"#fff"; ctx.fillText(str,x,y); }
function drawDialog(text){
  // If the box image isn't loaded, still draw readable white text.
  if (assets.box) ctx.drawImage(assets.box, CFG.ui.box.x, CFG.ui.box.y);
  const color = assets.box ? "#000" : "#fff";
  const shown = text.slice(0, Math.floor(game.dialogTick/2));
  drawText(8, CFG.ui.box.y + 8, shown || '...', color);
}
function drawBase(){
  if (assets.bg) ctx.drawImage(assets.bg,0,0); else { ctx.fillStyle='#121219'; ctx.fillRect(0,0,W,H); }
  if (assets.opponent) ctx.drawImage(assets.opponent, 180, CFG.ui.opponentY);
  if (assets.player)   ctx.drawImage(assets.player, 20, 70);
  if (assets.tileRed)  ctx.drawImage(assets.tileRed, 160, 65);
  if (assets.tileBlue) ctx.drawImage(assets.tileBlue, 60, 110);
}
function render(){
  if (game.scene==='menu'){
    drawBase();
    if (CFG.ui.showHearts) for(let i=0;i<5;i++){ const hx=8+i*12, hy=8; if(i<game.hearts && assets.heart) ctx.drawImage(assets.heart,hx,hy); }
    drawDialog("What will you do?");
    for(let i=0;i<menuItems.length;i++) drawText(18, H-30+i*10, (game.selection===i?"> ":"  ")+menuItems[i], assets.box?"#000":"#fff");
  } else {
    drawBase();
    if (CFG.ui.showHearts) for(let i=0;i<5;i++){ const hx=8+i*12, hy=8; if(i<game.hearts && assets.heart) ctx.drawImage(assets.heart,hx,hy); }
    drawDialog(game.dialog);
  }
}
function update(){
  if(['intro','menu','dialog'].includes(game.scene)){ if(!game.dialogDone) game.dialogTick++; }
}
function loop(){ update(); render(); requestAnimationFrame(loop); }

function onClick(){
  if(game.scene==='intro'){ game.scene='menu'; game.dialog="What will you do?"; game.dialogTick=0; return; }
  if(game.scene==='menu'){
    const choice = menuItems[game.selection];
    if(choice==='THROW TILE'){ game.scene='dialog'; game.dialog="Power/Aim coming next"; game.dialogTick=0; return; }
    if(choice==='HELP'){ game.scene='dialog'; game.dialog="Tap to lock power, aim X, aim Y."; game.dialogTick=0; return; }
    if(choice==='STATS'){ game.scene='dialog'; game.dialog='Hearts: '+game.hearts; game.dialogTick=0; return; }
    if(choice==='QUIT'){ game.scene='dialog'; game.dialog='See you at Kraken Games!'; game.dialogTick=0; return; }
  } else if(game.scene==='dialog'){ game.scene='menu'; game.dialog="What will you do?"; game.selection=0; return; }
}
function onKey(e){
  if(game.scene==='menu'){
    if(e.key==='ArrowDown') game.selection=(game.selection+1)%menuItems.length;
    if(e.key==='ArrowUp')   game.selection=(game.selection-1+menuItems.length)%menuItems.length;
    if(e.key==='Enter' || e.key===' ') onClick();
  } else if((game.scene==='intro' || game.scene==='dialog') && (e.key==='Enter'||e.key===' ')){ onClick(); }
}

// boot
(async function start(){
  loop(); // start drawing immediately
  // load images (safe if empty)
  assets.bg        = await loadImg(Sprites.bg);
  assets.player    = await loadImg(Sprites.player);
  assets.opponent  = await loadImg(Sprites.opponent);
  assets.tileBlue  = await loadImg(Sprites.tileBlue);
  assets.tileRed   = await loadImg(Sprites.tileRed);
  assets.box       = await loadImg(Sprites.box);
  assets.heart     = await loadImg(Sprites.heart);

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
})();
