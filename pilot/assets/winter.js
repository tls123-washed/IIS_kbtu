// The landscape is painted once per resize or palette change. Only small snow layers move.
const root = document.documentElement;
const scene = document.querySelector('#winterScene');
const canvas = scene.querySelector('canvas');
const snow = scene.querySelector('.winter-flurries');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const enabled = () => root.hasAttribute('data-winter');
let frame = 0;

function draw() {
  frame = 0;
  if (!enabled()) return;
  const w = scene.clientWidth, h = scene.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2, 5400 / Math.max(w, 1));
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx || !w || !h) return;
  ctx.scale(ratio, ratio);
  const night = root.dataset.theme === 'dark';
  const pick = (day, dark) => night ? dark : day;
  const snowcap = pick('#fff9ef', '#c5d7e3');
  const bark = pick('#694333', '#473949');
  let seed = 2261;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

  function polygon(points, color) {
    ctx.beginPath();
    points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function circle(x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI); ctx.fill();
  }
  function stroke(points, color, thickness = 1) {
    ctx.beginPath();
    points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.lineWidth = thickness; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.stroke();
  }
  function box(x,y,width,height,color) {
    ctx.fillStyle = color; ctx.fillRect(x,y,width,height);
  }
  function placed(x,y,scale,paint) {
    ctx.save(); ctx.translate(x,y); ctx.scale(scale,scale); paint(); ctx.restore();
  }
  function star(x,y,r,color) {
    polygon([[x,y-r],[x+r*.22,y-r*.25],[x+r*.82,y],[x+r*.22,y+r*.22],
      [x,y+r],[x-r*.22,y+r*.22],[x-r*.82,y],[x-r*.22,y-r*.25]],color);
  }
  const sky = ctx.createLinearGradient(0,0,0,h);
  sky.addColorStop(0,pick('#f9e9dc','#101b38'));
  sky.addColorStop(.55,pick('#fff8eb','#2c415e'));
  sky.addColorStop(1,pick('#f1dfd5','#80697c'));
  box(0,0,w,h,sky);
  for (let i=0; i<Math.min(650,w*h/4300); i++) {
    const x=random()*w, y=random()*h*.9;
    if (i % 12 === 0) star(x,y,2+random()*3,pick('#c69c72','#eddbb0'));
    else circle(x,y,.5+random()*1.1,pick('#fffdf5','#bfccdf'));
  }
  const moonX = w * (w < 700 ? .90 : .92), moonY = Math.max(55,h*.15);
  const radius = Math.min(48, Math.max(18,w*.024));
  const halo = ctx.createRadialGradient(moonX,moonY,radius*.85,moonX,moonY,radius*2.2);
  halo.addColorStop(0,pick('#f9c4705c','#ffe3a432')); halo.addColorStop(1,'transparent');
  circle(moonX,moonY,radius*2.2,halo); circle(moonX,moonY,radius,pick('#f1bd82','#ffebc1'));
  if (night) for (const [x,y,r] of [[-.4,-.2,.17],[.21,.35,.21],[.36,-.38,.11]]) {
    circle(moonX+x*radius,moonY+y*radius,r*radius,'#e8cea34f');
  }
  function hill(level, amplitude, phase, color) {
    const points = [[0,h]];
    for (let x=0; x<=w+8; x+=8) {
      const wave = Math.sin(x/w*7+phase) + .38*Math.sin(x/w*17+phase);
      points.push([x, h*level + amplitude*wave]);
    }
    points.push([w+8,h]); polygon(points,color);
  }
  hill(.57,h*.053,.3,pick('#e4cec6','#485770'));
  hill(.64,h*.052,1.9,pick('#c8cdca','#394e62'));
  function pine(x,y,height,far=false) {
    placed(x,y,height/100,() => {
      box(-2,-23,4,25,far ? pick('#a8b9ac','#455c6c') : bark);
      const main = far ? pick('#a9bcb0','#475f70') : pick('#497569','#253f4c');
      const shade = far ? main : pick('#30574f','#1e3342');
      const frost = far ? pick('#c6d0c5','#708493') : snowcap;
      for (let tier=0; tier<4; tier++) {
        const tip=-47-tier*17, width=24-tier*4.6, base=tip+35-tier*3;
        polygon([[0,tip],[-width,base],[-width*.42,base-2],[-width*.17,base+2],[width,base-3]],main);
        polygon([[0,tip],[width,base-3],[2,base]],shade);
        polygon([[0,tip],[-width*.73,base-9],[-width*.32,base-12],[-width*.20,base-8],
          [1,base-15],[width*.43,base-10],[width*.71,base-12]],frost);
      }
    });
  }
  for(let x=-8; x<w+16; x+=10+random()*14) {
    pine(x,h*.69+11*Math.sin(x/99),20+random()*29,true);
  }
  hill(.73,h*.035,3.7,pick('#edede3','#8899a9'));
  function cottage(x,y,size,red) {
    placed(x,y,size,() => {
      box(-40,-50,82,50,red ? pick('#ac4f43','#824d53') : pick('#ab8472','#5d6977'));
      polygon([[26,-52],[52,-44],[52,0],[26,0]],pick('#86564e','#495362'));
      box(16,-77,8,25,bark); box(14,-79,12,5,snowcap);
      polygon([[-50,-46],[-15,-79],[25,-75],[60,-43],[25,-46],[-14,-68]],bark);
      polygon([[-54,-47],[-16,-82],[26,-78],[62,-44],[55,-43],[23,-68],[-15,-74],[-45,-45]],snowcap);
      for(const wx of [-31,3,34]) {
        box(wx,-35,11,16,'#633e38'); box(wx+1,-34,9,13,'#ffdda0');
        box(wx+5,-34,1,14,'#885744'); box(wx,-28,11,1,'#885744'); box(wx-2,-20,15,2,snowcap);
      }
      box(-13,-26,11,26,bark); circle(-5,-11,1,'#f3cf8e');
    });
  }
  const scale = Math.min(1.65, Math.max(.56, Math.min(h/810,w/1000)));
  cottage(w*.068,h*.77,scale*.91,true); cottage(w*.135,h*.76,scale*.62,false);
  cottage(w*.842,h*.76,scale*.79,true); cottage(w*.895,h*.78,scale*.62,false);
  for(const [fraction, height] of [[.012,161],[.034,128],[.17,115],[.802,122],[.946,169],[.983,212]]) {
    pine(w*fraction,h*.80,height*scale);
  }
  hill(.84,h*.028,.6,pick('#fffcf1','#b8c9d3'));
  function snowman() {
    ctx.fillStyle=pick('#cad1c5','#849ba9');ctx.beginPath();ctx.ellipse(2,2,34,5,0,0,7);ctx.fill();
    stroke([[-13,-30],[-30,-44],[-36,-48]],bark,2.2);stroke([[-29,-43],[-29,-51]],bark,1.7);
    stroke([[11,-31],[30,-41],[36,-38]],bark,2.2);
    circle(0,-18,22,pick('#e1e7de','#afc1c9'));circle(-3,-20,19,snowcap);
    circle(-1,-51,15,pick('#e1e7de','#afc1c9'));circle(-3,-52,13,snowcap);
    for(const y of [-28,-18]) circle(-5,y,1.8,bark);
    circle(-9,-54,1.35,bark);circle(-2,-54,1.35,bark);
    polygon([[-7,-51],[-20,-49],[-7,-47]],'#d78b50');
    box(-14,-41,26,5,'#b33a3c');polygon([[3,-37],[9,-38],[16,-23],[8,-23]],'#a12c38');
    ctx.rotate(-.09);box(-8,-77,19,14,'#344452');box(-13,-65,29,4,'#344452');box(-8,-69,19,4,'#b44b48');
  }
  placed(w*.935,h*.88,scale*1.22,snowman);
  for (let i=0;i<w/12;i++) {
    const x=random()*w,y=h*(.88+random()*.12);
    stroke([[x,y],[x+4+random()*10,y-1]],pick('#d9ded2','#9baebb'),1);
  }
  // Fine evergreen needles and glass ornaments frame both upper corners.
  function bough(x,y,length,angle) {
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    stroke([[0,0],[length*.55,3],[length,0]],pick('#705948','#4a5661'),2.4);
    for(let i=0;i<length-4;i+=4) {
      const needle=(1-i/length)*16+4;
      for(const sign of [-1,1]) stroke([[i,2],[i+needle*.88,sign*needle]],pick('#557867','#577e7e'),1.35);
    }
    ctx.restore();
  }
  for(const mirror of [false,true]){
    ctx.save();ctx.translate(mirror?w:0,0);ctx.scale(mirror?-scale:scale,scale);
    for(const [x,y,len,angle] of [[-12,12,169,.15],[3,16,103,.76],[36,21,87,.54],[80,25,65,.39],[21,-1,106,.18]]) bough(x,y,len,angle);
    for(const [x,y,r,color] of [[24,83,9,'#ae383d'],[61,67,6,'#cf9c5f']]){
      stroke([[x,27],[x,y-r]],'#be9f6d',1);box(x-2,y-r-2,4,4,'#bc9c62');circle(x,y,r,color);
      stroke([[x-r*.52,y-1],[x-r*.35,y-r*.47]],'#ffedd5',1.5);
    }
    ctx.restore();
  }
  // The banner has its own composition so the ornaments fit beside even a short mobile title.
  const banner = document.querySelector('.winter-banner');
  const bw = banner.clientWidth, bh = banner.clientHeight;
  if (bw && bh) {
    banner.width = Math.round(bw*ratio); banner.height = Math.round(bh*ratio);
    const brush = banner.getContext('2d');
    brush.scale(ratio,ratio);
    const baubles = w < 761 ? [[.75,.55,.17],[.94,.28,.105]] : [[.48,.52,.18],[.55,.32,.115],[.42,.26,.082]];
    for(const [fraction, vertical, size] of baubles) {
      const x=bw*fraction, y=bh*vertical, r=bh*size;
      brush.strokeStyle=pick('#9d7a4c','#e2b577');brush.lineWidth=1.2;
      brush.beginPath();brush.moveTo(x,-1);brush.lineTo(x,y-r);brush.stroke();
      brush.fillStyle=pick('#ac824d','#d5ad73');brush.fillRect(x-r*.22,y-r-2,r*.44,5);
      brush.fillStyle=size>.12 ? pick('#b84147','#a64958') : pick('#c39b5f','#cca873');
      brush.beginPath();brush.arc(x,y,r,0,Math.PI*2);brush.fill();
      brush.save();brush.clip();brush.strokeStyle='#fff1d7';brush.lineWidth=1.4;
      brush.beginPath();brush.moveTo(x-r,y-r*.18);
      for(let j=1;j<=8;j++) brush.lineTo(x-r+j*r*.25,y-r*(j%2 ? -.12 : .18));
      brush.stroke();brush.beginPath();brush.arc(x,y,r*.78,3.45,4.36);brush.stroke();
      brush.restore();
    }
    for(let i=0;i<bw/13;i++){
      const x=random()*bw,y=random()*bh;
      brush.fillStyle=pick('#b48a55','#e8d3b0');brush.globalAlpha=.42;
      brush.fillRect(x,y,1.4,1.4);
      if(i%7===0) {brush.fillRect(x-2,y,5,1);brush.fillRect(x,y-2,1,5);}
    }
    brush.globalAlpha=1;
  }
}

