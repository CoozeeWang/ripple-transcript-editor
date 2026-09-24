"""腾讯云对象存储（COS）最小客户端：上传对象、生成限时下载链接、删除对象。

为什么需要它：腾讯云录音文件识别的「URL 模式」不收音频字节，只收一个能下载音频的地址。
超过 5MB 的音频没法走 base64 那一版，标准做法就是先传到 COS，再把链接交给它。

这里只做那三件事，不引入官方 SDK（本项目的依赖树刻意保持小；生命周期、CDN 这类能力用不到，
所以没有实现，**分块上传实现了** —— 见下面的 MULTIPART_THRESHOLD_BYTES）。
上传过程会通过 on_progress 回调把「已传多少字节」报给调用方，供界面显示进度。

签名算法（signature v5 / sha1）照官方《请求签名》文档与 Python SDK v5 的
`qcloud_cos/cos_auth.py` 的 `CosS3Auth` 逐字对齐：
    1. http_string   = "{method}\n{uri_path}\n{HttpParameters}\n{HttpHeaders}\n"   （method 小写）
    2. key_time      = "{now - 60};{now + expires}"                                （回拨 60 秒容忍时钟偏差）
    3. sign_key      = HmacSHA1(SecretKey, key_time)                    -> 十六进制小写
    4. string_to_sign= "sha1\n{key_time}\nSHA1(http_string)\n"
    5. signature     = HmacSHA1(sign_key【十六进制字符串本身】, string_to_sign)
    6. 鉴权串        = "q-sign-algorithm=sha1&q-ak={SecretId}&q-sign-time={key_time}"
                       "&q-key-time={key_time}&q-header-list={HeaderList}"
                       "&q-url-param-list={UrlParamList}&q-signature={signature}"
同一串既能放进 Authorization 请求头，也能直接拼在对象 URL 后面当预签名链接——这是官方的
两种等价用法，所以 `sign_request` 只算一次。

固定下来的三条约定（写进代码而不是文档，免得被后来的改动悄悄破坏）：
  - 对象键只用 ASCII：`ripple/<日期>/<随机串>.<后缀>`。原始文件名可能有中文或访谈者姓名，
    既会进云上的对象列表（隐私），又需要在签名里额外处理编码（容易出错）。
  - 下载链接固定走 COS 默认域名 `<bucket>.cos.<region>.myqcloud.com`。换成自定义域名 /
    静态网站域名 / 全球加速域名之后，腾讯云侧读文件会开始产生外网下行流量费（约 0.5 元/GB）。
  - 链接默认 6 小时过期；调用方在转录结束时（无论成败）就删对象，实际存活时间远短于此。
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import httpx

from .providers.base import ProviderError
from .providers.diagnostics import human_bytes, logger

COS_SIGN_ALGORITHM = "sha1"

# 对象都放在这个前缀下：方便在控制台一眼认出哪些是本应用传的，也方便挂生命周期规则
# （例如「ripple/ 下的对象 1 天后自动删除」），兜住「进程被杀导致没删干净」的极端情况。
OBJECT_PREFIX = "ripple"

# 交给腾讯云 ASR 的下载链接有效期。长音频要排队，给得宽一些；对象在转录结束时就删掉了，
# 所以链接实际能用的时间远短于这个值。
PRESIGNED_EXPIRES_SECONDS = 6 * 3600

# 与官方 SDK 一致：签名起始时间回拨 60 秒，避免本机时钟略快于服务端时刚签好就过期。
SIGN_TIME_BACKDATE_SECONDS = 60

# 上传可能要传几百 MB，上行带宽决定耗时；读取（服务端回一句结果）则应该很快。
COS_CONNECT_TIMEOUT_SECONDS = 15
COS_WRITE_TIMEOUT_SECONDS = 1800
COS_READ_TIMEOUT_SECONDS = 120
COS_POOL_TIMEOUT_SECONDS = 30

# ---- 分块上传 --------------------------------------------------------------
#
# 官方《分块上传》给出的适用判据原话：「在弱网络环境中，单个对象大于 20MB 可优先考虑分块上传，
# 在大带宽环境中可将超过 100MB 的对象进行分块上传」。
# 2026-09-14 实测：一次性 PUT 一个 201.9MB 的音频，连接在中途被对端断开（Server disconnected
# without sending a response），而同一个文件紧接着重跑只用了 35 秒 —— 断不断无法预知。
# 所以大对象一律走分块：坏一块只补那一块，不用从头再来。
MULTIPART_THRESHOLD_BYTES = 20 * 1024 * 1024

# 块大小。官方允许 1MB–5GB；取 8MB 是在「进度颗粒度」与「请求数」之间取平衡：
# 1GB 的文件分成 128 块，按实测上行速度大约每一两秒就能刷新一次进度。
PART_SIZE_BYTES = 8 * 1024 * 1024

# 单块最多试 3 次（首次 + 重试 2 次）。只对「连接断了 / 服务端 5xx」重试；
# 密钥无效、桶名不对这类 4xx 立刻抛出——重试一百次也不会变对。
PART_MAX_ATTEMPTS = 3
PART_RETRY_BACKOFF_SECONDS = 1.5

# 进度回调：`on_progress(已传字节, 总字节)`。上传过程中被多次调用。
ProgressCallback = Callable[[int, int], None]

# 官方 SDK 的 `quote(..., '-_.~')`：注意 `/` 会被编码成 %2F，空格编码成 %20（不是 +）。
_ENCODE_SAFE = "-_.~"

# 与各 provider 一致：默认不吃环境里的 HTTP/HTTPS 代理直连（本地开发机的代理常不稳定）。
_TRUST_PROXY = os.environ.get("TRANSCRIPTION_TRUST_PROXY") == "1"

# 对象键里允许的后缀：纯 ASCII 字母数字，长度合理；否则一律用 .bin（不影响识别，
# 腾讯云是按音频内容解码的，后缀只是给人看）。
_SAFE_SUFFIX = re.compile(r"^[a-z0-9]{1,8}$")


def hmac_sha1_hex(key: str, message: str) -> str:
    """HmacSHA1，返回十六进制小写。密钥与消息都按 UTF-8 取字节。"""
    return hmac.new(key.encode("utf-8"), message.encode("utf-8"), hashlib.sha1).hexdigest()


def encode(value: str) -> str:
    """按官方 SDK 的 safe 字符集做 URL 编码。"""
    return quote(value, safe=_ENCODE_SAFE)


def host_of(bucket: str, region: str) -> str:
    """桶的访问域名（默认域名，不用自定义/加速域名——见模块开头的费用说明）。"""
    return f"{bucket}.cos.{region}.myqcloud.com"


def object_url(bucket: str, region: str, key: str) -> str:
    return f"https://{host_of(bucket, region)}/{key}"


def canonical_params(params: Mapping[str, str]) -> tuple[str, str]:
    """返回 (HttpParameters, UrlParamList)：键小写并编码、按键字典序拼接。"""
    return _canonical(params)


def canonical_headers(headers: Mapping[str, str]) -> tuple[str, str]:
    """返回 (HttpHeaders, HeaderList)：规则同上（键小写并编码）。"""
    return _canonical(headers)


def _canonical(items: Mapping[str, str]) -> tuple[str, str]:
    encoded = {encode(key).lower(): encode(value) for key, value in items.items()}
    keys = sorted(encoded)
    pairs = "&".join(f"{key}={encoded[key]}" for key in keys)
    return pairs, ";".join(keys)


def build_http_string(method: str, uri_path: str, pairs: str, headers: str) -> str:
    """HttpString 的四个部分，末尾保留换行；空的部分也要留下空行（官方文档明确要求）。"""
    return f"{method.lower()}\n{uri_path}\n{pairs}\n{headers}\n"


def sign_key_of(secret_key: str, key_time: str) -> str:
    return hmac_sha1_hex(secret_key, key_time)


def signature_of(secret_key: str, key_time: str, http_string: str) -> str:
    digest = hashlib.sha1(http_string.encode("utf-8")).hexdigest()
    string_to_sign = f"{COS_SIGN_ALGORITHM}\n{key_time}\n{digest}\n"
    # 注意：以 sign_key 的**十六进制字符串**作为 HMAC 的密钥（官方文档与 SDK 都如此）。
    return hmac_sha1_hex(sign_key_of(secret_key, key_time), string_to_sign)


@dataclass(frozen=True)
class SignedRequest:
    """一次签名算出的全部中间结果，便于测试逐项断言。"""

    key_time: str
    param_list: str
    header_list: str
    http_string: str
    authorization: str


def sign_request(
    method: str,
    uri_path: str,
    params: Mapping[str, str],
    headers: Mapping[str, str],
    secret_id: str,
    secret_key: str,
    *,
    expires_seconds: int,
    now: int | None = None,
) -> SignedRequest:
    """算出鉴权串。`now` 可注入，便于测试得到确定的签名。"""
    start = (int(time.time()) if now is None else int(now)) - SIGN_TIME_BACKDATE_SECONDS
    key_time = f"{start};{start + SIGN_TIME_BACKDATE_SECONDS + expires_seconds}"

    param_pairs, param_list = canonical_params(params)
    header_pairs, header_list = canonical_headers(headers)
    http_string = build_http_string(method, uri_path, param_pairs, header_pairs)
    signature = signature_of(secret_key, key_time, http_string)

    authorization = (
        f"q-sign-algorithm={COS_SIGN_ALGORITHM}&q-ak={secret_id}"
        f"&q-sign-time={key_time}&q-key-time={key_time}"
        f"&q-header-list={header_list}&q-url-param-list={param_list}"
        f"&q-signature={signature}"
    )
    return SignedRequest(
        key_time=key_time,
        param_list=param_list,
        header_list=header_list,
        http_string=http_string,
        authorization=authorization,
    )


def object_key(original_filename: str, now: datetime | None = None) -> str:
    """给一段音频生成对象键：`ripple/<日期>/<随机串>.<后缀>`。

    刻意不带原始文件名：一是中文名在签名与 URL 里要额外编码、容易出错，二是云上的对象
    列表会因此暴露访谈对象姓名这类信息。
    """
    suffix = Path(original_filename).suffix.lower().lstrip(".")
    safe_suffix = suffix if _SAFE_SUFFIX.match(suffix) else "bin"
    day = (now or datetime.now(UTC)).strftime("%Y%m%d")
    return f"{OBJECT_PREFIX}/{day}/{uuid.uuid4().hex}.{safe_suffix}"


def cos_error_code(body: str) -> str:
    """从 COS 的错误 XML 里抠出 `<Code>`（拿不到就返回空串）。"""
    match = re.search(r"<Code>([^<]+)</Code>", body or "")
    return match.group(1) if match else ""


def describe_failure(response: httpx.Response) -> tuple[str, str]:
    """把 COS 的失败响应翻成（内部错误码, 中文说明）。

    主要是给「桶名/地域填错」「密钥没权限」这两类最常见的配置错误一个能照着改的提示。
    """
    code = cos_error_code(response.text)
    if code in {"InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied"}:
        return (
            "invalid_api_key",
            f"COS 拒绝了这次请求（{code}）：密钥无效，或这个子账号没有该存储桶的读写权限。",
        )
    if code in {"NoSuchBucket", "PermanentRedirect", "BucketRegionError", "IllegalLocationConstraintException"}:
        return (
            "bad_bucket",
            f"COS 说这个存储桶不存在或地域不对（{code}）：检查 Bucket 名与地域是否和桶实际所在地域一致。",
        )
    detail = f"（{code}）" if code else ""
    return "upload_failed", f"上传到 COS 失败：HTTP {response.status_code}{detail}。"


class PartUploadError(ProviderError):
    """分块上传里「重试有意义」的失败：连接中断、上传超时、服务端 5xx。

    与不可重试的失败（密钥无效、桶名不对）分开，重试循环只接这一类。
    """


_UPLOAD_ID_PATTERN = re.compile(r"<UploadId>([^<]+)</UploadId>")

# 传输层的错误码：它们才是「网络问题」；配置类错误（密钥 / 桶名）不该被包装成网络问题。
_TRANSPORT_CODES = {"network", "upload_timeout", "response_timeout"}

# 「多半是网络波动」这句话要克制：我们只能看见「连接被对端断开」，看不到是谁的锅
# （本机网络、路由器、运营商、对端服务器都有可能）。所以只说现象、给概率，不指责任何一方，
# 并且不点名任何具体引擎——提示语是给所有用户看的。
_NETWORK_PROBABILITY = "多半是网络波动，与音频本身无关。"


def _upload_failure(error: ProviderError, sent: int, total: int) -> ProviderError:
    """给上传失败补上「传到哪一步断的」，让用户知道是刚开始还是快传完。

    只在传输层失败时改写消息；配置类错误（密钥无效、桶名不对）原样抛出 —— 用「已传 0B」
    去描述一个权限错误只会让人更糊涂。
    """
    if error.code not in _TRANSPORT_CODES:
        return error
    if sent <= 0:
        return ProviderError(
            f"还没能连上云端存储：音频一个字节都没传出去。{_NETWORK_PROBABILITY}",
            code=error.code,
            raw=error.raw,
        )
    done = f"{human_bytes(sent)} / {human_bytes(total)}"
    if error.code == "upload_timeout":
        first = f"音频传得太慢：已传 {done}，超出规定时间仍未传完。"
    elif error.code == "response_timeout":
        first = f"云端在已传 {done} 之后迟迟没有响应。"
    else:
        first = f"音频没能传到云端：已传 {done} 就断开了。"
    return ProviderError(f"{first}{_NETWORK_PROBABILITY}", code=error.code, raw=error.raw)


def extract_upload_id(body: str) -> str:
    """从 InitiateMultipartUpload 的 XML 响应里取出 `<UploadId>`（取不到返回空串）。"""
    match = _UPLOAD_ID_PATTERN.search(body or "")
    return match.group(1) if match else ""


def complete_multipart_body(parts: Sequence[tuple[int, str]]) -> str:
    """拼 CompleteMultipartUpload 的请求体。ETag 按 COS 返回的原样带双引号写进去。"""
    items = "".join(
        f"<Part><PartNumber>{number}</PartNumber><ETag>{etag}</ETag></Part>"
        for number, etag in parts
    )
    return f"<CompleteMultipartUpload>{items}</CompleteMultipartUpload>"


class CosClient:
    """某个桶上的三个动作。凭据由调用方注入，本类不碰 settings。"""

    def __init__(self, secret_id: str, secret_key: str, bucket: str, region: str) -> None:
        self._secret_id = secret_id
        self._secret_key = secret_key
        self.bucket = bucket
        self.region = region

    @property
    def host(self) -> str:
        return host_of(self.bucket, self.region)

    def content_path(self, key: str) -> str:
        """URL 里对象的位置；与签名用的 UriPathname 必须逐字相同。"""
        return f"/{key}"

    def put_object(
        self,
        key: str,
        audio_path: Path,
        *,
        on_progress: ProgressCallback | None = None,
    ) -> None:
        """把本地音频原样上传（不压缩、不改码率）。

        超过 MULTIPART_THRESHOLD_BYTES 的对象走分块上传。上传过程中按块回调
        `on_progress(已传字节, 总字节)`；失败时抛出的 ProviderError 里带上「已传多少」，
        让用户知道是卡在开头还是快传完时断的。
        """
        total = audio_path.stat().st_size
        sent = 0

        def report(count: int) -> None:
            nonlocal sent
            sent = count
            if on_progress is not None:
                on_progress(count, total)

        try:
            if total >= MULTIPART_THRESHOLD_BYTES:
                self._put_in_parts(key, audio_path, report)
            else:
                self._put_at_once(key, audio_path, report)
        except ProviderError as error:
            raise _upload_failure(error, sent, total) from error

    def _put_at_once(self, key: str, audio_path: Path, report: Callable[[int], None]) -> None:
        """小对象：一次 PUT 传完。"""
        total = audio_path.stat().st_size
        report(0)
        url, headers = self._signed_request(
            "put", key, {}, {"Content-Type": "application/octet-stream"}
        )
        with audio_path.open("rb") as stream:
            response = self._send("PUT", url, headers, stream)
        if response.status_code != 200:
            code, message = describe_failure(response)
            raise ProviderError(message, code=code, raw=response.text[:2000])
        report(total)

    def _put_in_parts(self, key: str, audio_path: Path, report: Callable[[int], None]) -> None:
        """大对象：Initiate → 逐块 UploadPart（每块可重试）→ Complete。

        任何一步失败都先 Abort，把已经传上去的分块丢掉 —— 未完成的分块在 COS 上照样占存储、
        照样计费，而且不出现在对象列表里，靠人根本发现不了。
        """
        total = audio_path.stat().st_size
        part_size = PART_SIZE_BYTES
        part_count = (total + part_size - 1) // part_size
        report(0)
        upload_id = self._begin_multipart(key)
        logger.info(
            "分块上传 %s：共 %d 块 × %s uploadId=%s",
            human_bytes(total),
            part_count,
            human_bytes(part_size),
            upload_id,
        )
        parts: list[tuple[int, str]] = []
        sent = 0
        try:
            with audio_path.open("rb") as stream:
                for index in range(part_count):
                    payload = stream.read(part_size)
                    number = index + 1
                    etag = self._put_part_with_retry(
                        key, upload_id, number, index + 1, part_count, payload
                    )
                    parts.append((number, etag))
                    sent += len(payload)
                    report(sent)
            self._complete_multipart(key, upload_id, parts)
        except Exception:
            self._abort_multipart(key, upload_id)
            raise

    def _put_part_with_retry(
        self,
        key: str,
        upload_id: str,
        part_number: int,
        index: int,
        part_count: int,
        payload: bytes,
    ) -> str:
        """传一块，失败按 PART_MAX_ATTEMPTS 重试。返回 COS 给的 ETag（Complete 要用）。"""
        last: PartUploadError | None = None
        for attempt in range(1, PART_MAX_ATTEMPTS + 1):
            try:
                return self._put_part(key, upload_id, part_number, payload)
            except PartUploadError as error:
                last = error
                if attempt >= PART_MAX_ATTEMPTS:
                    break
                delay = PART_RETRY_BACKOFF_SECONDS * attempt
                logger.warning(
                    "第 %d/%d 块上传失败（第 %d 次尝试），%.1f 秒后重试：%s",
                    index,
                    part_count,
                    attempt,
                    delay,
                    error,
                )
                time.sleep(delay)
        assert last is not None  # 循环至少跑一次，last 一定有值
        raise ProviderError(
            f"第 {index}/{part_count} 块（{human_bytes(len(payload))}）连续 {PART_MAX_ATTEMPTS} "
            f"次都没能传上去：{last}",
            code=last.code,
            raw=last.raw,
        ) from last

    def _begin_multipart(self, key: str) -> str:
        """POST /<key>?uploads，拿到 UploadId。"""
        url, headers = self._signed_request("post", key, {"uploads": ""}, {})
        response = self._send("POST", url, headers, None)
        if response.status_code != 200:
            code, message = describe_failure(response)
            raise ProviderError(message, code=code, raw=response.text[:2000])
        upload_id = extract_upload_id(response.text)
        if not upload_id:
            raise ProviderError(
                "COS 没有返回分块上传的 UploadId，无法继续。",
                code="upload_failed",
                raw=response.text[:2000],
            )
        return upload_id

    def _put_part(self, key: str, upload_id: str, part_number: int, payload: bytes) -> str:
        """传一块。4xx 直接抛（不可重试），连接中断与服务端 5xx 抛 PartUploadError（可重试）。"""
        url, headers = self._signed_request(
            "put",
            key,
            {"partNumber": str(part_number), "uploadId": upload_id},
            {"Content-Type": "application/octet-stream"},
        )
        try:
            response = self._send("PUT", url, headers, payload)
        except ProviderError as error:
            # 传输层的问题（连接断了 / 上传超时）：换一次可能就过了。
            raise PartUploadError(str(error), code=error.code, raw=error.raw) from error
        if response.status_code == 200:
            etag = response.headers.get("ETag")
            if not etag:
                raise PartUploadError(
                    f"第 {part_number} 块传上去了但 COS 没返回 ETag，无法完成这次分块上传。",
                    code="upload_failed",
                    raw=str(dict(response.headers))[:2000],
                )
            return etag
        code, message = describe_failure(response)
        if response.status_code >= 500:
            raise PartUploadError(message, code="upload_failed", raw=response.text[:2000])
        raise ProviderError(message, code=code, raw=response.text[:2000])

    def _complete_multipart(self, key: str, upload_id: str, parts: Sequence[tuple[int, str]]) -> None:
        """POST /<key>?uploadId=… 把所有块合成一个对象。"""
        body = complete_multipart_body(parts).encode("utf-8")
        url, headers = self._signed_request(
            "post", key, {"uploadId": upload_id}, {"Content-Type": "application/xml"}
        )
        response = self._send("POST", url, headers, body)
        # COS 有一种坑：合并失败时也可能回 200，错误藏在响应体里，必须看内容。
        if response.status_code != 200 or "<Error>" in response.text:
            code, message = describe_failure(response)
            raise ProviderError(message, code=code, raw=response.text[:2000])

    def _abort_multipart(self, key: str, upload_id: str) -> None:
        """放弃这次分块上传，让 COS 把已上传的分块删掉。尽力而为，失败只记日志。"""
        try:
            url, headers = self._signed_request("delete", key, {"uploadId": upload_id}, {})
            response = self._send("DELETE", url, headers, None)
        except ProviderError as error:
            logger.warning(
                "分块上传已放弃，但没能通知 COS 清理分块 uploadId=%s：%s", upload_id, error
            )
            return
        if response.status_code not in (200, 204):
            logger.warning(
                "分块上传已放弃，但 COS 没接受清理请求 uploadId=%s：HTTP %d %s",
                upload_id,
                response.status_code,
                response.text[:200],
            )

    def _signed_request(
        self,
        method: str,
        key: str,
        params: Mapping[str, str],
        extra_headers: Mapping[str, str],
    ) -> tuple[str, dict[str, str]]:
        """算出「带 query 的完整 URL + 请求头」。

        params 里的键值要同时出现在两处：URL 的 query（服务端靠它取参数）和 q-url-param-list
        （签名用，键小写）。两处必须来自同一个 dict，否则签名对不上。
        Content-Type 之类的头不参与签名（签名只覆盖 host，官方要求的最小集），但如实带上。
        """
        path = self.content_path(key)
        signed = sign_request(
            method,
            path,
            params,
            {"host": self.host},
            self._secret_id,
            self._secret_key,
            expires_seconds=PRESIGNED_EXPIRES_SECONDS,
        )
        query = "&".join(f"{encode(name)}={encode(value)}" for name, value in params.items())
        url = f"https://{self.host}{path}" + (f"?{query}" if query else "")
        return url, {"Authorization": signed.authorization, **extra_headers}

    def presigned_get_url(
        self, key: str, expires_seconds: int = PRESIGNED_EXPIRES_SECONDS
    ) -> str:
        """生成限时下载链接（私有桶也能被腾讯云 ASR 取到）。"""
        path = self.content_path(key)
        signed = sign_request(
            "get",
            path,
            {},
            {"host": self.host},
            self._secret_id,
            self._secret_key,
            expires_seconds=expires_seconds,
        )
        return f"https://{self.host}{path}?{signed.authorization}"

    def delete_object(self, key: str) -> None:
        """删掉对象。调用方按「尽力而为」处理失败（别让它盖掉真正的转录错误）。"""
        path = self.content_path(key)
        signed = sign_request(
            "delete",
            path,
            {},
            {"host": self.host},
            self._secret_id,
            self._secret_key,
            expires_seconds=PRESIGNED_EXPIRES_SECONDS,
        )
        headers = {"Authorization": signed.authorization}
        response = self._send("DELETE", f"https://{self.host}{path}", headers, None)
        if response.status_code not in (200, 204):
            code, message = describe_failure(response)
            raise ProviderError(message, code=code, raw=response.text[:2000])

    def _send(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        content: object,
    ) -> httpx.Response:
        """唯一发 HTTP 的地方；测试替换掉它即可覆盖全部网络行为。

        超时按「连不上 / 传不完 / 等不到」分开翻译，和 provider 层保持同一套错误码。
        """
        timeout = httpx.Timeout(
            connect=COS_CONNECT_TIMEOUT_SECONDS,
            read=COS_READ_TIMEOUT_SECONDS,
            write=COS_WRITE_TIMEOUT_SECONDS,
            pool=COS_POOL_TIMEOUT_SECONDS,
        )
        try:
            with httpx.Client(timeout=timeout, trust_env=_TRUST_PROXY) as client:
                return client.request(method, url, headers=headers, content=content)
        except (httpx.ConnectTimeout, httpx.ConnectError, httpx.PoolTimeout) as error:
            raise ProviderError(
                f"连不上腾讯云 COS（{COS_CONNECT_TIMEOUT_SECONDS} 秒内没建立起连接），"
                "请检查网络或代理后重试",
                code="network",
                raw=str(error),
            ) from error
        except httpx.WriteTimeout as error:
            raise ProviderError(
                f"音频上传到 COS 超时（{COS_WRITE_TIMEOUT_SECONDS // 60} 分钟没能传完），"
                "上行带宽慢时容易发生",
                code="upload_timeout",
                raw=str(error),
            ) from error
        except httpx.ReadTimeout as error:
            raise ProviderError(
                f"COS {COS_READ_TIMEOUT_SECONDS} 秒没有响应",
                code="response_timeout",
                raw=str(error),
            ) from error
        except httpx.HTTPError as error:
            raise ProviderError(
                "与腾讯云 COS 的连接中断，请检查网络或代理后重试",
                code="network",
                raw=str(error),
            ) from error
