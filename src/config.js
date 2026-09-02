const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  RAW_DIR: path.join(ROOT, 'data', 'raw'),
  DB_PATH: path.join(ROOT, 'data', 'assistant.db'),
  PORT: process.env.PORT || 3000,

  // LLM 适配层（原型阶段关闭，规则+检索归因；接入时填入并置 enabled=true）
  LLM: {
    enabled: false,
    // 兼容 OpenAI 格式：填 baseUrl/apiKey/model 即可（行内网关、智谱 GLM、Ollama 等）
    baseUrl: '',
    apiKey: '',
    model: '',
  },
};
