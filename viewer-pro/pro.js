/* AeonSight Pro — EPUB scroll fix + Read Bar visibility + TTS highlighting
   - EPUB is now vertical scroll (flow: "scrolled-doc") and the mount is overflow:auto
   - Read Bar sits above the dock using a measured CSS variable
   - TXT/HTML sentences highlight while Audio Reader plays
*/

////////////////////
// DOM references //
////////////////////
const contentEl = document.getElementById('content');
const libList   = document.getElementById('libList');

const fileInput = document.getElementById('fileInput');
const loadDemo  = document.getElementById('loadDemo');
const clearLib  = document.getElementById('clearLib');

const prevBtn   = document.getElementById('prevPage');
const nextBtn   = document.getElementById('nextPage');
const zoomOut   = document.getElementById('zoomOut');
const zoomIn    = document.getElementById('zoomIn');
const fovRange  = document.getElementById('fov');
const fontPct   = document.getElementById('fontPct');

const toggleReader = document.getElementById('toggleReader');
const toggleLens   = document.getElementById('toggleLens');
const sleepBtn     = document.getElementById('sleepBtn');
const sleepMinsInp = document.getElementById('sleepMins');

const allowScriptsChk = document.getElementById('allowScripts');
const themeSelect     = document.getElementById('themeSelect');

const ttsVoice = document.getElementById('ttsVoice');
const ttsRate  = document.getElementById('ttsRate');
const ttsPitch = document.getElementById('ttsPitch');
const ttsVol   = document.getElementById('ttsVol');
const ttsAuto  = document.getElementById('ttsAuto');
const ttsPlay  = document.getElementById('ttsPlay');
const ttsPause = document.getElementById('ttsPause');
const ttsStop  = document.getElementById('ttsStop');

const lensEl    = document.getElementById('lens');
const dockEl    = document.getElementById('dock');

const statName  = document.getElementById('statName');
const statStatus= document.getElementById('statStatus');
const statProg  = document.getElementById('statProg');
const statPage  = document.getElementById('statPage');
const statTime  = document.getElementById('statTime');
const statWords = document.getElementById('statWords');

// Read Bar
const readBar   = document.getElementById('readBar');
const rbPrev    = readBar.querySelector('.rb-prev');
const rbCurrent = readBar.querySelector('.rb-current');
const rbNext    = readBar.querySelector('.rb-next');

//////////////////////
// Persistent state //
//////////////////////
const LS_KEY_LIB = 'aeon:library:v2'; // [{id,name,type,dataUrl,added}]
const LS_KEY_CFG = 'aeon:cfg';

const state = {
  type: null,                // 'pdf' | 'epub' | 'txt' | 'html'
  docName: null,
  currentId: null,

  // PDF
  pdfDoc: null,
  pdfPage: 1,
  pdfScale: 1.1,

  // EPUB
  epubBook: null,
  epubRend: null,
  epubFontPct: 100,

  // Plain text rendering (for in-page highlight)
  plainSentences: [],
  plainIsRendered: false,

  // Stats
  startedAt: 0,
  seconds: 0,
  wordsRead: 0,

  // Sleep guard
  sleepMinutes: 10,
  sleepTimer: null,
  lastTurnPageAt: 0,

  // UI
  fov: 72,
  theme: 'dark',

  // TTS
  tts: {
    speaking: false,
    paused: false,
    queue: [],
    idx: 0,
    follow: false,
    mapToPlain: false
  }
};

/////////////////////
// Script loaders  //
/////////////////////
async function loadScriptOnce(globalKey, srcList) {
  if (window[globalKey]) return;
  let lastErr;
  for (const src of srcList) {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
      });
      if (window[globalKey]) return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Unable to load ' + globalKey);
}
async function ensureEPUBLibs() {
  await loadScriptOnce('JSZip', [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
  ]);
  await loadScriptOnce('ePub', [
    'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
    'https://unpkg.com/epubjs@0.3.93/dist/epub.min.js',
    'https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js'
  ]);
}

