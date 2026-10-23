# 文本转语音 · cortico-world-tts

给 Coopanion 桌宠加一件事：**把文字合成为语音**。支持两种接口形状（SpeechSynthesizer 与 OpenAI 兼容的 `/v1/audio/speech`，后者可以接本地模型），音频落盘、作为附件进入对话，回执里带绝对路径和附件句柄。也可以先回执、完成后以声音事件交付；开启自动朗读后，桌宠气泡里的发言也会被合成成声音事件。

这是一个 `cortico` 的 **World 扩展**（`kind: world`，`api: 6`），只补一个 `tts` 世界，
不依赖任何第三方 npm 包（纯 ESM JS + Node 内置模块）。

> **它不播放声音，也不自己发送。** 出声与发送是别的工具的事；这份扩展只负责把语音*合成出来*，
> 剩下的（QQ 语音条、本地播放、桌宠自己的嘴）谁有工具谁做。桌面播放可以配
> `cortico-world-audio-play` 的自动监听，把声音事件直接放出来。
>
> MIT 许可，见 [LICENSE](LICENSE)。非官方扩展：与 Coopanion / cortico 的作者无关。

## 它做了什么

装好并启用之后，桌宠会多出两个工具：

| 工具 | 标签 | 作用 |
| --- | --- | --- |
| `tts_speak` | `act` | 把一段文字合成为语音文件（可临时指定音色、`instruction` 与交付方式），落盘、记进列表；同步回执带音频附件，异步则发声音事件 |
| `tts_control` | `act` | 读或改交付方式、声音事件去向、自动朗读开关 |

音频有几条去向：

1. **进对话**：工具回执带 `blobs`，Core 会把它存成句柄，并在模型可见的回执里留一行 `[blob log:… .wav audio/wav]`。
2. **发给别人**：把那个句柄交给渠道工具。例如官方 QQ 世界的 `qq_draft`：
   `{"voice": "log:xxxx.wav"}` 就能发一条语音条（语音条是独立一条消息，`text`、`image`、`reply_to` 都留空）。
3. **自己听**：控制台「文本转语音 → 作品」页点「试听」；或者把回执里的绝对路径交给本地播放工具。
4. **自动播放**：异步与自动朗读发的是声音事件，监听这类事件的播放扩展（如 `cortico-world-audio-play`）可以自动播放，不需要模型再调一次工具。

## 异步交付与自动朗读

- `delivery: wait`（默认）：`tts_speak` 等到音频合成好，把音频作为附件放进回执。
- `delivery: event`：`tts_speak` 立刻回执「已提交」，合成完成后发 `tts.voice` 事件（带音频附件与落盘路径）；失败发 `tts.voice-failed`。回执与事件带同一个请求号（形如 `#p...`），同时挂多条时按它对号。
- `eventDelivery` 决定声音事件去哪：`archive` 只落事件库，不唤醒桌宠，播放扩展仍能读到；`model` 投递到对话事件流。默认 `archive`。
- `autoSpeak: true` 后，桌宠在气泡里说的话（`desktop-pet.self` 的 say / ask）会自动合成成 `tts.voice`，同样受 `eventDelivery` 控制；只处理打开之后的新气泡，重启不补读。say 读 beats 拼起来的正文，ask 只读问题，不读选项。事件正文会注明「这是你自己气泡的朗读结果，通常不必回应」。
- 桌宠可以用 `tts_control` 改这三个开关；`tts_speak` 也能用 `delivery` 参数覆盖单次交付。

声音事件本身不播放。把 `cortico-world-audio-play` 的 `autoPlay` 打开后，它会监听 `tts.voice` 并自动播放。

## 安装

包目录就是你现在看的这个目录。三种装法，选一种：

**A. 控制台里装（推荐）**

设置 → 扩展 → 安装本地扩展，把本目录选给它。

**B. 命令行装**

在 `data/extensions` 目录里（`extensions/package.json` 所在处）执行：

```powershell
pnpm add "D:\path\to\cortico-world-tts" --ignore-workspace
```

它会往 `extensions/package.json` 的 `dependencies` 里写一条 `link:` 路径并连到 `node_modules/`。

