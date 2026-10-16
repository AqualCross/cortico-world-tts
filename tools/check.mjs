#!/usr/bin/env node
/**
 * 离线检查：不联网、不碰安装目录。跑法：node tools/check.mjs
 *
 * 覆盖：清单与声明 / 工具声明 / 配置组路径 / 面板声明 / WAV 工具 /
 * 语音仓库（落盘、索引、裁剪、坏索引容错）/ 接口客户端（打桩 fetch，含错误提示）/
 * 工具 handler 的整条链（打桩 fetch）/ WebUI bundle 的导出形状与自描述。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'tts-check-'));

let passed = 0;
let failed = 0;
let warned = 0;

const ok = (line) => { passed++; console.log(`  ok    ${line}`); };
const bad = (line) => { failed++; console.log(`  FAIL  ${line}`); };
const hint = (line) => { warned++; console.log(`  提醒  ${line}`); };

function assert(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}
function eq(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message ?? '不相等'}：${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
function check(label, fn) {
  try {
    fn();
    ok(label);
  } catch (err) {
    bad(`${label} — ${err?.message ?? err}`);
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    bad(`${label} — ${err?.message ?? err}`);
  }
}

/** 键序无关的 JSON 形态：对比 describe.json 与代码里的声明（与框架的深比较等价）。 */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

// ---------------------------------------------------------------------------
// 打桩 fetch
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
let calls = [];

function installFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    return handler(u, init);
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}
function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

const mod = await import(pathToFileURL(join(pkgDir, 'src', 'index.js')).href);
const def = mod.default;
const api = await import(pathToFileURL(join(pkgDir, 'src', 'api.js')).href);
const wav = await import(pathToFileURL(join(pkgDir, 'src', 'wav.js')).href);
const clipsMod = await import(pathToFileURL(join(pkgDir, 'src', 'clips.js')).href);
const config = await import(pathToFileURL(join(pkgDir, 'src', 'config.js')).href);

/** 用定义造一个世界；密钥与目录都可以换。 */
function makeWorld(overrides = {}, opts = {}) {
  const cfg = { ...def.defaults(), enabled: true, ...overrides };
  const stored = [];
  const world = def.create({
    cfg,
    dataDir: opts.dataDir ?? join(scratch, 'data'),
    botDir: opts.botDir ?? join(scratch, 'bot'),
    packageDir: pkgDir,
    secret: () => (opts.key === undefined ? 'sk-test' : opts.key),
    storeSecret: (name, value) => stored.push([name, value]),
  });
  world.__stored = stored;
  return world;
}