/////////////////////
// Theme handling  //
/////////////////////
function applyTheme(theme) {
  state.theme = theme;
  document.body.classList.remove('theme-dark','theme-light','theme-sepia');
  document.body.classList.add(`theme-${theme}`);
  if (state.type === 'epub' && state.epubRend) setEpubTheme(theme);
}
function setEpubTheme(theme) {
  if (!state.epubRend) return;
  const pct = String(state.epubFontPct || Number(fontPct.value) || 100) + '%';
  const base = { 'line-height':'1.7', 'font-size': pct };
  let bodyStyles;
  if (theme === 'light') bodyStyles = { ...base, 'color':'#0b0c10', 'background':'#ffffff' };
  else if (theme === 'sepia') bodyStyles = { ...base, 'color':'#3b2f27', 'background':'#f5efe3' };
  else bodyStyles = { ...base, 'color':'#eaf0ff', 'background':'#0b0c10' };
  state.epubRend.themes.register('aeon-theme', {
    'body': bodyStyles,
    'p': { 'margin': '0 0 1em 0' }
  });
  state.epubRend.themes.select('aeon-theme');
}

/////////////////////
// Utility helpers //
/////////////////////
const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const loadJSON = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const fmtTime = secs => {
  secs = Math.floor(secs);
  const m = Math.floor(secs/60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2,'0')}`;
};
function extOfName(name=''){ const m = name.toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }
function fileToDataUrl(file){
  return new Promise((res, rej)=>{
    const fr = new FileReader();
    fr.onerror = () => rej(fr.error);
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(file);
  });
}
function normalizeDataUrl(u, type){
  if (!u) return u;
  if (/^(data:|blob:|https?:)/i.test(u)) return u;
  const m = u.match(/([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (m) return `data:${m[1]};base64,${m[2]}`;
  const idx = u.indexOf('base64,');
  if (idx !== -1) {
    const b64 = u.slice(idx + 7);
    const mime =
      type === 'epub' ? 'application/epub+zip' :
      type === 'pdf'  ? 'application/pdf'     :
      (type === 'txt' ? 'text/plain'          :
      (type === 'html'? 'text/html'           : 'application/octet-stream'));
    return `data:${mime};base64,${b64}`;
  }
  return u;
}
function dataUrlToUint8(dataUrl){
  const base64 = dataUrl.split(',')[1] || dataUrl;
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Sentence split (shared by TTS and in-page render)
function sentenceSplit(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+/);
  const out = [];
  for (let i=0;i<parts.length;i++){
    const cur = parts[i];
    if (cur.length < 6 && i < parts.length - 1) { parts[i+1] = cur + ' ' + parts[i+1]; continue; }
    out.push(cur);
  }
  return out;
}

//////////////////////
// Library handling //
//////////////////////
function getLibrary(){ return loadJSON(LS_KEY_LIB, []); }
function setLibrary(list){ saveJSON(LS_KEY_LIB, list); renderLibrary(); }

function addToLibrary(name, type, dataUrl){
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const item = { id, name, type, dataUrl, added: Date.now() };
  const lib = getLibrary();
  lib.unshift(item);
  setLibrary(lib);
  return item;
}
function removeFromLibrary(id){
  setLibrary(getLibrary().filter(x => x.id !== id));
  if (state.currentId === id) {
    contentEl.innerHTML = '<div class="empty">Removed. Choose another file.</div>';
    resetDoc();
  }
}
function clearLibrary(){
  saveJSON(LS_KEY_LIB, []);
  renderLibrary();
}
function renderLibrary(){
  const lib = getLibrary();
  libList.innerHTML = '';
  for (const item of lib){
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="meta">
        <div class="name">${item.name}</div>
        <div class="sub">${item.type.toUpperCase()} • ${new Date(item.added).toLocaleString()}</div>
      </div>
      <div class="actions">
        <button class="btn small subtle" data-open="${item.id}">Open</button>
        <button class="btn small danger" data-del="${item.id}">Delete</button>
      </div>
    `;
    libList.appendChild(li);
  }
}

////////////////////
// Reader control //
////////////////////
function resetDoc(){
  // PDF cleanup
  state.pdfDoc = null;
  state.pdfPage = 1;

  // EPUB cleanup
  try { state.epubRend?.destroy(); } catch{}
  try { state.epubBook?.destroy?.(); } catch{}
  state.epubRend = null;
  state.epubBook = null;

  // Plain render
  state.plainSentences = [];
  state.plainIsRendered = false;

  // Stats
  state.seconds = 0;
  state.wordsRead = 0;
  state.startedAt = Date.now();
  updateStats();
  stopSleepGuard();
  kickSleepGuard();

  // TTS cleanup
  ttsCancelAll();
  hideReadBar();
  clearPlainHighlight();
}