**C. 手工连**

把 `data/extensions/node_modules/cortico-world-tts` 做成指向本目录的目录联接，
并自己在 `extensions/package.json` 里加 `"cortico-world-tts": "link:D:\\path\\to\\cortico-world-tts"`。

**装完必须重启 Coopanion**：扩展是 ESM 模块，进程内不会重新加载。重启后在 World 页启用本 World（写 `config.json` 的 `worlds.tts.enabled = true`），`tts_speak` 才会挂给桌宠。

### 一份能用的 `worlds.tts` 长什么样

`<安装目录>\data\home\<bot 目录>\config.json` 里，最小可用的一段：

```json
{
  "worlds": {
    "tts": {
      "enabled": true,
      "baseUrl": "https://maas.qianwenaiapi.com",
      "model": "qwen-audio-3.1-tts-flash",
      "voice": "longanhuan_v3.1",
      "apiKeySecret": "AUDIO_API_KEY",
      "format": "wav",
      "sampleRate": 24000
    }
  }
}
```

密钥本体不写在这里（见下面「密钥」一节）。改之前建议先备份
`config.json`（例如存成 `config.json.bak-tts-<时间戳>`）。

**改完必须重启 Coopanion**：扩展是 ESM 模块，进程内不会重新加载。重启后控制台
左栏会多出「文本转语音」，「作品」页看合成过的音频、「状态」页改配置与密钥。

## 配置

都在 `worlds.tts` 段，控制台「文本转语音 → 状态」里改了就地生效，不用重启：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 是否把 `tts_speak` 挂给桌宠 |
| `protocol` | `dashscope` | `dashscope` = 百炼 Qwen-Audio-TTS；`openai` = OpenAI 兼容的 `/v1/audio/speech`（本地 IndexTTS 这类，不需要 key） |
| `delivery` | `wait` | `wait` = 工具调用里等音频；`event` = 立刻回执，完成后发 `tts.voice` 事件 |
| `baseUrl` | `https://maas.qianwenaiapi.com` | 千问AI平台的接口根地址；接口路径是 `/api/v1/services/audio/tts/SpeechSynthesizer` |
| `apiKeySecret` | `AUDIO_API_KEY` | 密钥的**变量名**：先看部署 `.env`，再退到 `<bot 目录>/../providers/<端点>/.env` |
| `model` | `qwen-audio-3.1-tts-flash` | 模型名 |
| `voice` | `longanhuan_v3.1` | 音色，区分大小写；必须属于当前模型，不能跨模型混用 |
| `instruction` | 空 | 默认指令：情绪、方言、角色，例如「用开心的语气，语速稍快」 |
| `languageHints` | 空 | 可选语言提示：`zh` / `en` / `ja` 等（多个用逗号分隔，接口当前只用第一个）；帮助数字、缩写、符号的读法，留空不发 |
| `seed` | 留空 | 可选随机种子，0–65535：固定后同样的文本/音色/参数复现同样的音频；留空用接口默认（文档说默认 0） |
| `format` | `wav` | `wav` / `mp3` / `pcm` / `opus`；后两个是裸流，多数渠道处理不了 |
| `sampleRate` | `24000` | 8000–48000；opus 只支持 8 / 12 / 16 / 24 / 48 kHz |
| `timeoutMs` | `120000` | 单次合成（含下载音频）的等待上限 |
| `saveDir` | 空 | 留空 = 本插件数据目录下的 `tts/` |
| `keep` | `200` | 超出后自动删最旧的，`0` = 不清理 |
| `pushToConsole` | `true` | 合成完实时推给「作品」页 |
| `eventDelivery` | `archive` | 声音事件去向：`archive` 只落事件库；`model` 投递到对话事件流 |
| `autoSpeak` | `false` | 自动把桌宠气泡（say / ask）合成为声音事件；只处理启用之后的新气泡 |

### 密钥

密钥**不写进 `config.json`**。两种填法：

- 控制台 →「文本转语音 → 状态」→ 把 key 粘进输入框 → 保存。它会写进 `<bot 目录>/.env` 的
  `AUDIO_API_KEY=...`，并立刻在这次进程里生效。
