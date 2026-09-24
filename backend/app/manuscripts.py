"""Read legacy Word text locally, without starting Word or sending it to a provider."""
import asyncio
import subprocess
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter(prefix="/api/manuscripts")
MAX_BYTES = 50 * 1024 * 1024
TEXTUTIL = Path('/usr/bin/textutil')


def legacy_word_text(data: bytes) -> str:
    if not TEXTUTIL.is_file():
        raise HTTPException(422, '当前系统无法读取旧版 .doc，请用 Word 另存为 .docx 后拖入。')
    try:
        result = subprocess.run(
            [str(TEXTUTIL), '-convert', 'txt', '-stdin', '-stdout', '-encoding', 'UTF-8', '-noload', '-nostore'],
            input=data, capture_output=True, timeout=30, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(422, 'Word 文稿读取超时，请另存为 .docx 后重试。') from exc
    except OSError as exc:
        raise HTTPException(422, '无法启动本地 Word 读取工具，请另存为 .docx 后重试。') from exc
    if result.returncode:
        raise HTTPException(422, '无法读取这份 .doc 文稿，可能已损坏或设有密码。请用 Word 打开并另存为 .docx。')
    try:
        text = result.stdout.decode('utf-8').strip()
    except UnicodeDecodeError as exc:
        raise HTTPException(422, 'Word 文稿编码无法识别，请另存为 .docx 后重试。') from exc
    if not text:
        raise HTTPException(422, 'Word 文稿没有可读取的正文。')
    return text


@router.post('/legacy-word')
async def read_legacy_word(file: Annotated[UploadFile, File()]):
    try:
        if not (file.filename or '').lower().endswith('.doc'):
            raise HTTPException(422, '请选择旧版 Word（.doc）文件。')
        data = await file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, 'Word 文稿超过 50 MB，请拆分后导入。')
        if not data:
            raise HTTPException(422, 'Word 文件为空。')
        return {'text': await asyncio.to_thread(legacy_word_text, data)}
    finally:
        await file.close()
