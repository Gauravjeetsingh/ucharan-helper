const links = [['/timestamps','Timestamps'],['/follow','Follow'],['/learn','Learn'],['/test','Test']];
const nav = document.createElement('nav');
nav.className = 'app-nav';
nav.setAttribute('aria-label', 'App sections');
for (const [path, label] of links) {
  const a = document.createElement('a');
  a.href = path; a.textContent = label;
  if (location.pathname.replace(/\/$/, '') === path) a.setAttribute('aria-current', 'page');
  nav.append(a);
}
document.querySelector('header').after(nav);
