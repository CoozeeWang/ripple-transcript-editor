"""COS 签名与最小客户端的测试。

签名没法「看起来对」就算了：官方文档《请求签名》给了两个示例的中间值（HttpString、
StringToSign、SHA1(HttpString)），本文件把它们逐字搬进来当向量——只要 HttpString 的
构造有一处不一致（换行、排序、编码、方法大小写），这些断言就会红。
官方示例里的 Signature 值末尾被文档打码成 `...1234`，不能当向量，所以「Signature 本身」
改用「与手工 HmacSHA1 计算一致」来锁住最关键的那一步（以 SignKey 的十六进制字符串当密钥）。

其余行为（上传、删除、超时分类）用替换 `_send` / `httpx.Client` 覆盖，不发真实请求。
"""

import hashlib
import hmac
import re
from datetime import UTC, datetime
from typing import Self

import httpx
import pytest

import app.cos as cos_module
from app.cos import (
    CosClient,
    build_http_string,
    canonical_headers,
    canonical_params,
    hmac_sha1_hex,
    object_key,
    object_url,
    sign_request,
    signature_of,
)
from app.providers.base import ProviderError

BUCKET = "examplebucket-1250000000"
REGION = "ap-beijing"
HOST = f"{BUCKET}.cos.{REGION}.myqcloud.com"


class _FakeResponse:
    def __init__(self, status_code: int, text: str = "", headers: dict | None = None) -> None:
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}


# --- 签名向量 ---------------------------------------------------------------


def test_hmac_sha1_matches_rfc2202_vector() -> None:
    """HmacSHA1 本身先对一遍 RFC 2202 的标准向量（key="Jefe"）。"""
    assert (
        hmac_sha1_hex("Jefe", "what do ya want for nothing?")
        == "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79"
    )


def test_http_string_matches_official_download_example() -> None:
    """官方文档「下载对象」示例：GET + 两个 response-* 参数 + date/host 头。"""
    params, param_list = canonical_params(
        {
            "response-content-type": "application/octet-stream",
            "response-cache-control": "max-age=600",
        }
    )
    headers, header_list = canonical_headers(
        {"Host": HOST, "Date": "Thu, 16 May 2019 06:55:53 GMT"}
    )
    http_string = build_http_string("GET", "/exampleobject(腾讯云)", params, headers)

    assert param_list == "response-cache-control;response-content-type"
    assert header_list == "date;host"
    assert http_string == (
        "get\n/exampleobject(腾讯云)\n"
        "response-cache-control=max-age%3D600&"
        "response-content-type=application%2Foctet-stream\n"
        "date=Thu%2C%2016%20May%202019%2006%3A55%3A53%20GMT&host="
        f"{HOST}\n"
    )
    # 文档给出的 SHA1(HttpString)，与上面这一串必须完全相同
    assert (
        hashlib.sha1(http_string.encode("utf-8")).hexdigest()
        == "54ecfe22f59d3514fdc764b87a32d8133ea611e6"
    )


def test_http_string_matches_official_upload_example() -> None:
    """官方文档「上传对象」示例：PUT + 七个参与签名的头 + 空 URL 参数列表。"""
    params, param_list = canonical_params({})
    headers, header_list = canonical_headers(
        {
            "Content-Length": "13",
            "Content-MD5": "mQ/fVh815F3k6TAUm8m0eg==",
            "Content-Type": "text/plain",
            "Date": "Thu, 16 May 2019 06:45:51 GMT",
            "Host": HOST,
            "x-cos-acl": "private",
            "x-cos-grant-read": 'uin="100000000011"',
        }
    )
    http_string = build_http_string("PUT", "/exampleobject(腾讯云)", params, headers)

    assert param_list == ""
    assert header_list == (
        "content-length;content-md5;content-type;date;host;x-cos-acl;x-cos-grant-read"
    )
    # 空参数列表处必须留下一个空行（文档明确要求），否则哈希对不上
    assert "\n/exampleobject(腾讯云)\n\n" in http_string
    assert (
        hashlib.sha1(http_string.encode("utf-8")).hexdigest()
        == "8b2751e77f43a0995d6e9eb9477f4b685cca4172"
    )
    assert (
        "x-cos-grant-read=uin%3D%22100000000011%22" in http_string
    ), "头的 value 必须先编码再参与拼接"


