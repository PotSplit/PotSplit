/* AeonSight Pro — everything is client-side/offline.
   IndexedDB: library, positions, notes, bookmarks, goals, streaks
   No uploads; files stay local.
*/
(() => {
  // ---------- Elements ----------
  const $ = (s) => document.querySelector(s);
  const els = {
    addFiles:   $('#addFiles'),
    importZip:  $('#importZip'),
    exportZip:  $('#exportZip'),
    prev:       $('#prev'),
    next:       $('#next'),
    zoomIn:     $('#zoomIn'),
    zoomOut:    $('#zoomOut'),
    layout:     $('#layout'),
    theme:      $('#theme'),
    font:       $('#font'),
    width:      $('#width'),
    lineHeight: $('#lineHeight'),
    editorToggle: $('#editorToggle'),
    focusToggle:  $('#focusToggle'),
    idle:      $('#idle'),
    bookmark:  $('#bookmark'),
    highlight: $('#highlight'),

    search:    $('#search'),
    libList:   $('#libList'),

    epubPane:  $('#epubPane'),
    epubArea:  $('#epubArea'),
    pdfPane:   $('#pdfPane'),
    pdfCanvas: $('#pdfCanvas'),
    pdfPage:   $('#pdfPage'),
    pdfTotal:  $('#pdfTotal'),
    textPane:  $('#textPane'),
    doc:       $('#doc'),

    drop:      $('#drop'),

    // tts
    ttsPlay:   $('#ttsPlay'),
    ttsPause:  $('#ttsPause'),
    ttsStop:   $('#ttsStop'),
    ttsRate:   $('#ttsRate'),
    ttsVoice:  $('#ttsVoice'),

    statType:  $('#statType'),
    statProg:  $('#statProg'),
    statWords: $('#statWords'),
    statElapsed: $('#statElapsed'),
    statWPM:   $('#statWPM'),
    statGoal:  $('#statGoal'),
    statStreak:$('#statStreak'),

    noteModal: $('#noteModal'),
    noteText:  $('#noteText'),
    noteSave:  $('#noteSave'),
  };

  // ---------- State ----------
  const state = {
    db: null,
    library: [], // [{id, title, type, cover, size, addedAt, lastPos, progress, fileRef}]
    current: null, // id of opened item
    book: null, rendition: null, // epub.js
    pdf: null, pdfPageNum: 1, pdfScale: 1.1, // pdf.js
    type: 'text', // 'epub'|'pdf'|'text'
    startTime: Date.now(), wordsStart: 0,
    idleMs: 10*60000, idleTimer: null,
    voices: [],
    settings: {
      layout: 'single', theme: 'dark', font: 'system', width: 'normal', lineHeight: '1.6',
      goalMin: 20, streak: 0, lastGoalDate: null,
    }
  };

  // ---------- Utils ----------
  const secondsToHMS = s => {
    const h = Math.floor(s/3600).toString().padStart(2,'0');
    const m = Math.floor((s%3600)/60).toString().padStart(2,'0');
    const z = Math.floor(s%60).toString().padStart(2,'0');
    return `${h}:${m}:${z}`;
  };
  const wordCount = t => (t.trim().match(/\b[\w’'-]+\b/g) || []).length;

  function confetti() {
    // minimal confetti burst
    const n = 60;
    for(let i=0;i<n;i++){
      const s = document.createElement('span');
      s.className='fx';
      s.style.left = Math.random()*100+'vw';
      s.style.background = `linear-gradient(90deg,#00ffd1,#ff4fd8)`;
      document.body.appendChild(s);
      setTimeout(()=>s.remove(), 1400);
    }
  }

  function beep(ms=600, freq=880) {
    try {
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type='sine'; osc.frequency.value=freq; gain.gain.value=0.06;
      osc.start(); setTimeout(()=>{osc.stop();ctx.close();}, ms);
    } catch {}
  }

  function setIdle() {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (state.idleMs>0) {
      state.idleTimer = setTimeout(()=>{
        beep(); alert('⏰ Idle nudge — turn a page, take a breath, or resume reading.');
      }, state.idleMs);
    }
  }
  ['click','keydown','pointermove','wheel','touchstart'].forEach(evt =>
    document.addEventListener(evt, setIdle, {passive:true})
  );

  // ---------- IndexedDB ----------
  const DB_NAME = 'aeonsight-pro';
  const DB_VER  = 1;
  function openDB() {
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e=>{
        const db = e.target.result;
        db.createObjectStore('library',{keyPath:'id'});
        db.createObjectStore('files'); // key=id, value=ArrayBuffer
        db.createObjectStore('notes'); // key=bookId -> {highlights:[], bookmarks:[], pageNotes:[]}
        db.createObjectStore('settings'); // key='settings'
      };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    });
  }
  async function dbGet(store, key){return new Promise((res,rej)=>{const tx=state.db.transaction(store);tx.objectStore(store).get(key).onsuccess=e=>res(e.target.result);tx.onerror=()=>rej(tx.error)})}
  async function dbSet(store, keyOrObj, val){
    return new Promise((res,rej)=>{
      const tx=state.db.transaction(store,'readwrite');
      const os=tx.objectStore(store);
      const r = (val===undefined)? os.put(keyOrObj): os.put(val, keyOrObj);
      r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
    });
  }
  async function dbDel(store,key){return new Promise((res,rej)=>{const tx=state.db.transaction(store,'readwrite');tx.objectStore(store).delete(key).onsuccess=()=>res();tx.onerror=()=>rej(tx.error)})}
  async function dbAll(store){
    return new Promise((res,rej)=>{
      const tx=state.db.transaction(store); const os=tx.objectStore(store); const out=[];
      os.openCursor().onsuccess=e=>{const c=e.target.result;if(c){out.push(c.value);c.continue()}else res(out)};
      tx.onerror=()=>rej(tx.error);
    });
  }

  // ---------- Library UI ----------
  function renderLibrary(list=state.library) {
    const q = els.search.value.trim().toLowerCase();
    const items = q ? list.filter(i => (i.title||'').toLowerCase().includes(q)) : list;
    els.libList.innerHTML = items.map(item=>{
      const prog = Math.round(item.progress || 0);
      return `
        <li data-id="${item.id}">
          <div class="lib-cover" style="${item.cover?`background-image:url(${item.cover});background-size:cover;background-position:center;`:''}"></div>
          <div class="lib-meta">
            <div class="lib-title">${item.title || '(Untitled)'}</div>
            <div class="lib-sub">${item.type.toUpperCase()} • ${prog}%</div>
            <div class="progress"><span style="width:${prog}%"></span></div>
          </div>
        </li>`;
    }).join('') || `<li><div class="lib-meta">Your library is empty. Add files above or drop them here.</div></li>`;
    [...els.libList.querySelectorAll('li')].forEach(li=>{
      li.onclick = ()=> openFromLibrary(li.dataset.id);
    });
  }

  // ---------- Openers ----------
  async function addFiles(files) {
    for (const f of files){
      const id = crypto.randomUUID();
      const buf = await f.arrayBuffer();
      const type = guessType(f.name);
      const title = f.name.replace(/\.(epub|pdf|txt|html?|)$/i,'').trim();
      const cover = type==='epub' ? await extractEpubCover(buf).catch(()=>null) : null;
      const item = { id, title, type, size:f.size, addedAt:Date.now(), progress:0, lastPos:null, cover };
      await dbSet('files', id, buf);
      await dbSet('library', item);
      state.library.push(item);
    }
    renderLibrary();
  }

  function guessType(name){
    const n=name.toLowerCase();
    if (n.endsWith('.epub')) return 'epub';
    if (n.endsWith('.pdf'))  return 'pdf';
    if (n.endsWith('.txt'))  return 'text';
    if (n.endsWith('.html') || n.endsWith('.htm')) return 'text';
    return 'text';
  }

  async function openFromLibrary(id){
    const item = state.library.find(x=>x.id===id);
    if (!item) return;
    state.current = id;
    const buf = await dbGet('files', id);
    await openBuffer(item, buf);
  }

  async function openBuffer(item, buf){
    resetReader();
    state.startTime = Date.now();
    if (item.type==='epub'){
      await openEPUB(buf, item.lastPos);
    } else if (item.type==='pdf') {
      await openPDF(buf, item.lastPos);
    } else {
      // assume utf-8 text/HTML
      const text = new TextDecoder().decode(buf);
      openText(text);
    }
    els.statType.textContent = item.type.toUpperCase();
    updateStats();
  }

  function resetReader(){
    // panes
    els.epubPane.classList.add('hidden');
    els.pdfPane.classList.add('hidden');
    els.textPane.classList.add('hidden');
    // tts stop
    stopTTS();
    // epub clean
    try{ state.rendition && state.rendition.destroy(); }catch{}
    try{ state.book && state.book.destroy(); }catch{}
    state.book=null; state.rendition=null;
    // pdf clean
    state.pdf=null; state.pdfPageNum=1; state.pdfScale=1.1;
    // doc
    els.doc.contentEditable=false;
  }

  // ---------- EPUB ----------
  async function openEPUB(buf, lastPos){
    state.type='epub';
    els.epubPane.classList.remove('hidden');
    state.book = ePub(buf);
    state.rendition = state.book.renderTo(els.epubArea, {
      width: '100%', height: '100%',
      spread: pickSpread()
    });
    await state.rendition.display(lastPos || undefined);
    applyRenditionTheme();
    state.rendition.on('relocated', saveEpubLocation);
    // enable annotations (highlights)
    state.rendition.themes.fontSize(fontSizeForDoc());
  }
  function pickSpread(){
    const pref = els.layout.value;
    if (pref==='single') return 'none';
    if (pref==='spread') return 'auto';
    // auto
    return (innerWidth>1100)?'auto':'none';
  }
  function saveEpubLocation(loc){
    if (!state.current) return;
    const cfi = loc?.start?.cfi || null;
    const item = state.library.find(x=>x.id===state.current);
    if (!item) return;
    item.lastPos = { cfi };
    // estimate progress with locations if available
    if (state.book?.locations?.length()){
      const prog = state.book.locations.percentageFromCfi(cfi) * 100;
      item.progress = Math.max(0, Math.min(100, Math.round(prog)));
    }
    dbSet('library', item);
    renderLibrary();
    els.statProg.textContent = (item.progress||0) + '%';
  }

  // ---------- PDF ----------
  async function openPDF(buf, lastPos){
    state.type='pdf';
    els.pdfPane.classList.remove('hidden');
    state.pdf = await pdfjsLib.getDocument({ data:buf }).promise;
    els.pdfTotal.textContent = state.pdf.numPages.toString();
    state.pdfPageNum = Math.min(Math.max(1, lastPos?.page || 1), state.pdf.numPages);
    await renderPdfPage();
  }
  async function renderPdfPage(){
    const page = await state.pdf.getPage(state.pdfPageNum);
    const viewport = page.getViewport({ scale: state.pdfScale });
    const canvas = els.pdfCanvas;
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', {alpha:false});
    await page.render({ canvasContext: ctx, viewport }).promise;
    els.pdfPage.textContent = state.pdfPageNum.toString();

    // progress approximation
    const item = state.library.find(x=>x.id===state.current);
    if (item){
      const prog = Math.round((state.pdfPageNum/state.pdf.numPages)*100);
      item.progress = prog; item.lastPos = { page: state.pdfPageNum, scale: state.pdfScale };
      dbSet('library', item); renderLibrary(); els.statProg.textContent = prog + '%';
    }
  }

  // ---------- TEXT/HTML ----------
  function openText(content){
    state.type='text';
    els.textPane.classList.remove('hidden');
    // HTML vs TEXT
    if (content.trim().match(/<\/?[a-z][\s\S]*>/i)) els.doc.innerHTML = content;
    else els.doc.textContent = content;
    applyDocPrefs();
    els.statProg.textContent = '—';
  }

  // ---------- Appearance ----------
  function applyDocPrefs(){
    els.doc.classList.remove('narrow','wide','serif','mono');
    els.doc.classList.add(els.width.value);
    if (els.font.value==='serif') els.doc.classList.add('serif');
    if (els.font.value==='mono')  els.doc.classList.add('mono');
    els.doc.style.lineHeight = els.lineHeight.value;
    document.documentElement.classList.remove('theme-sepia','theme-light','theme-night');
    if (els.theme.value==='sepia') document.documentElement.classList.add('theme-sepia');
    if (els.theme.value==='light') document.documentElement.classList.add('theme-light');
    if (els.theme.value==='night') document.documentElement.classList.add('theme-night');
  }
  function applyRenditionTheme(){
    if (!state.rendition) return;
    const base = {'body':{'background':'transparent','color':'#eef2ff','line-height':els.lineHeight.value}};
    state.rendition.themes.register('as', base);
    state.rendition.themes.select('as');
    state.rendition.themes.fontSize(fontSizeForDoc());
    state.rendition.spread(pickSpread());
  }
  function fontSizeForDoc(){
    if (els.font.value==='serif') return '113%';
    if (els.font.value==='mono')  return '100%';
    return '108%';
  }

  // ---------- Highlights / Notes ----------
  // EPUB highlights with CFI
  async function highlightEPUB(){
    if (!state.rendition) return;
    const sel = state.rendition.getSelection();
    if (!sel || !sel.cfiRange) { alert('Select text first.'); return; }
    const cfi = sel.cfiRange;
    state.rendition.annotations.highlight(cfi, {}, null, 'as-highlight');
    await addNote({ type:'epub', cfi, text: sel.toString() });
  }
  // Text/HTML highlight by wrapping <mark>
  async function highlightTEXT(){
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { alert('Select text first.'); return; }
    const range = sel.getRangeAt(0);
    const mark = document.createElement('mark');
    mark.style.background = 'rgba(255,255,0,.35)';
    try{ range.surroundContents(mark); }catch{ alert('Cannot highlight across elements; select less.'); return; }
    await addNote({ type:'text', html: mark.innerText });
  }
  // PDF: store note for page
  async function notePDF(){
    const text = prompt('Page note:');
    if (!text) return;
    await addNote({ type:'pdf', page: state.pdfPageNum, text });
  }

  async function addNote(obj){
    if (!state.current) return;
    const existing = (await dbGet('notes', state.current)) || { highlights:[], bookmarks:[], pageNotes:[] };
    if (obj.type==='epub' || obj.type==='text') existing.highlights.push(obj);
    if (obj.type==='pdf') existing.pageNotes.push(obj);
    await dbSet('notes', state.current, existing);
    showNoteEditor(obj); // open modal to refine
  }

  function showNoteEditor(base){
    els.noteText.value = base.text || base.html || '';
    els.noteModal.showModal();
    els.noteSave.onclick = async ()=>{
      base.text = els.noteText.value;
      const n = (await dbGet('notes', state.current)) || { highlights:[], bookmarks:[], pageNotes:[] };
      // Update last appended entry text
      const arr = base.type==='pdf' ? n.pageNotes : n.highlights;
      arr[arr.length-1].text = base.text;
      await dbSet('notes', state.current, n);
      els.noteModal.close();
    };
  }

  // Bookmarks
  async function addBookmark(){
    if (!state.current) return;
    const n = (await dbGet('notes', state.current)) || { highlights:[], bookmarks:[], pageNotes:[] };
    const pos = state.type==='epub' ? (state.rendition?.currentLocation()?.start?.cfi || null)
              : state.type==='pdf' ? { page: state.pdfPageNum }
              : { char: 0 };
    n.bookmarks.push({ when: Date.now(), pos, type: state.type });
    await dbSet('notes', state.current, n);
    beep(250, 1200);
  }

  // ---------- Export / Import ----------
  async function exportAll(){
    const zip = new JSZip();
    const meta = { exportedAt: Date.now(), app:'AeonSight Pro' };
    zip.file('meta.json', JSON.stringify(meta, null, 2));
    zip.file('library.json', JSON.stringify(state.library, null, 2));

    const notes = {};
    for (const it of state.library) {
      notes[it.id] = await dbGet('notes', it.id) || { highlights:[], bookmarks:[], pageNotes:[] };
    }
    zip.file('notes.json', JSON.stringify(notes, null, 2));

    // settings
    zip.file('settings.json', JSON.stringify(state.settings, null, 2));

    const blob = await zip.generateAsync({type:'blob'});
    downloadBlob(blob, 'aeonsight-export.zip');
  }

  async function importAll(file){
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    async function json(name){return zip.file(name)?.async('string').then(s=>JSON.parse(s))}
    const lib = await json('library.json');
    const notes = await json('notes.json');
    const settings = await json('settings.json');

    if (Array.isArray(lib)) {
      // Merge by id (metadata only; user must re-add file binaries)
      for (const it of lib){
        const cur = state.library.find(x=>x.id===it.id);
        if (!cur){ await dbSet('library', it); state.library.push(it); }
      }
    }
    if (notes) {
      for (const [id, data] of Object.entries(notes)) await dbSet('notes', id, data);
    }
    if (settings) {
      state.settings = {...state.settings, ...settings};
      updateGoalLabel();
    }
    renderLibrary();
    alert('Imported metadata/notes/settings. (Files are not included for privacy.)');
  }

  function downloadBlob(blob, name){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Cover extraction (EPUB) ----------
  async function extractEpubCover(buf){
    try{
      const book = ePub(buf);
      await book.loaded.metadata;
      const coverUrl = await book.coverUrl();
      if (!coverUrl) return null;
      return coverUrl;
    }catch{return null}
  }

  // ---------- TTS ----------
  function loadVoices(){
    state.voices = speechSynthesis.getVoices();
    els.ttsVoice.innerHTML = state.voices.map((v,i)=>`<option value="${i}">${v.name} (${v.lang})</option>`).join('');
  }
  function getSpeakText(){
    if (state.type==='epub' && els.epubArea) return els.epubArea.innerText.slice(0, 4000);
    if (state.type==='pdf') return '(Select text to read aloud on PDF pages.)';
    return els.doc.innerText.slice(0, 4000);
  }
  function playTTS(){
    stopTTS();
    const u = new SpeechSynthesisUtterance(getSpeakText());
    const v = state.voices[+els.ttsVoice.value] || null;
    if (v) u.voice=v;
    u.rate = +els.ttsRate.value || 1;
    speechSynthesis.speak(u);
  }
  function pauseTTS(){ speechSynthesis.pause(); }
  function stopTTS(){ speechSynthesis.cancel(); }

  // ---------- Stats / Goals ----------
  function updateStats(){
    const secs = Math.max(1, (Date.now()-state.startTime)/1000);
    els.statElapsed.textContent = secondsToHMS(secs);
    if (state.type==='text'){
      const w = wordCount(els.doc.innerText);
      els.statWords.textContent = w;
      els.statWPM.textContent = Math.round((w/secs)*60) || '—';
    } else {
      els.statWords.textContent = '—';
      els.statWPM.textContent = '—';
    }
    requestAnimationFrame(updateStats);
  }
  function updateGoalLabel(){
    els.statGoal.textContent = `${state.settings.goalMin}m`;
    els.statStreak.textContent = `${state.settings.streak}d`;
  }

  // ---------- Events ----------
  // File add
  els.addFiles.onchange = async (e)=>{
    const files = [...(e.target.files||[])];
    if (files.length) await addFiles(files);
    els.addFiles.value = '';
  };

  // Import / Export
  els.exportZip.onclick = exportAll;
  els.importZip.onclick = async ()=>{
    const inp = document.createElement('input');
    inp.type='file'; inp.accept='.zip';
    inp.onchange = async ev => {
      const f = ev.target.files?.[0]; if (f) await importAll(f);
    };
    inp.click();
  };

  // Reader controls
  els.prev.onclick = async ()=>{
    if (state.type==='epub') state.rendition?.prev();
    else if (state.type==='pdf' && state.pdf){ state.pdfPageNum = Math.max(1, state.pdfPageNum-1); await renderPdfPage(); }
  };
  els.next.onclick = async ()=>{
    if (state.type==='epub') state.rendition?.next();
    else if (state.type==='pdf' && state.pdf){ state.pdfPageNum = Math.min(state.pdf.numPages, state.pdfPageNum+1); await renderPdfPage(); }
  };
  els.zoomIn.onclick = async ()=>{
    if (state.type==='pdf'){ state.pdfScale = Math.min(3, state.pdfScale+0.1); await renderPdfPage(); }
    if (state.type==='text'){ els.doc.style.fontSize = (parseFloat(getComputedStyle(els.doc).fontSize)+1)+'px'; }
    if (state.type==='epub') state.rendition?.themes.fontSize('+=5%');
  };
  els.zoomOut.onclick = async ()=>{
    if (state.type==='pdf'){ state.pdfScale = Math.max(0.5, state.pdfScale-0.1); await renderPdfPage(); }
    if (state.type==='text'){ els.doc.style.fontSize = (parseFloat(getComputedStyle(els.doc).fontSize)-1)+'px'; }
    if (state.type==='epub') state.rendition?.themes.fontSize('-=5%');
  };
  els.layout.onchange = ()=> applyRenditionTheme();
  els.theme.onchange  = ()=> { applyDocPrefs(); applyRenditionTheme(); };
  els.font.onchange   = ()=> { applyDocPrefs(); applyRenditionTheme(); };
  els.width.onchange  = ()=> { applyDocPrefs(); };
  els.lineHeight.onchange = ()=> { applyDocPrefs(); applyRenditionTheme(); };

  // Editor / Focus / Idle
  els.editorToggle.onchange = ()=> {
    if (state.type!=='text'){ els.editorToggle.checked=false; return; }
    els.doc.contentEditable = els.editorToggle.checked;
  };
  els.focusToggle.onchange = ()=> document.body.classList.toggle('focus', els.focusToggle.checked);
  els.idle.onchange = ()=> { const m = +els.idle.value; state.idleMs = m? m*60000:0; setIdle(); };

  // Notes / Highlights
  els.highlight.onclick = async ()=>{
    if (state.type==='epub') await highlightEPUB();
    else if (state.type==='text') await highlightTEXT();
    else if (state.type==='pdf') await notePDF();
  };
  els.bookmark.onclick = addBookmark;

  // TTS
  els.ttsPlay.onclick = playTTS;
  els.ttsPause.onclick = pauseTTS;
  els.ttsStop.onclick = stopTTS;
  els.ttsRate.oninput = ()=> { if (speechSynthesis.speaking) playTTS(); };
  speechSynthesis.onvoiceschanged = loadVoices; loadVoices();

  // Library
  els.search.oninput = ()=> renderLibrary();

  // Drag & drop to add/open
  ;['dragenter','dragover'].forEach(evt => els.drop.addEventListener(evt, e=>{e.preventDefault(); e.stopPropagation(); els.drop.classList.add('drag');}));
  ;['dragleave','drop'].forEach(evt => els.drop.addEventListener(evt, e=>{e.preventDefault(); e.stopPropagation(); els.drop.classList.remove('drag');}));
  els.drop.addEventListener('drop', async (e)=>{
    const files = [...(e.dataTransfer.files||[])];
    if (!files.length) return;
    await addFiles(files);
    // open first
    const firstId = state.library[state.library.length-1]?.id;
    if (firstId) await openFromLibrary(firstId);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', async e=>{
    if (e.target && ['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key==='ArrowLeft')   els.prev.click();
    if (e.key==='ArrowRight')  els.next.click();
    if (e.key==='+')           els.zoomIn.click();
    if (e.key==='-')           els.zoomOut.click();
    if (e.key.toLowerCase()==='h') els.highlight.click();
    if (e.key.toLowerCase()==='b') els.bookmark.click();
    if (e.code==='Space'){ e.preventDefault(); els.ttsPlay.click(); }
    if (e.key.toLowerCase()==='f'){ e.preventDefault(); els.focusToggle.click(); }
  });

  // Daily goal timer (confetti on finish)
  setInterval(()=>{
    const mins = (Date.now()-state.startTime)/60000;
    const met = mins >= state.settings.goalMin;
    if (met && state.settings.lastGoalDate !== new Date().toDateString()){
      state.settings.streak += 1;
      state.settings.lastGoalDate = new Date().toDateString();
      updateGoalLabel(); confetti(); beep(250, 1400);
      dbSet('settings','settings',state.settings);
    }
  }, 60000);

  // Stats loop
  function loop(){
    const secs = Math.max(1,(Date.now()-state.startTime)/1000);
    els.statElapsed.textContent = secondsToHMS(secs);
    if (state.type==='text'){
      const w = wordCount(els.doc.innerText);
      els.statWords.textContent = w;
      els.statWPM.textContent = Math.round((w/secs)*60) || '—';
    } else { els.statWords.textContent='—'; els.statWPM.textContent='—'; }
    requestAnimationFrame(loop);
  }

  // ---------- Init ----------
  (async function init(){
    state.db = await openDB();
    state.library = await dbAll('library');
    const saved = await dbGet('settings','settings');
    if (saved) state.settings = {...state.settings, ...saved};
    updateGoalLabel();
    renderLibrary();
    applyDocPrefs(); loop(); setIdle();
  })();
})();
