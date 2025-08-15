/* AeonSight Pro vNext
   - Safer EPUB sandbox (pre-append guard); optional scripts toggle (less safe)
   - Resume position, Bookmarks + notes, EPUB TOC
   - EPUB search (chapter) with highlights (disabled if scripts allowed)
   - Read Aloud (TTS) for EPUB/TXT/PDF (page-wise), Themes/Fonts
   - Library export/import, tap zones, Reader Mode polish
*/

////////////////////
// DOM references //
////////////////////
const $ = sel => document.querySelector(sel);
const contentEl   = $('#content');
const libList     = $('#libList');
const tocList     = $('#tocList');
const bmList      = $('#bmList');

const fileInput   = $('#fileInput');
const loadDemo    = $('#loadDemo');
const clearLib    = $('#clearLib');

const prevBtn     = $('#prevPage');
const nextBtn     = $('#nextPage');
const zoomOut     = $('#zoomOut');
const zoomIn      = $('#zoomIn');
const fovRange    = $('#fov');
const fontPct     = $('#fontPct');

const toggleReader= $('#toggleReader');
const toggleLens  = $('#toggleLens');
const sleepBtn    = $('#sleepBtn'); // (not in UI; kept for keybinding)
const sleepMinsInp= $('#sleepMins');

const allowScriptsChk = $('#allowScripts');

const lensEl      = $('#lens');

const statName    = $('#statName');
const statStatus  = $('#statStatus');
const statProg    = $('#statProg');
const statPage    = $('#statPage');
const statTime    = $('#statTime');
const statWords   = $('#statWords');

const themeSel    = $('#themeSel');
const fontSel     = $('#fontSel');

const searchInput = $('#searchInput');
const searchPrev  = $('#searchPrev');
const searchNext  = $('#searchNext');
const clearSearch = $('#clearSearch');

const ttsPlay     = $('#ttsPlay');
const ttsPause    = $('#ttsPause');
const ttsStop     = $('#ttsStop');
const ttsRate     = $('#ttsRate');

const tapLeft     = $('#tapLeft');
const tapRight    = $('#tapRight');

// ---- EPUB library auto-loader (no HTML changes required) ----
async function loadScriptOnce(globalKey, srcList) {
  if (window[globalKey]) return; // already present
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
      if (window[globalKey]) return; // loaded successfully
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Unable to load ' + globalKey);
}

async function ensureEPUBLibs() {
  // Load JSZip first (required by epub.js)
  await loadScriptOnce('JSZip', [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
  ]);

  // Then epub.js
  await loadScriptOnce('ePub', [
    'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
    'https://unpkg.com/epubjs@0.3.93/dist/epub.min.js',
    'https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js'
  ]);
}

//////////////////////
// Persistent state //
//////////////////////
const LS_KEY_LIB  = 'aeon:library:v2'; // [{id,name,type,dataUrl,added}]
const LS_KEY_CFG  = 'aeon:cfg';
const LS_KEY_POS  = 'aeon:pos';        // { id: {type, page?, cfi?} }
const LS_KEY_BM   = 'aeon:bm';         // { id: [ {ts,label,page?,cfi?,note?} ] }

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
  epubSearchMatches: [],
  epubSearchIdx: -1,

  // Stats
  startedAt: 0,
  seconds: 0,
  wordsRead: 0,

  // Sleep guard
  sleepMinutes: 10,
  sleepTimer: null,
  lastTurnPageAt: 0,

  // UI
  fov: 72
};

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

