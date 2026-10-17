/** Centered celebration, using the same Nanak Coin asset as the counter. */
export function celebrateCoin(layer, counter, onCollect) {
  const animations = [];
  let collected = false, stopped = false;
  const collect = () => {
    if (collected) return;
    collected = true; onCollect();
    counter.classList.add('lp-coin-collected');
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    collect(); // Navigation/retry must never lose an earned coin or leave full bars.
    animations.forEach(animation => animation.cancel());
    layer.hidden = true; layer.replaceChildren();
    counter.classList.remove('lp-coin-collected');
  };
  counter.classList.remove('lp-coin-collected');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    collect(); return stop;
  }
  layer.hidden = false;
  const animate = (node, keyframes, timing) => {
    const animation = node.animate(keyframes, {...timing, fill:'both'});
    animations.push(animation); return animation;
  };
  const colors = ['#f6a623', '#6668ed', '#2da46f', '#e66e83', '#ffd66b'];
  for (let i=0; i<72; i++) {
    const piece = document.createElement('i'); piece.className = 'lp-confetti';
    piece.style.backgroundColor = colors[i % colors.length]; layer.append(piece);
    const angle = i / 72 * Math.PI * 2;
    const x = Math.cos(angle) * (65 + i % 5 * 22), y = Math.sin(angle) * 90 - 45;
    animate(piece, [
      {transform:'translate(-50%, -50%) scale(.2)', opacity:0},
      {transform:`translate(${x}px, ${y}px) rotate(${i*31}deg)`, opacity:1, offset:.28},
      {transform:`translate(${x*1.25}px, ${150+i%6*19}px) rotate(${i*67}deg)`, opacity:0}
    ], {duration:1800+i%5*100, easing:'cubic-bezier(.15,.65,.4,1)'});
  }
  const coin = document.createElement('img'); coin.className = 'lp-flying-coin';
  coin.src = counter.querySelector('img').src; coin.alt = ''; layer.append(coin);
  const bounds = layer.getBoundingClientRect(), target = counter.querySelector('img').getBoundingClientRect();
  const dx = target.x + target.width/2 - bounds.x - bounds.width/2;
  const dy = target.y + target.height/2 - bounds.y - bounds.height/2;
  const flight = animate(coin, [
    {transform:'translate(-50%, -50%) scale(.3)', opacity:0},
    {transform:'translate(-50%, -50%) scale(1.1)', opacity:1, offset:.2},
    {transform:'translate(-50%, -50%) scale(1)', opacity:1, offset:.45},
    {transform:`translate(calc(-50% + ${dx*.45}px), calc(-50% + ${dy-35}px)) scale(.75)`, opacity:1, offset:.75},
    {transform:`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.48)`, opacity:0}
  ], {duration:1900, delay:150, easing:'ease-in-out'});
  flight.finished.then(() => { if (!stopped) collect(); }, () => {});
  Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
    if (stopped) return;
    layer.hidden = true; layer.replaceChildren();
  });
  return stop;
}
