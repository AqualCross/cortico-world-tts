/**
 * 文本转语音的 WebUI 面板（浏览器侧 bundle）。
 *
 * 宿主按 `/assets/extensions/<包>/<版本>/dist/webui.js` 取这个文件，
 * 直接 `import()` 它的 default 导出；所以它是纯浏览器 ES 模块：
 * 不 import 任何东西（`cortico/*` 在这里只允许 `import type`），只用 ctx.ui。
 */

const STYLE = `
.vs-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.vs-item { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.vs-item.vs-hit { outline: 2px solid #4aa8ff; outline-offset: 2px; }
.vs-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.vs-name { font-weight: 600; word-break: break-word; }
.vs-sub { opacity: .65; font-size: 11px; word-break: break-all; }
.vs-text { font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.vs-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 2px; }
.vs-empty { padding: 22px 8px; text-align: center; opacity: .8; }
.vs-conn { display: flex; gap: 6px; align-items: center; }
.vs-testrow { display: flex; gap: 8px; align-items: center; }
`;

const ZH = {
  clipsTitle: '作品',
  clipsEn: 'Clips',
  clipsDesc: '合成过的语音；可试听、复制路径。',
  statusTitle: '状态',
  statusEn: 'Status',
  statusDesc: '接口、密钥与磁盘占用。',
  refresh: '刷新',
  openFolder: '打开文件夹',
  openFolderBad: '打不开文件夹',
  selfTest: '插入自检音频',
  selfTestDone: '自检音频已写入：落盘 → 索引 → 取回 → 试听，这条路是通的。',
  selfTestBad: '自检失败',
  clearAll: '清空语音',
  clearAsk: '清空所有语音？',
  clearBody: '索引和磁盘上的音频都会被删掉，不能撤销。',
  cleared: '清空完成',
  remove: '删除',
  removeAsk: '删掉这段语音？',
  removeBody: '文件会从磁盘上删除。',
  removed: '已删除',
  play: '试听',
  playBad: '播放失败',
  copyPath: '复制路径',
  count: '语音',
  bytes: '占用',
  shown: '本页显示',
  connecting: '实时推送未连接',
  connected: '实时推送中',
  busier: '处理中…',
  empty: '还没有作品。让桌宠合成一段，或者点「插入自检音频」看看链路通不通。',
  loadBad: '读不到语音列表',
  unknown: '未知',
  keyField: '语音接口密钥',
  keyHint: '密钥只写进 .env。',
  keyPlaceholder: '粘贴 API key 后保存',
  keyPlaceholderSet: '已配置；粘贴新的可以覆盖',
  keyEmpty: '先粘贴密钥',
  keySaved: '密钥已保存',
  keyCleared: '密钥已清除',
  clearKey: '清除密钥',
  clearKeyBody: '会把 .env 里那一行置空。之后合成会直接失败，直到重新填入。',
  saveKey: '保存密钥',
  testTitle: '试听合成',
  testDesc: '用当前配置合成一句并试听，同时存进列表。',
  testSample: '你好，我是本鲸。这是一段试听。',
  testRun: '合成并试听',
  testDone: '合成完成',
  testBad: '合成失败',
  endpoint: '接口地址',
  protocol: '接口协议',
  model: '模型',
  params: '默认参数',
  dir: '目录',
  timeout: '单次超时',
  keyName: '密钥变量名',
  keyState: '密钥',
  keyFrom: '密钥来源',
  fromBot: '部署 .env',
  fromProvider: '端点 .env',
  setLabel: '已填',
  unsetLabel: '未填',
  voice: '音色',
  instruction: '默认指令',
  langHint: '语言提示',
  seed: '随机种子',
  indexFile: '索引文件',
  keep: '保留条数',
  lastItem: '最近一段',
  lastError: '最近错误',
  none: '无',
  runtime: '运行时',
  copyDir: '复制目录',
};

