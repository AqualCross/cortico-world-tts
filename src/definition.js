/**
 * WorldDefinition：装配层在构造所有可用定义时也会跑 create()，
 * 所以构造函数必须是纯的（不建目录、不发请求、不读密钥也行）。
 */
import { DEFAULTS, ID, LABEL } from './config.js';
import { TtsWorld } from './world.js';

export const ttsDefinition = {
  id: ID,
  label: LABEL,
  /** `worlds.tts` 段的默认值；启用与否由部署决定，定义里恒为 false。 */
  defaults: () => structuredClone(DEFAULTS),
  preflight: () => {
    if (typeof fetch !== 'function' || typeof AbortSignal?.timeout !== 'function') {
      throw new Error('语音工坊需要 Node 22+ 的全局 fetch / AbortSignal.timeout');
    }
  },
  create: (ctx) => new TtsWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    botDir: ctx.botDir,
    secret: (name) => ctx.secret(name),
    storeSecret: (name, value) => ctx.storeSecret(name, value),
  }),
};

export default ttsDefinition;