function extOfName(name=''){
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
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
  state.epubSearchMatches = [];
  state.epubSearchIdx = -1;

  // Stats
  state.seconds = 0;
  state.wordsRead = 0;
  state.startedAt = Date.now();
  updateStats();
  stopSleepGuard();
  kickSleepGuard();

  tocList.innerHTML = '';
  bmList.innerHTML = '';
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

/////////////////////////////
// EPUB sandbox hardening  //
/////////////////////////////
function setSandboxTokens(iframe, allowScripts){
  // Scripts ON (less safe): unique, opaque origin — no same-origin privileges
  // Scripts OFF (default): allow same-origin for resources, but no script execution
  iframe.setAttribute('sandbox', allowScripts ? 'allow-scripts' : 'allow-same-origin');
}
function guardIframeInsertion(container, allowScripts){
  const patch = (method) => {
    const original = container[method].bind(container);
    container[method] = function(node, ...rest){
      try{
        if (node && node.tagName === 'IFRAME') setSandboxTokens(node, allowScripts);
      }catch{}
      return original(node, ...rest);
    };
    return () => (container[method] = original);
  };
  const restoreAppend = patch('appendChild');
  const restoreInsert = patch('insertBefore');

  const mo = new MutationObserver((recs)=>{
    for (const r of recs){
      r.addedNodes.forEach(n=>{
        if (n && n.tagName === 'IFRAME') setSandboxTokens(n, allowScripts);
        if (n && n.querySelectorAll){
          n.querySelectorAll('iframe').forEach(fr=> setSandboxTokens(fr, allowScripts));
        }
      });
    }
  });
  mo.observe(container, { childList:true, subtree:true });

  return () => { try{ restoreAppend(); restoreInsert(); mo.disconnect(); }catch{} };
}
function forceEpubSandbox(allowScripts){
  const wanted = allowScripts ? 'allow-scripts' : 'allow-same-origin';
  const frs = contentEl.querySelectorAll('iframe');
  frs.forEach(fr => fr.setAttribute('sandbox', wanted));
}

///////////////////////////
// Positions & Bookmarks //
///////////////////////////
function getPositions(){ return loadJSON(LS_KEY_POS, {}); }
function savePosition(obj){ const all = getPositions(); all[state.currentId] = obj; saveJSON(LS_KEY_POS, all); }
function getBookmarks(){ return loadJSON(LS_KEY_BM, {}); }
function setBookmarks(map){ saveJSON(LS_KEY_BM, map); renderBookmarks(); }
function addBookmark(label, extra={}){
  const map = getBookmarks();
  const list = map[state.currentId] || [];
  list.unshift({ ts:Date.now(), label, ...extra });
  map[state.currentId] = list;
  setBookmarks(map);
}
function renderBookmarks(){
  bmList.innerHTML = '';
  const list = getBookmarks()[state.currentId] || [];
  for (const bm of list){
    const li = document.createElement('li');
    const sub = new Date(bm.ts).toLocaleString();
    li.innerHTML = `
      <div class="meta">
        <div class="name">${bm.label || 'Bookmark'}</div>
        <div class="sub">${sub}</div>
      </div>
      <div class="actions">
        <button class="btn small subtle" data-jump='${bm.cfi ? `cfi:${bm.cfi}` : (bm.page? `p:${bm.page}` : '')}'>Open</button>
        <button class="btn small danger" data-del='${bm.ts}'>Delete</button>
      </div>
    `;
    bmList.appendChild(li);
  }
}

//////////////////////////////
// Openers per file type    //
//////////////////////////////
async function openFromLibrary(id){
  const item = getLibrary().find(x => x.id === id);
  if (!item) return;
  state.currentId = id;
  await openBuffer(item.name, item.type, item.dataUrl);

  // Resume last position
  const pos = getPositions()[id];
  if (pos){
    if (pos.type === 'pdf' && state.pdfDoc){
      state.pdfPage = clamp(pos.page || 1, 1, state.pdfDoc.numPages);
      await renderPDFPage();
    } else if (pos.type === 'epub' && state.epubRend && pos.cfi){
      await state.epubRend.display(pos.cfi);
    }
  }

  // Bookmarks panel
  renderBookmarks();
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
  savePosition({ type:'pdf', page: state.pdfPage });

  state.wordsRead += Math.round(280 * 0.9);
  kickSleepGuard();
}

async function openEPUB(name, dataUrl){
  try{
    if (!window['ePub']) throw new Error('ePub.js missing');
    if (!window['JSZip']) throw new Error('JSZip missing (EPUB needs JSZip)');

    const allowScripts = !!allowScriptsChk?.checked;

    const bytes = dataUrlToUint8(dataUrl);
    state.epubBook = ePub();
    await state.epubBook.open(bytes.buffer, 'binary');

    contentEl.innerHTML = '';
    const mount = document.createElement('div');
    mount.className = 'epub-mount';
    contentEl.appendChild(mount);

    // Guard BEFORE EPUB.js appends its iframe
    guardIframeInsertion(mount, allowScripts);

    state.epubRend = state.epubBook.renderTo(mount, {
      width: '100%',
      height: '84vh',
      spread: 'none',
      allowScriptedContent: allowScripts
    });

    // Theme & font size
    state.epubFontPct = Number(fontPct.value || 100);
    state.epubRend.themes.register('aeon', {
      'body': { 'color':'var(--fg)','background':'var(--bg)','line-height':'1.7', 'font-size':`${state.epubFontPct}%` },
      'p':    { 'margin':'0 0 1em 0' }
    });
    state.epubRend.themes.select('aeon');

    // Inject search CSS + handlers when displayed (only if scripts OFF so we have same-origin)
    state.epubRend.on('displayed', (view)=>{
      try{
        setSandboxTokens(view.iframe, allowScripts);
        if (!allowScripts){
          const doc = view.document;
          if (doc && !doc.querySelector('style[data-aeon]')){
            const st = doc.createElement('style');
            st.setAttribute('data-aeon','');
            st.textContent = `.epub-mark{ background: rgba(255,255,0,.35); outline: 1px solid rgba(0,255,209,.6); }`;
            doc.head.appendChild(st);
          }
        }
      }catch{}
    });
    state.epubRend.on('rendered', ()=> forceEpubSandbox(allowScripts));

    // Relocation -> progress + save position
    state.epubRend.on('relocated', (loc)=>{
      try{
        const pct = Math.round((loc?.start?.percentage || 0) * 100);
        statProg.textContent = isFinite(pct) ? `${pct}%` : '—';
        const disp = loc?.start?.displayed;
        statPage.textContent = (disp && disp.page && disp.total) ? `${disp.page}/${disp.total}` : '—';
        savePosition({ type:'epub', cfi: loc?.start?.cfi });
        state.wordsRead += Math.round(250 * 0.9);
        kickSleepGuard();
      }catch{}
    });

    // Build TOC
    try{
      tocList.innerHTML = '';
      const nav = await state.epubBook.loaded.navigation;
      (nav?.toc || []).forEach(item=>{
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="meta">
            <div class="name">${item.label}</div>
            <div class="sub">${item.href || ''}</div>
          </div>
          <div class="actions"><button class="btn small subtle" data-href="${item.href}">Open</button></div>
        `;
        tocList.appendChild(li);
      });
    }catch{}

    await state.epubRend.display();
    forceEpubSandbox(allowScripts);

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
    const text = new TextDecoder('utf-8').decode(bytes);
    const safe = (type === 'html') ? stripHtml(text) : text;

    const pre = document.createElement('div');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.textContent = safe;
    contentEl.replaceChildren(pre);

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

///////////////////////////
// EPUB search (chapter) //
///////////////////////////
function clearEpubMarks(doc){
  if (!doc) return;
  doc.querySelectorAll('.epub-mark').forEach(n=>{
    const parent = n.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(n.textContent), n);
    parent.normalize();
  });
}
function markAllInDoc(doc, term){
  clearEpubMarks(doc);
  if (!term) return [];
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  const points = [];
  let node;
  while ((node = walker.nextNode())){
    const m = node.nodeValue.match(re);
    if (!m) continue;
    const frag = document.createDocumentFragment();
    let text = node.nodeValue;
    let lastIdx = 0;
    re.lastIndex = 0;
    let mm;
    while ((mm = re.exec(text))){
      const before = text.slice(lastIdx, mm.index);
      if (before) frag.appendChild(document.createTextNode(before));
      const span = doc.createElement('span');
      span.className = 'epub-mark';
      span.textContent = mm[0];
      frag.appendChild(span);
      points.push(span);
      lastIdx = mm.index + mm[0].length;
    }
    const after = text.slice(lastIdx);
    if (after) frag.appendChild(document.createTextNode(after));
    node.parentNode.replaceChild(frag, node);
  }
  return points;
}
async function epubSearch(term, dir=+1){
  if (!state.epubRend) return;
  const allowScripts = !!allowScriptsChk?.checked;
  if (allowScripts){
    setStatus('Search disabled while EPUB scripts are allowed (security).');
    return;
  }
  const view = state.epubRend.views? state.epubRend.views.current() : null;
  const doc = view && view.document;
  if (!doc){ setStatus('No chapter loaded'); return; }

  if (state.epubSearchMatches.length === 0 || term){
    const t = term ?? searchInput.value.trim();
    if (!t){ setStatus('Enter search'); return; }
    state.epubSearchMatches = markAllInDoc(doc, t);
    state.epubSearchIdx = -1;
  }
  if (state.epubSearchMatches.length === 0){ setStatus('No matches'); return; }

  state.epubSearchIdx = (state.epubSearchIdx + dir + state.epubSearchMatches.length) % state.epubSearchMatches.length;
  const el = state.epubSearchMatches[state.epubSearchIdx];
  el.scrollIntoView({ behavior:'smooth', block:'center' });
  try{ el.animate([{outlineColor:'transparent'},{outlineColor:'var(--acc)'}], {duration:500, iterations:1}); }catch{}
  setStatus(`Match ${state.epubSearchIdx+1}/${state.epubSearchMatches.length}`);
}
function clearSearchMarks(){
  if (!state.epubRend) return;
  const view = state.epubRend.views? state.epubRend.views.current() : null;
  const doc = view && view.document;
  if (doc) clearEpubMarks(doc);
  state.epubSearchMatches = [];
  state.epubSearchIdx = -1;
  setStatus('Search cleared');
}

///////////////////////////
// Read Aloud (WebSpeech)//
///////////////////////////
let ttsUtter = null;
function getCurrentText(){
  if (state.type === 'epub' && state.epubRend){
    // If scripts OFF -> same-origin -> can read iframe text
    const allowScripts = !!allowScriptsChk?.checked;
    const iframe = contentEl.querySelector('iframe');
    if (iframe && !allowScripts){
      const doc = iframe.contentDocument;
      return doc?.body?.innerText || '';
    }
    return ''; // we avoid crossing origin in scripts-on mode
  } else if (state.type === 'pdf' && state.pdfDoc){
    // Read current page text
    return state.pdfDoc.getPage(state.pdfPage).then(p =>
      p.getTextContent().then(tc => tc.items.map(i=>i.str).join(' '))
    );
  } else {
    return Promise.resolve(contentEl.innerText || '');
  }
}
async function ttsPlayNow(){
  try { window.speechSynthesis.cancel(); }catch{}
  let text = getCurrentText();
  if (text && typeof text.then === 'function') text = await text;
  if (!text){ setStatus('Nothing to read'); return; }
  ttsUtter = new SpeechSynthesisUtterance(text);
  ttsUtter.rate = Number(ttsRate.value||1);
  window.speechSynthesis.speak(ttsUtter);
  setStatus('Reading aloud…');
}
function ttsPauseNow(){ try{ window.speechSynthesis.pause(); }catch{} }
function ttsStopNow(){ try{ window.speechSynthesis.cancel(); setStatus('TTS stopped'); }catch{} }

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
};
nextBtn.onclick = async ()=>{
  if (state.type === 'pdf' && state.pdfDoc){
    state.pdfPage = clamp(state.pdfPage + 1, 1, state.pdfDoc.numPages);
    await renderPDFPage();
  } else if (state.type === 'epub' && state.epubRend){
    await state.epubRend.next();
  }
};
tapLeft.onclick = ()=> prevBtn.click();
tapRight.onclick= ()=> nextBtn.click();

zoomIn.onclick = async ()=>{
  if (state.type === 'pdf' && state.pdfDoc){
    state.pdfScale = clamp(state.pdfScale + 0.1, 0.5, 3);
    await renderPDFPage();
  } else if (state.type === 'epub' && state.epubRend){
    state.epubFontPct = clamp(state.epubFontPct + 10, 80, 180);
    state.epubRend.themes.fontSize(`${state.epubFontPct}%`);
  } else if (state.type === 'txt' || state.type === 'html'){
    const cur = Number(fontPct.value||100)+10; fontPct.value = clamp(cur, 80, 180);
    contentEl.style.fontSize = `${fontPct.value}%`;
  }
};
zoomOut.onclick = async ()=>{
  if (state.type === 'pdf' && state.pdfDoc){
    state.pdfScale = clamp(state.pdfScale - 0.1, 0.5, 3);
    await renderPDFPage();
  } else if (state.type === 'epub' && state.epubRend){
    state.epubFontPct = clamp(state.epubFontPct - 10, 80, 180);
    state.epubRend.themes.fontSize(`${state.epubFontPct}%`);
  } else if (state.type === 'txt' || state.type === 'html'){
    const cur = Number(fontPct.value||100)-10; fontPct.value = clamp(cur, 80, 180);
    contentEl.style.fontSize = `${fontPct.value}%`;
  }
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

fontPct.oninput = ()=>{
  const v = Number(fontPct.value);
  if (state.type === 'epub' && state.epubRend){
    state.epubFontPct = clamp(v,80,180);
    state.epubRend.themes.fontSize(`${state.epubFontPct}%`);
  } else {
    contentEl.style.fontSize = `${v}%`;
  }
};

toggleReader.onclick = ()=>{
  const on = document.body.classList.toggle('reader');
  toggleReader.textContent = on ? 'Exit Reader Mode' : 'Reader Mode';
  toggleReader.setAttribute('aria-pressed', on ? 'true' : 'false');
  persistCfg();
  contentEl.focus({ preventScroll: false });
};
toggleLens.onclick = ()=>{
  const on = !lensEl.classList.contains('on');
  lensEl.classList.toggle('on', on);
  toggleLens.setAttribute('aria-pressed', on ? 'true' : 'false');
};
contentEl.addEventListener('mousemove', (e)=>{
  if (!lensEl.classList.contains('on')) return;
  const r = contentEl.getBoundingClientRect();
  const x = e.clientX - r.left - lensEl.offsetWidth/2;
  const y = e.clientY - r.top  - lensEl.offsetHeight/2;
  lensEl.style.transform = `translate(${Math.max(0,Math.min(x,r.width- lensEl.offsetWidth))}px, ${Math.max(0,Math.min(y,r.height-lensEl.offsetHeight))}px)`;
});

allowScriptsChk.onchange = ()=>{
  persistCfg();
  if (state.type === 'epub' && state.currentId) openFromLibrary(state.currentId);
};

themeSel.onchange = ()=>{
  document.body.classList.remove('theme-dark','theme-sepia','theme-light');
  document.body.classList.add(`theme-${themeSel.value}`);
  persistCfg();
};
fontSel.onchange = ()=>{
  document.body.classList.remove('font-serif','font-sans','font-dys');
  document.body.classList.add(`font-${fontSel.value}`);
  persistCfg();
};

searchNext.onclick = ()=> epubSearch(undefined, +1);
searchPrev.onclick = ()=> epubSearch(undefined, -1);
clearSearch.onclick = ()=> clearSearchMarks();
searchInput.addEventListener('keydown', e=>{
  if (e.key === 'Enter') epubSearch(searchInput.value.trim(), +1);
});

ttsPlay.onclick = ()=> ttsPlayNow();
ttsPause.onclick= ()=> ttsPauseNow();
ttsStop.onclick = ()=> ttsStopNow();
ttsRate.oninput  = ()=> { if (ttsUtter) ttsUtter.rate = Number(ttsRate.value||1); };

document.addEventListener('keydown', async (e)=>{
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return;
  if (e.key === 'ArrowRight'){ nextBtn.click(); }
  if (e.key === 'ArrowLeft'){ prevBtn.click(); }
  if (e.key === '+' || e.key === '='){ zoomIn.click(); }
  if (e.key === '-'){ zoomOut.click(); }
  if (e.key.toLowerCase() === 'r'){ toggleReader.click(); }
  if (e.key.toLowerCase() === 'i'){ toggleLens.click(); }
  if (e.key.toLowerCase() === 's'){ try{ ensureBuzzer()(500); }catch{} }
  if (e.key.toLowerCase() === 'f'){ document.documentElement.requestFullscreen?.(); }
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

//////////////////////
// TOC interactions //
//////////////////////
tocList.addEventListener('click', (e)=>{
  const href = e.target.getAttribute('data-href');
  if (href && state.epubRend) state.epubRend.display(href);
});

//////////////////////
// Bookmarks panel  //
//////////////////////
$('#addBm').onclick = ()=>{
  if (!state.currentId) return;
  if (state.type === 'pdf') addBookmark(`Page ${state.pdfPage}`, { page: state.pdfPage });
  else if (state.type === 'epub' && state.epubRend){
    const loc = state.epubRend.currentLocation();
    addBookmark(`EPUB ${Math.round((loc?.start?.percentage||0)*100)}%`, { cfi: loc?.start?.cfi });
  } else addBookmark('Bookmark');
};
bmList.addEventListener('click', (e)=>{
  const j = e.target.getAttribute('data-jump');
  const d = e.target.getAttribute('data-del');
  if (j){
    if (j.startsWith('p:') && state.type==='pdf'){
      state.pdfPage = clamp(Number(j.slice(2)), 1, state.pdfDoc.numPages);
      renderPDFPage();
    } else if (j.startsWith('cfi:') && state.type==='epub' && state.epubRend){
      state.epubRend.display(j.slice(4));
    }
  }
  if (d){
    const map = getBookmarks();
    const list = map[state.currentId] || [];
    map[state.currentId] = list.filter(x => String(x.ts) !== d);
    setBookmarks(map);
  }
});

/////////////////////////////
// Tabs (Library/TOC/BM)   //
/////////////////////////////
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('on'));
    btn.classList.add('on');
    document.getElementById(btn.dataset.panel).classList.add('on');
  });
});

/////////////////////////////
// Demo: build EPUB in RAM //
/////////////////////////////
loadDemo.onclick = async ()=>{
  if (!window.JSZip){ alert('JSZip missing'); return; }
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
  body{color:var(--fg);background:var(--bg);line-height:1.7;font-family: serif;}
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
    <p>This EPUB was generated on the fly. Try Reader Mode (R), zoom (+/-), search, and the lens (I).</p>
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
  <spine>
    <itemref idref="chap1"/>
  </spine>
</package>`);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  return dataUrl;
}

//////////////////////
// Export / Import  //
//////////////////////
$('#exportLib').onclick = ()=>{
  const data = JSON.stringify(getLibrary(), null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aeonsight-library-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#importLib').onchange = async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  try{
    const text = await f.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('Bad file');
    saveJSON(LS_KEY_LIB, arr);
    renderLibrary();
    alert('Library imported.');
  }catch(err){ alert('Import failed: '+err.message); }
  e.target.value='';
};

//////////////////////
// Init / defaults  //
//////////////////////
(function init(){
  const cfg = loadJSON(LS_KEY_CFG, {});
  if (cfg.fontPct) fontPct.value = cfg.fontPct;
  if (cfg.fov) { fovRange.value = cfg.fov; fovRange.oninput(); }
  if (cfg.sleepMinutes) sleepMinsInp.value = cfg.sleepMinutes;
  if (typeof cfg.allowScripts === 'boolean') allowScriptsChk.checked = cfg.allowScripts;

  // Restore theme & font
  if (cfg.theme){ themeSel.value = cfg.theme; document.body.classList.add(`theme-${cfg.theme}`); }
  if (cfg.font){ fontSel.value = cfg.font; document.body.classList.add(`font-${cfg.font}`); }

  // Reader mode state
  if (cfg.reader) {
    document.body.classList.add('reader');
    toggleReader.textContent = 'Exit Reader Mode';
  }

  fontPct.addEventListener('change', persistCfg);
  fovRange.addEventListener('change', persistCfg);
  sleepMinsInp.addEventListener('change', persistCfg);

  renderLibrary();
  setStatus('Idle');
  contentEl.focus();

  // Register Service Worker (once)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW reg failed', err));
  }

  // Sidebar tabs default: Library
  document.querySelector('[data-panel="libPanel"]').click?.();
})();
function persistCfg(){
  saveJSON(LS_KEY_CFG, {
    fontPct: Number(fontPct.value),
    fov: Number(fovRange.value),
    sleepMinutes: Number(sleepMinsInp.value),
    allowScripts: !!allowScriptsChk.checked,
    reader: document.body.classList.contains('reader'),
    theme: themeSel.value || 'dark',
    font: fontSel.value || 'serif'
  });
}
// ---- Bottom Action Dock (no-HTML-change helper) ----
(function makeBottomDock(){
  // IDs you want in the bottom dock (add/remove to taste)
  const ids = [
    'openBtn','importBtn','exportBtn',
    'prevPage','nextPage','zoomOut','zoomIn',
    'toggleReader','toggleLens','sleepBtn'
  ];

  // Create the dock once
  if (document.getElementById('actionDock')) return;
  const dock = document.createElement('div');
  dock.id = 'actionDock';
  dock.setAttribute('role','toolbar');
  dock.setAttribute('aria-label','Reading controls');
  document.body.appendChild(dock);

  // Move any existing controls into the dock (if they exist)
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // If a button has a parent wrapper that matters, just move the button itself
    dock.appendChild(el);
  });

  // Optional: if nothing was found, remove the dock
  if (!dock.children.length) dock.remove();
})();
