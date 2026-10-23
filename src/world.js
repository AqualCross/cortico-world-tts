/**
 * 文本转语音 World。
 *
 * 三件事：调阿里云百炼的 Qwen-Audio-TTS 接口把文字合成语音、把音频落盘并记进索引、
 * 把音频交给 Core（工具回执的 blob，或事件里的音频附件）。
 *
 * 合成可以同步交付（工具调用里等），也可以先回执、完成后发声音事件；还能自动把桌宠
 * 气泡里的发言合成为声音事件。事件去向由配置决定：只落事件库，或投递到模型事件流。
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
import {
  DEFAULTS,
  DELIVERIES,
  EVENT_DELIVERIES,
  EVENT_FAILED_TYPE,
  EVENT_TYPE,
  ID,
  PET_EVENT,
  configGroup,
  text,
} from './config.js';
import { speakable } from './speakable.js';
import { formatKb, formatSeconds, sampleWav, wavDuration } from './wav.js';

const msg = (err) => (err instanceof Error ? err.message : String(err));
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const oneLine = (value, max = 160) => {
  const s = asText(value).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/** 自动朗读的两次失败尝试之间至少隔这么久，免得接口挂了还逐条气泡重试。 */
const AUTO_FAIL_COOLDOWN_MS = 10000;

/** 全部工具的声明（不含 handler）；定义里的 describe 与 `tools()` 都取它。 */
export const TTS_TOOL_DECLS = [
  {
    name: 'tts_speak',
    tags: ['act'],
    interruptible: true,
    description: 'Synthesize speech from text. By default the call waits and returns the audio, which is saved to disk and attached to the conversation; with delivery=event it returns at once and the audio arrives later as an event. Nothing is played or sent.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 2000, description: 'What to say.' },
        note: { type: 'string', description: 'Short label for the clip list.' },
        voice: { type: 'string', description: 'Voice for this call; must belong to the configured model.' },
        instruction: { type: 'string', description: 'Emotion, dialect or role hint.' },
        delivery: { type: 'string', enum: ['wait', 'event'], description: 'wait = return the audio in this call; event = return immediately and deliver the audio as an event. Defaults to the configured delivery mode.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'tts_control',
    tags: ['act'],
    description: 'Read or change how speech is delivered. action=status shows the current modes; action=set changes delivery (wait/event), eventDelivery (archive/model) and autoSpeak, and saves them to the config. archive keeps voice events in the event store without waking you; model delivers them to the conversation. autoSpeak synthesizes the pet\'s own bubble lines into voice events.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'set'], description: 'status = show the current settings; set = change the given ones.' },
        delivery: { type: 'string', enum: ['wait', 'event'], description: 'For set: wait = tts_speak blocks for the audio; event = it returns at once and the audio arrives as an event.' },
        eventDelivery: { type: 'string', enum: ['archive', 'model'], description: 'For set: archive = voice events are stored only; model = they are delivered to the conversation and wake you.' },
        autoSpeak: { type: 'boolean', description: 'For set: synthesize the pet\'s own bubble lines into voice events.' },
      },
      required: ['action'],
    },
  },
];

export class TtsWorld {
  #host = null;
  #streams = new Set();
  #clips = null;
  #busy = 0;
  #lastError = '';
  #lastItemAt = '';
  #persist = null;
  #scanMs;
  #timer = null;
  #voiceCursor = 0;
  #jobs = Promise.resolve();
  #jobEpoch = 0;
  #abort = null;
  #autoFailedAt = 0;
  #seq = 0;

  constructor(opts = {}) {
    this.id = ID;
    this.cfg = opts.cfg ?? { ...DEFAULTS };
    this.dataDir = opts.dataDir ?? process.cwd();
    this.botDir = opts.botDir ?? process.cwd();
    this.secret = typeof opts.secret === 'function' ? opts.secret : () => '';
    this.storeSecret = typeof opts.storeSecret === 'function' ? opts.storeSecret : () => {};
    this.#persist = typeof opts.persist === 'function' ? opts.persist : null;
    this.#scanMs = Number.isFinite(Number(opts.scanMs)) && Number(opts.scanMs) >= 10 ? Number(opts.scanMs) : 1500;
    this.language = 'zh';
  }

  // -------------------------------------------------------------------------
  // 配置：config.json 的段被 WebUI 热改，每次用时现读
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

