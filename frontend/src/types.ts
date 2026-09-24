export interface AudioInfo {
  filename: string;
  duration: number;
}

export interface Speaker {
  id: string;
  name: string;
  /** 配色槽位（0..3），合并/重排时保持稳定，不随 speakers 数组顺序漂移。缺省时回退到数组位置。 */
  colorIndex?: number;
  /** 用户选择的强调色，使用六位十六进制颜色。 */
  color?: string;
}

export interface WordOrigin {
  model: string;
  segment: string;
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface Word {
  /** Immutable coordinates in the model's original transcript, separate from version comparison. */
  origins?: WordOrigin[];
  timing?: "source" | "replacement" | "approximate" | "unresolved";
  text: string;
  start: number;
  end: number;
  speaker_id?: string;
}

export interface Annotation {
  id: string;
  text: string;
  createdAt: string;
}

/** 片段内的一处高亮：编辑辅助记号，不参与任何导出（md/txt/docx/pdf/JSON 一律剥离）。
 *  范围相对所属 segment 的 text，左闭右开 [start, end)。编辑文本时由 reanchorRanges 重锚。 */
export interface Highlight {
  id: string;
  start: number;
  end: number;
}

export interface Segment {
  id: string;
  speaker_id: string;
  start: number;
  end: number;
  text: string;
  words?: Word[];
  annotations?: Annotation[];
  highlights?: Highlight[];
  /** IDs retained from actual merge operations; old files may omit this. */
  mergedFrom?: string[];
  splitFrom?: string;
}

export interface Transcript {
  timeAligned?: boolean;
  /** Display confirmations scoped to a comparison version and segment; never manuscript text. */
  comparisonReviews?: Record<string, {segmentId:string; before:string; accepted:string[]}>;
  /** Last segment whose text or speaker was edited; playback does not change it. */
  lastEditedSegmentId?: string;
  audio: AudioInfo;
  speakers: Speaker[];
  segments: Segment[];
  /** Explicit approval of a specific segment revision; never inferred from edits. */
  reviewedSegments?: Record<string, string>;
}

export interface Participant {
  name: string;
  role: string;
}

export interface InterviewDraft {
  title: string;
  recorded_at: string | null;
  location: string;
  participants: Participant[];
  topics: string[];
  notes: string;
}

export interface InterviewMetadata extends InterviewDraft {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface AudioStatus {
  exists: boolean;
  filename: string | null;
}

export interface ProviderStatus {
  provider: string;
  configured: boolean;
}

/** 设置一个引擎所需的凭据字段描述（来自后端，不含任何密钥值）。 */
export interface CredentialField {
  options?: string[];
  advanced?: boolean;
  read_only?: boolean;
  allow_custom?: boolean;
  description?: string;
  default_value?: string;
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
  required: boolean;
}

/** 引擎能力声明。前端据此决定哪些转录选项可见，不给用户看用不了的开关。 */
export interface ProviderCapabilities {
  diarization: boolean;
  language_selection: boolean;
  speaker_count_hint: boolean;
  audio_events: boolean;
  word_timestamps: boolean;
  max_duration_seconds?: number | null;
  max_file_bytes?: number | null;
}

/** 给前端渲染用的引擎描述（不含任何密钥）。 */
export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  capabilities: ProviderCapabilities;
  models: string[];
  credential_fields: CredentialField[];
  experimental?: boolean;
}

/** 一套命名凭据档案的概要（不含任何密钥值）。 */
export interface CredentialProfile {
  public_values?: Record<string, string>;
  id: string;
  name: string;
  /** 是否为该引擎当前「启用」的那套（镜像进 .env，手动选该引擎时使用）。 */
  active: boolean;
  /** 是否为跨引擎唯一的「全局默认」配置（转录默认优先使用）。 */
  is_default?: boolean;
  /** 已填写的字段 key 列表（用于徽标提示，不暴露值）。 */
  field_keys_present: string[];
}

/** 某个引擎的凭据档案列表视图。 */
export interface CredentialListView {
  provider_id: string;
  provider_name: string;
  experimental: boolean;
  fields: CredentialField[];
  profiles: CredentialProfile[];
  active_profile_id: string | null;
  /** 跨引擎唯一的全局默认档案标记，没有则为 null。 */
  default_profile?: { provider_id: string; profile_id: string } | null;
}

/** GET /api/credentials/default 的返回。 */
export interface DefaultCredentialView {
  default_profile: { provider_id: string; profile_id: string } | null;
}

export interface TranscriptionOptions {
  language_code: string | null;
  num_speakers: number | null;
  diarize: boolean;
  tag_audio_events: boolean;
  timestamps_granularity: "word" | "character";
}

// ---- 多版本转录存储（范式 B：旁挂 .transcript/ 目录） ----
// 二维模型：models[] = 模型（某引擎一次转录）列表；每个 model 含原稿 original（只读）
// 与修改稿迭代 edits[]（可 v1/v2/v3 并存）。schemaVersion: 2。

export interface TranscriptEdit {
  /** Source version for the default comparison; same model, stable edit id. */
  comparisonBaseId?: string;
  id: string; // 模型内稳定序号，如 "e1","e2"…
  label?: string; // 可选自定义显示名（默认 "修改稿 vN"，N = edits 内位置从 1 起）
  file: string; // 修改稿文件名，如 "<modelId>-e1.json"
  updated_at: string;
}

export interface TranscriptModel {
  designatedOriginal?: boolean;
  designatedOriginalEditId?: string;
  sourceKind?: "transcription" | "import";
  sourceName?: string;
  createdAt?: string;
  id: string; // 稳定逻辑 id，如 "m1","m2"…（独立于文件名）
  engine: string; // "ElevenLabs Scribe v2" | "funasr" | "imported" | ...
  label?: string; // 可选自定义模型名（默认 = engine）
  original?: string; // 引擎原稿文件名（可选，只读）；如 "<modelId>-original.json"
  edits: TranscriptEdit[]; // 修改稿迭代，至少 1 份
  activeEditId: string; // 当前激活修改稿 id
}

export interface TranscriptManifest {
  /** Interview-level details shared by original and edited versions. */
  interviewDetails?: Pick<InterviewDraft, "recorded_at" | "location" | "topics" | "notes">;
  /** Shared interview title, independent of version labels. */
  title?: string;
  schemaVersion: number; // 2 = 二维 models 结构
  audio: string; // 音频文件名
  audioHash?: string;
  /** 音频指纹（大小 + 前 64KB 的 SHA-256），用于跨重命名关联转录，独立于文件名。 */
  audioFingerprint?: string;
  models: TranscriptModel[];
  activeModelId: string; // 当前激活模型 id
}

/** @deprecated 仅用于 v1→v2 迁移兼容，新代码勿直接使用。 */
export interface TranscriptVersion {
  id: string;
  label: string;
  engine: string;
  createdAt: string;
  edited: string;
  original?: string;
}
