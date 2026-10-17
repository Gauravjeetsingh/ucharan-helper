/** Falling two-tone petals and one earned coin, shared by the practice modes. */
export function celebratePetals(layer, counter, {earned = true, petalCount = 72, onCollect}) {
  const animations = [];
  let collected = false, stopped = false;
  const collect = () => {
    if (!earned || collected) return;
    collected = true; onCollect(); counter.classList.add('reward-collected');
  };
  const stop = () => {
    if (stopped) return;
    stopped = true; collect();
    animations.forEach(animation => animation.cancel());
    layer.hidden = true; layer.replaceChildren(); counter.classList.remove('reward-collected');
  };
  counter.classList.remove('reward-collected');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    collect(); return stop;
  }
  layer.hidden = false;
  const bounds = layer.getBoundingClientRect();
  const animate = (node, keyframes, timing) => {
    const animation = node.animate(keyframes, {...timing, fill:'both'});
    animations.push(animation); return animation;
  };
  const palette = [
    ['#ff91d7','#f950ac'], ['#c5afff','#9877e9'], ['#ffcf86','#f6a34e'],
    ['#ffb5b1','#f17d91'], ['#a6dbc5','#71b89b'], ['#fff0a2','#ecc968']
  ];
  const svgNS = 'http://www.w3.org/2000/svg';
  for (let i=0; i<petalCount; i++) {
    const petal = document.createElementNS(svgNS,'svg');
    petal.setAttribute('viewBox','0 0 44 58'); petal.setAttribute('aria-hidden','true');
    petal.classList.add('celebration-petal');
    petal.style.left = `${4 + (i * 37.7) % 92}%`;
    petal.style.width = `${18 + i % 5 * 3}px`;
    const colors = palette[i % palette.length];
    for (const [shape,color] of [
      ['M2 56C0 36-1 18 12 7C18 2 24 0 28 2C31 4 27 9 32 11C34 12 36 10 37 10C49 28 36 48 2 56Z',colors[0]],
      ['M28 2C31 4 27 9 32 11C34 12 36 10 37 10C49 28 36 48 2 56Z',colors[1]]
    ]) {
      const path = document.createElementNS(svgNS,'path'); path.setAttribute('d',shape); path.setAttribute('fill',color); petal.append(path);
    }
    layer.append(petal);
    const drift = (i % 2 ? 1 : -1) * (14 + i % 4 * 9), rotation = i * 47 % 360;
    const pose = (x,y,turn,tilt) => `translate3d(${x}px,${y}px,0) rotate(${turn}deg) rotateY(${tilt}deg)`;
    animate(petal,[
      {transform:pose(0,-35,rotation,0),opacity:0},
      {transform:pose(drift,bounds.height*.18,rotation+25,35),opacity:.95,offset:.2},
      {transform:pose(-drift*.5,bounds.height*.5,rotation-20,-30),opacity:.95,offset:.5},
      {transform:pose(drift*.7,bounds.height*.82,rotation+35,40),opacity:.85,offset:.8},
      {transform:pose(-drift,bounds.height+95,rotation+60,0),opacity:0}
    ],{duration:2600+i%7*130,delay:i%9*75,easing:'linear'});
  }
  if (earned) {
    const coin = document.createElement('img'); coin.className = 'celebration-coin';
    coin.src = counter.querySelector('img').src; coin.alt = ''; layer.append(coin);
    const target = counter.querySelector('img').getBoundingClientRect();
    const dx = target.x + target.width/2 - bounds.x - bounds.width/2;
    const dy = target.y + target.height/2 - bounds.y - (bounds.height-75);
    const pose = (x,y,scale) => `translate(calc(-50% + ${x}px),calc(-50% + ${y}px)) scale(${scale})`;
    const flight = animate(coin,[
      {transform:pose(0,0,.4),opacity:0},
      {transform:pose(0,-15,1.08),opacity:1,offset:.18},
      {transform:pose(dx*.1,dy*.25,.95),opacity:1,offset:.4},
      {transform:pose(dx*.55,dy*.75,.7),opacity:1,offset:.74},
      {transform:pose(dx,dy,.48),opacity:0}
    ],{duration:2300,delay:250,easing:'ease-in-out'});
    flight.finished.then(() => { if (!stopped) collect(); }, () => {});
  }
  Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
    if (stopped) return;
    layer.hidden = true; layer.replaceChildren();
  });
  return stop;
}
