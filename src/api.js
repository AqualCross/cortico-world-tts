/**
 * 阿里云百炼 Qwen-Audio-TTS HTTP 接口的最小客户端。
 *
 * 只用 Node 22 自带的 fetch。接口是普通 JSON（非流式）：
 *   POST <baseUrl>/api/v1/services/audio/tts/SpeechSynthesizer
 * 成功时 `output.audio.url` 是 24 小时有效的下载链接，再 GET 一次就是字节；
 * 流式（请求头 X-DashScope-SSE: enable）会按句在 `output.audio.data` 里给
 * base64，这份客户端先不做流式——非流式够用，慢的话再说。
 */

/** 请求失败；`status` 是 HTTP 状态码，0 表示没走到服务端。 */
export class TtsApiError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'TtsApiError';
    this.status = Number(opts.status) || 0;
    this.code = String(opts.code ?? '');
    this.body = String(opts.body ?? '');
  }
}

const DEFAULT_TIMEOUT = 120000;

/** 接口路径；baseUrl 是根地址，不含它。 */
export const TTS_PATH = 'api/v1/services/audio/tts/SpeechSynthesizer';

export const MIME_BY_FORMAT = Object.freeze({
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  pcm: 'audio/pcm',
});

function joinUrl(baseUrl, path) {
  const base = String(baseUrl ?? '').trim().replace(/[/\s]+$/, '');
  if (!base) throw new TtsApiError('没有配置接口地址');
  return `${base}/${String(path).replace(/^\/+/, '')}`;
}

function snippet(value, max = 300) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function normalizeFormat(value) {
  const f = String(value ?? '').trim().toLowerCase().replace(/^\./, '');
  if (f === 'mpeg') return 'mp3';
  return Object.hasOwn(MIME_BY_FORMAT, f) ? f : 'mp3'; // 接口默认 mp3
}

/** 超时与调用方的 AbortSignal 合成一个信号。 */
function signalFor(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function describeNetworkError(err, timeoutMs) {
  if (err?.name === 'TimeoutError') return `等 ${Math.round(timeoutMs / 1000)} 秒没有响应，超时了`;
  if (err?.name === 'AbortError') return '调用被中断了';
  const detail = err?.cause?.message ?? err?.message ?? err;
  return `连不上语音接口：${snippet(detail, 200)}`;
}

async function fetchTimed(url, init, timeoutMs, signal) {
  try {
    return await fetch(url, { ...init, signal: signalFor(timeoutMs, signal) });
  } catch (err) {
    throw new TtsApiError(describeNetworkError(err, timeoutMs));
  }
}

/** 常见的失败提示；认不出就不加。 */
function hintsFor(status, code, raw) {
  const s = String(raw ?? '');
  if (status === 401 || status === 403) return '（密钥不对、没权限，或者这个模型没有开通）';
  if (status === 404) return '（接口地址或模型名不对）';
  if (status === 429) return '（触发限流，等一会儿再试）';
  if (code === 'InvalidParameter' && /TTS speak operation failed|voice/i.test(s)) {
    return '（音色和模型不匹配：worlds.tts.voice 要用当前模型支持的音色）';
  }
  return '';
}

/** 异步 POST 一次并解析 JSON；非 2xx 抛 TtsApiError，正文带给调用方。 */
async function postJson(url, { apiKey, body, timeoutMs, signal }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetchTimed(url, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs, signal);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = json?.code ?? json?.error?.code ?? '';
    const raw = json?.message ?? json?.error?.message ?? json?.msg ?? text;
    throw new TtsApiError(
      `接口返回 ${res.status}${code ? ` [${code}]` : ''}：${snippet(raw, 300)}${hintsFor(res.status, code, raw)}`,
      { status: res.status, code, body: snippet(text, 800) },
    );
  }
  if (!json) throw new TtsApiError(`接口没有返回 JSON：${snippet(text, 300)}`, { status: res.status });
  return json;
}

