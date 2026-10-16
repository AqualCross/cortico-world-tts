# 更新日志 · cortico-world-tts

每个版本一节 `## <版本号>`；扩展市场按节显示更新说明。

## 0.1.1

- 适配扩展契约 world 6：World 的 `console()` 改名 `webUi()`，manifest 的 `consoleClient` 改为 `webUiClient`，浏览器面板产物改为 `dist/webui.js`。
- 增加自描述 `describe.json`（工具与事件；由 `pnpm describe:extension` 生成），扩展市场与 `check:extension` 读它。
- 声明市场标签 `voice`。
- 名字从「语音工坊」改为「文本转语音」，与同类扩展的叫法一致。
- 需要 **Coopanion v0.2.0**（内嵌 Cortico v0.2.0）及以上；旧版会拒绝加载本包。

## 0.1.0

- 首个版本：`tts_speak` 工具，支持百炼 Qwen-Audio-TTS（SpeechSynthesizer）与 OpenAI 兼容 `/v1/audio/speech` 两种协议；音频落盘、作为附件交回对话。
- 「作品」与「状态」两个面板：试听、复制路径、删除、离线自检；密钥填写与试听合成。
