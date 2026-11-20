'use strict';

if (window.matchMedia('(max-width:700px)').matches) {
  for (const outline of document.querySelectorAll('.reader-nav, .paper-navigation details')) {
    outline.open = false;
  }
}

function searchKey(text) {
  return text.toLocaleLowerCase().normalize('NFKC').trim();
}
for (const collection of document.querySelectorAll('[data-collection]')) {
  const controls = collection.querySelector('[data-controls]');
  const buttons = Array.from(controls.querySelectorAll('[data-kind]'));
  const search = controls.querySelector('[data-search]');
  const items = Array.from(collection.querySelectorAll('[data-item]'));
  const counters = collection.querySelector('[data-found]');
  const empty = collection.querySelector('[data-empty]');
  const unit = collection.querySelector('[data-unit]');
  const available = buttons.map(b => b.dataset.kind);
  let active = 'all';
  function readQuery() {
    const params = new URLSearchParams(location.search);
    active = available.includes(params.get('topic')) ? params.get('topic') : 'all';
    search.value = params.get('q') || '';
  }
  function refresh(updateUrl) {
    const terms = searchKey(search.value).split(/\s+/).filter(Boolean);
    let count = 0;
    for (const item of items) {
      const fits = (active === 'all' || active === item.dataset.filter) && terms.every(t => searchKey(item.dataset.text).includes(t));
      item.hidden = !fits;
      if (fits) count++;
    }
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === active)));
    counters.textContent = String(count);
    unit.textContent = count === 1 ? unit.dataset.one : unit.dataset.many;
    empty.hidden = count !== 0;
    if (updateUrl && /^https?:$/.test(location.protocol)) {
      const url = new URL(location.href);
      if (active === 'all') url.searchParams.delete('topic'); else url.searchParams.set('topic', active);
      if (search.value.trim()) url.searchParams.set('q', search.value.trim()); else url.searchParams.delete('q');
      history.replaceState(null, '', url);
    }
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    active = button.dataset.kind;
    refresh(true);
  }));
  search.addEventListener('input', () => refresh(true));
  empty.querySelector('[data-reset]').addEventListener('click', () => {
    active = 'all';
    search.value = '';
    refresh(true);
    search.focus();
  });
  addEventListener('popstate', () => { readQuery(); refresh(false); });
  readQuery();
  refresh(false);
  controls.hidden = false;
}

const viewer = document.getElementById('image-pop');
if (typeof viewer?.showModal === 'function') {
  const pic = viewer.querySelector('img');
  const caption = viewer.querySelector('p');
  const close = viewer.querySelector('.dialog-close');
  const controls = viewer.querySelector('.image-controls');
  const position = viewer.querySelector('[data-position]');
  let previous;
  let group = [];
  let current = 0;

  function display(index) {
    current = (index + group.length) % group.length;
    const link = group[current];
    pic.src = link.href;
    pic.alt = link.querySelector('img').alt;
    caption.textContent = link.dataset.caption;
    position.textContent = (current + 1) + ' / ' + group.length;
  }
  const links = Array.from(document.querySelectorAll('[data-zoom]'));
  for (const link of links) {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      previous = link;
      group = links.filter(item => item.getClientRects().length !== 0);
      controls.hidden = group.length < 2;
      display(group.indexOf(link));
      viewer.showModal();
      close.focus();
    });
  }
  controls.querySelector('[data-prev]').addEventListener('click', () => display(current - 1));
  controls.querySelector('[data-next]').addEventListener('click', () => display(current + 1));
  viewer.addEventListener('keydown', event => {
    if (group.length < 2 || !['ArrowRight','ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    display(current + (event.key === 'ArrowRight' ? 1 : -1));
  });
  close.addEventListener('click', () => viewer.close());
  viewer.addEventListener('close', () => { pic.removeAttribute('src'); previous?.focus(); });
  viewer.addEventListener('click', event => {
    if (event.target !== viewer) return;
    const box = viewer.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) viewer.close();
  });
}