const EN = {
  clipsTitle: 'Clips',
  clipsEn: '',
  clipsDesc: 'Everything synthesized so far; listen or copy the path.',
  statusTitle: 'Status',
  statusEn: '',
  statusDesc: 'Endpoint, key and disk usage.',
  refresh: 'Refresh',
  openFolder: 'Open folder',
  openFolderBad: 'Could not open the folder',
  selfTest: 'Insert self-test clip',
  selfTestDone: 'Self-test clip written: save → index → fetch → play all work.',
  selfTestBad: 'Self-test failed',
  clearAll: 'Clear all',
  clearAsk: 'Clear every clip?',
  clearBody: 'Both the index and the files on disk are removed. This cannot be undone.',
  cleared: 'Cleared',
  remove: 'Delete',
  removeAsk: 'Delete this clip?',
  removeBody: 'The file is removed from disk.',
  removed: 'Deleted',
  play: 'Listen',
  playBad: 'Could not play',
  copyPath: 'Copy path',
  count: 'Clips',
  bytes: 'On disk',
  shown: 'Shown',
  connecting: 'Live feed disconnected',
  connected: 'Live feed connected',
  busier: 'Working…',
  empty: 'No clips yet. Ask the pet to synthesize one, or use "Insert self-test clip" to check the chain.',
  loadBad: 'Could not read the clip list',
  unknown: 'unknown',
  keyField: 'TTS API key',
  keyHint: 'The key is written to .env.',
  keyPlaceholder: 'Paste the API key, then save',
  keyPlaceholderSet: 'Configured; paste a new one to replace it',
  keyEmpty: 'Paste the key first',
  keySaved: 'Key saved',
  keyCleared: 'Key cleared',
  clearKey: 'Clear key',
  clearKeyBody: 'Empties that line in .env. Synthesis will fail until a key is entered again.',
  saveKey: 'Save key',
  testTitle: 'Test synthesis',
  testDesc: 'Synthesize one line with the current settings and listen; it is kept in the list.',
  testSample: 'Hello, this is the pet speaking. Testing, one two three.',
  testRun: 'Synthesize and listen',
  testDone: 'Synthesized',
  testBad: 'Synthesis failed',
  endpoint: 'Endpoint',
  protocol: 'Protocol',
  model: 'Model',
  params: 'Defaults',
  dir: 'Folder',
  timeout: 'Timeout',
  keyName: 'Secret name',
  keyState: 'API key',
  keyFrom: 'Key source',
  fromBot: 'deployment .env',
  fromProvider: 'endpoint .env',
  setLabel: 'set',
  unsetLabel: 'missing',
  voice: 'Voice',
  instruction: 'Default instruction',
  langHint: 'Language hint',
  seed: 'Seed',
  indexFile: 'Index file',
  keep: 'Keep',
  lastItem: 'Latest',
  lastError: 'Last error',
  none: 'none',
  runtime: 'Runtime',
  copyDir: 'Copy folder',
};

const text = (language) => (language === 'en' ? EN : ZH);

/** 异常一律收敛成一行字。 */
function message(err) {
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  return String(err);
}

function injectStyle(ctx) {
  const el = ctx.ui.h('style');
  el.textContent = STYLE;
  ctx.root.appendChild(el);
}

/**
 * 试听：一次只放一段，id → object URL 缓存在面板生命周期里。
 * 复用同一只 Audio，换源即停旧段。
 */
function makePlayer(ctx) {
  let audio = null;
  const urls = new Map();
  const urlFor = (id) => {
    const hit = urls.get(id);
    if (hit) return Promise.resolve(hit);
    return ctx.invokeBinary('blob', [id]).then((blob) => {
      const url = URL.createObjectURL(blob);
      urls.set(id, url);
      ctx.own({ dispose: () => { try { URL.revokeObjectURL(url); } catch (e) { /* 撤销过就算了 */ } } });
      return url;
    });
  };
  const stop = () => {
    if (!audio) return;
    try {
      audio.pause();
    } catch (e) { /* 暂停失败无所谓 */ }
  };
  const play = async (id) => {
    const url = await urlFor(id);
    if (ctx.signal.aborted) return;
    if (!audio) {
      audio = new Audio();
      ctx.own({ dispose: () => stop() });
    }
    stop();
    audio.src = url;
    await audio.play();
  };
  const forget = (id) => {
    const url = urls.get(id);
    if (!url) return;
    urls.delete(id);
    try {
      URL.revokeObjectURL(url);
    } catch (e) { /* 撤销过就算了 */ }
  };
  const forgetAll = () => {
    for (const id of [...urls.keys()]) forget(id);
  };
  return { play, stop, forget, forgetAll };
}

