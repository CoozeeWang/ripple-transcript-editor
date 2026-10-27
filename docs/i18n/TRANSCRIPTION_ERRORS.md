# 转录与诊断提示

以下为现行简体中文、繁體中文（台灣）和 English 对照。维护资源时同步更新此表；使用场景、动态参数和诊断分类保持一致，不将私人验收记录或供应商原始响应写入此文档。

## 三语文案

| 消息键 | 使用场景 | 简体中文 | 繁體中文（台灣） | English |
| --- | --- | --- | --- | --- |
| `transcriptionErrors.durationLimit` | 已确认的当前音频超过所选引擎时长上限；提交前阻止。 | 音频时长为 {{duration}}，超过“{{engine}}”的 {{limit}} 上限，尚未提交转录。 | 音訊長度為 {{duration}}，超過「{{engine}}」的 {{limit}} 上限，尚未送出轉錄。 | This audio is {{duration}} long, exceeding the {{limit}} limit for “{{engine}}”. It has not been submitted for transcription. |
| `transcriptionErrors.decodeFailed` | 供应商返回无法解码或不支持音频；作为主错误，不把操作建议当原因。 | 转录引擎无法解码或不支持这段音频。 | 轉錄引擎無法解碼或不支援這段音訊。 | The transcription engine cannot decode this audio or does not support it. |
| `transcriptionErrors.inputLimit` | 诊断原因分类；对应稳定分类码 `input_limit`。 | 音频超过所选引擎的限制 | 音訊超過所選引擎的限制 | Audio exceeds the selected engine’s limits |
| `useTranscription.m1154` | 超时长后的操作建议；本轮更新既有条目。 | 请切分音频，或改用支持更长音频的引擎。 | 請分割音訊，或改用支援更長音訊的引擎。 | Split the audio, or choose an engine that supports longer recordings. |

## 参数与显示约定

- `duration`：当前音频由播放器确认稳定后的时长，采用 `HH:MM:SS`，例如 `03:06:09`。未知值、无效值和其他音频的时长均不能用于判定超限。
- `limit`：所选引擎声明的最长时长，采用同样的 `HH:MM:SS`，例如 `02:00:00`。恰好达到上限允许提交。
- `engine`：所选转录引擎名称，沿用服务目录的本地化；不改写用户自定义名称、音频文件名或稿件内容。
- 已确认超限时，不上传音频、不创建转录稿；提示保留到关闭或重新选择引擎。未知时长不据此阻止原有转录流程。
- 解码错误本身不能证明音频损坏或时长超限。主错误说明引擎无法读取音频，下一步建议另行显示；两者文字相同时只显示一次。
- `input_limit` 是诊断分类码，三语保持同一个机器值，用户可读的原因由 `transcriptionErrors.inputLimit` 翻译。不把它归入格式或输出长度错误。

## 产品版本

版本值不翻译。复制错误详情、导出诊断环境及后端诊断使用产品版本；来源为 `desktop/src-tauri/tauri.conf.json`，不能使用前端或 Python 工程包的版本号。后端打包时将同一版本写入只读代码资源 `product-version.json`，搬移到 Mac 或 Windows 安装目录后仍能读取；不能从用户数据目录加载产品身份。版本缺失或无效时返回 `unknown`，不冒充旧版本。

检查入口：`node scripts/i18n-audit.mjs`、诊断版本测试、转录时长边界与三语错误映射测试，以及 [合成提示页面](../../frontend/tests/transcription-errors-review.md)。浏览器和隔离 WebKit 结果不代表安装版或 Windows 实机验收。
