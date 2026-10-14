#!/usr/bin/env node
/**
 * 联网真合成一条：拿部署里已配的密钥（只读 .env，不打印密钥），
 * 走完「接口 → 下载 → 落盘 → 索引」整条路，音频存在临时目录里。
 *
 * 跑法：
 *   $env:LIVE_BOT_DIR = "D:\Coopanion\data\home\companion"   # 必填
 *   node tools/live.mjs
 * 可加 LIVE_BASE_URL / LIVE_MODEL / LIVE_VOICE / LIVE_KEY_SECRET / LIVE_TEXT。
 * 没有配好密钥、或不想花这份钱，就别跑。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const botDir = process.env.LIVE_BOT_DIR;
if (!botDir || !existsSync(botDir)) {
  console.error('先用 LIVE_BOT_DIR 指一个部署目录（里面有 .env），例如 D:\\Coopanion\\data\\home\\companion');
  process.exit(2);
}

const secretName = process.env.LIVE_KEY_SECRET || 'AUDIO_API_KEY';
const env = readFileSync(join(botDir, '.env'), 'utf8');
const hit = new RegExp(`^\\s*${secretName}\\s*=\\s*(\\S+)`, 'm').exec(env);
if (!hit) {
  console.error(`部署 .env 里没有 ${secretName} 这一行`);
  process.exit(2);
}

const { synthesizeSpeech } = await import(pathToFileURL(join(pkgDir, 'src', 'api.js')).href);
const { Clips } = await import(pathToFileURL(join(pkgDir, 'src', 'clips.js')).href);
const { wavDuration, formatSeconds } = await import(pathToFileURL(join(pkgDir, 'src', 'wav.js')).href);

const opts = {
  baseUrl: process.env.LIVE_BASE_URL || 'https://maas.qianwenaiapi.com',
  apiKey: hit[1],
  model: process.env.LIVE_MODEL || 'qwen-audio-3.1-tts-flash',
  voice: process.env.LIVE_VOICE || 'longanhuan_v3.1',
  text: process.env.LIVE_TEXT || '你好，我是本鲸。这是一条联网自检的语音。',
  format: 'wav',
  sampleRate: 24000,
  timeoutMs: 180000,
};

console.log(`合成中：${opts.model} · ${opts.voice} · ${opts.baseUrl}`);
const started = Date.now();
const res = await synthesizeSpeech(opts);

const dir = mkdtempSync(join(tmpdir(), 'tts-live-'));
const clips = new Clips({ dir, keep: 0 });
const item = clips.add({
  bytes: res.bytes,
  mime: res.mime,
  seconds: wavDuration(res.bytes),
  text: opts.text,
  note: '联网自检',
  voice: opts.voice,
  model: opts.model,
  format: res.format,
  sampleRate: opts.sampleRate,
  usage: res.usage,
  source: 'live',
});
writeFileSync(join(dir, 'README.txt'), '这是联网自检的临时目录，随时可以删。\n');

console.log('完成：');
console.log(`  文件：${item.path}`);
console.log(`  大小：${item.bytes} 字节 · 时长：${item.seconds ? formatSeconds(item.seconds) : '(读不出)'} · 延迟：${Date.now() - started} ms`);
console.log(`  mime：${item.mime} · 用量：${res.usage ? JSON.stringify(res.usage) : '(接口没给)'}`);
console.log(`  放起来听：把路径交给系统播放器或别的工具试试。`);
console.log(`  这个目录没被清掉，方便你试听：${dir}`);