// ---------------------------------------------------------------------------
// 语音页
// ---------------------------------------------------------------------------

function clipsPanel(ctx) {
  const tx = text(ctx.language);
  injectStyle(ctx);

  const sheet = ctx.ui.sheet({ title: tx.clipsTitle, en: tx.clipsEn || undefined, desc: tx.clipsDesc });
  ctx.root.appendChild(sheet.el);
  const body = sheet.body;

  const stats = ctx.ui.statgrid();
  body.appendChild(stats);

  const rowbar = ctx.ui.rowbar();
  const connBox = ctx.ui.h('div', 'vs-conn');
  rowbar.appendChild(connBox);
  rowbar.appendChild(ctx.ui.h('span', 'grow'));
  body.appendChild(rowbar);

  const actions = ctx.ui.actions();
  body.appendChild(actions);

  const note = ctx.ui.msgline('');
  body.appendChild(note);

  const list = ctx.ui.h('div', 'vs-list');
  body.appendChild(list);

  const player = makePlayer(ctx);
  let focusId = '';
  let lastCount = -1;
  let seq = 0;

  const setConn = (label, tone) => {
    connBox.textContent = '';
    connBox.appendChild(ctx.ui.pill(label, tone));
  };
  const say = (line) => {
    note.textContent = line || '';
  };

  const render = (data) => {
    const items = Array.isArray(data?.items) ? data.items : [];
    lastCount = typeof data?.count === 'number' ? data.count : items.length;
    stats.replaceChildren(
      ctx.ui.stat({ k: tx.count, v: String(lastCount) }),
      ctx.ui.stat({ k: tx.bytes, v: ctx.ui.fmt.bytes(data?.totalBytes ?? 0) }),
      ctx.ui.stat({ k: tx.shown, v: String(items.length) }),
    );
    list.replaceChildren();
    if (!items.length) {
      list.appendChild(ctx.ui.h('div', 'vs-empty', tx.empty));
      return;
    }
    for (const item of items) list.appendChild(card(item));
    if (focusId) {
      const hit = list.querySelector(`[data-id="${focusId}"]`);
      if (hit) {
        hit.classList.add('vs-hit');
        hit.scrollIntoView({ block: 'nearest' });
      }
      focusId = '';
    }
  };

  const card = (item) => {
    const el = ctx.ui.h('div', 'vs-item');
    el.dataset.id = item.id;

    const head = ctx.ui.h('div', 'vs-head');
    head.appendChild(ctx.ui.h('span', 'vs-name', item.note || item.text || item.file));
    head.appendChild(ctx.ui.h('span', 'vs-sub', item.file));
    el.appendChild(head);

    const duration = typeof item.seconds === 'number' ? ctx.ui.fmt.duration(item.seconds * 1000) : '—';
    el.appendChild(ctx.ui.h('div', 'vs-sub', [
      item.id,
      item.voice || '—',
      item.model || '—',
      duration,
      ctx.ui.fmt.bytes(item.bytes),
      ctx.ui.fmt.clock(item.createdAt),
    ].join(' · ')));

    if (item.text) el.appendChild(ctx.ui.h('div', 'vs-text', item.text));

    const bar = ctx.ui.h('div', 'vs-row');
    bar.append(
      ctx.ui.button(tx.play, { size: 'sm', onClick: () => { void listen(item); } }),
      ctx.ui.copyButton(item.path, { label: tx.copyPath }),
      ctx.ui.button(tx.remove, { variant: 'danger', size: 'sm', onClick: () => { void drop(item); } }),
    );
    el.appendChild(bar);
    return el;
  };

  const listen = async (item) => {
    try {
      await player.play(item.id);
    } catch (err) {
      ctx.ui.toast(`${tx.playBad}：${message(err)}`, 'bad');
    }
  };

  const reload = async (busy) => {
    const mine = ++seq;
    const release = busy ? ctx.ui.busy(tx.busier, tx.refresh) : null;
    try {
      const data = await ctx.invoke('list', [120]);
      if (mine !== seq || ctx.signal.aborted) return;
      render(data);
      say('');
    } catch (err) {
      if (mine !== seq) return;
      say(`${tx.loadBad}：${message(err)}`);
      ctx.ui.toast(`${tx.loadBad}：${message(err)}`, 'bad');
    } finally {
      if (release) release.dispose();
    }
  };

  const drop = async (item) => {
    const ok = await ctx.ui.confirm({ title: tx.removeAsk, body: `${tx.removeBody}\n${item.file}`, danger: true });
    if (!ok) return;
    try {
      await ctx.invoke('remove', [item.id]);
      player.forget(item.id);
      await reload(false);
      ctx.ui.toast(tx.removed, 'ok');
    } catch (err) {
      ctx.ui.toast(message(err), 'bad');
    }
  };

  const clearAll = async () => {
    const ok = await ctx.ui.confirm({ title: tx.clearAsk, body: tx.clearBody, danger: true });
    if (!ok) return;
    try {
      player.stop();
      await ctx.invoke('clear', []);
      player.forgetAll();
      await reload(false);
      ctx.ui.toast(tx.cleared, 'ok');
    } catch (err) {
      ctx.ui.toast(message(err), 'bad');
    }
  };

  const openFolder = async () => {
    try {
      const res = await ctx.invoke('openFolder', []);
      if (!res?.ok) ctx.ui.toast(res?.detail || tx.openFolderBad, 'bad');
    } catch (err) {
      ctx.ui.toast(message(err), 'bad');
    }
  };

  const selfTest = async () => {
    const release = ctx.ui.busy(tx.busier, tx.selfTest);
    try {
      const res = await ctx.invoke('selftest', []);
      if (res?.item?.id) focusId = res.item.id;
      await reload(false);
      if (res?.item?.id) {
        try {
          await player.play(res.item.id);
        } catch (err) {
          /* 自检的播放失败留给 toasts，不算自检失败 */
        }
      }
      ctx.ui.toast(tx.selfTestDone, 'ok');
    } catch (err) {
      ctx.ui.toast(`${tx.selfTestBad}：${message(err)}`, 'bad');
    } finally {
      release.dispose();
    }
  };

  actions.append(
    ctx.ui.button(tx.refresh, { size: 'sm', onClick: () => { void reload(true); } }),
    ctx.ui.button(tx.openFolder, { size: 'sm', onClick: () => { void openFolder(); } }),
    ctx.ui.button(tx.selfTest, { size: 'sm', onClick: () => { void selfTest(); } }),
    ctx.ui.button(tx.clearAll, { variant: 'danger', size: 'sm', onClick: () => { void clearAll(); } }),
  );

  setConn(tx.connecting, 'plain');
  ctx.own(ctx.stream({
    open: () => setConn(tx.connected, 'on'),
    close: () => setConn(tx.connecting, 'off'),
    message: (raw) => {
      let frame = null;
      try {
        frame = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      switch (frame.t) {
        case 'ready':
          setConn(`${tx.connected} · ${frame.count ?? 0}`, 'on');
          break;
        case 'item':
          if (frame.item?.id) focusId = frame.item.id;
          void reload(false);
          break;
        case 'removed':
          if (frame.id) player.forget(frame.id);
          void reload(false);
          break;
        case 'cleared':
          player.stop();
          player.forgetAll();
          void reload(false);
          break;
        case 'error':
          ctx.ui.toast(frame.message || tx.unknown, 'bad');
          break;
        default:
          break;
      }
    },
  }));

  // 推送关掉时页面也能自己追上：只在条数变了以后重建。
  ctx.interval(() => {
    ctx.invoke('list', [1])
      .then((data) => {
        if (typeof data?.count === 'number' && data.count !== lastCount) void reload(false);
      })
      .catch(() => { /* 面板自己会显示错误，这里别刷屏 */ });
  }, 30000);

  void reload(true);
}

// ---------------------------------------------------------------------------
// 状态页
// ---------------------------------------------------------------------------

function statusPanel(ctx) {
  const tx = text(ctx.language);
  injectStyle(ctx);

  const sheet = ctx.ui.sheet({ title: tx.statusTitle, en: tx.statusEn || undefined, desc: tx.statusDesc });
  ctx.root.appendChild(sheet.el);
  const body = sheet.body;

  const stats = ctx.ui.statgrid();
  body.appendChild(stats);

  const keyCard = ctx.ui.section(tx.keyField, tx.keyHint);
  const keyRow = ctx.ui.rowbar();
  const keyInput = ctx.ui.input({ type: 'password', placeholder: tx.keyPlaceholder, cls: 'mono' });
  keyInput.style.minWidth = '280px';
  keyRow.append(
    keyInput,
    ctx.ui.button(tx.saveKey, { variant: 'primary', size: 'sm', onClick: () => { void saveKey(); } }),
    ctx.ui.button(tx.clearKey, { size: 'sm', onClick: () => { void clearKey(); } }),
  );
  keyCard.appendChild(keyRow);
  body.appendChild(keyCard);

  const player = makePlayer(ctx);

  const testCard = ctx.ui.section(tx.testTitle, tx.testDesc);
  const testRow = ctx.ui.h('div', 'vs-testrow');
  const testInput = ctx.ui.input({ type: 'text' });
  testInput.value = tx.testSample;
  testInput.style.flex = '1 1 auto';
  testInput.style.minWidth = '0';
  testRow.append(
    testInput,
    ctx.ui.button(tx.testRun, { variant: 'primary', size: 'sm', onClick: () => { void runTest(); } }),
  );
  testCard.appendChild(testRow);
  const testNote = ctx.ui.msgline('');
  testCard.appendChild(testNote);
  body.appendChild(testCard);

  const kvBox = ctx.ui.h('div');
  body.appendChild(kvBox);

  const actions = ctx.ui.actions();
  body.appendChild(actions);

  const note = ctx.ui.msgline('');
  body.appendChild(note);

  let currentDir = '';
  let lastClipId = '';

  const render = (s) => {
    currentDir = String(s?.dir ?? '');
    stats.replaceChildren(
      ctx.ui.stat({ k: tx.count, v: String(s?.count ?? 0) }),
      ctx.ui.stat({ k: tx.bytes, v: ctx.ui.fmt.bytes(s?.totalBytes ?? 0) }),
      ctx.ui.stat({ k: tx.keyState, v: ctx.ui.pill(s?.keySet ? tx.setLabel : tx.unsetLabel, s?.keySet ? 'on' : 'off') }),
      ctx.ui.stat({ k: tx.voice, v: String(s?.voice || '—') }),
    );
    kvBox.replaceChildren(ctx.ui.kv([
      { k: tx.protocol, v: s?.protocol || '—' },
      { k: tx.endpoint, v: s?.baseUrl || '—' },
      { k: tx.model, v: s?.model || '—' },
      { k: tx.params, v: `${s?.voice || '—'} · ${s?.format || '—'} · ${s?.sampleRate ? `${s.sampleRate} Hz` : '—'}` },
      { k: tx.instruction, v: s?.instruction || tx.none },
      { k: tx.langHint, v: s?.languageHints || tx.none },
      { k: tx.seed, v: s?.seed == null ? tx.none : String(s.seed) },
      { k: tx.timeout, v: ctx.ui.fmt.duration(s?.timeoutMs ?? 0) },
      { k: tx.keyName, v: ctx.ui.h('span', 'mono', s?.keyName || '') },
      {
        k: tx.keyFrom,
        v: s?.keyFrom === 'bot'
          ? tx.fromBot
          : s?.keyFrom === 'provider'
            ? tx.fromProvider + (s?.keyProvider ? ` · ${s.keyProvider}` : '')
            : tx.none,
      },
      { k: tx.dir, v: ctx.ui.h('span', 'mono', currentDir) },
      { k: tx.indexFile, v: ctx.ui.h('span', 'mono', s?.indexFile || '') },
      { k: tx.keep, v: String(s?.keep ?? 0) },
      { k: tx.lastItem, v: s?.lastItemAt ? ctx.ui.fmt.clock(s.lastItemAt) : tx.none },
      { k: tx.lastError, v: s?.lastError || tx.none },
      { k: tx.runtime, v: `Node ${s?.node ?? '?'} · ${s?.platform ?? '?'}` },
    ]));
    keyInput.placeholder = s?.keySet ? tx.keyPlaceholderSet : tx.keyPlaceholder;
  };

  const load = async (busy) => {
    const release = busy ? ctx.ui.busy(tx.busier, tx.statusTitle) : null;
    try {
      const s = await ctx.invoke('state', []);
      if (ctx.signal.aborted) return;
      render(s);
    } catch (err) {
      note.textContent = message(err);
      ctx.ui.toast(message(err), 'bad');
    } finally {
      if (release) release.dispose();
    }
  };

  const saveKey = async () => {
    const value = keyInput.value.trim();
    if (!value) {
      ctx.ui.toast(tx.keyEmpty, 'bad');
      return;
    }
    const release = ctx.ui.busy(tx.busier, tx.saveKey);
    try {
      const s = await ctx.invoke('setKey', [value]);
      keyInput.value = '';
      render(s);
      note.textContent = tx.keySaved;
      ctx.ui.toast(tx.keySaved, 'ok');
    } catch (err) {
      ctx.ui.toast(message(err), 'bad');
    } finally {
      release.dispose();
    }
  };

  const clearKey = async () => {
    const ok = await ctx.ui.confirm({ title: tx.clearKey, body: tx.clearKeyBody, danger: true });
    if (!ok) return;
    try {
      const s = await ctx.invoke('clearKey', []);
      render(s);
      note.textContent = tx.keyCleared;
      ctx.ui.toast(tx.keyCleared, 'ok');
    } catch (err) {
      ctx.ui.toast(message(err), 'bad');
    }
  };

  const runTest = async () => {
    const line = testInput.value.trim() || tx.testSample;
    const release = ctx.ui.busy(tx.busier, tx.testRun);
    try {
      const res = await ctx.invoke('test', [line]);
      lastClipId = String(res?.item?.id ?? '');
      const bits = [
        res?.item?.voice || '',
        typeof res?.item?.seconds === 'number' ? ctx.ui.fmt.duration(res.item.seconds * 1000) : '',
        res?.item?.bytes ? ctx.ui.fmt.bytes(res.item.bytes) : '',
      ].filter(Boolean);
      testNote.textContent = `${tx.testDone}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
      ctx.ui.toast(tx.testDone, 'ok');
      await load(false);
      if (lastClipId) {
        try {
          await player.play(lastClipId);
        } catch (err) {
          ctx.ui.toast(`${tx.playBad}：${message(err)}`, 'bad');
        }
      }
    } catch (err) {
      testNote.textContent = `${tx.testBad}：${message(err)}`;
      ctx.ui.toast(`${tx.testBad}：${message(err)}`, 'bad');
    } finally {
      release.dispose();
    }
  };

  actions.append(
    ctx.ui.button(tx.refresh, { size: 'sm', onClick: () => { void load(true); } }),
    ctx.ui.copyButton(() => currentDir, { label: tx.copyDir }),
  );

  void load(true);
}

export default {
  panels: {
    clips: { mount: clipsPanel },
    status: { mount: statusPanel },
  },
};
