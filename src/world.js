/**
 * 语音工坊 World。
 *
 * 三件事：调阿里云百炼的 Qwen-Audio-TTS 接口把文字合成语音、把音频落盘并记进索引、
 * 把它作为工具回执的 blob 交给 Core（于是进模型上下文与日志；句柄可以直接交给
 * 别的渠道工具用）。
 *
 * 这里**不播放**任何声音，也不替用户发送：出声与发送都是另外的事，谁有工具谁做。
 * 只依赖框架契约与 Node 内置模块，服务端不需要编译。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { TtsApiError, synthesizeOpenAiSpeech, synthesizeSpeech } from './api.js';
import { Clips } from './clips.js';
import { DEFAULTS, ID, configGroup, text } from './config.js';
import { formatKb, formatSeconds, sampleWav, wavDuration } from './wav.js';

const msg = (err) => (err instanceof Error ? err.message : String(err));
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const oneLine = (value, max = 160) => {
  const s = asText(value).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export class TtsWorld {
  #host = null;
  #streams = new Set();
  #clips = null;
  #busy = 0;
  #lastError = '';
  #lastItemAt = '';

  constructor(opts = {}) {
    this.id = ID;
    this.cfg = opts.cfg ?? { ...DEFAULTS };
    this.dataDir = opts.dataDir ?? process.cwd();
    this.botDir = opts.botDir ?? process.cwd();
    this.secret = typeof opts.secret === 'function' ? opts.secret : () => '';
    this.storeSecret = typeof opts.storeSecret === 'function' ? opts.storeSecret : () => {};
    this.language = 'zh';
  }

  // -------------------------------------------------------------------------
  // 配置：config.json 的段被控制台热改，每次用时现读
  // -------------------------------------------------------------------------

  #raw(key) {
    const value = this.cfg?.[key];
    return value === undefined || value === null ? DEFAULTS[key] : value;
  }

  #str(key) {
    const value = this.#raw(key);
    const s = typeof value === 'string' ? value.trim() : '';
    return s || String(DEFAULTS[key] ?? '');
  }

  #num(key, min, max) {
    const n = Number(this.#raw(key));
    if (!Number.isFinite(n)) return Number(DEFAULTS[key]) || min;
    return Math.min(Math.max(n, min), max);
  }

  #bool(key) {
    const value = this.#raw(key);
    return typeof value === 'boolean' ? value : Boolean(DEFAULTS[key]);
  }

  #text() {
    return text(this.language);
  }

  /** `worlds.tts.languageHints`：逗号/空格分隔，空 = 不发这个参数。 */
  #languageHints() {
    return String(this.#raw('languageHints') ?? '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** `worlds.tts.protocol`：dashscope = 百炼 SpeechSynthesizer 形状；openai = /v1/audio/speech。 */
  #protocol() {
    return this.#str('protocol') === 'openai' ? 'openai' : 'dashscope';
  }

  /** `worlds.tts.seed`：0–65535；留空（null）= 不发，用接口默认。 */
  #seed() {
    const raw = this.#raw('seed');
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(Math.max(Math.round(n), 0), 65535);
  }

  /** 语音根目录：配置了就用配置的（相对路径按 bot 目录解析），否则 <dataDir>/tts。 */
  dir() {
    const raw = String(this.#raw('saveDir') ?? '').trim();
    if (!raw) return join(this.dataDir, 'tts');
    return isAbsolute(raw) ? raw : resolve(this.botDir, raw);
  }

  /**
   * 密钥只在内存里过一手，不写 config.json。
   *
   * 先问部署 .env（`ctx.secret`），再退到同级 `providers/<端点>/.env`：
   * 机器上往往已经为别的模型建过端点，密钥名直接填那个就行，不必抄第二份。
   */
  #keyLookup() {
    const name = this.#str('apiKeySecret');
    if (!name) return { name, value: '', from: '', provider: '' };
    let own = '';
    try {
      own = String(this.secret(name) ?? '').trim();
    } catch {
      own = '';
    }
    if (own) return { name, value: own, from: 'bot', provider: '' };
    const found = this.#keyFromProviders(name);
    return {
      name,
      value: found.value,
      from: found.value ? 'provider' : '',
      provider: found.provider,
    };
  }

  /** 扫 `<botDir>/../providers/<端点>/.env`，找同名变量。 */
  #keyFromProviders(name) {
    const root = resolve(this.botDir, '..', 'providers');
    const pattern = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(\\S+)`, 'm');
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const hit = pattern.exec(readFileSync(join(root, entry.name, '.env'), 'utf8'));
        if (hit) return { value: hit[1], provider: entry.name };
      }
    } catch {
      // 没有 providers 目录、或某个端点没有 .env：当作没找到。
    }
    return { value: '', provider: '' };
  }

  apiKey() {
    return this.#keyLookup().value;
  }

  #clipsFor() {
    const dir = this.dir();
    const keep = this.#num('keep', 0, 5000);
    if (!this.#clips || this.#clips.dir !== dir) this.#clips = new Clips({ dir, keep });
    else this.#clips.keep = keep;
    return this.#clips;
  }

  #envState() {
    const t = this.#text();
    const protocol = this.#protocol();
    const baseUrl = this.#str('baseUrl');
    const model = this.#str('model');
    const voice = this.#str('voice');
    const key = this.#keyLookup();
    const name = key.name;
    const keySet = Boolean(key.value);
    const extra = { keyFrom: key.from, keyProvider: key.provider, model, voice, protocol };
    if (!baseUrl) return { ok: false, baseUrl, model, voice, name, keySet, detail: t.readyNoBase, ...extra };
    // openai 兼容的本地服务通常不需要 key；dashscope 必需要有。
    if (protocol === 'dashscope' && !keySet) {
      return { ok: false, baseUrl, model, voice, name, keySet, detail: t.readyNoKey, ...extra };
    }
    if (!voice) return { ok: false, baseUrl, model, voice, name, keySet, detail: t.readyNoVoice, ...extra };
    return { ok: true, baseUrl, model, voice, name, keySet, detail: t.readyOk(model, voice), ...extra };
  }

  // -------------------------------------------------------------------------
  // 提示词
  // -------------------------------------------------------------------------

  /** 不往系统前缀里加任何东西：工具自身的描述就够了。 */
  envPromptVars() {
    return null;
  }

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------

  tools() {
    return [
      {
        name: 'tts_speak',
        tags: ['act'],
        interruptible: true,
        description: 'Synthesize speech from text. The audio is saved to disk and attached to the conversation; nothing is played or sent.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', maxLength: 2000, description: 'What to say.' },
            note: { type: 'string', description: 'Short label for the clip list.' },
            voice: { type: 'string', description: 'Voice for this call; must belong to the configured model.' },
            instruction: { type: 'string', description: 'Emotion, dialect or role hint.' },
          },
          required: ['text'],
        },
        handler: async (args, ctx) => this.#speak(args ?? {}, ctx),
      },
    ];
  }

  async #speak(args, ctx) {
    const rawText = asText(args.text);
    if (!rawText) return { text: '[tts_speak 没执行] text 是空的。不想合成语音就别调用。', failed: true };
    const protocol = this.#protocol();
    const keyName = this.#str('apiKeySecret');
    const key = this.apiKey();
    if (protocol === 'dashscope' && !key) {
      return {
        text: `[tts_speak 没执行] 没有配置 ${keyName}：请在控制台「语音工坊 → 状态」里填入密钥（或在部署 .env 里写 ${keyName}=...）。`,
        failed: true,
      };
    }
    const voice = asText(args.voice) || this.#str('voice');
    if (!voice) {
      return {
        text: '[tts_speak 没执行] 没有可选音色：请在控制台「语音工坊 → 状态」或 worlds.tts.voice 里选一个。',
        failed: true,
      };
    }
    const model = this.#str('model');
    const instruction = asText(args.instruction) || this.#str('instruction');
    const note = asText(args.note);
    const sampleRate = this.#num('sampleRate', 8000, 48000);
    this.#busy += 1;
    try {
      const res = protocol === 'openai'
        ? await synthesizeOpenAiSpeech({
            baseUrl: this.#str('baseUrl'),
            apiKey: key,
            model,
            text: rawText,
            voice,
            languageHints: this.#languageHints(),
            format: this.#str('format'),
            sampleRate,
            timeoutMs: this.#num('timeoutMs', 10000, 900000),
            signal: ctx?.signal,
          })
        : await synthesizeSpeech({
            baseUrl: this.#str('baseUrl'),
            apiKey: key,
            model,
            text: rawText,
            voice,
            instruction,
            languageHints: this.#languageHints(),
            seed: this.#seed(),
            format: this.#str('format'),
            sampleRate,
            timeoutMs: this.#num('timeoutMs', 10000, 900000),
            signal: ctx?.signal,
          });
      const seconds = wavDuration(res.bytes);
      const { item, warning } = this.#saveSafe({
        bytes: res.bytes,
        mime: res.mime,
        seconds,
        text: rawText,
        note,
        voice,
        model,
        instruction,
        format: res.format,
        sampleRate,
        usage: res.usage,
        source: 'api',
      });
      return this.#outcome({
        verb: '合成好了。',
        bytes: res.bytes,
        mime: res.mime,
        seconds,
        text: rawText,
        note,
        voice,
        model,
        format: res.format,
        item,
        warning,
      });
    } catch (err) {
      return this.#failure('tts_speak', err);
    } finally {
      this.#busy -= 1;
    }
  }

  #failure(tool, err) {
    const detail = err instanceof TtsApiError ? err.message : msg(err);
    this.#lastError = `${new Date().toISOString()} ${detail}`;
    this.#emit({ t: 'error', message: detail, tool }, true);
    return { text: `[${tool} 失败] ${detail}`, failed: true };
  }

  // -------------------------------------------------------------------------
  // 落盘与回执
  // -------------------------------------------------------------------------

  #saveSafe(payload) {
    try {
      return { item: this.#storeBytes(payload), warning: '' };
    } catch (err) {
      return { item: null, warning: `（存盘失败，音频只在这次回执里：${msg(err)}）` };
    }
  }

  #storeBytes(payload) {
    const item = this.#clipsFor().add(payload);
    this.#lastItemAt = item.createdAt;
    this.#emit({ t: 'item', item });
    return item;
  }

  /** 工具回执：文本给模型读，blob 交给 Core 进上下文。 */
  #outcome(spec) {
    const bytes = spec.bytes;
    const kb = formatKb(bytes.length);
    const name = spec.item?.file ?? `voice-${Date.now().toString(36)}.wav`;
    const lines = [spec.verb];
    if (spec.item) lines.push(`文件：${spec.item.path}`);
    const bits = [
      spec.voice,
      spec.model,
      spec.format,
      spec.seconds ? formatSeconds(spec.seconds) : '',
      kb,
    ].filter(Boolean);
    lines.push(`参数：${bits.join(' · ')}`);
    if (spec.note) lines.push(`名字：${spec.note}`);
    lines.push(`文字：${oneLine(spec.text, 200)}`);
    if (spec.warning) lines.push(spec.warning);
    return {
      text: lines.join('\n'),
      blobs: [{
        bytes,
        mime: spec.mime,
        name,
        fallbackText: `[语音 ${name}${spec.seconds ? ` ${formatSeconds(spec.seconds)}` : ''}｜${spec.voice}｜${kb}]`,
      }],
    };
  }

  #counts() {
    const clips = this.#clipsFor();
    return { count: clips.count, totalBytes: clips.totalBytes };
  }

  // -------------------------------------------------------------------------
  // 控制台
  // -------------------------------------------------------------------------

  console(language = 'zh') {
    this.language = language === 'en' ? 'en' : 'zh';
    const t = this.#text();
    const env = this.#envState();
    const clips = this.#clipsFor();
    return {
      label: t.label,
      lamps: [{
        label: t.lamp,
        state: env.ok ? 'online' : (env.baseUrl ? 'error' : 'offline'),
        hint: env.detail,
      }],
      badges: [
        { label: t.badgeClips, value: String(clips.count), tone: clips.count ? 'on' : 'off' },
        { label: t.badgeKey, value: env.keySet ? t.keySet : t.keyUnset, tone: env.keySet ? 'on' : 'off' },
        { label: t.badgeVoice, value: env.voice || '—', tone: env.voice ? 'on' : 'off' },
      ],
      panels: [
        { id: 'clips', title: t.panelClipsTitle, description: t.panelClipsDesc, getMethods: ['list'] },
        { id: 'status', title: t.panelStatusTitle, description: t.panelStatusDesc, getMethods: ['state'] },
      ],
      config: [configGroup(this.language)],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      stream: (panel, socket) => this.stream(panel, socket),
    };
  }

  async invoke(panel, method, args = []) {
    const list = Array.isArray(args) ? args : [args];
    if (panel === 'clips') {
      switch (method) {
        case 'list': return this.#clipsFor().summary(list[0]);
        case 'blob': return this.#fileResult(list[0]);
        case 'remove': return this.#remove(list[0]);
        case 'clear': return this.#clearAll();
        case 'openFolder': return this.#openFolder();
        case 'selftest': return this.#selfTest();
        default: throw new Error(`未知面板方法：clips.${method}`);
      }
    }
    if (panel === 'status') {
      switch (method) {
        case 'state': return this.#state();
        case 'setKey': return this.#setKey(list[0]);
        case 'clearKey': return this.#setKey('');
        case 'test': return this.#test(list[0]);
        // 状态页的「试听合成」也要取二进制；面板路由是按面板分的，这里补一份同样的口。
        case 'blob': return this.#fileResult(list[0]);
        default: throw new Error(`未知面板方法：status.${method}`);
      }
    }
    throw new Error(`未知面板：${panel}`);
  }

  #state() {
    const env = this.#envState();
    const clips = this.#clipsFor();
    return {
      language: this.language,
      node: process.version,
      platform: process.platform,
      dir: this.dir(),
      indexFile: clips.indexFile,
      keep: clips.keep,
      count: clips.count,
      totalBytes: clips.totalBytes,
      busy: this.#busy > 0,
      lastError: this.#lastError,
      lastItemAt: this.#lastItemAt,
      protocol: this.#protocol(),
      baseUrl: env.baseUrl,
      model: env.model,
      voice: env.voice,
      instruction: this.#str('instruction'),
      languageHints: this.#str('languageHints'),
      seed: this.#seed(),
      format: this.#str('format'),
      sampleRate: this.#num('sampleRate', 8000, 48000),
      timeoutMs: this.#num('timeoutMs', 10000, 900000),
      keyName: env.name,
      keySet: env.keySet,
      keyFrom: env.keyFrom,
      keyProvider: env.keyProvider,
      detail: env.detail,
    };
  }

  #setKey(value) {
    const name = this.#str('apiKeySecret');
    const next = typeof value === 'string' ? value.trim() : '';
    try {
      this.storeSecret(name, next);
    } catch (err) {
      throw new Error(`写不进 .env：${msg(err)}`);
    }
    return { ...this.#state(), keyName: name, keySet: Boolean(next), saved: true };
  }

  #fileResult(ref) {
    const item = this.#clipsFor().get(ref);
    if (!item) throw new Error('找不到这段语音');
    let stat = null;
    try {
      stat = statSync(item.path);
    } catch {
      throw new Error('语音文件不在了');
    }
    const sha256 = createHash('sha256').update(readFileSync(item.path)).digest('hex');
    return { $file: { mime: item.mime, path: item.path, bytes: stat.size, sha256 } };
  }

  #remove(ref) {
    const id = asText(ref);
    const ok = this.#clipsFor().remove(id);
    if (ok) this.#emit({ t: 'removed', id });
    return { ok, ...this.#counts() };
  }

  #clearAll() {
    const removed = this.#clipsFor().clear();
    this.#emit({ t: 'cleared' });
    return { ok: true, removed, ...this.#counts() };
  }

  /** 离线自检：不联网也能验证落盘、索引、取回与页面显示。 */
  #selfTest() {
    const bytes = sampleWav(0.6);
    const item = this.#storeBytes({
      bytes,
      mime: 'audio/wav',
      seconds: wavDuration(bytes),
      text: '离线自检：没有调用任何语音接口。',
      note: '自检音频',
      voice: 'self-test',
      model: 'self-test',
      instruction: '',
      format: 'wav',
      sampleRate: 24000,
      usage: null,
      source: 'selftest',
    });
    return { ok: true, item, ...this.#counts() };
  }

  /** 控制台「试听合成」：拿当前配置真合成一句，并把它存进语音列表。 */
  async #test(value) {
    const line = asText(value) || '你好，这是一段试听。';
    const protocol = this.#protocol();
    const key = this.apiKey();
    if (protocol === 'dashscope' && !key) throw new Error(`没有配置 ${this.#str('apiKeySecret')}：先在这个页面填入密钥。`);
    const voice = this.#str('voice');
    if (!voice) throw new Error('先选一个音色（worlds.tts.voice）。');
    const sampleRate = this.#num('sampleRate', 8000, 48000);
    const res = protocol === 'openai'
      ? await synthesizeOpenAiSpeech({
          baseUrl: this.#str('baseUrl'),
          apiKey: key,
          model: this.#str('model'),
          text: line,
          voice,
          languageHints: this.#languageHints(),
          format: this.#str('format'),
          sampleRate,
          timeoutMs: this.#num('timeoutMs', 10000, 900000),
        })
      : await synthesizeSpeech({
          baseUrl: this.#str('baseUrl'),
          apiKey: key,
          model: this.#str('model'),
          text: line,
          voice,
          instruction: this.#str('instruction'),
          languageHints: this.#languageHints(),
          seed: this.#seed(),
          format: this.#str('format'),
          sampleRate,
          timeoutMs: this.#num('timeoutMs', 10000, 900000),
        });
    const item = this.#storeBytes({
      bytes: res.bytes,
      mime: res.mime,
      seconds: wavDuration(res.bytes),
      text: line,
      note: '控制台试听',
      voice,
      model: this.#str('model'),
      instruction: this.#str('instruction'),
      format: res.format,
      sampleRate,
      usage: res.usage,
      source: 'console-test',
    });
    return { ok: true, item, ...this.#counts() };
  }

  #openFolder() {
    const dir = this.dir();
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* 打不开就算了，返回给面板看。 */
    }
    if (process.platform !== 'win32') return { ok: false, dir, detail: '只会在 Windows 上打开资源管理器' };
    try {
      spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, dir };
    } catch (err) {
      return { ok: false, dir, detail: msg(err) };
    }
  }

  stream(panel, socket) {
    if (panel !== 'clips') {
      try {
        socket.close(`未知面板：${panel}`);
      } catch {
        /* ignore */
      }
      return;
    }
    const peer = {
      send: (frame) => {
        try {
          if (socket.open) socket.send(JSON.stringify(frame));
        } catch {
          /* 连接断了就算了，面板会自己重连。 */
        }
      },
    };
    this.#streams.add(peer);
    try {
      socket.onClose(() => this.#streams.delete(peer));
      socket.onMessage(() => { /* 面板只用 HTTP 请求，回帧不处理。 */ });
    } catch {
      /* 宿主实现不支持回调也不影响单向推送。 */
    }
    peer.send({ t: 'ready', dir: this.dir(), count: this.#clipsFor().count });
  }

  #emit(frame, force = false) {
    if (!force && !this.#bool('pushToConsole')) return;
    for (const peer of this.#streams) peer.send(frame);
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  async start(host) {
    this.#host = host;
    try {
      this.#clipsFor().ensure();
    } catch (err) {
      this.#host?.log?.warn?.('语音工坊：数据目录建不出来', { err: msg(err) });
    }
    this.#host?.log?.info?.('语音工坊已就绪', {
      dir: this.dir(),
      model: this.#str('model'),
      voice: this.#str('voice'),
      key: this.apiKey() ? '已配置' : '未配置',
    });
  }

  async stop() {
    this.#streams.clear();
    this.#host = null;
  }
}