- 自己在那份 `.env` 里写一行 `AUDIO_API_KEY=sk-...`，然后重启。

`apiKeySecret` 改名成别的变量名也行，`.env` 里跟着改。
找不到部署 `.env` 里的那一行时，插件会去 `<bot 目录>/../providers/<端点>/.env`
里挨个找同名变量，找到就用（「状态」页会写密钥来源是哪一份）。

## 接口（阿里云百炼 Qwen-Audio-TTS）

- **端点**：`POST <baseUrl>/api/v1/services/audio/tts/SpeechSynthesizer`，
  `Authorization: Bearer <key>`，`Content-Type: application/json`。
  默认 `baseUrl` 是 `https://maas.qianwenaiapi.com`（千问AI平台，路径与 DashScope 一致）；
  官方文档标注该模型**仅华北 2（北京）地域**可用。
- **非流式请求体**（本扩展用这条）：

  ```json
  {
    "model": "qwen-audio-3.1-tts-flash",
    "input": {
      "text": "要念的正文",
      "voice": "longanhuan_v3.1",
      "format": "wav",
      "sample_rate": 24000,
      "instruction": "用开心的语气",
      "language_hints": ["zh"],
      "seed": 42
    }
  }
  ```

  响应里 `output.audio.url` 是 24 小时有效的下载链接，本扩展拿到后立刻再 GET 一次并落盘。
- **流式**（本扩展暂未使用）：请求头加 `X-DashScope-SSE: enable`，按句在
  `output.audio.data` 里给 base64，按序拼接即可。
- **计费**：按 token（`qwen-audio-3.1-tts-flash`）；响应的 `usage` 会存进列表里。
- **常见错误**：
  - `401 / 403`：密钥不对、没权限，或模型没开通；
  - `404`：接口地址或模型名不对；
  - `429`：限流；
  - `InvalidParameter` + `TTS speak operation failed`：**音色和模型不匹配**——
    `voice` 必须属于当前 `model`，3.1 的音色都是 `*_v3.1` 这种写法。
- **音色**：见百炼文档「Qwen-Audio-TTS音色列表」。默认 `longanhuan_v3.1`（多语种与方言，女声）；
  精品中文如 `yuxiaoyun_v3.1`、`qiaoxiaojiao_v3.1`、`longanlingxi_v3.1`；英文如 `Emily_v3.1`。
  多语种与方言音色北京、新加坡地域都支持；其他类型音色仅北京。
- **想要「它自己的声」**：可以先用百炼的声音复刻 / 声音设计做一条专属音色，
  再把音色名填进 `worlds.tts.voice`。

## 本地 TTS：OpenAI 兼容接口（`protocol: "openai"`）

把 `protocol` 填 `openai`，扩展改走 OpenAI 兼容的 `POST <baseUrl>/v1/audio/speech`：
`baseUrl` 填根地址即可（`http://127.0.0.1:8000` 或 `http://127.0.0.1:8000/v1` 都认），
请求体是扁平的 `{model, input, voice, response_format, sample_rate, lang?}`，响应直接是音频字节。
本地服务通常不需要 key；若服务端起了 `--api-token`，把 token 填进密钥变量即可。

以 IndexTTS-2.5 的 HTTP 服务为例：

```json
{
  "worlds": {
    "tts": {
      "enabled": true,
      "protocol": "openai",
      "baseUrl": "http://127.0.0.1:8000",
      "model": "IndexTTS-2.5",
      "voice": "voice_01",
      "format": "wav",
      "sampleRate": 24000
    }
  }
}
```

- `voice` 填 `characters/` 下的文件名（`GET /v1/audio/voices` 可列出），也接受 `IndexTTS:alex` 或绝对路径；
- `format` 只支持 `mp3` / `wav` / `ogg`（其它值会被当 mp3 发）；
- `languageHints` 的第一个值会映射成 `lang`（ZH / EN / JA / ES / AR），不认识的就不发；
- `instruction`、`seed` 不适用于这套接口（不会发送）；
- 模型加载期间服务端回 503，回执会提示"服务端还在加载模型"；音色名打错回 400，回执会提示去哪看列表。

