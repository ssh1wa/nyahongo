"""OpenAI 兼容接口的最小客户端（DeepInfra、DeepSeek 等都能用）。只用标准库。"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

from .config import LlmConfig

RETRY_STATUS = {429, 500, 502, 503, 504}
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


class LlmError(Exception):
    """可以直接展示给用户的错误，不会包含 API Key。"""


def _request(cfg: LlmConfig, path: str, body: dict | None = None, timeout: float = 90) -> dict:
    key = cfg.key()
    if not key:
        raise LlmError("没有配置 API Key：请在 config.toml 的 [llm] 里填写 api_key")
    url = cfg.base_url.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    for attempt in range(3):
        req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:300]
            if e.code in RETRY_STATUS and attempt < 2:
                time.sleep(2 ** attempt * 2)
                continue
            if e.code == 401:
                raise LlmError("API Key 无效或已失效（HTTP 401）") from None
            raise LlmError(f"接口返回错误 HTTP {e.code}：{detail}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 2:
                time.sleep(2 ** attempt * 2)
                continue
            raise LlmError(f"连接失败：{getattr(e, 'reason', e)}") from None
    raise AssertionError("unreachable")


def list_models(cfg: LlmConfig) -> list[str]:
    payload = _request(cfg, "/models", timeout=30)
    return sorted(m.get("id", "") for m in payload.get("data", []) if m.get("id"))


def _parse_json(text: str) -> dict | list | None:
    cleaned = _FENCE.sub("", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                return None
    return None


def chat_json(
    cfg: LlmConfig,
    messages: list[dict],
    *,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> dict | list:
    """发一次对话请求，要求模型返回 JSON。JSON 不合法时让模型修一次。"""
    if not cfg.model:
        raise LlmError("没有配置模型：请在 config.toml 的 [llm] 里填写 model")

    def call(msgs: list[dict], temp: float) -> str:
        payload = _request(cfg, "/chat/completions", {
            "model": cfg.model,
            "messages": msgs,
            "temperature": temp,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        })
        choice = (payload.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content")
        if choice.get("finish_reason") == "length":
            # 输出被截断时让模型"重新输出完整 JSON"没有用，长度限制还是一样
            raise LlmError(f"模型输出超过 {max_tokens} tokens 被截断，请减少一次处理的内容")
        if not isinstance(content, str) or not content.strip():
            raise LlmError("模型没有返回内容")
        return content

    content = call(messages, temperature)
    parsed = _parse_json(content)
    if parsed is not None:
        return parsed
    repaired = call(messages + [
        {"role": "assistant", "content": content},
        {"role": "user", "content": "上一条回复不是合法的 JSON。请只输出同样内容的完整合法 JSON，不要 Markdown，不要解释。"},
    ], 0.1)
    parsed = _parse_json(repaired)
    if parsed is None:
        raise LlmError("模型连续两次返回了无法解析的 JSON")
    return parsed