def test_signature_uses_hex_sign_key_as_the_hmac_key() -> None:
    """最容易写错的一步：SignKey 先被算成十六进制字符串，再拿这个字符串当密钥。"""
    key_time = "1557989753;1557996953"
    http_string = "get\n/\n\nhost=example.com\n"

    digest = hashlib.sha1(http_string.encode("utf-8")).hexdigest()
    string_to_sign = f"sha1\n{key_time}\n{digest}\n"
    expected_sign_key = hmac.new(b"secretkey", key_time.encode("utf-8"), hashlib.sha1).hexdigest()
    expected = hmac.new(
        expected_sign_key.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1
    ).hexdigest()

    assert signature_of("secretkey", key_time, http_string) == expected


def test_key_time_backdates_start_and_spans_expiry() -> None:
    signed = sign_request(
        "get", "/k", {}, {"host": "h"}, "AKIDx", "secretx", expires_seconds=3600, now=1_557_989_753
    )
    # 与官方 SDK 一致：起始回拨 60 秒，结束 = 起点 + 60 + 有效期
    assert signed.key_time == "1557989693;1557993353"


def test_authorization_fields_are_complete_and_sorted() -> None:
    signed = sign_request(
        "get",
        "/ripple/x.m4a",
        {},
        {"host": HOST},
        "AKIDx",
        "secretx",
        expires_seconds=60,
        now=1_557_989_753,
    )
    fields = dict(item.split("=", 1) for item in signed.authorization.split("&"))
    assert list(fields) == [
        "q-sign-algorithm",
        "q-ak",
        "q-sign-time",
        "q-key-time",
        "q-header-list",
        "q-url-param-list",
        "q-signature",
    ], "字段顺序照官方模板，别乱动"
    assert fields["q-sign-algorithm"] == "sha1"
    assert fields["q-ak"] == "AKIDx"
    assert fields["q-header-list"] == "host"
    assert fields["q-url-param-list"] == ""
    assert len(fields["q-signature"]) == 40


def test_signature_params_do_not_sign_themselves() -> None:
    """q-* 系列不能进 q-url-param-list，否则签名永远算不对（官方文档明确）。"""
    signed = sign_request(
        "get", "/k", {"prefix": "a/"}, {"host": HOST}, "AKIDx", "secretx", expires_seconds=60
    )
    assert signed.param_list == "prefix"
    assert "q-sign-algorithm" not in signed.http_string


# --- 对象键与链接 -----------------------------------------------------------


def test_object_key_is_ascii_and_keeps_suffix() -> None:
    key = object_key("田燕燕_20211105.m4a", now=datetime(2026, 9, 14, tzinfo=UTC))
    assert key.startswith("ripple/20260914/")
    assert key.endswith(".m4a")
    assert key.isascii(), "对象键必须全 ASCII：中文名既泄露访谈对象姓名，又要额外编码"
    assert "田燕燕" not in key
    assert object_key("x.m4a") != object_key("x.m4a"), "同一文件名两次调用要得到不同键"


@pytest.mark.parametrize(
    ("filename", "expected_suffix"),
    [("a.WAV", ".wav"), ("a.m4a", ".m4a"), ("无后缀", ".bin"), ("a.录音", ".bin"), ("a.verylongext", ".bin")],
)
def test_object_key_falls_back_to_bin_for_unsafe_suffix(filename: str, expected_suffix: str) -> None:
    assert object_key(filename).endswith(expected_suffix)


def test_object_url_uses_cos_default_domain() -> None:
    """必须是默认域名：换自定义/加速域名会让腾讯 ASR 读文件产生外网下行流量费。"""
    url = object_url(BUCKET, REGION, "ripple/x.m4a")
    assert url == f"https://{HOST}/ripple/x.m4a"
    assert url.endswith(".myqcloud.com/ripple/x.m4a")


