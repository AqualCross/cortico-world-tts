/**
 * 文本转语音的配置段与文案。
 *
 * 段名是 `config.json` 的 `worlds.tts`。WebUI 热改就地写这个对象，
 * World 每次用时现读，所以这里只有默认值与 schema，不持有副本。
 */

export const ID = 'tts';
export const LABEL = '文本转语音';

/** 合成结果的事件类型：成功带音频附件，失败只有原因。 */
export const EVENT_TYPE = 'tts.voice';
export const EVENT_FAILED_TYPE = 'tts.voice-failed';

/** 桌宠气泡事件；本 World 只读这一种。 */
export const PET_EVENT = 'desktop-pet.self';

/** 交付方式：wait = 工具调用里等；event = 立刻回执，完成后发事件。 */
export const DELIVERIES = Object.freeze(['wait', 'event']);
/** 声音事件去向：archive = 只落事件库；model = 投递到模型事件流。 */
export const EVENT_DELIVERIES = Object.freeze(['archive', 'model']);

/** `worlds.tts` 段的默认值；`enabled` 由框架的 World 开关管理，其余键与 configGroup 里的路径一一对应。 */
export const DEFAULTS = Object.freeze({
  enabled: false,
  protocol: 'dashscope',
  delivery: 'wait',
  eventDelivery: 'archive',
  autoSpeak: false,
  baseUrl: 'https://maas.qianwenaiapi.com',
  apiKeySecret: 'AUDIO_API_KEY',
  model: 'qwen-audio-3.1-tts-flash',
  voice: 'longanhuan_v3.1',
  instruction: '',
  languageHints: '',
  seed: null,
  format: 'wav',
  sampleRate: 24000,
  timeoutMs: 120000,
  saveDir: '',
  keep: 200,
  pushToConsole: true,
});

/** 采样率可选项（Hz）；opus 只支持 8000 / 12000 / 16000 / 24000 / 48000。 */
export const SAMPLE_RATES = Object.freeze([8000, 12000, 16000, 22050, 24000, 44100, 48000]);

const ZH = {
  label: '文本转语音',
  lamp: '语音接口',
  badgeClips: '作品',
  badgeKey: '密钥',
  badgeVoice: '音色',
  keySet: '已填',
  keyUnset: '未填',
  panelClipsTitle: '作品',
  panelClipsDesc: '合成过的语音；可试听、复制路径。',
  panelStatusTitle: '状态',
  panelStatusDesc: '接口、密钥与磁盘占用。',
  readyOk: (model, voice) => `可用：${model} · ${voice}`,
  readyNoBase: '未配置接口地址',
  readyNoKey: '未填密钥',
  readyNoVoice: '未选音色',
  config: {
    title: '文本转语音',
    protocol: '接口协议',
    protocolDesc: '接口形状。',
    delivery: '交付方式',
    deliveryDesc: 'wait = 工具调用里等语音合成完再回；event = 立刻回执，合成完成后作为声音事件送达（去向由「声音事件去向」决定）。',
    eventDelivery: '声音事件去向',
    eventDeliveryDesc: 'archive = 只落事件库，播放扩展能读到，但不唤醒桌宠；model = 投递到对话事件流，桌宠会被唤醒。自动朗读也走这里。',
    autoSpeak: '自动朗读桌宠气泡',
    autoSpeakDesc: '把桌宠在气泡里说的话（say / ask）合成为语音并发成声音事件；只处理启用之后的新气泡，重启不补。本身不出声，播放交给监听这类事件的播放扩展。',
    baseUrl: '接口地址',
    baseUrlDesc: '接口的根地址。',
    keyName: '密钥变量名',
    keyNameDesc: '密钥在 .env 里的变量名；密钥本身在「状态」页填。',
    model: '模型',
    modelDesc: '模型名。',
    voice: '音色',
    voiceDesc: '音色名，区分大小写。',
    instruction: '默认指令',
    instructionDesc: '可选。情绪、方言、角色等；工具参数可临时覆盖。',
    langHint: '语言提示',
    langHintDesc: '可选，留空不发。',
    seed: '随机种子',
    seedDesc: '可选，0–65535；留空不发。',
    format: '音频格式',
    formatDesc: '音频格式；可选项随服务不同。',
    sampleRate: '采样率',
    sampleRateDesc: '采样率（Hz）。',
    timeout: '超时',
    timeoutDesc: '单次合成的等待上限。',
    saveDir: '保存目录',
    saveDirDesc: '留空 = 插件数据目录下的 tts/。',
    keep: '保留条数',
    keepDesc: '超出后删最旧的；0 = 不清理。',
    push: '推送到作品页',
    pushDesc: '合成后实时显示在「作品」页。',
  },
};