function setStatus(msg){ statStatus.textContent = msg; }
function updateStats(){
  statName.textContent = state.docName ?? '—';
  statPage.textContent = (state.type === 'pdf' && state.pdfDoc)
    ? `${state.pdfPage}/${state.pdfDoc.numPages}` :
    (state.type === 'epub' ? '—' : '—');
  statTime.textContent = fmtTime(state.seconds);
  statWords.textContent = String(state.wordsRead);
}
setInterval(()=>{ state.seconds += 1; updateStats(); }, 1000);

//////////////////////
// Sleep Guard beep //
//////////////////////
let buzzer;
function ensureBuzzer(){
  if (!buzzer){
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    buzzer = (ms=800) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.001;
      o.start();
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ms/1000));
      o.stop(ctx.currentTime + (ms/1000));
    };
  }
  return buzzer;
}
function stopSleepGuard(){
  if (state.sleepTimer){ clearTimeout(state.sleepTimer); state.sleepTimer = null; }
}
function kickSleepGuard(){
  stopSleepGuard();
  const mins = Number(sleepMinsInp.value || state.sleepMinutes);
  state.sleepMinutes = clamp(mins, 1, 120);
  state.lastTurnPageAt = Date.now();
  state.sleepTimer = setTimeout(()=>{
    setStatus('Sleep alert!');
    try{ ensureBuzzer()(); }catch{}
  }, state.sleepMinutes*60*1000);
}

///////////////////////////
// Openers per file type //
///////////////////////////
async function openFromLibrary(id){
  const item = getLibrary().find(x => x.id === id);
  if (!item) return;
  openBuffer(item.name, item.type, item.dataUrl);
  state.currentId = id;
}

async function openBuffer(name, type, dataUrl){
  resetDoc();
  state.docName = name;
  state.type = type;
  statName.textContent = name;
  setStatus('Loading…');
  contentEl.innerHTML = '';

  const safeUrl = normalizeDataUrl(dataUrl, type);

  if (type === 'pdf')       await openPDF(name, safeUrl);
  else if (type === 'epub') await openEPUB(name, safeUrl);
  else if (type === 'txt' || type === 'html') await openPlain(name, safeUrl, type);
  else {
    contentEl.innerHTML = '<p>Unsupported file type.</p>';
    setStatus('Unsupported');
  }
}

async function openPDF(name, dataUrl){
  try{
    if (!window['pdfjsLib']) throw new Error('PDF.js missing');
    const bytes = dataUrlToUint8(dataUrl);
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    state.pdfDoc = await loadingTask.promise;
    state.pdfPage = clamp(state.pdfPage, 1, state.pdfDoc.numPages);
    await renderPDFPage();
    setStatus('Ready');
  }catch(err){
    console.error(err);
    contentEl.innerHTML = '<p>Failed to open PDF.</p>';
    setStatus('Error');
  }
}
async function renderPDFPage(){
  const page = await state.pdfDoc.getPage(state.pdfPage);
  const viewport = page.getViewport({ scale: state.pdfScale });
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-page';
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  contentEl.replaceChildren(canvas);
  await page.render({ canvasContext: ctx, viewport }).promise;

  statProg.textContent = `${Math.round((state.pdfPage/state.pdfDoc.numPages)*100)}%`;
  statPage.textContent = `${state.pdfPage}/${state.pdfDoc.numPages}`;

  state.wordsRead += Math.round(280 * 0.9);
  kickSleepGuard();
}

function forceEpubSandbox(allowScripts){
  // If scripts ON: sandbox="allow-scripts" (no same-origin)
  // If scripts OFF: sandbox="allow-same-origin" (no scripts)
  const wanted = allowScripts ? 'allow-scripts' : 'allow-same-origin';
  const frs = contentEl.querySelectorAll('iframe');
  frs.forEach(fr => fr.setAttribute('sandbox', wanted));
}

