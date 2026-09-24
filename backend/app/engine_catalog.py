"""Service presets. Model IDs remain editable; presets never migrate saved choices."""
from dataclasses import dataclass


@dataclass(frozen=True)
class EnginePreset:
    name: str
    base_url: str
    models: tuple[str, ...] = ()
    key_required: bool = True
    protocol: str = "openai"
    description: str = ""
    urls: tuple[str, ...] = ()


PRESETS = {
    "deepseek": EnginePreset("DeepSeek", "https://api.deepseek.com", ("deepseek-v4-flash", "deepseek-v4-pro")),
    "kimi": EnginePreset("Kimi", "https://api.moonshot.cn/v1", ("kimi-k2.6", "kimi-k3"),
        description="请选择与你的密钥所属平台一致的国内或国际地址。", urls=("https://api.moonshot.cn/v1", "https://api.moonshot.ai/v1")),
    "glm": EnginePreset("智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", ("glm-5.3",),
        description="使用智谱开放平台的通用 API 密钥；这里不使用 Coding 套餐地址。"),
    "openai": EnginePreset("OpenAI", "https://api.openai.com/v1", ("gpt-4.1", "gpt-4.1-mini")),
    "claude": EnginePreset("Claude", "https://api.anthropic.com/v1", ("claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"), protocol="anthropic"),
    "gemini": EnginePreset("Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", ("gemini-2.5-flash", "gemini-2.5-pro"), protocol="gemini"),
    "openrouter": EnginePreset("OpenRouter", "https://openrouter.ai/api/v1", description="可读取平台模型列表。请选择支持文本对话和 JSON 输出的模型。"),
    "siliconflow": EnginePreset("硅基流动", "https://api.siliconflow.cn/v1", ("deepseek-ai/DeepSeek-V4-Flash",),
        urls=("https://api.siliconflow.cn/v1", "https://api.siliconflow.com/v1")),
    "ollama": EnginePreset("Ollama（本地）", "http://localhost:11434/v1", key_required=False,
        description="先启动 Ollama 并下载模型，再读取本机模型列表。"),
    "lmstudio": EnginePreset("LM Studio（本地）", "http://localhost:1234/v1", key_required=False,
        description="先在 LM Studio 中启动本地服务并加载模型。"),
    "compatible": EnginePreset("其他编辑引擎（自定义服务）", "", key_required=False,
        description="填写兼容 Chat Completions 的基础地址，模型须支持 JSON 输出。"),
}