const EN = {
  label: 'Text to Speech',
  lamp: 'TTS API',
  badgeClips: 'Clips',
  badgeKey: 'API key',
  badgeVoice: 'Voice',
  keySet: 'set',
  keyUnset: 'missing',
  panelClipsTitle: 'Clips',
  panelClipsDesc: 'Everything synthesized so far; listen or copy the path.',
  panelStatusTitle: 'Status',
  panelStatusDesc: 'Endpoint, key and disk usage.',
  readyOk: (model, voice) => `ready: ${model} · ${voice}`,
  readyNoBase: 'no endpoint configured',
  readyNoKey: 'no API key',
  readyNoVoice: 'no voice selected',
  config: {
    title: 'Text to Speech',
    protocol: 'Protocol',
    protocolDesc: 'Request shape.',
    delivery: 'Delivery',
    deliveryDesc: 'wait = block the tool call until the audio is ready; event = return at once and deliver the audio as an event (where it goes is set by Event destination).',
    eventDelivery: 'Event destination',
    eventDeliveryDesc: 'archive = store the event without waking the pet (a playback extension can still read it); model = deliver it to the conversation, waking the pet. Auto-speak uses the same destination.',
    autoSpeak: 'Speak the pet\'s bubbles',
    autoSpeakDesc: 'Synthesize what the pet says in bubbles (say / ask) into speech events; only new bubbles after this is enabled, nothing is replayed on restart. It does not play sound; a playback extension listening for these events does.',
    baseUrl: 'Endpoint',
    baseUrlDesc: 'Root URL of the API.',
    keyName: 'Secret name',
    keyNameDesc: 'Name of the secret in .env; the key itself goes on the Status panel.',
    model: 'Model',
    modelDesc: 'Model name.',
    voice: 'Voice',
    voiceDesc: 'Voice name, case-sensitive.',
    instruction: 'Default instruction',
    instructionDesc: 'Optional emotion, dialect or role hint; the tool argument overrides it.',
    langHint: 'Language hint',
    langHintDesc: 'Optional; empty sends nothing.',
    seed: 'Seed',
    seedDesc: 'Optional seed, 0–65535; empty sends nothing.',
    format: 'Audio format',
    formatDesc: 'Audio format; the choices depend on the provider.',
    sampleRate: 'Sample rate',
    sampleRateDesc: 'Sample rate in Hz.',
    timeout: 'Timeout',
    timeoutDesc: 'How long one synthesis may take.',
    saveDir: 'Save directory',
    saveDirDesc: 'Empty means the plugin data directory plus tts/.',
    keep: 'Keep',
    keepDesc: 'Oldest clips are pruned above this count; 0 disables pruning.',
    push: 'Push to Clips panel',
    pushDesc: 'Show new clips live on the Clips panel.',
  },
};

export function text(language = 'zh') {
  return language === 'en' ? EN : ZH;
}

/** WebUI 的配置组；路径必须落在 `worlds.tts.` 段内，且每个键都在 DEFAULTS 里有对应项。 */
export function configGroup(language = 'zh') {
  const t = text(language).config;
  const K = `worlds.${ID}`;
  return {
    id: `world:${ID}`,
    owner: `world:${ID}`,
    schema: {
      type: 'object',
      title: t.title,
      properties: {
        [`${K}.protocol`]: {
          type: 'string',
          title: t.protocol,
          description: t.protocolDesc,
          enum: ['dashscope', 'openai'],
          'x-hot': true,
        },
        [`${K}.delivery`]: {
          type: 'string',
          title: t.delivery,
          description: t.deliveryDesc,
          enum: [...DELIVERIES],
          'x-hot': true,
        },
        [`${K}.baseUrl`]: { type: 'string', title: t.baseUrl, description: t.baseUrlDesc, 'x-hot': true },
        [`${K}.apiKeySecret`]: { type: 'string', title: t.keyName, description: t.keyNameDesc },
        [`${K}.model`]: { type: 'string', title: t.model, description: t.modelDesc, 'x-hot': true },
        [`${K}.voice`]: { type: 'string', title: t.voice, description: t.voiceDesc, 'x-hot': true },
        [`${K}.instruction`]: { type: 'string', title: t.instruction, description: t.instructionDesc, 'x-hot': true },
        [`${K}.languageHints`]: { type: 'string', title: t.langHint, description: t.langHintDesc, 'x-hot': true },
        [`${K}.seed`]: {
          type: 'integer',
          title: t.seed,
          description: t.seedDesc,
          minimum: 0,
          maximum: 65535,
          nullable: true,
          'x-hot': true,
        },
        [`${K}.format`]: {
          type: 'string',
          title: t.format,
          description: t.formatDesc,
          enum: ['wav', 'mp3', 'pcm', 'opus'],
          'x-hot': true,
        },
        [`${K}.sampleRate`]: {
          type: 'integer',
          title: t.sampleRate,
          description: t.sampleRateDesc,
          enum: [...SAMPLE_RATES],
          'x-suffix': 'Hz',
          'x-hot': true,
        },
        [`${K}.timeoutMs`]: {
          type: 'integer',
          title: t.timeout,
          description: t.timeoutDesc,
          minimum: 10000,
          maximum: 900000,
          multipleOf: 1000,
          'x-suffix': 'ms',
          'x-hot': true,
        },
        [`${K}.saveDir`]: {
          type: 'string',
          title: t.saveDir,
          description: t.saveDirDesc,
          'x-path': { kind: 'directory' },
          'x-hot': true,
        },
        [`${K}.keep`]: {
          type: 'integer',
          title: t.keep,
          description: t.keepDesc,
          minimum: 0,
          maximum: 5000,
          multipleOf: 10,
          'x-suffix': ' 条',
        },
        [`${K}.pushToConsole`]: { type: 'boolean', title: t.push, description: t.pushDesc, 'x-hot': true },
        [`${K}.eventDelivery`]: {
          type: 'string',
          title: t.eventDelivery,
          description: t.eventDeliveryDesc,
          enum: [...EVENT_DELIVERIES],
          'x-hot': true,
        },
        [`${K}.autoSpeak`]: { type: 'boolean', title: t.autoSpeak, description: t.autoSpeakDesc, 'x-hot': true },
      },
    },
  };
}