async function openEPUB(name, dataUrl){
  try{
    await ensureEPUBLibs();

    const allowScripts = !!allowScriptsChk?.checked;

    const bytes = dataUrlToUint8(dataUrl);
    state.epubBook = ePub();
    await state.epubBook.open(bytes.buffer, 'binary');

    contentEl.innerHTML = '';
    const mount = document.createElement('div');
    mount.className = 'epub-mount';
    contentEl.appendChild(mount);

    state.epubRend = state.epubBook.renderTo(mount, {
      width: '100%',
      height: '100%',            // let CSS control actual height
      spread: 'none',
      allowScriptedContent: allowScripts,
      flow: 'scrolled-doc'       // <-- vertical scroll
    });

    state.epubFontPct = Number(fontPct.value || 100);

    await state.epubRend.display();
    setEpubTheme(state.theme);
    forceEpubSandbox(allowScripts);
    state.epubRend.on('rendered', ()=> {
      setEpubTheme(state.theme);
      forceEpubSandbox(allowScripts);
    });

    state.epubRend.on('relocated', (loc)=>{
      try{
        const pct = Math.round(loc.start.percentage * 100);
        statProg.textContent = `${pct}%`;
        statPage.textContent = `${loc.start.displayed.page}/${loc.start.displayed.total}`;
        state.wordsRead += Math.round(250 * 0.9);
        kickSleepGuard();
      }catch{}
    });

    setStatus('Ready');
  }catch(err){
    console.error(err);
    contentEl.innerHTML = '<p>Failed to open EPUB.</p>';
    setStatus('Error');
  }
}

async function openPlain(name, dataUrl, type){
  try{
    const bytes = dataUrlToUint8(dataUrl);
    const raw = new TextDecoder('utf-8').decode(bytes);
    const safe = (type === 'html') ? stripHtml(raw) : raw;

    // Render as paragraphs with sentence spans for in-page highlight
    renderPlainWithSpans(safe);

    const words = safe.trim().split(/\s+/g).filter(Boolean).length;
    state.wordsRead += words;
    statProg.textContent = '—';
    statPage.textContent = '—';
    setStatus('Ready');
    kickSleepGuard();
  }catch(err){
    console.error(err);
    contentEl.innerHTML = '<p>Failed to open text.</p>';
    setStatus('Error');
  }
}
function stripHtml(html){
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').trim();
}

//////////////////////////////
// Plain text render helper //
//////////////////////////////
function renderPlainWithSpans(text) {
  state.plainSentences = [];
  state.plainIsRendered = false;
  clearPlainHighlight();

  const container = document.createElement('div');
  container.style.whiteSpace = 'pre-wrap';
  container.style.wordBreak = 'break-word';

  const paras = (text || '').split(/\n{2,}/);
  let sentIndex = 0;
  for (const p of paras) {
    const pEl = document.createElement('p');
    pEl.style.margin = '0 0 1em 0';
    const sents = sentenceSplit(p);
    for (const s of sents) {
      const span = document.createElement('span');
      span.className = 'sent';
      span.dataset.idx = String(sentIndex);
      span.textContent = s + ' ';
      pEl.appendChild(span);
      state.plainSentences.push(s);
      sentIndex++;
    }
    container.appendChild(pEl);
  }

  contentEl.replaceChildren(container);
  state.plainIsRendered = true;
}

function clearPlainHighlight() {
  contentEl.querySelectorAll('.read-sent').forEach(el => el.classList.remove('read-sent'));
}
function markPlainSentence(idx) {
  if (!state.plainIsRendered) return;
  contentEl.querySelectorAll('.read-sent').forEach(el => el.classList.remove('read-sent'));
  const el = contentEl.querySelector(`.sent[data-idx="${idx}"]`);
  if (el) {
    el.classList.add('read-sent');
    const rect = el.getBoundingClientRect();
    const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    if (rect.top < 80 || rect.bottom > vh - 200) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

//////////////////////
// 🎧 Audio Reader //
//////////////////////
function ttsPopulateVoices() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const prev = loadJSON(LS_KEY_CFG, {}).ttsVoice;
  ttsVoice.innerHTML = '';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name; opt.textContent = `${v.name} (${v.lang})${v.default?' — default':''}`;
    ttsVoice.appendChild(opt);
  });
  if (prev) ttsVoice.value = prev;
}
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = ttsPopulateVoices;
  setTimeout(ttsPopulateVoices, 200);
}