  /** 一次调用的交付方式：工具参数优先，其次配置。 */
  #deliveryOf(args) {
    const asked = asText(args?.delivery);
    if (DELIVERIES.includes(asked)) return asked;
    return this.#str('delivery') === 'event' ? 'event' : 'wait';
  }

  /** `worlds.tts.eventDelivery`：archive = 只落事件库；model = 投递到模型事件流。 */
  #eventDelivery() {
    return this.#str('eventDelivery') === 'model' ? 'model' : 'archive';
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
      { ...TTS_TOOL_DECLS[0], handler: async (args, ctx) => this.#speak(args ?? {}, ctx) },
      { ...TTS_TOOL_DECLS[1], handler: async (args) => this.#control(args ?? {}) },
    ];
  }

  /** 一次请求的参数；不合法时直接带着现成的失败回执返回。 */
  #prepare(args) {
    const text = asText(args?.text);
    if (!text) return { outcome: { text: '[tts_speak 没执行] text 是空的。不想合成语音就别调用。', failed: true } };
    const protocol = this.#protocol();
    const keyName = this.#str('apiKeySecret');
    const key = this.apiKey();
    if (protocol === 'dashscope' && !key) {
      return {
        outcome: {
          text: `[tts_speak 没执行] 没有配置 ${keyName}：请在控制台「文本转语音 → 状态」里填入密钥（或在部署 .env 里写 ${keyName}=...）。`,
          failed: true,
        },
      };
    }
    const voice = asText(args?.voice) || this.#str('voice');
    if (!voice) {
      return {
        outcome: {
          text: '[tts_speak 没执行] 没有可选音色：请在控制台「文本转语音 → 状态」或 worlds.tts.voice 里选一个。',
          failed: true,
        },
      };
    }
    return {
      text,
      protocol,
      key,
      voice,
      model: this.#str('model'),
      instruction: asText(args?.instruction) || this.#str('instruction'),
      note: asText(args?.note),
      sampleRate: this.#num('sampleRate', 8000, 48000),
    };
  }

  #request(prep, signal) {
    const common = {
      baseUrl: this.#str('baseUrl'),
      apiKey: prep.key,
      model: prep.model,
      text: prep.text,
      voice: prep.voice,
      languageHints: this.#languageHints(),
      format: this.#str('format'),
      sampleRate: prep.sampleRate,
      timeoutMs: this.#num('timeoutMs', 10000, 900000),
      signal,
    };
    return prep.protocol === 'openai'
      ? synthesizeOpenAiSpeech(common)
      : synthesizeSpeech({ ...common, instruction: prep.instruction, seed: this.#seed() });
  }

  #store(prep, res) {
    const seconds = wavDuration(res.bytes);
    const { item, warning } = this.#saveSafe({
      bytes: res.bytes,
      mime: res.mime,
      seconds,
      text: prep.text,
      note: prep.note,
      voice: prep.voice,
      model: prep.model,
      instruction: prep.instruction,
      format: res.format,
      sampleRate: prep.sampleRate,
      usage: res.usage,
      source: 'api',
    });
    return { seconds, item, warning };
  }

  async #speak(args, ctx) {
    const prep = this.#prepare(args);
    if (prep.outcome) return prep.outcome;
    if (this.#deliveryOf(args) === 'event') return this.#submit(prep);
    this.#busy += 1;
    try {
      const res = await this.#request(prep, ctx?.signal);
      const { seconds, item, warning } = this.#store(prep, res);
      return this.#outcome({
        verb: '合成好了。',
        bytes: res.bytes,
        mime: res.mime,
        seconds,
        text: prep.text,
        note: prep.note,
        voice: prep.voice,
        model: prep.model,
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

  /** 事件交付：先回执，合成与发事件排进后台队列。 */
  #submit(prep) {
    if (!this.#host) {
      return { text: '[tts_speak 没执行] 事件模式需要 World 正在运行；等它启动后再试。', failed: true };
    }
    prep.requestId = `p${Date.now().toString(36)}${++this.#seq}`;
    const epoch = this.#jobEpoch;
    this.#busy += 1;
    this.#enqueueJob(async () => {
      if (epoch !== this.#jobEpoch) {
        this.#busy -= 1;
        return;
      }
      try {
        const res = await this.#request(prep, this.#abort?.signal);
        const { seconds, item } = this.#store(prep, res);
        await this.#pushVoice({ prep, res, seconds, item, origin: 'tool' });
      } catch (err) {
        if (epoch === this.#jobEpoch) await this.#pushFailed(prep, err, 'tool');
      } finally {
        this.#busy -= 1;
      }
    });
    const route = this.#eventDelivery() === 'model' ? '投递到对话事件流' : '只落事件库';
    return { text: `已提交语音合成 #${prep.requestId}；完成后作为声音事件送达（${route}）。` };
  }

  /** 同一时间只跑一个合成任务：事件按提交顺序出来，也避免并发打接口。 */
  #enqueueJob(task) {
    const run = () => task();
    const result = this.#jobs.then(run, run);
    this.#jobs = result.then(() => {}, () => {});
    return result;
  }

  async #pushVoice({ prep, res, seconds, item, origin }) {
    if (origin === 'pet' && !this.#bool('autoSpeak')) return;
    const host = this.#host;
    if (!host?.pushEvent) return;
    const name = item?.file ?? `voice-${Date.now().toString(36)}.wav`;
    const stamp = prep.requestId ? ` #${prep.requestId}` : '';
    const label = origin === 'pet' ? '（这是你自己气泡的朗读结果，通常不必回应）' : '';
    const bits = [
      prep.voice,
      prep.model,
      res.format,
      seconds ? formatSeconds(seconds) : '',
      formatKb(res.bytes.length),
    ].filter(Boolean);
    try {
      await host.pushEvent({
        type: EVENT_TYPE,
        source: this.id,
        senderKey: item?.id,
        ts: new Date().toISOString(),
        text: `语音合成完成${stamp}${label}：${oneLine(prep.text, 200)}\n参数：${bits.join(' · ')}`,
        meta: {
          origin,
          requestId: prep.requestId ?? '',
          text: prep.text,
          voice: prep.voice,
          model: prep.model,
          format: res.format ?? '',
          seconds,
          mime: res.mime,
          path: item?.path ?? '',
          itemId: item?.id ?? '',
          note: prep.note,
        },
        blobs: [{
          bytes: res.bytes,
          mime: res.mime,
          name,
          fallbackText: `[语音 ${name}${seconds ? ` ${formatSeconds(seconds)}` : ''}｜${prep.voice}｜${formatKb(res.bytes.length)}]`,
        }],
      }, { deliver: this.#eventDelivery() === 'model', trigger: 'debounce' });
    } catch (err) {
      this.#lastError = `${new Date().toISOString()} 声音事件没送出去：${msg(err)}`;
      host.log?.warn?.('文本转语音：声音事件没送出去', { err: msg(err) });
    }
  }

  async #pushFailed(prep, err, origin) {
    const detail = err instanceof TtsApiError ? err.message : msg(err);
    this.#lastError = `${new Date().toISOString()} ${detail}`;
    this.#emit({ t: 'error', message: detail, tool: origin === 'pet' ? 'auto-speak' : 'tts_speak' }, true);
    const host = this.#host;
    if (!host?.pushEvent) return;
    const stamp = prep.requestId ? ` #${prep.requestId}` : '';
    const label = origin === 'pet' ? '（桌宠气泡的朗读结果）' : '';
    try {
      await host.pushEvent({
        type: EVENT_FAILED_TYPE,
        source: this.id,
        ts: new Date().toISOString(),
        text: `语音合成失败${stamp}${label}：${detail}`,
        meta: { origin, requestId: prep.requestId ?? '', text: prep.text, voice: prep.voice, model: prep.model },
      }, { deliver: this.#eventDelivery() === 'model', trigger: 'debounce' });
    } catch (pushErr) {
      host.log?.warn?.('文本转语音：失败事件没送出去', { err: msg(pushErr) });
    }
  }

  /** 桌宠读的配置回执：三个开关与在途任务。 */
  #controlSays() {
    const auto = this.#bool('autoSpeak') ? 'on' : 'off';
    return `交付：${this.#deliveryOf({})} · 声音事件：${this.#eventDelivery()} · 自动朗读：${auto}${this.#busy ? ` · 在途 ${this.#busy}` : ''}`;
  }

  #control(args) {
    const action = asText(args?.action) || 'status';
    if (action === 'status') return { text: this.#controlSays() };
    if (action !== 'set') return { text: '[tts_control 没执行] action 只能是 status 或 set。', failed: true };

    const patch = {};
    if (args?.delivery !== undefined) {
      const delivery = asText(args.delivery);
      if (!DELIVERIES.includes(delivery)) return { text: '[tts_control 没执行] delivery 只能是 wait 或 event。', failed: true };
      patch.delivery = delivery;
    }
    if (args?.eventDelivery !== undefined) {
      const route = asText(args.eventDelivery);
      if (!EVENT_DELIVERIES.includes(route)) return { text: '[tts_control 没执行] eventDelivery 只能是 archive 或 model。', failed: true };
      patch.eventDelivery = route;
    }
    if (args?.autoSpeak !== undefined) {
      if (typeof args.autoSpeak !== 'boolean') return { text: '[tts_control 没执行] autoSpeak 只能是 true 或 false。', failed: true };
      patch.autoSpeak = args.autoSpeak;
    }
    if (Object.keys(patch).length === 0) return { text: '[tts_control 没执行] set 至少要给一项。', failed: true };

    try {
      this.#persist?.(patch);
    } catch (err) {
      return { text: `[tts_control 失败] 配置没写进去：${msg(err)}`, failed: true };
    }
    for (const [key, value] of Object.entries(patch)) this.cfg[key] = value;
    // 打开自动朗读只处理之后的新气泡，不补读此前的。
    if (patch.autoSpeak === true) this.#voiceCursor = this.#host?.store?.latestCursor?.() ?? this.#voiceCursor;
    return { text: `已更新：${this.#controlSays()}` };
  }

  /** 扫一遍桌宠气泡；关着自动朗读时只把游标推到最新，打开后不补读旧气泡。 */
  async #scanPet() {
    const host = this.#host;
    if (!host) return;
    try {
      if (!this.#bool('autoSpeak')) {
        this.#voiceCursor = host.store.latestCursor();
        return;
      }
      const events = host.store.range({ fromCursor: this.#voiceCursor + 1, limit: 50 });
      for (const event of events) {
        this.#voiceCursor = Math.max(this.#voiceCursor, event.cursor);
        if (event.type !== PET_EVENT) continue;
        const line = this.#lineOf(event);
        if (line) this.#submitAuto(line);
      }
    } catch (err) {
      this.#lastError = `${new Date().toISOString()} 读气泡事件失败：${msg(err)}`;
    }
  }

  /** 气泡说出来的话：say 的 beats 拼起来，ask 只读问题。 */
  #lineOf(event) {
    const meta = event.meta ?? {};
    if (meta.kind === 'say' && Array.isArray(meta.beats)) {
      const text = meta.beats
        .map((beat) => (beat && typeof beat.text === 'string' ? beat.text : ''))
        .filter(Boolean)
        .join('。 ');
      return speakable(text);
    }
    if (meta.kind === 'ask' && typeof meta.question === 'string') return speakable(meta.question);
    return '';
  }

  #submitAuto(line) {
    if (!this.#host) return;
    if (Date.now() - this.#autoFailedAt < AUTO_FAIL_COOLDOWN_MS) return;
    const env = this.#envState();
    if (!env.ok) {
      this.#autoFailedAt = Date.now();
      this.#lastError = `${new Date().toISOString()} 自动朗读未就绪：${env.detail}`;
      this.#host.log?.warn?.('自动朗读未就绪', { detail: env.detail });
      return;
    }
    const prep = this.#prepare({ text: line, note: '桌宠气泡' });
    if (prep.outcome) {
      this.#autoFailedAt = Date.now();
      this.#lastError = `${new Date().toISOString()} 自动朗读没提交：${prep.outcome.text}`;
      return;
    }
    const epoch = this.#jobEpoch;
    this.#busy += 1;
    this.#enqueueJob(async () => {
      if (epoch !== this.#jobEpoch || !this.#bool('autoSpeak')) {
        this.#busy -= 1;
        return;
      }
      try {
        const res = await this.#request(prep, this.#abort?.signal);
        const { seconds, item } = this.#store(prep, res);
        await this.#pushVoice({ prep, res, seconds, item, origin: 'pet' });
      } catch (err) {
        this.#autoFailedAt = Date.now();
        if (epoch === this.#jobEpoch) await this.#pushFailed(prep, err, 'pet');
      } finally {
        this.#busy -= 1;
      }
    });
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
  // WebUI
  // -------------------------------------------------------------------------

  webUi(language = 'zh') {
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
      queue: this.#busy,
      lastError: this.#lastError,
      lastItemAt: this.#lastItemAt,
      protocol: this.#protocol(),
      delivery: this.#deliveryOf({}),
      eventDelivery: this.#eventDelivery(),
      autoSpeak: this.#bool('autoSpeak'),
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

  /** WebUI「试听合成」：拿当前配置真合成一句，并把它存进语音列表。 */
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
      source: 'webui-test',
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
    if (this.#timer) clearInterval(this.#timer);
    this.#jobEpoch += 1;
    this.#abort = new AbortController();
    this.#voiceCursor = host.store.latestCursor();
    try {
      this.#clipsFor().ensure();
    } catch (err) {
      this.#host?.log?.warn?.('文本转语音：数据目录建不出来', { err: msg(err) });
    }
    this.#timer = setInterval(() => { void this.#scanPet(); }, this.#scanMs);
    this.#timer.unref?.();
    this.#host?.log?.info?.('文本转语音已就绪', {
      dir: this.dir(),
      model: this.#str('model'),
      voice: this.#str('voice'),
      key: this.apiKey() ? '已配置' : '未配置',
      delivery: this.#deliveryOf({}),
      eventDelivery: this.#eventDelivery(),
      autoSpeak: this.#bool('autoSpeak'),
    });
  }

  async stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#jobEpoch += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#streams.clear();
    this.#host = null;
  }
}