function schedule() {
  if (enabled() && !frame) frame = requestAnimationFrame(draw);
}
new ResizeObserver(schedule).observe(scene);
new MutationObserver(schedule).observe(root, {attributes:true, attributeFilter:['data-theme']});

function burst(event) {
  if (!enabled() || reduced.matches || document.hidden) return;
  const button = event.target.closest('button, .avatar-picker, .winter-setting, select, [data-act]');
  if (!button || button.disabled) return;
  const rect = button.getBoundingClientRect();
  const shake = button.matches('[data-act="nav"], [data-act="join"], .theme-toggle, .chip-comm');
  const glow = button.matches('.like, [data-act="ticket"], [data-act="follow"]');
  const x = event.detail ? event.clientX : rect.left+rect.width/2;
  const y = event.detail ? event.clientY : rect.top+rect.height/2;
  if (shake) button.animate([{translate:'0'},{translate:'-2px 0'},{translate:'2px 0'},{translate:'0'}],210);
  for(let i=0; i<8; i++){
    const bit = document.createElement('i');
    bit.className = 'snow-bit' + (glow ? ' spark' : '');
    bit.setAttribute('aria-hidden','true');
    const spread = (Math.random()-.5)*(shake?88:50);
    bit.style.left = (x+(Math.random()-.5)*16)+'px'; bit.style.top = y+'px';
    document.body.append(bit);
    const up = glow ? -28 : shake ? -13 : -4;
    const fall = glow ? -36-Math.random()*20 : 25+Math.random()*36;
    bit.animate([{transform:'scale(.5)',opacity:0},{transform:`translate(${spread*.35}px,${up}px) scale(1)`,opacity:1,offset:.25},
      {transform:`translate(${spread}px,${fall}px) rotate(95deg) scale(.4)`,opacity:0}],380+Math.random()*260).finished.then(()=>bit.remove());
  }
}
document.addEventListener('click',burst,true);
export function updateWinter() {
  if (!enabled()) { snow.replaceChildren(); document.querySelectorAll('.snow-bit').forEach(bit=>bit.remove()); return; }
  if (!snow.childElementCount) {
    for(let i=0;i<32;i++){
      const flake=document.createElement('i');
      flake.style.setProperty('--x', ((i*37)%100)+'%');
      flake.style.setProperty('--fall', (11+i%8)+'s');
      flake.style.setProperty('--delay', -(i*3.81)+'s');
      flake.style.setProperty('--size', (2+i%3)+'px');
      snow.append(flake);
    }
  }
  schedule();
}