def test_presigned_url_puts_signature_in_query_and_misses_nothing() -> None:
    client = CosClient("AKIDx", "secretx", BUCKET, REGION)
    url = client.presigned_get_url("ripple/20260914/a.m4a")

    assert url.startswith(f"https://{HOST}/ripple/20260914/a.m4a?")
    query = url.split("?", 1)[1]
    assert "q-sign-algorithm=sha1" in query
    assert "q-ak=AKIDx" in query
    # 空字符串也要保留（parse_qsl 默认会丢掉空值，所以直接看原文）
    assert "&q-url-param-list=&" in query
    assert "q-header-list=host" in query
    assert "q-signature=" in query


# --- 上传与删除 -------------------------------------------------------------


def _client_with_send(monkeypatch, outcome: httpx.Response | Exception) -> tuple[CosClient, dict]:
    client = CosClient("AKIDx", "secretx", BUCKET, REGION)
    captured: dict = {}

    def fake_send(method: str, url: str, headers: dict, content: object) -> httpx.Response:
        captured.update(method=method, url=url, headers=headers)
        captured["body"] = content.read() if hasattr(content, "read") else content
        if isinstance(outcome, Exception):
            raise outcome
        return outcome  # type: ignore[return-value]

    monkeypatch.setattr(client, "_send", fake_send)
    return client, captured


def test_put_object_uploads_raw_bytes_and_signs_host(tmp_path, monkeypatch) -> None:
    client, captured = _client_with_send(monkeypatch, _FakeResponse(200))
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"audio-bytes")

    client.put_object("ripple/20260914/a.m4a", audio)

    assert captured["method"] == "PUT"
    assert captured["url"] == f"https://{HOST}/ripple/20260914/a.m4a"
    assert captured["body"] == b"audio-bytes", "上传必须是原样字节：不压缩、不改码率"
    auth = captured["headers"]["Authorization"]
    assert "q-header-list=host" in auth
    assert "q-url-param-list=&" in auth


@pytest.mark.parametrize(
    ("body", "expected_code"),
    [
        ("<Error><Code>SignatureDoesNotMatch</Code></Error>", "invalid_api_key"),
        ("<Error><Code>AccessDenied</Code></Error>", "invalid_api_key"),
        ("<Error><Code>NoSuchBucket</Code></Error>", "bad_bucket"),
        ("<Error><Code>PermanentRedirect</Code></Error>", "bad_bucket"),
        ("<Error><Code>InternalError</Code></Error>", "upload_failed"),
        ("not xml at all", "upload_failed"),
    ],
)
def test_put_object_translates_cos_errors(tmp_path, monkeypatch, body, expected_code) -> None:
    client, _ = _client_with_send(monkeypatch, _FakeResponse(403, body))
    audio = tmp_path / "x.m4a"
    audio.write_bytes(b"data")

    with pytest.raises(ProviderError) as excinfo:
        client.put_object("ripple/a.m4a", audio)

    assert excinfo.value.code == expected_code
    assert excinfo.value.raw == body[:2000], "原始 XML 要留档，便于排查"


def test_delete_object_accepts_204(monkeypatch) -> None:
    client, captured = _client_with_send(monkeypatch, _FakeResponse(204))
    client.delete_object("ripple/a.m4a")
    assert captured["method"] == "DELETE"
    assert captured["url"] == f"https://{HOST}/ripple/a.m4a"


def test_delete_object_reports_failure(monkeypatch) -> None:
    client, _ = _client_with_send(monkeypatch, _FakeResponse(404, "<Error><Code>NoSuchKey</Code></Error>"))
    with pytest.raises(ProviderError) as excinfo:
        client.delete_object("ripple/a.m4a")
    assert excinfo.value.code == "upload_failed"


# --- 超时分类 ---------------------------------------------------------------


def _patch_httpx_client(monkeypatch, outcome: object) -> dict:
    captured: dict = {}

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *exc: object) -> bool:
            return False

        def request(self, method: str, url: str, headers: object = None, content: object = None):
            captured.update(method=method, url=url)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

    monkeypatch.setattr(cos_module.httpx, "Client", FakeClient)
    return captured


