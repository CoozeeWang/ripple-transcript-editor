# 引擎服务预设（2026-09-21）

本次范围：DeepSeek、Kimi、智谱 GLM、OpenAI、Claude、Gemini；聚合平台 OpenRouter、硅基流动；本机 Ollama、LM Studio；其他 OpenAI 兼容服务。阿里、豆包及新增转录服务留待后续。

## 配置体验

设置主页只显示已保存的配置，默认配置仍在最上方。在添加配置中选择服务，自动填入地址及部分模型选项。模型可手动填写；读取模型列表不会改变当前选择。常规官方地址位于高级设置，国内/国际地址直接展示。官方入口只允许对应官方地址；其他兼容代理使用自定义入口。原有自定义配置不会被迁移或替换。

读取列表与测试使用当前表单，不自动保存。测试连接会发出一个简短的付费可能请求，只验证连接和简单结构化响应，不代表真实文稿编辑质量。请求不含文稿。列表接口不可用时仍可使用预设或手动 ID。聚合平台、本地模型以及手动填写的模型需要自身支持文本对话与 JSON 输出；列表存在不等于全部模型已适配。预设模型不是自动追踪“最新版本”的别名；已保存 ID 保持原样。

## 调用与存储

- 兼容服务使用 Chat Completions + JSON object。
- Claude 使用 Messages、x-api-key、固定结果工具（强制单工具返回）；工具仅作为结构化结果容器，不执行操作。
- Gemini 使用官方 OpenAI 兼容接口和 JSON schema。
- 全部经过 Ripple 原有结果验证；截断或格式错误不能作为成功结果应用。
- 原有 store 的新增 provider 分组按需补齐；保留 profile ID、默认选择、模型和密钥。普通兼容协议的版本指纹算法保持不变，不使旧的续传记录失效。
- 列表与测试不写入凭据，不把上游原始错误或密钥回传前端。
- 转录仅整理现有字段：Whisper 预填基础地址和模型；FunASR 预填主机与端口。保留 GPT 转录模型尚未适配的说明。

## 验证边界

通过模拟上游的协议、迁移、密钥隔离、错误分类及表单交互测试，构建通过。浏览器检查服务切换、Claude 表单、Kimi 地区地址和原有默认配置。未使用真实供应商密钥进行付费请求；真实音频/文稿效果尚待用户账户验收。

## 官方参考

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- [Claude tool choice](https://platform.claude.com/cookbook/tool-use-tool-choice)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Kimi 快速开始](https://platform.kimi.com/docs/get-api-key)
- [智谱 API](https://docs.bigmodel.cn/cn/api/introduction)
- [DeepSeek](https://api-docs.deepseek.com/)
- [硅基流动](https://docs.siliconflow.cn/docs/api/chat-completions-post)
- [OpenRouter](https://openrouter.ai/docs/api_reference/overview)
- [Ollama](https://docs.ollama.com/api/openai-compatibility)
- [LM Studio](https://lmstudio.ai/docs/developer/openai-compat)
