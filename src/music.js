// 音樂播放器與曲庫：純播放模式（播放佇列、上一首／下一首、隨機、重複、媒體鍵），
// 以及桌面版的工作區（加入資料夾或單檔、批次轉成 .waxrack）。
// 網頁版沒有檔案系統，曲庫就是目前蠟筒架上的各組。
// 記憶體：桌面版的歌只把「正在播的」和「下一首」放上蠟筒架，播完就移除。

const AUDIO_KEY = 'phonograph.music';   // 播放器自己的設定：啟動模式、隨機、重複、上次的工作區
const WAXES = [['brown', '棕蠟（約 2 分鐘）'], ['black', '黑蠟（約 2 分鐘）'], ['amber', '琥珀蠟（約 4 分鐘）']];
const QUALITIES = [['lossless', '無損'], ['high', '高品質'], ['compact', '精簡']];
const STATUS = { todo: '未轉檔', done: '已轉檔', busy: '轉檔中', stale: '設定已變更', changed: '來源已變更', error: '轉檔失敗' };

export function initMusic(api) {
  const fs = api.platform.fs;   // 只有桌面版有
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let prefs = { startPlayer: false, shuffle: false, repeat: 'off', lastWorkspace: null };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(AUDIO_KEY) || '{}')); } catch {}
  const savePrefs = () => { try { localStorage.setItem(AUDIO_KEY, JSON.stringify(prefs)); } catch {} };

  // ---- 曲庫 ----
  // song：{key, kind:'file'|'rack', title, artist, album, path?, root?, rel?, size?, mtime?, gid?, status?, out?}
  let songs = [];
  const byKey = new Map();
  // 工作區（桌面版）
  let ws = null, wsPath = null, wsDirty = false;
  const newWorkspace = () => ({ app: 'wax-phonograph', kind: 'workspace', v: 1, name: '未命名工作區', sources: [],
    output: { dir: null, layout: 'mirror' }, convert: { wax: 'brown', rpm: 160, normalize: true, quality: 'lossless' }, songs: {} });
  const convKey = () => { const c = ws.convert; return `${c.wax}|${c.rpm}|${c.normalize ? 1 : 0}|${c.quality}`; };

  // ---- 播放佇列 ----
  let queue = [], qi = -1;                 // 佇列是 song key 的陣列
  let curGid = null, nextGid = null, nextQi = -1;
  const loaded = new Map();                // 桌面版：key → 已放上蠟筒架的群組（暫時的）
  let busyLoading = false, wasPlaying = false;
  const songOf = k => byKey.get(k);

  // ---------------- 介面 ----------------
  const root = document.createElement('div'); root.id = 'player';
  root.innerHTML = `
  <header class="pv-head">
    <span class="pv-brand">蠟筒留聲機 · 播放器</span>
    <span class="pv-tabs"><button data-pv="now" class="on">播放</button><button data-pv="lib">曲庫</button></span>
    <span class="pv-sp"></span>
    <label class="pv-opt"><input type="checkbox" id="pvStart"> 啟動時開啟播放器</label>
    <button class="btn" id="pvClose">回到留聲機</button>
  </header>
  <section class="pv-page on" data-page="now">
    <div class="pv-now">
      <div class="pv-cover" id="pvCover"></div>
      <div class="pv-info">
        <div class="pv-title" id="pvTitle">還沒有播放</div>
        <div class="pv-artist" id="pvArtist">從「曲庫」把歌加入佇列</div>
        <div class="pv-bar"><i id="pvBar"></i></div>
        <div class="pv-times"><span id="pvPos">0:00</span><span id="pvState"></span><span id="pvTot">0:00</span></div>
        <div class="pv-ctl">
          <button class="pv-b" id="pvShuffle" title="隨機播放">⤮</button>
          <button class="pv-b" id="pvPrev" title="上一首"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
          <button class="pv-b big" id="pvPlay" title="播放／停止">▶</button>
          <button class="pv-b" id="pvNext" title="下一首"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button>
          <button class="pv-b" id="pvRepeat" title="重複">↻</button>
        </div>
      </div>
    </div>
    <div class="pv-qhead"><b>播放佇列</b><span id="pvQInfo"></span><span class="pv-sp"></span><button class="mini" id="pvQClear">清空</button></div>
    <ol class="pv-queue" id="pvQueue"></ol>
  </section>
  <section class="pv-page" data-page="lib">
    <div id="pvLibDesk" class="pv-lib"></div>
    <div id="pvLibWeb" class="pv-lib"></div>
  </section>`;
  document.body.appendChild(root);

  root.querySelectorAll('.pv-tabs button').forEach(b => b.onclick = () => showPage(b.dataset.pv));
  function showPage(p) {
    root.querySelectorAll('.pv-tabs button').forEach(b => b.classList.toggle('on', b.dataset.pv === p));
    root.querySelectorAll('.pv-page').forEach(s => s.classList.toggle('on', s.dataset.page === p));
    if (p === 'lib') renderLib();
  }
  $('pvStart').checked = !!prefs.startPlayer;
  $('pvStart').onchange = e => { prefs.startPlayer = e.target.checked; savePrefs(); };
  $('pvClose').onclick = () => close();

  // ---------------- 開關 ----------------
  function open(page) { api.setPlayerMode(true); root.classList.add('on'); if (page) showPage(page); refreshSongs(); renderQueue(); tick(); }
  function close() { root.classList.remove('on'); api.setPlayerMode(false); }
  function ready() {   // 留聲機開啟後（音訊可用）
    if (fs && prefs.lastWorkspace) openWorkspace(prefs.lastWorkspace, true);
    if (prefs.startPlayer) open();
  }

  // ---------------- 曲庫資料 ----------------
  function refreshSongs() {
    if (fs) return;   // 桌面版由工作區掃描產生
    // 網頁版：蠟筒架上有內容的各組就是歌
    songs = api.rackSongs().filter(s => s.hasContent).map(s => ({ key: 'g' + s.gid, kind: 'rack', gid: s.gid, title: s.name, artist: '', secs: s.secs }));
    byKey.clear(); songs.forEach(s => byKey.set(s.key, s));
    queue = queue.filter(k => byKey.has(k));
  }

  async function scanWorkspace() {
    if (!ws) return;
    const items = await fs.scanSources(ws.sources);
    const key = convKey();
    const next = [];
    for (const it of items) {
      const rec = ws.songs[it.path];
      const s = { key: it.path, kind: 'file', path: it.path, root: it.root, rel: it.rel, size: it.size, mtime: it.mtime,
        title: rec?.title || it.name.replace(/\.[^.]+$/, ''), artist: rec?.artist || '', album: rec?.album || '', out: rec?.out || null };
      s.status = statusOf(s, rec, key);
      next.push(s);
    }
    // 已轉檔的要確認輸出檔還在
    await Promise.all(next.filter(s => s.status === 'done').map(async s => { if (!(await fs.stat(s.out))) s.status = 'todo'; }));
    songs = next; byKey.clear(); songs.forEach(s => byKey.set(s.key, s));
    queue = queue.filter(k => byKey.has(k) || loaded.has(k));
    renderLib(); renderQueue();
    readTagsLater(songs.filter(s => !ws.songs[s.path]?.tagged));
  }
  function statusOf(s, rec, key) {
    if (!rec?.out) return 'todo';
    if (rec.size !== s.size || rec.mtime !== s.mtime) return 'changed';
    if (rec.key !== key) return 'stale';
    return 'done';
  }
  // 標題、演出者、專輯在背景慢慢讀，讀到就記進工作區
  let tagRun = 0;
  async function readTagsLater(list) {
    const run = ++tagRun;
    for (const s of list) {
      if (run !== tagRun) return;
      const t = await fs.readTags(s.path).catch(() => ({}));
      const rec = ws.songs[s.path] || (ws.songs[s.path] = {});
      if (t.title) s.title = rec.title = t.title;
      if (t.artist) s.artist = rec.artist = t.artist;
      if (t.album) s.album = rec.album = t.album;
      rec.tagged = true; wsDirty = true;
      if (root.classList.contains('on')) { renderLibRows(); renderQueue(); }
    }
    saveWorkspaceSoon();
  }

  // ---------------- 工作區檔案 ----------------
  async function openWorkspace(path, quiet) {
    try {
      const data = JSON.parse(new TextDecoder().decode(await fs.readFile(path)));
      if (data.kind !== 'workspace') throw new Error('不是工作區檔案');
      ws = Object.assign(newWorkspace(), data); ws.convert = Object.assign(newWorkspace().convert, data.convert); ws.output = Object.assign(newWorkspace().output, data.output);
      wsPath = path; prefs.lastWorkspace = path; savePrefs();
      await scanWorkspace();
      if (!quiet) api.toast(`已開啟工作區「${ws.name}」`);
    } catch (e) { if (!quiet) api.toast('無法開啟工作區：' + e.message); else { prefs.lastWorkspace = null; savePrefs(); } }
  }
  async function saveWorkspace(asNew) {
    if (!ws) return;
    if (asNew || !wsPath) {
      const p = await fs.pickSaveWorkspace((ws.name || '工作區') + '.waxspace'); if (!p) return false;
      wsPath = p; ws.name = p.split(/[\\/]/).pop().replace(/\.waxspace$/i, ''); prefs.lastWorkspace = p; savePrefs();
    }
    await fs.writeFile(wsPath, new TextEncoder().encode(JSON.stringify(ws, null, 1)));
    wsDirty = false; renderLib(); return true;
  }
  let saveTimer = 0;
  function saveWorkspaceSoon() { if (!wsPath) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (wsDirty) saveWorkspace(false).catch(e => api.toast('工作區儲存失敗：' + e.message)); }, 800); }
  function touched() { wsDirty = true; saveWorkspaceSoon(); }

  // ---------------- 轉檔 ----------------
  let converting = null;   // {stop:bool}
  // 輸出路徑：依來源資料夾或全部放一起；同名的加編號
  async function outPathFor(s) {
    const base = s.rel.replace(/\.[^./]+$/, '');
    const rel = ws.output.layout === 'flat' ? base.split('/').pop() : (s.root ? s.root.split(/[\\/]/).pop() + '/' + base : base);
    const taken = new Set(Object.entries(ws.songs).filter(([p, r]) => p !== s.path && r.out).map(([, r]) => r.out.toLowerCase()));
    for (let i = 1; ; i++) { const p = await fs.outputPath(ws.output.dir, i === 1 ? rel : `${rel} (${i})`); if (!taken.has(p.toLowerCase())) return p; }
  }
  async function convertOne(s, onProgress) {
    const buf = await api.decodeAudio((await fs.readFile(s.path)).buffer);
    const blob = await api.convertSong(buf, { ...ws.convert, title: s.title }, onProgress);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (ws.output.dir) {
      const out = await outPathFor(s);
      await fs.writeFile(out, bytes);
      const st = await fs.stat(s.path);
      ws.songs[s.path] = Object.assign(ws.songs[s.path] || {}, { out, key: convKey(), size: st?.size ?? s.size, mtime: st?.mtime ?? s.mtime, title: s.title, artist: s.artist, album: s.album, secs: buf.duration });
      s.out = out; s.status = 'done'; touched();
    }
    return bytes;
  }
  async function convertBatch(list) {
    if (!list.length) { api.toast('沒有需要轉檔的歌'); return; }
    if (!ws.output.dir) { if (!(await pickOutput())) return; list = list.map(s => byKey.get(s.key)).filter(Boolean); }   // 選輸出資料夾會重新掃描，要改用新的歌曲物件
    if (converting) return;
    converting = { stop: false }; renderLib();
    let ok = 0, fail = 0;
    for (let i = 0; i < list.length && !converting.stop; i++) {
      const s = list[i]; s.status = 'busy'; renderLibRows();
      setProg(`轉檔中 ${i + 1}/${list.length}：${s.title}`, i / list.length);
      try { await convertOne(s, f => setProg(`轉檔中 ${i + 1}/${list.length}：${s.title}（${Math.round(f * 100)}%）`, (i + f) / list.length)); ok++; }
      catch (e) { s.status = 'error'; s.err = e.message; fail++; }
      renderLibRows();
    }
    const stopped = converting.stop; converting = null;
    setProg(`${stopped ? '已停止。' : '完成。'}成功 ${ok} 首${fail ? `，失敗 ${fail} 首` : ''}`, 1);
    renderLib();
  }
  async function pickOutput() { const d = await fs.pickFolder(); if (!d) return false; ws.output.dir = d; touched(); await scanWorkspace(); return true; }
  function setProg(text, f) { const t = $('pvProgT'), b = $('pvProgB'); if (t) t.textContent = text; if (b) b.style.width = Math.round(f * 100) + '%'; }

  // ---------------- 播放 ----------------
  // 取得一首歌的 .waxrack 位元組：已轉檔就讀檔，否則當場轉（有輸出資料夾時順便存起來）
  async function bytesFor(s) {
    if (s.status === 'done' && s.out) { try { return await fs.readFile(s.out); } catch {} }
    s.status = 'busy'; renderLibRows(); setNow(s, '正在轉成蠟筒…');
    try { return await convertOne(s); } finally { if (s.status === 'busy') s.status = ws?.output.dir ? 'done' : 'todo'; renderLibRows(); }
  }
  async function ensureLoaded(k) {
    const s = songOf(k); if (!s) return null;
    if (s.kind === 'rack') return s.gid;
    if (loaded.has(k)) return loaded.get(k);
    const gid = await api.loadSong(await bytesFor(s), { name: s.title });
    loaded.set(k, gid); return gid;
  }
  // 從佇列的第 i 首開始播
  async function playAt(i) {
    if (!api.hasAudio()) { api.toast('請先開啟留聲機'); return; }
    if (i < 0 || i >= queue.length || busyLoading) return;
    busyLoading = true;
    try {
      // 換歌：先把之前預載的「下一首」拿掉，避免接錯
      dropLoaded(k => k !== queue[i]);
      qi = i; nextGid = null; nextQi = -1;
      const gid = await ensureLoaded(queue[i]); if (gid == null) return;
      curGid = gid; await api.playGroup(gid); wasPlaying = true;
      setNow(songOf(queue[i]));
      await preloadNext();
    } catch (e) { api.toast('無法播放：' + e.message); }
    finally { busyLoading = false; renderQueue(); }
  }
  function nextIndex(from) {
    if (!queue.length) return -1;
    if (prefs.repeat === 'one') return from;
    if (prefs.shuffle) { if (queue.length === 1) return prefs.repeat === 'all' ? 0 : -1; let j; do j = Math.floor(Math.random() * queue.length); while (j === from); return j; }
    if (from + 1 < queue.length) return from + 1;
    return prefs.repeat === 'all' ? 0 : -1;
  }
  // 預先把下一首放上蠟筒架，播完這首會無縫接過去（網頁版的蠟筒架各組本來就會依序接續）
  async function preloadNext() {
    nextQi = nextIndex(qi); nextGid = null;
    if (nextQi < 0) return;
    const s = songOf(queue[nextQi]); if (!s || s.kind === 'rack') return;
    try {
      if (nextQi === qi || loaded.has(queue[nextQi])) {   // 重複同一首：再放一份
        nextGid = await api.loadSong(await bytesFor(s), { name: s.title });
      } else nextGid = await ensureLoaded(queue[nextQi]);
    } catch (e) { api.toast('下一首準備失敗：' + e.message); nextGid = null; }
  }
  // 移除暫時放上蠟筒架、但已經不需要的歌
  function dropLoaded(keepFn) {
    for (const [k, gid] of [...loaded]) if (gid !== curGid && gid !== nextGid && (!keepFn || keepFn(k))) { api.removeGroup(gid); loaded.delete(k); }
  }
  async function next() { const j = nextIndex(qi); if (j >= 0) await playAt(j); else if (queue.length) await playAt(0); }
  async function prev() {
    const st = api.musicStatus();
    if (st.pos > 3 && qi >= 0) return playAt(qi);   // 播超過 3 秒：回到這首開頭
    await playAt(Math.max(0, qi - 1));
  }

  // 每 0.4 秒看一次播放狀態：偵測無縫換到下一首、這首播完、更新畫面
  function tick() {
    const st = api.musicStatus();
    if (st.gid != null && st.gid !== curGid && !busyLoading) {
      const prevGid = curGid; curGid = st.gid;
      if (st.gid === nextGid) {   // 已無縫接到預載的下一首
        if (prefs.repeat === 'one') { for (const [k, g] of loaded) if (g === prevGid) loaded.set(k, st.gid); }
        qi = nextQi; nextGid = null;
        for (const [k, g] of [...loaded]) if (g === prevGid && g !== curGid) { api.removeGroup(g); loaded.delete(k); }
        if (prevGid != null && ![...loaded.values()].includes(prevGid) && songOf(queue[qi])?.kind !== 'rack') api.removeGroup(prevGid);
        setNow(songOf(queue[qi])); preloadNext(); renderQueue();
      } else {   // 使用者在別處換了蠟筒（例如網頁版蠟筒架接到下一組）
        const k = 'g' + st.gid, i = queue.indexOf(k);
        if (i >= 0) { qi = i; setNow(songOf(k)); renderQueue(); }
      }
    }
    // 這首播完了但沒有預載的下一首（例如網頁版的隨機、或剛好放不下）
    if (wasPlaying && !st.playing && !busyLoading && st.total && st.pos >= st.total - 0.6) {
      wasPlaying = false; const j = nextIndex(qi); if (j >= 0) playAt(j);
    } else wasPlaying = st.playing || busyLoading;
    if (root.classList.contains('on')) {
      $('pvPos').textContent = api.fmtDur(st.pos || 0); $('pvTot').textContent = api.fmtDur(st.total || 0);
      $('pvBar').style.width = (st.total ? Math.min(100, (st.pos / st.total) * 100) : 0) + '%';
      $('pvPlay').textContent = st.playing ? '■' : '▶';
      $('pvState').textContent = busyLoading ? '準備中…' : st.playing ? '' : (st.total ? '已停止' : '');
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused';
  }
  setInterval(tick, 400);

  // ---- 正在播放的資訊、封面、媒體鍵 ----
  let coverURL = null;
  async function setNow(s, note) {
    if (!s) return;
    $('pvTitle').textContent = s.title || '（未命名）';
    $('pvArtist').textContent = note || [s.artist, s.album].filter(Boolean).join(' · ') || ' ';
    let art = [];
    if (coverURL) { URL.revokeObjectURL(coverURL); coverURL = null; }
    $('pvCover').style.backgroundImage = '';
    if (fs && s.kind === 'file' && !note) {
      const t = await fs.readTags(s.path).catch(() => ({}));
      if (t.cover) { coverURL = URL.createObjectURL(new Blob([t.cover.data], { type: t.cover.mime })); $('pvCover').style.backgroundImage = `url("${coverURL}")`; art = [{ src: coverURL, type: t.cover.mime }]; }
    }
    if ('mediaSession' in navigator && !note) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: s.title || '', artist: s.artist || '', album: s.album || '蠟筒留聲機', artwork: art }); } catch {}
    }
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession, h = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
    h('play', () => { if (!api.musicStatus().playing) { if (qi < 0 && queue.length) playAt(0); else api.togglePlay(); } });
    h('pause', () => { if (api.musicStatus().playing) api.togglePlay(); });
    h('stop', () => api.stop());
    h('nexttrack', () => next());
    h('previoustrack', () => prev());
  }

  // ---- 播放控制 ----
  $('pvPlay').onclick = () => { const st = api.musicStatus(); if (st.playing) { wasPlaying = false; api.stop(); } else if (qi < 0 || curGid == null) { if (queue.length) playAt(Math.max(0, qi)); } else api.togglePlay(); };
  $('pvNext').onclick = () => next();
  $('pvPrev').onclick = () => prev();
  const syncModes = () => { $('pvShuffle').classList.toggle('on', !!prefs.shuffle); $('pvRepeat').classList.toggle('on', prefs.repeat !== 'off');
    $('pvRepeat').textContent = prefs.repeat === 'one' ? '↻1' : '↻'; $('pvRepeat').title = { off: '不重複', all: '全部重複', one: '單曲重複' }[prefs.repeat]; };
  $('pvShuffle').onclick = () => { prefs.shuffle = !prefs.shuffle; savePrefs(); syncModes(); reNext(); };
  $('pvRepeat').onclick = () => { prefs.repeat = { off: 'all', all: 'one', one: 'off' }[prefs.repeat]; savePrefs(); syncModes(); reNext(); };
  syncModes();
  // 佇列或模式改變後，重新準備下一首
  async function reNext() { if (busyLoading || qi < 0) return; const old = nextGid; nextGid = null; if (old != null && old !== curGid) for (const [k, g] of [...loaded]) if (g === old) { api.removeGroup(g); loaded.delete(k); } await preloadNext(); }

  // ---- 佇列 ----
  function enqueue(keys, playNow) {
    const start = queue.length; for (const k of keys) queue.push(k);
    renderQueue();
    if (playNow) playAt(start); else if (qi >= 0 && nextGid == null) reNext();
    api.toast(`已加入 ${keys.length} 首到佇列`);
  }
  function renderQueue() {
    const el = $('pvQueue'); if (!el) return;
    $('pvQInfo').textContent = queue.length ? `${queue.length} 首` : '';
    el.innerHTML = queue.length ? queue.map((k, i) => { const s = songOf(k) || { title: '（已移除）' };
      return `<li class="${i === qi ? 'on' : ''}" data-i="${i}"><span class="pv-qt">${esc(s.title)}</span><span class="pv-qa">${esc(s.artist || '')}</span>${i === nextQi && i !== qi ? '<span class="pv-qn">下一首</span>' : ''}<button class="mini" data-rm="${i}" title="從佇列移除">✕</button></li>`; }).join('')
      : `<li class="pv-empty">佇列是空的。到「曲庫」選歌，按「加入佇列」或「播放」。</li>`;
  }
  $('pvQueue').onclick = e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { const i = +rm.dataset.rm; queue.splice(i, 1); if (i < qi) qi--; else if (i === qi) qi = -1; renderQueue(); reNext(); return; }
    const li = e.target.closest('li[data-i]'); if (li) playAt(+li.dataset.i);
  };
  $('pvQClear').onclick = () => { queue = []; qi = -1; nextQi = -1; renderQueue(); };

  // ---------------- 曲庫畫面 ----------------
  const selected = new Set();
  function renderLib() {
    $('pvLibDesk').style.display = fs ? '' : 'none';
    $('pvLibWeb').style.display = fs ? 'none' : '';
    if (!fs) return renderWebLib();
    const el = $('pvLibDesk');
    if (!ws) {
      el.innerHTML = `<div class="pv-empty big">還沒有工作區。工作區記錄你加入的資料夾與檔案、輸出位置和轉檔設定。<div class="btns"><button class="btn" data-a="new">＋ 新增工作區</button><button class="btn" data-a="open">開啟工作區…</button></div></div>`;
      return;
    }
    const c = ws.convert, o = ws.output;
    el.innerHTML = `
      <div class="pv-row"><b class="pv-ws">${esc(ws.name)}${wsPath ? '' : '（未儲存）'}</b><span class="pv-sp"></span>
        <button class="mini" data-a="new">新增</button><button class="mini" data-a="open">開啟…</button><button class="mini" data-a="save">${wsPath ? '另存…' : '儲存…'}</button></div>
      <div class="pv-row"><span class="pv-lab">來源</span>${ws.sources.map((s, i) => `<span class="pv-chip" title="${esc(s.path)}">${s.type === 'folder' ? '📁' : '♪'} ${esc(s.path.split(/[\\/]/).pop())}<button data-rmsrc="${i}" title="移除">✕</button></span>`).join('') || '<span class="pv-dim">還沒有加入任何來源</span>'}
        <span class="pv-sp"></span><button class="mini" data-a="addFolder">＋ 資料夾</button><button class="mini" data-a="addFiles">＋ 檔案</button><button class="mini" data-a="rescan">重新掃描</button></div>
      <div class="pv-row"><span class="pv-lab">輸出</span><span class="pv-path" title="${esc(o.dir || '')}">${esc(o.dir || '尚未選擇輸出資料夾')}</span>
        <button class="mini" data-a="pickOut">選擇…</button>${o.dir ? '<button class="mini" data-a="showOut">開啟資料夾</button>' : ''}
        <select data-k="layout"><option value="mirror">依來源資料夾分類</option><option value="flat">全部放在同一層</option></select></div>
      <div class="pv-row"><span class="pv-lab">轉檔</span>
        <select data-k="wax">${WAXES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        <label>錄音轉速 <input type="number" data-k="rpm" min="60" max="240" step="1" value="${c.rpm}"> rpm</label>
        <label><input type="checkbox" data-k="normalize" ${c.normalize ? 'checked' : ''}> 自動調整音量</label>
        <select data-k="quality">${QUALITIES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
      <div class="pv-row"><button class="btn" data-a="convSel">轉檔選取</button><button class="btn" data-a="convAll">轉檔全部未完成</button>${converting ? '<button class="btn" data-a="stop">停止</button>' : ''}
        <span class="pv-sp"></span><button class="btn" data-a="queueSel">加入佇列</button><button class="btn" data-a="playSel">播放選取</button></div>
      <div class="pv-prog"><i id="pvProgB"></i></div><div class="pv-dim" id="pvProgT"></div>
      <table class="pv-table"><thead><tr><th><input type="checkbox" id="pvSelAll"></th><th>狀態</th><th>標題</th><th>演出者</th><th>專輯</th><th>來源</th></tr></thead><tbody id="pvRows"></tbody></table>`;
    el.querySelector('[data-k=layout]').value = o.layout; el.querySelector('[data-k=wax]').value = c.wax; el.querySelector('[data-k=quality]').value = c.quality;
    renderLibRows();
  }
  function renderLibRows() {
    const tb = $('pvRows'); if (!tb) return;
    tb.innerHTML = songs.length ? songs.map(s => `<tr data-k="${esc(s.key)}" class="${queue[qi] === s.key ? 'on' : ''}"><td><input type="checkbox" ${selected.has(s.key) ? 'checked' : ''}></td>
      <td><span class="pv-st st-${s.status}" title="${esc(s.err || '')}">${STATUS[s.status] || ''}</span></td><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.album)}</td><td class="pv-dim" title="${esc(s.path)}">${esc(s.rel)}</td></tr>`).join('')
      : `<tr><td colspan="6" class="pv-empty">加入資料夾或檔案後，這裡會列出所有音檔。雙擊一首就能播放。</td></tr>`;
    const all = $('pvSelAll'); if (all) all.checked = songs.length > 0 && songs.every(s => selected.has(s.key));
  }
  function renderWebLib() {
    refreshSongs();
    $('pvLibWeb').innerHTML = `<div class="pv-row"><b>蠟筒架上的歌</b><span class="pv-sp"></span><button class="btn" data-a="queueAllWeb">全部加入佇列</button></div>
      <table class="pv-table"><thead><tr><th>標題</th><th>長度</th><th></th></tr></thead><tbody>${songs.map(s => `<tr data-k="${s.key}"><td>${esc(s.title)}</td><td>${api.fmtDur(s.secs || 0)}</td><td><button class="mini" data-play="${s.key}">播放</button> <button class="mini" data-q="${s.key}">加入佇列</button></td></tr>`).join('')
      || '<tr><td colspan="3" class="pv-empty">蠟筒架上還沒有錄音。回到留聲機錄音、匯入音檔刻成蠟筒，或載入 .waxrack。</td></tr>'}</tbody></table>
      <p class="pv-dim">想把整個音樂資料夾批次轉成蠟筒、像播放器一樣使用，可以下載 Windows 桌面版（見「關於」）。</p>`;
  }
  const selList = () => songs.filter(s => selected.has(s.key));
  root.addEventListener('click', async e => {
    const t = e.target, a = t.closest('[data-a]')?.dataset.a;
    if (t.closest('[data-play]')) { const k = t.closest('[data-play]').dataset.play; const i = queue.indexOf(k); if (i >= 0) playAt(i); else enqueue([k], true); return; }
    if (t.closest('[data-q]')) { enqueue([t.closest('[data-q]').dataset.q]); return; }
    if (t.closest('[data-rmsrc]')) { ws.sources.splice(+t.closest('[data-rmsrc]').dataset.rmsrc, 1); touched(); await scanWorkspace(); return; }
    if (t.id === 'pvSelAll') { songs.forEach(s => t.checked ? selected.add(s.key) : selected.delete(s.key)); renderLibRows(); return; }
    const row = t.closest('#pvRows tr[data-k]');
    if (row && t.type === 'checkbox') { const k = row.dataset.k; t.checked ? selected.add(k) : selected.delete(k); return; }
    if (!a) return;
    try {
      if (a === 'new') { ws = newWorkspace(); wsPath = null; songs = []; byKey.clear(); renderLib(); if (await fs.pickFolder().then(d => d && (ws.sources.push({ type: 'folder', path: d }), true))) await scanWorkspace(); }
      else if (a === 'open') { const p = await fs.pickOpenWorkspace(); if (p) await openWorkspace(p); }
      else if (a === 'save') { if (await saveWorkspace(true)) api.toast('工作區已儲存'); }
      else if (a === 'addFolder') { const d = await fs.pickFolder(); if (d && !ws.sources.some(s => s.path === d)) { ws.sources.push({ type: 'folder', path: d }); touched(); await scanWorkspace(); } }
      else if (a === 'addFiles') { const fl = await fs.pickAudioFiles(); for (const p of fl) if (!ws.sources.some(s => s.path === p)) ws.sources.push({ type: 'file', path: p }); if (fl.length) { touched(); await scanWorkspace(); } }
      else if (a === 'rescan') await scanWorkspace();
      else if (a === 'pickOut') await pickOutput();
      else if (a === 'showOut') fs.showInFolder(ws.output.dir);
      else if (a === 'convSel') convertBatch(selList().filter(s => s.status !== 'busy'));
      else if (a === 'convAll') convertBatch(songs.filter(s => s.status !== 'done' && s.status !== 'busy'));
      else if (a === 'stop') { if (converting) converting.stop = true; setProg('會在這首轉完後停止…', 1); }
      else if (a === 'queueSel') { const l = selList(); if (!l.length) api.toast('請先勾選歌曲'); else enqueue(l.map(s => s.key)); }
      else if (a === 'playSel') { const l = selList(); if (!l.length) api.toast('請先勾選歌曲'); else { enqueue(l.map(s => s.key), true); showPage('now'); } }
      else if (a === 'queueAllWeb') { if (songs.length) enqueue(songs.map(s => s.key)); }
    } catch (err) { api.toast(err.message); }
  });
  root.addEventListener('dblclick', e => { const row = e.target.closest('#pvRows tr[data-k]'); if (!row) return; const k = row.dataset.k, i = queue.indexOf(k); if (i >= 0) playAt(i); else enqueue([k], true); });
  root.addEventListener('change', async e => {
    const k = e.target.dataset?.k; if (!k || !ws || !e.target.closest('#pvLibDesk')) return;
    if (k === 'layout') ws.output.layout = e.target.value;
    else if (k === 'rpm') ws.convert.rpm = Math.max(60, Math.min(240, Math.round(+e.target.value || 160)));
    else if (k === 'normalize') ws.convert.normalize = e.target.checked;
    else ws.convert[k] = e.target.value;
    touched(); if (k !== 'layout') await scanWorkspace();   // 轉檔設定改了，舊的會變成「設定已變更」
  });

  return { open, close, ready, isOpen: () => root.classList.contains('on') };
}
