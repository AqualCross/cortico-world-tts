/**
 * WorldDefinition：装配层在构造所有可用定义时也会跑 create()，
 * 所以构造函数必须是纯的（不建目录、不发请求、不读密钥也行）。
 */
import { DEFAULTS, EVENT_FAILED_TYPE, EVENT_TYPE, ID, LABEL } from './config.js';
import { TTS_TOOL_DECLS, TtsWorld } from './world.js';

/** 自描述里每个工具配一句给人看的话，按工具名。 */
const TOOL_SUMMARIES = {
  tts_speak: {
    zh: '把一段文字合成为语音；音频落盘并作为附件交回对话，也可以先回执、完成后发声音事件。不播放、也不发送。',
    en: 'Synthesize speech from text; the audio is saved to disk and returned as a conversation attachment, or delivered later as an event. Nothing is played or sent.',
  },
  tts_control: {
    zh: '查看或修改语音的交付方式、声音事件去向和自动朗读开关。',
    en: 'Read or change how speech is delivered: wait/event, the voice event destination, and auto-speak.',
  },
};

/** 与框架 `describeTools()` 相同的拼法：取发给模型的字段，再加一句 summary。 */
function describeTools(decls) {
  return decls.map(({ name, description, parameters, tags }) => ({
    name,
    description,
    parameters,
    tags,
    summary: TOOL_SUMMARIES[name],
  }));
}

export const ttsDefinition = {
  id: ID,
  label: LABEL,
  /** `worlds.tts` 段的默认值；启用与否由部署决定，定义里恒为 false。 */
  defaults: () => structuredClone(DEFAULTS),
  preflight: () => {
    if (typeof fetch !== 'function' || typeof AbortSignal?.timeout !== 'function') {
      throw new Error('文本转语音需要 Node 22+ 的全局 fetch / AbortSignal.timeout');
    }
  },
  create: (ctx) => new TtsWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    botDir: ctx.botDir,
    secret: (name) => ctx.secret(name),
    storeSecret: (name, value) => ctx.storeSecret(name, value),
    persist: typeof ctx.persist === 'function' ? (patch) => ctx.persist(patch) : undefined,
  }),
  /** 自描述：可能出现的全部工具与事件，不进提示词。`describe:extension` 把它导出成 describe.json。 */
  describe: {
    tools: describeTools(TTS_TOOL_DECLS),
    events: [{
      type: EVENT_TYPE,
      description: {
        zh: '语音合成完成：正文带参数摘要，附件是一段语音；异步交付与自动朗读都发这条。',
        en: 'A finished synthesis: the text carries the parameters and the attachment is the audio; both async delivery and auto-speak emit it.',
      },
      trigger: 'debounce',
    }, {
      type: EVENT_FAILED_TYPE,
      description: {
        zh: '语音合成失败：正文是原因，没有附件。',
        en: 'A failed synthesis: the text is the reason, with no attachment.',
      },
      trigger: 'debounce',
    }],
  },
};

export default ttsDefinition;