## 控制台页

- **作品**：合成过的音频列表（正文、音色、时长、大小、时间），试听、复制路径、删除、清空、
  打开文件夹，以及「插入自检音频」——离线造一段 0.6 秒的 wav，走完
  「落盘 → 索引 → 取回 → 试听」，看不到它说明是扩展或面板的问题，不是接口的问题。
- **状态**：密钥填写、试听合成（用当前配置真合成一句并播放）、接口/模型/音色/目录/索引/
  保留条数/最近错误/运行时。

## 自检

离线检查（不联网、不碰安装目录）：

```powershell
node tools/check.mjs
```

用**这套安装里的框架判据**真跑一遍装配检查（manifest 解析、dry-mount、工具名冲突、配置路径）：

```powershell
$env:COOPANION_APP_ROOT = "D:\Coopanion\resources\app"
node --experimental-transform-types tools/drymount.mts
```

联网真合成一条（要部署里已配密钥，会花一点钱）：

```powershell
$env:LIVE_BOT_DIR = "D:\Coopanion\data\home\companion"
node tools/live.mjs        # 可加 LIVE_BASE_URL / LIVE_MODEL / LIVE_VOICE / LIVE_TEXT
```

## 目录结构

```
cortico-world-tts/
├─ package.json        # cortico: { kind: world, api: 6, webUiClient: dist/webui.js, describe: describe.json }
├─ describe.json       # 自描述：工具与事件（pnpm describe:extension 生成，扩展市场与 check:extension 读它）
├─ CHANGELOG.md        # 每个版本一节，扩展市场按版本显示更新说明
├─ README.md
├─ src/
│  ├─ index.js         # 入口：default 导出 WorldDefinition
│  ├─ definition.js    # id/label/defaults/preflight/create/describe
│  ├─ config.js        # worlds.tts 默认值、中英文案、配置组 schema
│  ├─ world.js         # TtsWorld：工具、WebUI 面板、流式推送、生命周期
│  ├─ api.js           # 百炼 HTTP 客户端：请求体、错误归一化、下载、mime 嗅探
│  ├─ clips.js         # 语音仓库：目录 + index.json
│  └─ wav.js           # 时长解析、KB/时长文案、离线自检样本
├─ dist/webui.js       # 浏览器侧面板 bundle（export default { panels }）
└─ tools/
   ├─ check.mjs        # 离线检查
   ├─ drymount.mts     # 用框架自带判据跑 dry-mount
   └─ live.mjs         # 联网真合成一条
```

## 启用之后

- 跟桌宠提一句你现在有 `tts_speak` 了——它若在记忆里记着旧的"借系统嗓音"土办法，
  让它换成这个工具（新工具一次调用就出音频+句柄，不用落工作区再读一遍）。
- 想让它发 QQ 语音条：`qq_draft` 的 `voice` 吃回执里的 `log:` 句柄，或工作区的 `mem:` 句柄。

## 已知限制

- **不播放**：这份扩展只合成，不出声；本地播放要靠别的工具（系统播放器、未来的桌宠能力）。
- 模型读不到音频内容，回执只有文本（文件名、时长、参数）——别指望它"听过"自己的声音。
- 只做非流式调用；长文本（几百字）容易接近超时，一次合成一两句最稳。
- `pcm` / `opus` 是裸流：文件能落盘，但多数渠道与播放器不认，建议 `wav` / `mp3`。
- 音色不能跨模型；换 `model` 记得一起换 `voice`。
- `protocol: openai` 下 `instruction` / `seed` 不适用；`format` 只支持 `mp3` / `wav` / `ogg`。

## 致谢

目录结构、扩展骨架与部分实现（语音仓库、dry-mount 检查等）改编自
[cortico-world-image](https://github.com/Lostdegree/cortico-world-image)（MIT），在此致谢。

## 许可

MIT，见 [LICENSE](LICENSE)。若内容涉及对外发布，请自行评估并遵守所在地区对 AI 生成内容的标识要求。
