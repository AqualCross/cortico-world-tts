# 更新日志 · cortico-world-tts

每个版本一节 `## <版本号>`；扩展市场按节显示更新说明。

## 0.1.4

- 新增异步交付：`worlds.tts.delivery = event`（或 `tts_speak` 的 `delivery` 参数）时，工具立刻回执，合成完成后发 `tts.voice` 事件；失败发 `tts.voice-failed`。
- 新增 `worlds.tts.eventDelivery`：`archive` 只落事件库，`model` 投递到模型事件流；异步交付与自动朗读共用这一个去向。
- 新增 `worlds.tts.autoSpeak`：自动把桌宠气泡（say / ask）合成为语音事件；只处理启用之后的新气泡，重启不补。
- 新增 `tts_control` 工具：桌宠可以读、改 `delivery`、`eventDelivery` 与 `autoSpeak`。
- 声音事件带音频附件与落盘路径，供监听事件的播放扩展（如 `cortico-world-audio-play`）取用。
- 异步回执与事件带同一个请求号；桌宠气泡的语音事件正文注明这是自己的朗读结果、通常不必回应。

## 0.1.3

- 移除配置页里与框架 World 开关重复的「启用」项；World 的启用与停用统一在 World 页。

## 0.1.2

- 修复详情页顶部徽标未随面板状态和操作结果同步更新的问题。

## 0.1.1

- 适配扩展契约 world 6：World 的 `console()` 改名 `webUi()`，manifest 的 `consoleClient` 改为 `webUiClient`，浏览器面板产物改为 `dist/webui.js`。
- 增加自描述 `describe.json`（工具与事件；由 `pnpm describe:extension` 生成），扩展市场与 `check:extension` 读它。
- 声明市场标签 `voice`。
- 名字从「语音工坊」改为「文本转语音」，与同类扩展的叫法一致。
- 需要 **Coopanion v0.2.0**（内嵌 Cortico v0.2.0）及以上；旧版会拒绝加载本包。

## 0.1.0

- 首个版本：`tts_speak` 工具，支持百炼 Qwen-Audio-TTS（SpeechSynthesizer）与 OpenAI 兼容 `/v1/audio/speech` 两种协议；音频落盘、作为附件交回对话。
- 「作品」与「状态」两个面板：试听、复制路径、删除、离线自检；密钥填写与试听合成。