function getSelectionInContent() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return '';
  const range = sel.getRangeAt(0);
  if (!contentEl.contains(range.commonAncestorContainer)) return '';
  return sel.toString().trim();
}

async function getPDFCurrentPageText() {
  try {
    if (!state.pdfDoc) return '';
    const page = await state.pdfDoc.getPage(state.pdfPage);
    const textContent = await page.getTextContent();
    const strings = textContent.items.map(i => i.str);
    return strings.join(' ');
  } catch { return ''; }
}

function getEPUBVisibleText() {
  try {
    const contents = state.epubRend?.getContents?.() || [];
    const text = contents.map(c => c?.document?.body?.innerText || '').join('\n').trim();
    return text;
  } catch {
    return '';
  }
}

function getPlainTextFromStage() {
  return contentEl?.innerText?.trim?.() || '';
}

function buildUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const chosen = voices.find(v => v.name === ttsVoice.value);
  if (chosen) u.voice = chosen;
  u.rate  = Number(ttsRate.value || 1);
  u.pitch = Number(ttsPitch.value || 1);
  u.volume= Number(ttsVol.value || 1);
  return u;
}

function showReadBar(prev, cur, next) {
  rbPrev.textContent = prev || '';
  rbCurrent.textContent = cur || '';
  rbNext.textContent = next || '';
  readBar.hidden = false;
}
function hideReadBar() {
  readBar.hidden = true;
  rbPrev.textContent = rbCurrent.textContent = rbNext.textContent = '';
}

async function collectCurrentReadableText() {
  const sel = getSelectionInContent();
  if (sel) return { text: sel, mapToPlain: false };

  if (state.type === 'pdf') {
    const t = await getPDFCurrentPageText();
    return { text: t, mapToPlain: false };
  }
  if (state.type === 'epub') {
    const t = getEPUBVisibleText();
    if (!t && allowScriptsChk.checked) {
      setStatus('Audio Reader: To read EPUB text, turn OFF "Allow EPUB scripts".');
    }
    return { text: t, mapToPlain: false };
  }
  if (state.type === 'txt' || state.type === 'html') {
    if (state.plainIsRendered && state.plainSentences.length) {
      return { text: state.plainSentences.join(' '), mapToPlain: true };
    }
    return { text: getPlainTextFromStage(), mapToPlain: false };
  }
  return { text: '', mapToPlain: false };
}

function ttsCancelAll() {
  state.tts.speaking = false;
  state.tts.paused = false;
  state.tts.follow = false;
  state.tts.queue = [];
  state.tts.idx = 0;
  state.tts.mapToPlain = false;
  try { speechSynthesis.cancel(); } catch {}
  hideReadBar();
  clearPlainHighlight();
}

async function ttsStartFollow() {
  if (!('speechSynthesis' in window)) {
    setStatus('Audio Reader: not supported by this browser.');
    return;
  }

  const { text: baseText, mapToPlain } = await collectCurrentReadableText();
  if (!baseText) { setStatus('Audio Reader: nothing readable on this view.'); return; }

  const chunks = sentenceSplit(baseText);
  if (!chunks.length) { setStatus('Audio Reader: no sentences found.'); return; }

  state.tts.queue = chunks;
  state.tts.idx = 0;
  state.tts.speaking = true;
  state.tts.follow = !!ttsAuto.checked;
  state.tts.mapToPlain = mapToPlain;

  const speakNext = () => {
    if (!state.tts.speaking) return;
    if (state.tts.idx >= state.tts.queue.length) {
      if (!state.tts.follow) { state.tts.speaking = false; setStatus('Audio Reader: done.'); hideReadBar(); clearPlainHighlight(); return; }
      hideReadBar(); clearPlainHighlight();
      if (state.type === 'pdf' && state.pdfDoc && state.pdfPage < state.pdfDoc.numPages) {
        nextBtn.click();
        setTimeout(()=> ttsStartFollow(), 250);
        return;
      }
      if (state.type === 'epub' && state.epubRend) {
        state.epubRend.next().then(()=> setTimeout(()=> ttsStartFollow(), 250));
        return;
      }
      state.tts.speaking = false;
      setStatus('Audio Reader: end of document/section.');
      return;
    }

    const i = state.tts.idx;
    const prev = state.tts.queue[i-1] || '';
    const cur  = state.tts.queue[i]   || '';
    const next = state.tts.queue[i+1] || '';
    showReadBar(prev, cur, next);
    if (state.tts.mapToPlain) markPlainSentence(i);

    const u = buildUtterance(cur);
    u.onstart = () => { /* ensure bar visible */ showReadBar(prev, cur, next); };
    u.onend = () => { state.tts.idx++; speakNext(); };
    u.onerror = () => { state.tts.idx++; speakNext(); };
    try { speechSynthesis.speak(u); } catch { state.tts.idx++; speakNext(); }
  };

  speakNext();
  setStatus('Audio Reader: playing…');
}