/** 从魔术字节认音频格式；认不出来给 null，别硬猜。 */
export function sniffAudio(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (b.length >= 3 && b.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  return null;
}

/**
 * 合成一段语音。非流式：拿到 `output.audio.url` 再下载一次字节。
 *
 * @param {object} opts baseUrl / apiKey / model / text / voice / instruction /
 *   format / sampleRate / timeoutMs / signal
 * @returns {Promise<{bytes: Buffer, mime: string, format: string, usage: object|null,
 *   requestId: string, via: 'url'|'base64'}>}
 */
export async function synthesizeSpeech(opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT;
  const format = normalizeFormat(opts.format);
  const input = {
    text: String(opts.text ?? ''),
    voice: String(opts.voice ?? ''),
    format,
  };
  const sampleRate = Number(opts.sampleRate) || 0;
  if (sampleRate) input.sample_rate = sampleRate;
  const instruction = String(opts.instruction ?? '').trim();
  if (instruction) input.instruction = instruction;
  const hints = Array.isArray(opts.languageHints)
    ? opts.languageHints.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [];
  if (hints.length) input.language_hints = hints;
  const seed = opts.seed === undefined || opts.seed === null || opts.seed === '' ? null : Number(opts.seed);
  if (seed !== null && Number.isFinite(seed)) input.seed = Math.min(Math.max(Math.round(seed), 0), 65535);
  if (opts.extraInput && typeof opts.extraInput === 'object') Object.assign(input, opts.extraInput);

  const json = await postJson(joinUrl(opts.baseUrl, TTS_PATH), {
    apiKey: opts.apiKey,
    body: { model: String(opts.model ?? ''), input },
    timeoutMs,
    signal: opts.signal,
  });

  const audio = json?.output?.audio;
  const usage = json?.usage && typeof json.usage === 'object' ? json.usage : null;
  const requestId = typeof json?.request_id === 'string' ? json.request_id : '';

  if (audio && typeof audio.url === 'string' && audio.url.trim()) {
    const res = await fetchTimed(audio.url.trim(), { method: 'GET' }, timeoutMs, opts.signal);
    if (!res.ok) throw new TtsApiError(`下载生成的语音失败：HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new TtsApiError('下载到的语音是空的');
    const header = String(res.headers.get('content-type') ?? '').split(';')[0].trim();
    const mime = sniffAudio(bytes)
      ?? (header.startsWith('audio/') ? header : null)
      ?? MIME_BY_FORMAT[format];
    return { bytes, mime, format, usage, requestId, via: 'url' };
  }

  if (audio && typeof audio.data === 'string' && audio.data.trim()) {
    const bytes = Buffer.from(audio.data.replace(/^data:[^,]+,/, ''), 'base64');
    if (!bytes.length) throw new TtsApiError('接口返回的 base64 是空的');
    return { bytes, mime: sniffAudio(bytes) ?? MIME_BY_FORMAT[format], format, usage, requestId, via: 'base64' };
  }

  const errorish = json?.message ?? json?.error?.message;
  throw new TtsApiError(
    errorish
      ? `接口没给音频：${snippet(errorish, 300)}`
      : `接口没给音频：${snippet(JSON.stringify(json ?? {}), 300)}`,
  );
}

// ---------------------------------------------------------------------------
// OpenAI 兼容形态（本地 IndexTTS 这类服务）
// ---------------------------------------------------------------------------

/** OpenAI 兼容 TTS 的地址：根地址或 /v1 结尾都收。 */
export function openAiSpeechUrl(baseUrl) {
  const base = String(baseUrl ?? '').trim().replace(/[/\s]+$/, '');
  if (!base) throw new TtsApiError('没有配置接口地址');
  return /\/v1$/i.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

const OPENAI_FORMATS = new Set(['mp3', 'wav', 'ogg']);
/** IndexTTS 的语种标识；只认它支持的五种。 */
const OPENAI_LANGS = new Set(['ZH', 'EN', 'JA', 'ES', 'AR']);

/** 语言提示 → `lang`（第一个值，大写；不认识就不发）。 */
function openAiLang(hints) {
  const first = Array.isArray(hints) && hints.length ? String(hints[0] ?? '').trim().toUpperCase() : '';
  return OPENAI_LANGS.has(first) ? first : '';
}

/**
 * OpenAI 兼容形态：POST `<base>/v1/audio/speech`，body 是扁平的
 * `{model, input, voice, response_format, sample_rate, lang?}`，响应是原始音频字节。
 * 本地服务通常不需要 key；有 key 就带上（服务端开了 --api-token 时用）。
 *
 * @param {object} opts baseUrl / apiKey / model / text / voice / format /
 *   sampleRate / languageHints / timeoutMs / signal
 * @returns {Promise<{bytes: Buffer, mime: string, format: string, usage: null,
 *   requestId: string, via: 'openai'}>}
 */
export async function synthesizeOpenAiSpeech(opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT;
  const rawFormat = String(opts.format ?? '').trim().toLowerCase().replace(/^\./, '');
  const responseFormat = OPENAI_FORMATS.has(rawFormat) ? rawFormat : 'mp3';
  const body = {
    model: String(opts.model ?? '').trim() || 'IndexTTS-2.5',
    input: String(opts.text ?? ''),
    voice: String(opts.voice ?? ''),
    response_format: responseFormat,
  };
  const sampleRate = Number(opts.sampleRate) || 0;
  if (sampleRate) body.sample_rate = sampleRate;
  const lang = openAiLang(opts.languageHints);
  if (lang) body.lang = lang;

  const headers = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const res = await fetchTimed(openAiSpeechUrl(opts.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs, opts.signal);

  if (!res.ok) {
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const detail = json?.detail ?? json?.error?.message ?? json?.message ?? text;
    const hint = res.status === 503
      ? '（服务端还在加载模型，等它就绪再试）'
      : res.status === 400 && /voice/i.test(String(detail ?? ''))
        ? '（音色不存在：填 characters/ 里那个名字，或用 GET /v1/audio/voices 看列表）'
        : res.status === 401 ? '（服务端要求 Bearer token）' : '';
    throw new TtsApiError(`接口返回 ${res.status}：${snippet(detail, 300)}${hint}`, {
      status: res.status,
      body: snippet(text, 800),
    });
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new TtsApiError('接口返回的音频是空的');
  const header = String(res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mime = sniffAudio(bytes)
    ?? (header.startsWith('audio/') ? header : null)
    ?? MIME_BY_FORMAT[responseFormat]
    ?? 'audio/mpeg';
  return { bytes, mime, format: responseFormat, usage: null, requestId: '', via: 'openai' };
}
