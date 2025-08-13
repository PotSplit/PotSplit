/* AeonSight Pro — hardened sandbox + real Reader Mode + restore positions
   - Default: EPUB scripts BLOCKED (safer). Toggle: “Allow EPUB scripts (less safe)”.
   - Never combine sandbox="allow-scripts allow-same-origin" to avoid DevTools warning.
   - PDF uses replaceChildren() to avoid “deferred DOM Node” warning.
   - Reader Mode = true distraction-free (persisted; defaults ON unless you turned it off).
   - Remembers last position: PDF page & EPUB CFI per library item.
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

const lensEl    = document.getElementById('lens');

const statName  = document.getElementById('statName');
const statStatus= document.getElementById('statStatus');
const statProg  = document.getElementById('statProg');
const statPage  = document.getElementById('statPage');
const statTime  = document.getElementById('statTime');
const statWords = document.getElementById('statWords');

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
// Position keys   //
/////////////////////
const posKeyEpub = () => state.currentId ? `aeon:pos:${state.currentId}` : null;
const posKeyPdf  = () => state.currentId ? `aeon:pdfpage:${state.currentId}` : null;

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
  // also clear saved positions
  localStorage.removeItem(`aeon:pos:${id}`);
  localStorage.removeItem(`aeon:pdfpage:${id}`);
  setLibrary(getLibrary().filter(x => x.id !== id));
  if (state.currentId === id) {
    contentEl.innerHTML = '<div class="empty">Removed. Choose another file.</div>';
    resetDoc();
  }
}
function clearLibrary(){
  // nuke positions too
  for (const it of getLibrary()){
    localStorage.removeItem(`aeon:pos:${it.id}`);
    localStorage.removeItem(`aeon:pdfpage:${it.id}`);
  }
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

  // Stats
  state.seconds = 0;
  state.wordsRead = 0;
  state.startedAt = Date.now();
  updateStats();
  stopSleepGuard();
  kickSleepGuard();
}

function setStatus(msg){ statStatus.textContent = msg; }
function updateStats(){
  statName.textContent = state.docName ?? '—';
  statPage.textContent = (state.type === 'pdf' && state.pdfDoc)
    ? `${state.pdfPage}/${state.pdfDoc.numPages}` :
    (state.type === 'epub' ? (statPage.textContent || '—') : '—');
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
  state.currentId = id;                 // set before open so position keys work
  await openBuffer(item.name, item.type, item.dataUrl);
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

    // restore saved page (if any)
    const saved = posKeyPdf() && Number(localStorage.getItem(posKeyPdf()));
    if (saved && saved >= 1 && saved <= state.pdfDoc.numPages) {
      state.pdfPage = saved;
    } else {
      state.pdfPage = clamp(state.pdfPage, 1, state.pdfDoc.numPages);
    }

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
  // Replace instead of wiping (avoids DevTools deferred-node warning)
  contentEl.replaceChildren(canvas);
  await page.render({ canvasContext: ctx, viewport }).promise;

  statProg.textContent = `${Math.round((state.pdfPage/state.pdfDoc.numPages)*100)}%`;
  statPage.textContent = `${state.pdfPage}/${state.pdfDoc.numPages}`;

  // persist last page
  const k = posKeyPdf(); if (k) localStorage.setItem(k, String(state.pdfPage));

  state.wordsRead += Math.round(280 * 0.9);
  kickSleepGuard();
}

function forceEpubSandbox(allowScripts){
  // If scripts ON: use sandbox="allow-scripts" (unique origin).
  // If scripts OFF: use sandbox="allow-same-origin" (no scripts).
  const wanted = allowScripts ? 'allow-scripts' : 'allow-same-origin';
  const frs = contentEl.querySelectorAll('iframe');
  frs.forEach(fr => fr.setAttribute('sandbox', wanted));
}

async function openEPUB(name, dataUrl){
  try{
    if (!window['ePub'])  throw new Error('ePub.js missing');
    if (!window['JSZip']) throw new Error('JSZip missing (EPUB needs JSZip)');

    const allowScripts = !!allowScriptsChk?.checked;

    // Open from ArrayBuffer (no network fetches)
    const bytes = dataUrlToUint8(dataUrl);
    state.epubBook = ePub();
    await state.epubBook.open(bytes.buffer, 'binary');

    contentEl.innerHTML = '';
    const mount = document.createElement('div');
    mount.className = 'epub-mount';
    contentEl.appendChild(mount);

    state.epubRend = state.epubBook.renderTo(mount, {
      width: '100%',
      height: '84vh',
      spread: 'none',
      allowScriptedContent: allowScripts // default false via checkbox (unchecked)
    });

    // Theme & font size
    state.epubFontPct = Number(fontPct.value || 100);
    state.epubRend.themes.register('aeon', {
      'body': { 'color':'#eaf0ff','background':'#0b0c10','line-height':'1.7', 'font-size':`${state.epubFontPct}%` },
      'p':    { 'margin':'0 0 1em 0' }
    });
    state.epubRend.themes.select('aeon');

    // Restore saved CFI if present
    const savedCFI = posKeyEpub() && localStorage.getItem(posKeyEpub());
    await state.epubRend.display(savedCFI || undefined);

    // Force safer sandbox after each render
    forceEpubSandbox(allowScripts);
    state.epubRend.on('rendered', ()=> forceEpubSandbox(allowScripts));

    state.epubRend.on('relocated', (loc)=>{
      try{
        const pct = Math.round((loc?.start?.percentage || 0) * 100);
        const page = loc?.start?.displayed?.page;
        const total = loc?.start?.displayed?.total;
        statProg.textContent = isFinite(pct) && pct>0 ? `${pct}%` : '—';
        statPage.textContent = (page && total) ? `${page}/${total}` : '—';

        // persist CFI
        const k = posKeyEpub(); if (k && loc?.start?.cfi) localStorage.setItem(k, loc.start.cfi);

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

function updateReaderBtnUI(on){
  toggleReader.textContent = on ? 'Exit Reader Mode' : 'Reader Mode';
  toggleReader.setAttribute('aria-pressed', on ? 'true' : 'false');
}
toggleReader.onclick = ()=>{
  const on = document.body.classList.toggle('reader');
  updateReaderBtnUI(on);
  persistCfg(); // save choice
  contentEl.focus({ preventScroll: false });
};

// Optional: Lens & Sleep quick actions
if (toggleLens && lensEl){
  toggleLens.onclick = ()=>{
    const on = lensEl.classList.toggle('show');
    toggleLens.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
}
if (sleepBtn){
  sleepBtn.onclick = ()=>{
    setStatus('Sleep timer reset');
    kickSleepGuard();
    setTimeout(()=> setStatus('Ready'), 800);
  };
}

allowScriptsChk.onchange = ()=>{
  persistCfg();
  // Re-open current EPUB under the new sandbox policy
  if (state.type === 'epub' && state.currentId) openFromLibrary(state.currentId);
};

document.addEventListener('keydown', async (e)=>{
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowRight'){ nextBtn.click(); }
  if (e.key === 'ArrowLeft'){  prevBtn.click(); }
  if (e.key === '+' || e.key === '='){ zoomIn.click(); }
  if (e.key === '-'){ zoomOut.click(); }
  if (e.key.toLowerCase() === 'r'){ toggleReader.click(); }
  if (e.key.toLowerCase() === 'i'){ toggleLens?.click(); }
  if (e.key.toLowerCase() === 's'){ sleepBtn?.click(); }
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
  const t = e.target;
  if (!(t instanceof Element)) return;
  const openId = t.getAttribute('data-open');
  const delId  = t.getAttribute('data-del');
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
    <p>This EPUB was generated on the fly. Try Reader Mode (R), zoom (+/-), and the lens (I).</p>
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
// Init / defaults  //
//////////////////////
(function init(){
  // Allow focusing content container with JS when toggling Reader Mode
  if (!contentEl.hasAttribute('tabindex')) contentEl.setAttribute('tabindex','-1');

  const cfg = loadJSON(LS_KEY_CFG, {});
  if (cfg.fontPct) fontPct.value = cfg.fontPct;
  if (cfg.fov) { fovRange.value = cfg.fov; fovRange.oninput(); }
  if (cfg.sleepMinutes) sleepMinsInp.value = cfg.sleepMinutes;
  if (typeof cfg.allowScripts === 'boolean') allowScriptsChk.checked = cfg.allowScripts;

  // Reader Mode: default ON if not yet set
  const readerPref = (typeof cfg.reader === 'boolean') ? cfg.reader : true;
  if (readerPref) document.body.classList.add('reader');
  updateReaderBtnUI(readerPref);

  fontPct.addEventListener('change', ()=> persistCfg());
  fovRange.addEventListener('change', ()=> persistCfg());
  sleepMinsInp.addEventListener('change', ()=> persistCfg());

  renderLibrary();
  setStatus('Idle');
  contentEl.focus();
})();

function persistCfg(){
  saveJSON(LS_KEY_CFG, {
    fontPct: Number(fontPct.value),
    fov: Number(fovRange.value),
    sleepMinutes: Number(sleepMinsInp.value),
    allowScripts: !!allowScriptsChk.checked,
    reader: document.body.classList.contains('reader')
  });
}