ttsPlay.onclick = async ()=> {
  ttsCancelAll();
  await ttsStartFollow();
};
ttsPause.onclick = ()=> {
  if (!state.tts.speaking) return;
  if (!speechSynthesis.paused) { speechSynthesis.pause(); state.tts.paused = true; setStatus('Audio Reader: paused'); }
  else { try { speechSynthesis.resume(); state.tts.paused = false; setStatus('Audio Reader: resumed'); } catch{} }
};
ttsStop.onclick = ()=> {
  ttsCancelAll();
  setStatus('Audio Reader: stopped');
};

// Persist TTS prefs
[ttsRate, ttsPitch, ttsVol, ttsVoice, ttsAuto].forEach(el=>{
  el.addEventListener('change', persistCfg);
});

///////////////////////////
// Controls & Shortcuts  //
///////////////////////////
prevBtn.onclick = async ()=>{
  if (state.type === 'pdf' && state.pdfDoc){
    state.pdfPage = clamp(state.pdfPage - 1, 1, state.pdfDoc.numPages);
    await renderPDFPage();
  } else if (state.type === 'epub' && state.epubRend){
    await state.epubRend.prev();
  }
  if (state.tts.follow && state.tts.speaking) { ttsCancelAll(); await ttsStartFollow(); }
};
nextBtn.onclick = async ()=>{
  if (state.type === 'pdf' && state.pdfDoc){
    state.pdfPage = clamp(state.pdfPage + 1, 1, state.pdfDoc.numPages);
    await renderPDFPage();
  } else if (state.type === 'epub' && state.epubRend){
    await state.epubRend.next();
  }
  if (state.tts.follow && state.tts.speaking) { ttsCancelAll(); await ttsStartFollow(); }
};

zoomIn.onclick = async ()=>{
  if (state.type === 'pdf' && state.pdfDoc){
    state.pdfScale = clamp(state.pdfScale + 0.1, 0.5, 3);
    await renderPDFPage();
  } else if (state.type === 'epub' && state.epubRend){
    state.epubFontPct = clamp(state.epubFontPct + 10, 80, 180);
    setEpubTheme(state.theme);
  } else if (state.type === 'txt' || state.type === 'html'){
    const cur = Number(fontPct.value||100)+10; fontPct.value = clamp(cur, 80, 180);
    contentEl.style.fontSize = `${fontPct.value}%`;
  }
  persistCfg();
};
zoomOut.onclick = async ()=>{
  if (state.type === 'pdf' && state.pdfDoc){
    state.pdfScale = clamp(state.pdfScale - 0.1, 0.5, 3);
    await renderPDFPage();
  } else if (state.type === 'epub' && state.epubRend){
    state.epubFontPct = clamp(state.epubFontPct - 10, 80, 180);
    setEpubTheme(state.theme);
  } else if (state.type === 'txt' || state.type === 'html'){
    const cur = Number(fontPct.value||100)-10; fontPct.value = clamp(cur, 80, 180);
    contentEl.style.fontSize = `${fontPct.value}%`;
  }
  persistCfg();
};

fovRange.oninput = ()=>{
  state.fov = Number(fovRange.value);
  if (state.fov <= 56) {
    contentEl.classList.add('narrow');
    contentEl.classList.remove('wide');
  } else if (state.fov >= 86) {
    contentEl.classList.add('wide');
    contentEl.classList.remove('narrow');
  } else {
    contentEl.classList.remove('wide','narrow');
  }
};
fovRange.addEventListener('change', persistCfg);

