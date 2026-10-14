/**
 * 语音工坊的配置段与文案。
 *
 * 段名是 `config.json` 的 `worlds.tts`。控制台热改就地写这个对象，
 * World 每次用时现读，所以这里只有默认值与 schema，不持有副本。
 */

export const ID = 'tts';
export const LABEL = '语音工坊';

/** `worlds.tts` 段的默认值；键名与 configGroup 里的路径一一对应。 */
export const DEFAULTS = Object.freeze({
  enabled: false,
  protocol: 'dashscope',
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
  label: '语音工坊',
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
    title: '语音工坊',
    enabled: '启用语音工坊',
    enabledDesc: '开启后桌宠才拿到 tts_speak 工具。',
    protocol: '接口协议',
    protocolDesc: '接口形状。',
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
  label: 'Voice Studio',
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
    title: 'Voice Studio',
    enabled: 'Enable Voice Studio',
    enabledDesc: 'Turns on the tts_speak tool for the bot.',
    protocol: 'Protocol',
    protocolDesc: 'Request shape.',
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

/** 控制台的配置组；路径必须落在 `worlds.tts.` 段内，且每个键都在 DEFAULTS 里有对应项。 */
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
        [`${K}.enabled`]: { type: 'boolean', title: t.enabled, description: t.enabledDesc, 'x-hot': true },
        [`${K}.protocol`]: {
          type: 'string',
          title: t.protocol,
          description: t.protocolDesc,
          enum: ['dashscope', 'openai'],
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
      },
    },
  };
}