for (const showcase of document.querySelectorAll('[data-showcase]')) {
  const tablist = showcase.querySelector('[role="tablist"]');
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const modes = showcase.querySelector('.mode-switch');
  const modeButtons = Array.from(modes.querySelectorAll('button'));
  const scene = showcase.querySelector('[data-core-scene]');
  const pause = showcase.querySelector('[data-pause]');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;

  function syncMotion() {
    scene.dataset.paused = String(paused || reduce.matches);
    pause.hidden = reduce.matches;
    pause.setAttribute('aria-label', paused ? pause.dataset.playLabel : pause.dataset.stopLabel);
    pause.title = pause.getAttribute('aria-label');
    pause.querySelector('.pause-glyph').hidden = paused;
    pause.querySelector('.play-glyph').hidden = !paused;
  }
  function setMode(mode) {
    showcase.dataset.mode = mode;
    scene.hidden = mode !== 'model';
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    for (const screen of showcase.querySelectorAll('.stage-screen')) screen.hidden = mode === 'model';
  }
  function select(tab) {
    for (const item of tabs) {
      const current = item === tab;
      item.setAttribute('aria-selected', String(current));
      item.tabIndex = current ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !current;
    }
    scene.dataset.project = tab.dataset.project;
    showcase.dataset.project = tab.dataset.project;
  }
  for (const [index,tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const offsets = {ArrowLeft:-1, ArrowRight:1, Home:-index, End:tabs.length-1-index};
      if (!(event.key in offsets)) return;
      event.preventDefault();
      const next = tabs[(index + offsets[event.key] + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
  modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  pause.addEventListener('click', () => { paused = !paused; syncMotion(); });
  if (reduce.addEventListener) reduce.addEventListener('change', syncMotion);
  else reduce.addListener?.(syncMotion);
  syncMotion();
  select(tabs[0]);
  setMode('model');
  tablist.hidden = false;
  modes.hidden = false;
}

const commandMenu = document.getElementById('command-menu');
const launcher = document.querySelector('[data-launch-command]');
if (typeof commandMenu?.showModal === 'function' && launcher) {
  const input = commandMenu.querySelector('input');
  const empty = commandMenu.querySelector('.command-empty');
  const items = Array.from(commandMenu.querySelectorAll('.command-results a')).map(link => ({
    link, row:link.parentElement, text:searchKey(link.textContent + ' ' + link.dataset.terms)
  }));
  let focusBeforeOpen;
  let visible = [];
  function applySearch() {
    const terms = searchKey(input.value).split(/\s+/).filter(Boolean);
    visible = [];
    for (const item of items) {
      const match = terms.every(term => item.text.includes(term));
      item.row.hidden = !match;
      if (match) visible.push(item.link);
    }
    empty.hidden = visible.length > 0;
  }
  function openSearch() {
    if (document.querySelector('dialog[open]')) return;
    focusBeforeOpen = document.activeElement;
    input.value = '';
    applySearch();
    commandMenu.showModal();
    commandMenu.querySelector('.command-results').scrollTop = 0;
    input.focus();
  }
  launcher.hidden = false;
  if (/Mac|iPhone|iPad/.test(navigator.platform)) launcher.querySelector('kbd').textContent = '⌘ K';
  launcher.addEventListener('click', openSearch);
  input.addEventListener('input', applySearch);
  commandMenu.querySelector('[data-command-close]').addEventListener('click', () => commandMenu.close());
  commandMenu.addEventListener('close', () => focusBeforeOpen?.focus());
  commandMenu.addEventListener('click', event => {
    if (event.target !== commandMenu) return;
    const bounds = commandMenu.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) commandMenu.close();
  });
  commandMenu.addEventListener('keydown', event => {
    if (!visible.length) return;
    const index = visible.indexOf(document.activeElement);
    if (event.key === 'Enter' && document.activeElement === input) {
      event.preventDefault();
      visible[0].click();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = index === -1 ? (event.key === 'ArrowDown' ? 0 : visible.length-1) :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      visible[next].focus();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing) return;
    const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    const editing = event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]');
    const slash = event.key === '/' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey;
    if ((!combo && !slash) || (document.querySelector('dialog[open]') && !commandMenu.open)) return;
    event.preventDefault();
    if (commandMenu.open) input.focus();
    else openSearch();
  });
}
