const modes = location.pathname.replace(/\/$/, '') === '/bani/japji-sahib';
document.body.dataset.view = modes ? 'modes' : 'banis';
document.getElementById('banis').hidden = modes;
document.getElementById('modes').hidden = !modes;
if (modes) {
  document.title = 'Japji Sahib · Uchaaran';
  try {
    const completed = JSON.parse(sessionStorage.getItem('uchaaran-followed-pauris') || '[]');
    const count = new Set(completed.filter(n => Number.isInteger(n) && n >= 1 && n <= 38)).size;
    document.getElementById('bani-progress').value = count;
    document.getElementById('step').textContent = `Step ${count}/38`;
  } catch {}
} else document.title = 'ਸੁੰਦਰ ਗੁਟਕਾ · Kids mode';