fontPct.oninput = ()=>{
  const v = Number(fontPct.value);
  if (state.type === 'epub' && state.epubRend){
    state.epubFontPct = clamp(v,80,180);
    setEpubTheme(state.theme);
  } else {
    contentEl.style.fontSize = `${v}%`;
  }
};
fontPct.addEventListener('change', persistCfg);

toggleReader.onclick = ()=>{
  const on = document.body.classList.toggle('reader');
  toggleReader.textContent = on ? 'Exit Reader Mode' : 'Reader Mode';
  toggleReader.setAttribute('aria-pressed', on ? 'true' : 'false'));
  persistCfg();
  contentEl.focus({ preventScroll: false });
};

toggleLens.onclick = ()=>{
  const on = document.body.classList.toggle('lens-on');
  toggleLens.setAttribute('aria-pressed', on ? 'true' : 'false');
};

sleepBtn.onclick = ()=> { try{ ensureBuzzer()(); }catch{}; };

allowScriptsChk.onchange = ()=>{
  persistCfg();
  if (state.type === 'epub' && state.currentId) openFromLibrary(state.currentId);
};

themeSelect.onchange = ()=>{
  applyTheme(themeSelect.value);
  persistCfg();
};

document.addEventListener('keydown', async (e)=>{
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (e.key === 'ArrowRight'){ nextBtn.click(); }
  if (e.key === 'ArrowLeft'){ prevBtn.click(); }
  if (e.key === '+' || e.key === '='){ zoomIn.click(); }
  if (e.key === '-'){ zoomOut.click(); }
  if (e.key.toLowerCase() === 'r'){ toggleReader.click(); }
  if (e.key.toLowerCase() === 'i'){ toggleLens.click(); }
  if (e.key.toLowerCase() === 's'){ sleepBtn.click(); }
  if (e.key.toLowerCase() === 'f'){ document.documentElement.requestFullscreen?.(); }
  if (e.key.toLowerCase() === 'p'){ ttsPlay.click(); } // Play audio
});

////////////////////
// File ingestion //
////////////////////
fileInput.onchange = async (ev)=>{
  const files = Array.from(ev.target.files || []);
  for (const f of files){
    const ext = extOfName(f.name);
    const type = (ext === 'pdf'||ext==='epub'||ext==='txt'||ext==='html') ? ext : 'txt';
    const dataUrl = await fileToDataUrl(f);
    const item = addToLibrary(f.name, type, dataUrl);
    await openFromLibrary(item.id);
  }
  fileInput.value = '';
};

function handleDrop(e){
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length){
    fileInput.files = e.dataTransfer.files;
    fileInput.onchange({ target: fileInput });
  } else {
    const text = e.dataTransfer.getData('text/plain');
    if (text && /base64,/.test(text)){
      let type = 'txt';
      if (/epub\+zip/.test(text)) type = 'epub';
      else if (/application\/pdf/.test(text)) type = 'pdf';
      else if (/text\/html/.test(text)) type = 'html';
      const item = addToLibrary(`Pasted ${type.toUpperCase()}`, type, normalizeDataUrl(text, type));
      openFromLibrary(item.id);
    }
  }
}
function handlePaste(e){
  const text = e.clipboardData?.getData('text/plain');
  if (text && /base64,/.test(text)){
    let type = 'txt';
    if (/epub\+zip/.test(text)) type = 'epub';
    else if (/application\/pdf/.test(text)) type = 'pdf';
    else if (/text\/html/.test(text)) type = 'html';
    const item = addToLibrary(`Pasted ${type.toUpperCase()}`, type, normalizeDataUrl(text, type));
    openFromLibrary(item.id);
  }
}
contentEl.addEventListener('dragover', e=>{ e.preventDefault(); });
contentEl.addEventListener('drop', handleDrop);
document.addEventListener('paste', handlePaste);

