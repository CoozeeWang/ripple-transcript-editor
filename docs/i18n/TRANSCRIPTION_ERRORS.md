# 转录与诊断提示

以下为现行简体中文、繁體中文（台灣）和 English 对照。维护资源时同步更新此表；使用场景、动态参数和诊断分类保持一致，不将私人验收记录或供应商原始响应写入此文档。

## 三语文案

| 消息键 | 使用场景 | 简体中文 | 繁體中文（台灣） | English |
| --- | --- | --- | --- | --- |
| `transcriptionErrors.durationLimit` | 已确认的当前音频超过所选引擎时长上限；提交前阻止。 | 音频时长为 {{duration}}，超过“{{engine}}”的 {{limit}} 上限，尚未提交转录。 | 音訊長度為 {{duration}}，超過「{{engine}}」的 {{limit}} 上限，尚未送出轉錄。 | This audio is {{duration}} long, exceeding the {{limit}} limit for “{{engine}}”. It has not been submitted for transcription. |
| `transcriptionErrors.decodeFailed` | 供应商返回无法解码或不支持音频；作为主错误，不把操作建议当原因。 | 转录引擎无法解码或不支持这段音频。 | 轉錄引擎無法解碼或不支援這段音訊。 | The transcription engine cannot decode this audio or does not support it. |
| `transcriptionErrors.inputLimit` | 诊断原因分类；对应稳定分类码 `input_limit`。 | 音频超过所选引擎的限制 | 音訊超過所選引擎的限制 | Audio exceeds the selected engine’s limits |
| `useTranscription.m1154` | 超时长后的操作建议；本轮更新既有条目。 | 请切分音频，或改用支持更长音频的引擎。 | 請分割音訊，或改用支援更長音訊的引擎。 | Split the audio, or choose an engine that supports longer recordings. |

## 转录入口与确认

标题行右侧的图标只打开现有转录设置。已有稿件时，确认前说明新增原始稿及保留范围；点击确认后才调用引擎。此音频正在转录时禁用入口，不区分首次与再次转录的按钮名称。

| 消息键 | 简体中文 | 繁體中文（台灣） | English |
| --- | --- | --- | --- |
| `transcriptionAction.transcribe` | 转录音频 | 轉錄音訊 | Transcribe audio |
| `transcriptionAction.running` | 此音频正在转录，完成或取消后可再次转录。 | 此音訊正在轉錄，完成或取消後可再次轉錄。 | This audio is being transcribed. Wait for it to finish or cancel before starting again. |
| `transcriptionAction.editingLocked` | 请先结束当前 AI 编辑任务，再转录音频。 | 請先結束目前的 AI 編輯任務，再轉錄音訊。 | End the current AI editing task before transcribing this audio. |
| `transcriptionAction.loading` | 稿件正在切换，请稍候。 | 稿件正在切換，請稍候。 | Switching versions. Please wait. |
| `transcriptionAction.audioUnavailable` | 音频尚未就绪，请先恢复音频访问。 | 音訊尚未就緒，請先恢復音訊存取權限。 | The audio is not ready. Restore audio access first. |
| `transcriptionAction.preserve` | 将生成新的原始转录稿，已有稿件保留。 | 將產生新的原始轉錄稿，既有稿件保留。 | A new original transcript will be created. Existing versions will be kept. |
| `transcriptionAction.preserveDetails` | 原有原始稿、修改稿、批注和高亮均不会被覆盖或删除。 | 原有原始稿、修改稿、批註和醒目提示均不會被覆寫或刪除。 | Existing originals, edited versions, annotations and highlights will not be overwritten or deleted. |
| `transcriptionAction.confirm` | 确认并开始转录 | 確認並開始轉錄 | Confirm and start transcription |

## 原始稿归属

项目页与版本菜单按“原始稿 → 相关修改稿各版本”展示，修改稿之间不分层级。未关联稿件及来源原稿不在当前列表时，使用中性说明，不误挂靠到其他原始稿。

| 消息键 | 简体中文 | 繁體中文（台灣） | English |
| --- | --- | --- | --- |
| `originalGroups.unlinked` | 未关联原始稿 | 未關聯原始稿 | No linked original |
| `originalGroups.unavailable` | 来源原始稿不在当前列表中 | 來源原始稿不在目前清單中 | The source original is not in this list |

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
