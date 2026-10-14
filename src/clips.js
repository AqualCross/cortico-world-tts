/**
 * 语音仓库：一个目录 + 一份 index.json。
 *
 * 只有本进程写它，索引常驻内存，落盘走「写临时文件再 rename」。
 * 索引损坏或文件被外部删掉时不抛错，静默当空/跳过，避免一个坏文件把整个 World 卡死。
 */
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const INDEX_FILE = 'index.json';
const VERSION = 1;

const EXT_BY_MIME = {
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/pcm': 'pcm',
};

const MIME_BY_EXT = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  pcm: 'audio/pcm',
};

const pad = (n, width = 2) => String(n).padStart(width, '0');

function stampOf(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function newId() {
  return randomBytes(4).toString('hex');
}

function intOf(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function secondsOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export class Clips {
  #items = [];
  #loaded = false;

  /** @param {{dir: string, keep?: number}} opts */
  constructor(opts = {}) {
    this.dir = String(opts.dir ?? '.');
    this.keep = intOf(opts.keep, 200);
  }

  get indexFile() {
    return join(this.dir, INDEX_FILE);
  }

  ensure() {
    mkdirSync(this.dir, { recursive: true });
    return this.dir;
  }

  get count() {
    this.#load();
    return this.#items.length;
  }

  get totalBytes() {
    this.#load();
    return this.#items.reduce((sum, item) => sum + intOf(item.bytes), 0);
  }

  list(limit = 24) {
    this.#load();
    const n = Math.max(0, intOf(limit, 24));
    return this.#items.slice(0, n || this.#items.length).map((item) => this.#hydrate(item));
  }

  get(ref) {
    this.#load();
    const key = String(ref ?? '').trim();
    if (!key) return null;
    const lower = key.toLowerCase();
    const item = this.#items.find((it) => it.id === lower
      || it.file.toLowerCase() === lower
      || it.path.toLowerCase() === lower
      || it.path.toLowerCase() === resolve(key).toLowerCase());
    return item ? this.#hydrate(item) : null;
  }

  /** 存一段语音并返回记录；`bytes` 是 Buffer/Uint8Array。 */
  add(entry) {
    this.#load();
    this.ensure();
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    const mime = String(entry.mime ?? 'audio/wav');
    const ext = String(entry.ext ?? EXT_BY_MIME[mime] ?? 'wav').replace(/^\./, '').toLowerCase();
    const now = new Date();
    const id = newId();
    const file = `${stampOf(now)}-${id}.${ext}`;
    const path = join(this.dir, file);
    writeFileSync(path, bytes);
    const item = {
      id,
      file,
      path,
      mime: MIME_BY_EXT[ext] ?? mime,
      ext,
      bytes: bytes.length,
      seconds: secondsOf(entry.seconds),
      text: String(entry.text ?? '').slice(0, 2000),
      note: String(entry.note ?? '').slice(0, 200),
      voice: String(entry.voice ?? ''),
      model: String(entry.model ?? ''),
      instruction: String(entry.instruction ?? '').slice(0, 500),
      format: String(entry.format ?? ext),
      sampleRate: intOf(entry.sampleRate),
      usage: entry.usage && typeof entry.usage === 'object' ? entry.usage : null,
      source: String(entry.source ?? 'api'),
      createdAt: now.toISOString(),
    };
    this.#items.unshift(item);
    this.#prune();
    this.#save();
    return this.#hydrate(item);
  }

  remove(ref) {
    this.#load();
    const item = this.get(ref);
    if (!item) return false;
    this.#items = this.#items.filter((it) => it.id !== item.id);
    this.#unlink(item.path);
    this.#save();
    return true;
  }

  clear() {
    this.#load();
    const removed = this.#items.length;
    for (const item of this.#items) this.#unlink(item.path);
    this.#items = [];
    this.#save();
    return removed;
  }

  summary(limit = 60) {
    this.#load();
    const n = Math.max(1, intOf(limit, 60));
    return {
      dir: this.dir,
      indexFile: this.indexFile,
      keep: this.keep,
      count: this.#items.length,
      totalBytes: this.totalBytes,
      shown: Math.min(n, this.#items.length),
      items: this.#items.slice(0, n).map((item) => this.#hydrate(item)),
    };
  }

  /** 对外（模型、浏览器）的形态：不暴露 Buffer，路径是绝对路径。 */
  #hydrate(item) {
    return { ...item };
  }

  #unlink(path) {
    try {
      rmSync(path, { force: true });
    } catch {
      /* 文件已经不在了，或者被别的程序占着；索引照删。 */
    }
  }

  #prune() {
    if (!this.keep || this.#items.length <= this.keep) return;
    const dropped = this.#items.splice(this.keep);
    for (const item of dropped) this.#unlink(item.path);
  }

  #load() {
    if (this.#loaded) return;
    this.#loaded = true;
    const file = this.indexFile;
    if (!existsSync(file)) {
      this.#items = [];
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      parsed = null;
    }
    const raw = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(raw)) {
      this.#items = [];
      return;
    }
    const items = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') continue;
      const path = typeof entry.path === 'string' && isAbsolute(entry.path)
        ? entry.path
        : join(this.dir, entry.file);
      let bytes = intOf(entry.bytes);
      try {
        if (!existsSync(path)) continue;
        bytes = statSync(path).size;
      } catch {
        continue;
      }
      const ext = String(entry.ext ?? path.split('.').pop() ?? 'wav').toLowerCase();
      items.push({
        id: typeof entry.id === 'string' && entry.id ? entry.id : newId(),
        file: entry.file,
        path,
        mime: String(entry.mime ?? MIME_BY_EXT[ext] ?? 'audio/wav'),
        ext,
        bytes,
        seconds: secondsOf(entry.seconds),
        text: String(entry.text ?? ''),
        note: String(entry.note ?? ''),
        voice: String(entry.voice ?? ''),
        model: String(entry.model ?? ''),
        instruction: String(entry.instruction ?? ''),
        format: String(entry.format ?? ext),
        sampleRate: intOf(entry.sampleRate),
        usage: entry.usage && typeof entry.usage === 'object' ? entry.usage : null,
        source: String(entry.source ?? 'api'),
        createdAt: String(entry.createdAt ?? new Date().toISOString()),
      });
    }
    this.#items = items;
    const before = items.length;
    this.#prune();
    if (this.#items.length !== before) this.#save();
  }

  #save() {
    try {
      this.ensure();
      const body = JSON.stringify({ version: VERSION, items: this.#items }, null, 2);
      const tmp = `${this.indexFile}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, this.indexFile);
    } catch {
      /* 磁盘写不进去时不让合成失败；下一次成功写入会覆盖。 */
    }
  }
}