def test_cos_uses_split_timeouts(monkeypatch) -> None:
    captured = _patch_httpx_client(monkeypatch, _FakeResponse(200))
    CosClient("AKIDx", "secretx", BUCKET, REGION)._send("GET", "https://example.invalid/x", {}, None)

    timeout = captured["timeout"]
    assert timeout.connect == cos_module.COS_CONNECT_TIMEOUT_SECONDS
    assert timeout.write == cos_module.COS_WRITE_TIMEOUT_SECONDS
    assert timeout.read == cos_module.COS_READ_TIMEOUT_SECONDS
    assert timeout.pool == cos_module.COS_POOL_TIMEOUT_SECONDS
    # 上传几百 MB 的音频是常态，写超时必须够宽；连接失败则要快速反馈。
    assert cos_module.COS_WRITE_TIMEOUT_SECONDS >= 600
    assert cos_module.COS_CONNECT_TIMEOUT_SECONDS <= 30


@pytest.mark.parametrize(
    ("raised", "expected_code", "expected_text"),
    [
        (httpx.ConnectTimeout("timed out"), "network", "连不上腾讯云 COS"),
        (httpx.ConnectError("nodename nor servname provided"), "network", "连不上腾讯云 COS"),
        (httpx.WriteTimeout("The write operation timed out"), "upload_timeout", "上传到 COS 超时"),
        (httpx.ReadTimeout("The read operation timed out"), "response_timeout", "没有响应"),
    ],
)
def test_cos_timeout_failures_are_distinguishable(monkeypatch, raised, expected_code, expected_text) -> None:
    _patch_httpx_client(monkeypatch, raised)
    with pytest.raises(ProviderError) as excinfo:
        CosClient("AKIDx", "secretx", BUCKET, REGION)._send(
            "GET", "https://example.invalid/x", {}, None
        )
    assert excinfo.value.code == expected_code
    assert expected_text in str(excinfo.value)
    assert excinfo.value.raw == str(raised)


# --- 分块上传 ---------------------------------------------------------------


def _multipart_send(monkeypatch, client: CosClient, *, part_failures=None, complete_text=None):
    """把 _send 换成假 COS，按请求形状分派：初始化 / 传块 / 合并 / 放弃。

    part_failures 形如 {2: 1}：第 2 块先失败 1 次，再成功。
    """
    failures = dict(part_failures or {})
    calls: list[dict] = []

    def fake_send(method: str, url: str, headers: dict, content: object):
        payload = content.read() if hasattr(content, "read") else content
        calls.append({"method": method, "url": url, "headers": headers, "body": payload})
        if "?uploads" in url:
            return _FakeResponse(
                200,
                "<InitiateMultipartUploadResult><UploadId>UP-1</UploadId>"
                "</InitiateMultipartUploadResult>",
            )
        if "partNumber=" in url:
            number = int(re.search(r"partNumber=(\d+)", url).group(1))
            if failures.get(number, 0) > 0:
                failures[number] -= 1
                # 模拟 2026-09-14 现场那次：连接被对端断开
                raise ProviderError(
                    "与腾讯云 COS 的连接中断", code="network",
                    raw="Server disconnected without sending a response.",
                )
            return _FakeResponse(200, "", {"ETag": f'"etag-{number}"'})
        if method == "POST":
            return _FakeResponse(200, complete_text or "<CompleteMultipartUploadResult/>")
        if method == "DELETE":
            return _FakeResponse(204)
        raise AssertionError(f"没预料到的请求：{method} {url}")

    monkeypatch.setattr(client, "_send", fake_send)
    return calls


def _big_file(tmp_path, size: int = 250):
    audio = tmp_path / "big.bin"
    audio.write_bytes(b"x" * size)
    return audio


def test_small_object_still_uses_a_single_put(tmp_path, monkeypatch) -> None:
    """小于阈值仍走一次 PUT：几 MB 的文件没必要拆成三次请求。"""
    client, captured = _client_with_send(monkeypatch, _FakeResponse(200))
    audio = tmp_path / "small.bin"
    audio.write_bytes(b"x" * 512)

    client.put_object("ripple/small.bin", audio)

    assert captured["method"] == "PUT"
    assert "partNumber" not in captured["url"]
    assert captured["url"] == f"https://{HOST}/ripple/small.bin"