//////////////////////
// Library actions  //
//////////////////////
libList.addEventListener('click', (e)=>{
  const openId = e.target.getAttribute('data-open');
  const delId  = e.target.getAttribute('data-del');
  if (openId) openFromLibrary(openId);
  if (delId)  removeFromLibrary(delId);
});
clearLib.onclick = ()=>{
  if (confirm('Clear the entire library?')) clearLibrary();
};

/////////////////////////////
// Demo: build EPUB in RAM //
/////////////////////////////
loadDemo.onclick = async ()=>{
  await ensureEPUBLibs();
  const dataUrl = await buildSampleEpub();
  const item = addToLibrary('Sample.epub', 'epub', dataUrl);
  openFromLibrary(item.id);
};

async function buildSampleEpub(){
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  const uuid = (self.crypto?.randomUUID?.() || ('urn:uuid:'+Date.now()));
  zip.file('META-INF/container.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const style = `
  body{color:#eaf0ff;background:#0b0c10;line-height:1.7;font-family: serif;}
  h1{color:#00ffd1;margin:0 0 .5em 0}
  `;

  zip.file('OEBPS/nav.xhtml',
`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head><title>Nav</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <ol><li><a href="chapter1.xhtml">Hello</a></li></ol>
    </nav>
  </body>
</html>`);

  zip.file('OEBPS/chapter1.xhtml',
`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Hello</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>AeonSight Sample</h1>
    <p>This EPUB was generated on the fly. Try Reader Mode (R), zoom (+/-), the theme selector, and the Audio Reader with karaoke highlighting.</p>
    <p>Drop your own EPUB/PDF any time on the stage.</p>
  </body>
</html>`);

  zip.file('OEBPS/style.css', style);

  zip.file('OEBPS/content.opf',
`<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="pub-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${uuid}</dc:identifier>
    <dc:title>AeonSight Sample</dc:title>
    <meta property="dcterms:modified">${new Date().toISOString().slice(0,19)}Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="chap1"/></spine>`);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  return dataUrl;
}

//////////////////////
// Init / defaults  //
//////////////////////
(function init(){
  const cfg = loadJSON(LS_KEY_CFG, {});
  if (cfg.fontPct) { fontPct.value = cfg.fontPct; }
  if (cfg.fov) { fovRange.value = cfg.fov; fovRange.oninput(); }
  if (cfg.sleepMinutes) { sleepMinsInp.value = cfg.sleepMinutes; }
  if (cfg.theme) { themeSelect.value = cfg.theme; applyTheme(cfg.theme); } else { applyTheme('dark'); }
  if (typeof cfg.allowScripts === 'boolean') allowScriptsChk.checked = cfg.allowScripts;
  if (cfg.reader) {
    document.body.classList.add('reader');
    toggleReader.textContent = 'Exit Reader Mode';
    toggleReader.setAttribute('aria-pressed', 'true');
  }

  // TTS restore
  if (cfg.ttsRate)  ttsRate.value = cfg.ttsRate;
  if (cfg.ttsPitch) ttsPitch.value = cfg.ttsPitch;
  if (cfg.ttsVol)   ttsVol.value   = cfg.ttsVol;
  if (typeof cfg.ttsAuto === 'boolean') ttsAuto.checked = cfg.ttsAuto;
  if (cfg.ttsVoice) { setTimeout(()=> { ttsVoice.value = cfg.ttsVoice; }, 300); }

  renderLibrary();
  setStatus('Idle');
  contentEl.focus();

  ttsPopulateVoices();
  syncDockHeight();
  window.addEventListener('resize', syncDockHeight);
})();

function syncDockHeight(){
  const h = (dockEl?.offsetHeight || 84) + 'px';
  document.documentElement.style.setProperty('--dock-h', h);
}

function persistCfg(){
  saveJSON(LS_KEY_CFG, {
    fontPct: Number(fontPct.value),
    fov: Number(fovRange.value),
    sleepMinutes: Number(sleepMinsInp.value),
    allowScripts: !!allowScriptsChk.checked,
    reader: document.body.classList.contains('reader'),
    theme: themeSelect.value,
    // TTS
    ttsRate: Number(ttsRate.value),
    ttsPitch: Number(ttsPitch.value),
    ttsVol: Number(ttsVol.value),
    ttsVoice: ttsVoice.value || '',
    ttsAuto: !!ttsAuto.checked
  });
}
