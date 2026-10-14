/**
 * 扩展入口：默认导出必须是 WorldDefinition。
 * `cortico.kind = world`、`api = 5` 与 `keywords` 里的 `cortico-world` 见 package.json。
 */
import definition, { ttsDefinition } from './definition.js';

export default definition;
export { ttsDefinition };
export { TtsWorld } from './world.js';
export { ID as TTS_WORLD_ID, DEFAULTS as TTS_DEFAULTS } from './config.js';