def test_large_object_is_split_uploaded_in_order_and_completed(tmp_path, monkeypatch) -> None:
    """超过阈值必须走分块 —— 这是「单条长连接被中途掐断」的兜底。"""
    client = CosClient("AKIDx", "secretx", BUCKET, REGION)
    monkeypatch.setattr(cos_module, "MULTIPART_THRESHOLD_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_SIZE_BYTES", 100)
    calls = _multipart_send(monkeypatch, client)
    seen: list[tuple[int, int]] = []

    client.put_object(
        "ripple/big.bin", _big_file(tmp_path), on_progress=lambda s, t: seen.append((s, t))
    )

    def kind(call: dict) -> str:
        if "?uploads" in call["url"]:
            return "init"
        if "partNumber=" in call["url"]:
            return "part"
        return "complete" if call["method"] == "POST" else "abort"

    assert [kind(c) for c in calls] == ["init", "part", "part", "part", "complete"]
    # 250 字节 / 每块 100 → 100 + 100 + 50，最后一块可以不足一块大小（官方允许）
    assert [c["body"] for c in calls if kind(c) == "part"] == [b"x" * 100, b"x" * 100, b"x" * 50]

    part = next(c for c in calls if kind(c) == "part")
    assert "partNumber=1" in part["url"] and "uploadId=UP-1" in part["url"]
    # 两个 query 参数必须同时进 URL 与签名（键小写），否则 COS 会拒
    assert "q-url-param-list=partnumber;uploadid" in part["headers"]["Authorization"]

    complete = next(c for c in calls if kind(c) == "complete")
    assert complete["body"] == (
        b"<CompleteMultipartUpload>"
        b'<Part><PartNumber>1</PartNumber><ETag>"etag-1"</ETag></Part>'
        b'<Part><PartNumber>2</PartNumber><ETag>"etag-2"</ETag></Part>'
        b'<Part><PartNumber>3</PartNumber><ETag>"etag-3"</ETag></Part>'
        b"</CompleteMultipartUpload>"
    )
    # 进度单调递增到文件总大小：界面靠它显示「已传多少」
    assert [s for s, _ in seen] == [0, 100, 200, 250]
    assert seen[-1] == (250, 250)


def test_a_broken_part_is_retried_and_the_others_are_not_resent(tmp_path, monkeypatch) -> None:
    """坏一块只补那一块 —— 这正是分块上传存在的理由。"""
    client = CosClient("AKIDx", "secretx", BUCKET, REGION)
    monkeypatch.setattr(cos_module, "MULTIPART_THRESHOLD_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_SIZE_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_RETRY_BACKOFF_SECONDS", 0)
    calls = _multipart_send(monkeypatch, client, part_failures={2: 1})

    client.put_object("ripple/big.bin", _big_file(tmp_path))

    assert len([c for c in calls if "partNumber=2" in c["url"]]) == 2, "第 2 块断了要重试"
    assert len([c for c in calls if "partNumber=1" in c["url"]]) == 1, "第 1 块不该被重传"
    assert len([c for c in calls if "partNumber=3" in c["url"]]) == 1
    assert not [c for c in calls if c["method"] == "DELETE"], "重试成功就不该放弃整个上传"


def test_a_part_that_never_succeeds_gives_up_and_tells_cos_to_clean_up(tmp_path, monkeypatch) -> None:
    """重试用完就放弃，并且必须通知 COS 清理已上传的分块（否则一直占着存储）。"""
    client = CosClient("AKIDx", "secretx", BUCKET, REGION)
    monkeypatch.setattr(cos_module, "MULTIPART_THRESHOLD_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_SIZE_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_RETRY_BACKOFF_SECONDS", 0)
    calls = _multipart_send(monkeypatch, client, part_failures={2: 99})

    with pytest.raises(ProviderError) as excinfo:
        client.put_object("ripple/big.bin", _big_file(tmp_path))

    assert len([c for c in calls if "partNumber=2" in c["url"]]) == cos_module.PART_MAX_ATTEMPTS
    assert [c for c in calls if c["method"] == "DELETE"], "放弃时必须 Abort 掉已传的分块"
    merged = [
        c
        for c in calls
        if c["method"] == "POST" and "partNumber" not in c["url"] and "?uploads" not in c["url"]
    ]
    assert not merged, "没传完就不该去合并"
    # 报错要说清「传到哪一步断的」，用户才知道是刚开始还是快完了
    assert "已传 100B / 250B" in str(excinfo.value)


