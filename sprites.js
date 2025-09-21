// Safe stub so the game runs even if you haven't added images/audio yet.
window.Sprites = {
  bg: "",
  box: "",
  player: "",
  opponent: "",
  tileBlue: "",
  tileRed: "",
  tileRedBack: "",
  heart: "",
  heartEmpty: "",
  card: "",
  slapHand: ""
};

window.Sounds = { 
  bgm:"",
  throw:"",
  impact:"",
  slap:"",
  win:"",
  lose:""
};

console.log("sprites.js loaded (stub). Add your base64 or file URLs later.");