try {
  // -------------------------------------------------------------------------
  console.log('清单与声明');

  check('package.json 的 cortico 段与 webUiClient', () => {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    eq(manifest.cortico?.kind, 'world', 'kind');
    eq(manifest.cortico?.api, 6, 'api');
    assert(typeof manifest.cortico?.webUiClient === 'string' && manifest.cortico.webUiClient, '缺 webUiClient');
    assert(existsSync(join(pkgDir, manifest.cortico.webUiClient)), 'webUiClient 文件不在包里');
    eq(manifest.cortico?.describe, 'describe.json', 'describe');
    assert(existsSync(join(pkgDir, 'describe.json')), 'describe.json 不在包里');
    assert(Array.isArray(manifest.files) && manifest.files.includes('describe.json'), 'files 缺 describe.json');
    assert(Array.isArray(manifest.keywords) && manifest.keywords.includes('cortico-world'), 'keywords 缺 cortico-world');
  });

  check('CHANGELOG.md 有当前版本的一节', () => {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const src = readFileSync(join(pkgDir, 'CHANGELOG.md'), 'utf8');
    const version = String(manifest.version ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert(new RegExp(`^##\\s*\\[?${version}\\]?`, 'm').test(src), `CHANGELOG.md 缺 ## ${manifest.version} 一节`);
    assert(Array.isArray(manifest.files) && manifest.files.includes('CHANGELOG.md'), 'files 缺 CHANGELOG.md');
  });

  check('默认导出是 WorldDefinition', () => {
    eq(def.id, 'tts', 'id');
    eq(def.label, '文本转语音', 'label');
    const defaults = def.defaults();
    eq(defaults.enabled, false, 'enabled 默认 false');
    eq(defaults.model, 'qwen-audio-3.1-tts-flash', 'model 默认');
    assert(defaults.voice, 'voice 默认不能为空');
    def.preflight(); // 环境满足时不抛
  });

  check('describe 与 describe.json 一致，实例工具都在声明里', () => {
    assert(def.describe && Array.isArray(def.describe.tools) && def.describe.tools.length === 1, '定义缺 describe.tools');
    assert(Array.isArray(def.describe.events), '定义缺 describe.events');
    const file = JSON.parse(readFileSync(join(pkgDir, 'describe.json'), 'utf8'));
    eq(stable(file), stable(JSON.parse(JSON.stringify(def.describe))), 'describe.json 与代码里的 describe 不一致');
    eq(file.tools[0].name, 'tts_speak', 'describe 工具名');
    eq(file.events.length, 0, '这个 World 不该声明事件');
    const names = new Set(file.tools.map((t) => t.name));
    for (const tool of makeWorld().tools()) assert(names.has(tool.name), `工具 ${tool.name} 不在 describe.tools 里`);
  });

  check('配置组与默认值一一对应，且都在 worlds.tts 段内', () => {
    const group = config.configGroup('zh');
    const paths = Object.keys(group.schema.properties);
    for (const path of paths) {
      assert(path.startsWith('worlds.tts.'), `配置路径不在 worlds.tts：${path}`);
      const short = path.slice('worlds.tts.'.length);
      assert(Object.hasOwn(config.DEFAULTS, short), `配置 ${short} 没有默认值`);
    }
    for (const short of Object.keys(config.DEFAULTS)) {
      assert(paths.includes(`worlds.tts.${short}`), `默认值 ${short} 没有进 schema`);
    }
  });

  check('不写系统提示词：没有环境段、没有提示词文档', () => {
    const world = makeWorld();
    eq(world.envPromptVars(), null, 'envPromptVars 应为 null');
    const decl = world.webUi('zh');
    assert(!decl.promptDocs || decl.promptDocs.length === 0, '不该再声明提示词文档');
  });

  // -------------------------------------------------------------------------
  console.log('World 与工具');

  check('工具只有一个 tts_speak，声明齐全', () => {
    const world = makeWorld();
    const tools = world.tools();
    eq(tools.length, 1, '工具数量');
    const tool = tools[0];
    eq(tool.name, 'tts_speak', '工具名');
    assert(Array.isArray(tool.tags) && tool.tags.includes('act'), 'tags');
    eq(tool.interruptible, true, 'interruptible');
    eq(tool.parameters.required?.[0], 'text', 'required[0]');
    assert(tool.parameters.properties?.voice, '缺 voice 参数');
    assert(tool.parameters.properties?.instruction, '缺 instruction 参数');
  });

  check('面板与配置组声明', () => {
    const world = makeWorld();
    const decl = world.webUi('zh');
    const ids = decl.panels.map((p) => p.id);
    assert(ids.includes('clips') && ids.includes('status'), `面板缺：${ids.join(',')}`);
    assert(Array.isArray(decl.config) && decl.config.length === 1, '缺配置组');
  });

  await checkAsync('两个面板都要能取二进制（状态页试听用）', async () => {
    const world = makeWorld();
    for (const panel of ['clips', 'status']) {
      try {
        await world.invoke(panel, 'blob', ['不存在的编号']);
        throw new Error(`不存在的编号居然取到了二进制`);
      } catch (err) {
        assert(!String(err?.message).includes('未知面板方法'), `${panel}.blob 没接上：${err?.message}`);
      }
    }
  });

  // -------------------------------------------------------------------------
  console.log('WAV 工具');

  check('样本时长能读回来', () => {
    for (const seconds of [0.3, 0.6, 1.2]) {
      const bytes = wav.sampleWav(seconds);
      const got = wav.wavDuration(bytes);
      assert(Math.abs(got - seconds) < 0.02, `${seconds}s 读成 ${got}s`);
    }
  });

  check('认不出的字节给 null', () => {
    eq(wav.wavDuration(Buffer.from('not a wav at all')), null, '文本不是 wav');
    eq(wav.wavDuration(Buffer.alloc(0)), null, '空缓冲');
  });

  // -------------------------------------------------------------------------
  console.log('语音仓库');

  check('落盘、索引、裁剪、坏索引容错', () => {
    const dir = join(scratch, 'clips');
    const sample = wav.sampleWav(0.5);
    const clips = new clipsMod.Clips({ dir, keep: 2 });
    clips.add({ bytes: sample, mime: 'audio/wav', seconds: 0.5, text: '一', voice: 'v1' });
    clips.add({ bytes: sample, mime: 'audio/wav', seconds: 0.5, text: '二' });
    clips.add({ bytes: sample, mime: 'audio/wav', seconds: 0.5, text: '三' });
    eq(clips.count, 2, 'keep=2 后的条数');
    assert(clips.list().some((i) => i.text === '三'), '最新的没留下');
    assert(!clips.list().some((i) => i.text === '一'), '最旧的没被裁掉');
    assert(existsSync(clips.indexFile), '索引没落盘');

    const again = new clipsMod.Clips({ dir, keep: 2 });
    eq(again.count, 2, '重载索引后的条数');
    const first = again.list()[0];
    eq(first.seconds, 0.5, '秒数没持久化');
    assert(again.get(first.id)?.path === first.path, '按 id 取不回来');
    assert(again.remove(first.id) && again.count === 1, '删除没生效');

    writeFileSync(join(dir, 'index.json'), '{oops');
    eq(new clipsMod.Clips({ dir, keep: 2 }).count, 0, '坏索引应当当空');
  });

  // -------------------------------------------------------------------------
  console.log('接口客户端');

  await checkAsync('成功路径：请求体、鉴权、下载、mime 嗅探', async () => {
    const body = wav.sampleWav(0.2);
    installFetch((u) => {
      if (u.includes('/api/v1/services/audio/tts/SpeechSynthesizer')) {
        return jsonRes({
          request_id: 'req-1',
          output: { finish_reason: 'stop', audio: { url: 'http://oss.test/voice.wav', id: 'a1' } },
          usage: { input_tokens: 5, output_tokens: 9, total_tokens: 14 },
        });
      }
      if (u === 'http://oss.test/voice.wav') {
        return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      }
      throw new Error(`没料到的请求：${u}`);
    });
    try {
      const res = await api.synthesizeSpeech({
        baseUrl: 'https://dashscope.test',
        apiKey: 'sk-1',
        model: 'qwen-audio-3.1-tts-flash',
        text: '你好',
        voice: 'longanhuan_v3.1',
        instruction: '开心一点',
        languageHints: ['zh'],
        seed: 42,
        format: 'wav',
        sampleRate: 24000,
      });
      const post = calls.find((c) => c.init?.method === 'POST');
      assert(post, '没有发 POST');
      const sent = JSON.parse(post.init.body);
      eq(sent.model, 'qwen-audio-3.1-tts-flash', 'model');
      eq(sent.input.text, '你好', 'text');
      eq(sent.input.voice, 'longanhuan_v3.1', 'voice');
      eq(sent.input.format, 'wav', 'format');
      eq(sent.input.sample_rate, 24000, 'sample_rate');
      eq(sent.input.instruction, '开心一点', 'instruction');
      eq(JSON.stringify(sent.input.language_hints), '["zh"]', 'language_hints');
      eq(sent.input.seed, 42, 'seed');
      eq(post.init.headers.Authorization, 'Bearer sk-1', 'Authorization');
      eq(res.mime, 'audio/wav', 'mime');
      eq(res.via, 'url', 'via');
      eq(res.usage.total_tokens, 14, 'usage');
      eq(res.bytes.length, body.length, '字节长度');
    } finally {
      restoreFetch();
    }
  });

  await checkAsync('失败路径：状态码与提示', async () => {
    const cases = [
      { status: 401, json: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, want: '密钥' },
      { status: 400, json: { code: 'InvalidParameter', message: 'TTS speak operation failed' }, want: '音色' },
      { status: 404, json: { code: 'ModelNotFound', message: 'nope' }, want: '接口地址' },
    ];
    for (const one of cases) {
      installFetch(() => jsonRes(one.json, one.status));
      try {
        await api.synthesizeSpeech({ baseUrl: 'https://dashscope.test', apiKey: 'k', model: 'm', text: 't', voice: 'v' });
        throw new Error(`HTTP ${one.status} 应当抛错`);
      } catch (err) {
        assert(err instanceof api.TtsApiError, `不是 TtsApiError：${err?.name}`);
        eq(err.status, one.status, 'status');
        assert(err.message.includes(one.want), `提示里没有「${one.want}」：${err.message}`);
      } finally {
        restoreFetch();
      }
    }
    installFetch(() => jsonRes({ request_id: 'r', output: { finish_reason: 'stop' } }));
    try {
      await api.synthesizeSpeech({ baseUrl: 'https://dashscope.test', apiKey: 'k', model: 'm', text: 't', voice: 'v' });
      throw new Error('没有音频应当抛错');
    } catch (err) {
      assert(err instanceof api.TtsApiError && err.message.includes('接口没给音频'), `错误不对：${err?.message}`);
    } finally {
      restoreFetch();
    }
  });

  await checkAsync('OpenAI 兼容形态：地址、请求体、原始字节', async () => {
    const body = wav.sampleWav(0.2);
    const seen = [];
    installFetch((u, init) => {
      seen.push({ u, init });
      if (u === 'http://127.0.0.1:8000/v1/audio/speech') {
        return new Response(body, { status: 200, headers: { 'content-type': 'audio/wav' } });
      }
      throw new Error(`没料到的请求：${u}`);
    });
    try {
      const res = await api.synthesizeOpenAiSpeech({
        baseUrl: 'http://127.0.0.1:8000',
        model: 'IndexTTS-2.5',
        text: '你好',
        voice: 'voice_01',
        format: 'mp3',
        sampleRate: 24000,
        languageHints: ['zh'],
      });
      const post = seen.find((c) => c.init?.method === 'POST');
      assert(post, '没有发 POST');
      const sent = JSON.parse(post.init.body);
      eq(sent.model, 'IndexTTS-2.5', 'model');
      eq(sent.input, '你好', 'input 是扁平文本');
      eq(sent.voice, 'voice_01', 'voice');
      eq(sent.response_format, 'mp3', 'response_format');
      eq(sent.sample_rate, 24000, 'sample_rate');
      eq(sent.lang, 'ZH', 'lang 映射');
      eq(post.init.headers.Authorization, undefined, '没 key 就不带 Authorization');
      eq(res.mime, 'audio/wav', 'mime（按字节嗅探）');
      eq(res.via, 'openai', 'via');
      eq(res.bytes.length, body.length, '字节长度');
      const res2 = await api.synthesizeOpenAiSpeech({ baseUrl: 'http://127.0.0.1:8000/v1', text: 'x', voice: 'v', format: 'wav' });
      eq(res2.bytes.length, body.length, '/v1 结尾的地址也要认');
    } finally {
      restoreFetch();
    }
  });

  await checkAsync('OpenAI 形态的失败提示（503 加载中 / 音色不存在）', async () => {
    installFetch(() => jsonRes({ detail: 'Model is still loading, retry later (see /health)' }, 503));
    try {
      await api.synthesizeOpenAiSpeech({ baseUrl: 'http://127.0.0.1:8000', text: 'x', voice: 'v', format: 'wav' });
      throw new Error('503 应当抛错');
    } catch (err) {
      assert(err instanceof api.TtsApiError && err.message.includes('加载'), `503 提示不对：${err?.message}`);
    } finally {
      restoreFetch();
    }
    installFetch(() => jsonRes({ detail: "Voice 'nope' not found" }, 400));
    try {
      await api.synthesizeOpenAiSpeech({ baseUrl: 'http://127.0.0.1:8000', text: 'x', voice: 'nope', format: 'wav' });
      throw new Error('400 应当抛错');
    } catch (err) {
      assert(err instanceof api.TtsApiError && err.message.includes('音色'), `400 提示不对：${err?.message}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------------------
  console.log('工具整条链');

  await checkAsync('合成 → 落盘 → 回执带 blob', async () => {
    const dataDir = join(scratch, 'world-data');
    const world = makeWorld({ languageHints: 'zh' }, { dataDir, key: 'sk-test' });
    const body = wav.sampleWav(0.4);
    installFetch((u) => {
      if (u.includes('SpeechSynthesizer')) {
        return jsonRes({ request_id: 'r2', output: { audio: { url: 'http://oss.test/v.wav' } }, usage: { characters: 6 } });
      }
      if (u === 'http://oss.test/v.wav') return new Response(body, { status: 200 });
      throw new Error(`没料到的请求：${u}`);
    });
    try {
      const tool = world.tools()[0];
      const out = await tool.handler({ text: '本鲸会说话了。', note: '演示' }, {});
      assert(!out.failed, `不该失败：${out.text}`);
      assert(out.text.includes('合成好了'), '回执缺字样');
      assert(/文件：.+\.wav/.test(out.text), '回执没有文件路径');
      assert(Array.isArray(out.blobs) && out.blobs.length === 1, '回执没有 blob');
      eq(out.blobs[0].mime, 'audio/wav', 'blob mime');
      eq(out.blobs[0].bytes.length, body.length, 'blob 字节');
      const post = calls.find((c) => c.init?.method === 'POST');
      eq(JSON.stringify(JSON.parse(post.init.body).input.language_hints), '["zh"]', 'world 请求里的 language_hints');
      assert(JSON.parse(post.init.body).input.seed === undefined, '留空时不该发 seed');
      const summary = await world.invoke('clips', 'list', [10]);
      eq(summary.count, 1, '仓库条数');
      eq(summary.items[0].text, '本鲸会说话了。', '仓库文本');
      eq(summary.items[0].seconds, 0.4, '仓库时长');
      assert(existsSync(summary.items[0].path), '落盘文件不在了');
    } finally {
      restoreFetch();
    }
  });

  await checkAsync('openai 协议：无 key 也能合成，instruction/seed 不发', async () => {
    const world = makeWorld({
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:8000',
      model: 'IndexTTS-2.5',
      voice: 'voice_01',
      languageHints: 'zh',
    }, { key: '' });
    const body = wav.sampleWav(0.4);
    let sent = null;
    installFetch((u, init) => {
      if (u === 'http://127.0.0.1:8000/v1/audio/speech') {
        sent = JSON.parse(init.body);
        return new Response(body, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      }
      throw new Error(`没料到的请求：${u}`);
    });
    try {
      const out = await world.tools()[0].handler({ text: '本鲸会说话了。', instruction: '这句应该被忽略' }, {});
      assert(!out.failed, `不该失败：${out.text}`);
      assert(Array.isArray(out.blobs) && out.blobs.length === 1, '回执没有 blob');
      eq(sent.input, '本鲸会说话了。', 'input');
      eq(sent.voice, 'voice_01', 'voice');
      eq(sent.lang, 'ZH', 'lang');
      assert(sent.instruction === undefined, 'openai 形态不该发 instruction');
      assert(sent.seed === undefined, 'openai 形态不该发 seed');
    } finally {
      restoreFetch();
    }
  });

  await checkAsync('缺密钥 / 空文本：不联网就失败', async () => {
    const world = makeWorld({}, { key: '' });
    installFetch(() => {
      throw new Error('不该联网');
    });
    try {
      const tool = world.tools()[0];
      const noKey = await tool.handler({ text: '你好' }, {});
      assert(noKey.failed && noKey.text.includes('没有配置'), `缺密钥的回执不对：${noKey.text}`);
      const empty = await tool.handler({ text: '   ' }, {});
      assert(empty.failed && empty.text.includes('text 是空的'), `空文本的回执不对：${empty.text}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------------------
  console.log('WebUI bundle');

  check('纯 ESM：没有顶层 import', () => {
    const src = readFileSync(join(pkgDir, 'dist', 'webui.js'), 'utf8');
    assert(!/^\s*import\s/m.test(src), 'webui bundle 顶层不该有 import');
  });

  await checkAsync('panels 导出形状', async () => {
    const bundle = await import(pathToFileURL(join(pkgDir, 'dist', 'webui.js')).href);
    const panels = bundle.default?.panels ?? {};
    assert(typeof panels.clips?.mount === 'function', '缺 clips.mount');
    assert(typeof panels.status?.mount === 'function', '缺 status.mount');
  });
} catch (err) {
  bad(`未捕获的异常：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
} finally {
  restoreFetch();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n结果：${passed} 项通过，${warned} 个提醒，${failed} 个失败`);
process.exit(failed === 0 ? 0 : 1);