def test_complete_that_returns_an_error_inside_a_200_is_a_failure(tmp_path, monkeypatch) -> None:
    """COS 会「HTTP 200 但响应体里是 Error」——只看状态码会把失败当成功。"""
    client = CosClient("AKIDx", "secretx", BUCKET, REGION)
    monkeypatch.setattr(cos_module, "MULTIPART_THRESHOLD_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_SIZE_BYTES", 100)
    _multipart_send(monkeypatch, client, complete_text="<Error><Code>InvalidPart</Code></Error>")

    with pytest.raises(ProviderError) as excinfo:
        client.put_object("ripple/big.bin", _big_file(tmp_path))
    assert excinfo.value.code == "upload_failed"

    # 对照：正常响应体必须判为成功
    monkeypatch.undo()
    client2 = CosClient("AKIDx", "secretx", BUCKET, REGION)
    monkeypatch.setattr(cos_module, "MULTIPART_THRESHOLD_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_SIZE_BYTES", 100)
    _multipart_send(monkeypatch, client2)
    client2.put_object("ripple/big.bin", _big_file(tmp_path))


def test_part_permission_error_fails_fast_without_retrying(tmp_path, monkeypatch) -> None:
    """密钥/权限不对重试一百次也不会变对，必须立刻抛出，别浪费用户的时间。"""
    client = CosClient("AKIDx", "secretx", BUCKET, REGION)
    monkeypatch.setattr(cos_module, "MULTIPART_THRESHOLD_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_SIZE_BYTES", 100)
    monkeypatch.setattr(cos_module, "PART_RETRY_BACKOFF_SECONDS", 0)
    calls: list[dict] = []

    def fake_send(method: str, url: str, headers: dict, content: object):
        calls.append({"method": method, "url": url})
        if "?uploads" in url:
            return _FakeResponse(200, "<UploadId>UP-1</UploadId>")
        if "partNumber=" in url:
            return _FakeResponse(403, "<Error><Code>AccessDenied</Code></Error>")
        return _FakeResponse(204)

    monkeypatch.setattr(client, "_send", fake_send)

    with pytest.raises(ProviderError) as excinfo:
        client.put_object("ripple/big.bin", _big_file(tmp_path))

    assert excinfo.value.code == "invalid_api_key"
    assert len([c for c in calls if "partNumber=" in c["url"]]) == 1, "权限错误不该重试"
    assert [c for c in calls if c["method"] == "DELETE"], "失败后仍要清理已传的分块"


# --- 失败时的说法 -----------------------------------------------------------


def test_failure_message_says_nothing_left_the_machine_when_never_connected() -> None:
    from app.cos import _upload_failure

    original = ProviderError("连不上腾讯云 COS", code="network", raw="connect timeout")
    message = str(_upload_failure(original, 0, 1024))
    assert "一个字节都没传出去" in message
    assert "多半是网络波动" in message, "要给概率，但不指责任何一方"


def test_failure_message_reports_how_far_it_got() -> None:
    from app.cos import _upload_failure

    original = ProviderError("连接中断", code="network", raw="Server disconnected")
    message = str(_upload_failure(original, 100 * 1024 * 1024, 200 * 1024 * 1024))
    assert "已传 100.0MB / 200.0MB" in message
    assert "多半是网络波动，与音频本身无关" in message


def test_configuration_errors_are_not_dressed_up_as_network_problems() -> None:
    """「密钥无效」用「已传 0B」去描述只会让人更糊涂，必须原样抛出。"""
    from app.cos import _upload_failure

    original = ProviderError("COS 拒绝了这次请求", code="invalid_api_key", raw="<Error/>")
    assert _upload_failure(original, 0, 1024) is original
