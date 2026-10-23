"""设置页用：把 config.toml 读成网页能显示的样子、把网页改的设置写回 config.toml。

写回时整个文件按固定格式重新生成（带注释），用户以前手动改过的项都会保留，因为是从读出来的配置写回去的。
API Key 不会通过接口返回给网页，只告诉网页「填了没有、末尾 4 位」。
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from . import config as _config
from .config import PC_ROOT, Config, load_config

# 常见的 AI 服务（和手机 App 设置里的一样）
PROVIDERS = [
    {"id": "deepseek", "name": "DeepSeek", "url": "https://api.deepseek.com", "site": "platform.deepseek.com"},
    {"id": "deepinfra", "name": "DeepInfra", "url": "https://api.deepinfra.com/v1/openai", "site": "deepinfra.com"},
    {"id": "bailian", "name": "阿里云百炼", "url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "site": "bailian.console.aliyun.com"},
    {"id": "siliconflow", "name": "硅基流动", "url": "https://api.siliconflow.cn/v1", "site": "cloud.siliconflow.cn"},
]

WHISPER_MODELS = [
    {"id": "large-v3", "name": "large-v3（最准，推荐，约 3 GB）"},
    {"id": "kotoba-tech/kotoba-whisper-v2.0-faster", "name": "kotoba-whisper（日语专用，更快）"},
    {"id": "medium", "name": "medium（电脑没有显卡时可以选，约 1.5 GB）"},
    {"id": "small", "name": "small（最快，准确度一般）"},
]


def _rel(p: Path) -> str:
    try:
        return p.resolve().relative_to(PC_ROOT).as_posix()
    except ValueError:
        return str(p)


def public(cfg: Config | None = None) -> dict:
    """给网页看的设置（不含 API Key 本身）"""
    cfg = cfg or load_config()
    key = cfg.llm.api_key
    return {
        "llm": {"base_url": cfg.llm.base_url, "model": cfg.llm.model, "has_key": bool(cfg.llm.key()),
                "key_tail": key[-4:] if len(key) >= 8 else "", "from_env": bool(cfg.llm.key() and not key)},
        "download": asdict(cfg.download),
        "whisper": asdict(cfg.whisper),
        "ffmpeg": cfg.ffmpeg,
        "paths": {"library": _rel(cfg.library), "workspace": _rel(cfg.workspace), "library_abs": str(cfg.library)},
        "providers": PROVIDERS,
        "whisper_models": WHISPER_MODELS,
        "config_path": str(_config.CONFIG_PATH),
    }


def _toml(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "[" + ", ".join(_toml(x) for x in v) + "]"
    return json.dumps(str(v), ensure_ascii=False)  # TOML 的基本字符串和 JSON 字符串转义规则一致


def write(cfg: Config, path: Path | None = None) -> None:
    # 路径在调用时才取：默认参数写成 CONFIG_PATH 会在定义时就固定下来，测试换不掉，会写坏真实的配置
    path = path or _config.CONFIG_PATH
    d, w = cfg.download, cfg.whisper
    lines = [
        "# にゃほんご PC 端的设置。一般在 PC 端的「设置」页里改就行，也可以直接编辑这个文件。",
        "# 这个文件不会被提交到 git（里面有 API Key）。",
        "",
        "[paths]",
        f"workspace = {_toml(_rel(cfg.workspace))}   # 下载的原始文件",
        f"library = {_toml(_rel(cfg.library))}       # 生成的学习包，手机从这里下载",
        f"sync = {_toml(_rel(cfg.sync))}             # 多设备同步的数据和备份",
        "",
        "[ffmpeg]",
        f"path = {_toml(cfg.ffmpeg)}                 # 留空自动查找",
        "",
        "[download]",
        f"proxy = {_toml(d.proxy)}                   # 例如 http://127.0.0.1:7890，只用于下面列出的网站",
        f"proxy_domains = {_toml(d.proxy_domains)}",
        f"cookies_from_browser = {_toml(d.cookies_from_browser)}  # 需要登录才能看的内容：edge / chrome / firefox",
        f"max_height = {_toml(d.max_height)}",
        "",
        "[whisper]",
        f"model = {_toml(w.model)}",
        f"device = {_toml(w.device)}                 # auto / cuda / cpu",
        f"compute_type = {_toml(w.compute_type)}",
        f"beam_size = {_toml(w.beam_size)}",
        f"initial_prompt = {_toml(w.initial_prompt)} # 角色名、专有名词，提高识别准确率",
        f"hf_mirror = {_toml(w.hf_mirror)}           # 模型从国内镜像 hf-mirror.com 下载",
        "",
        "[llm]",
        "# 任何兼容 OpenAI 格式的接口都可以（DeepSeek、DeepInfra、阿里云百炼、硅基流动……）",
        f"base_url = {_toml(cfg.llm.base_url)}",
        f"api_key = {_toml(cfg.llm.api_key)}         # 也可以不填，改用环境变量 NIHONGO_LLM_API_KEY",
        f"model = {_toml(cfg.llm.model)}",
        "",
    ]
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(lines), encoding="utf-8")
    tmp.replace(path)


def update(patch: dict) -> dict:
    """按网页提交的改动更新设置。api_key 只有填了新值才会替换，传 null 是清空"""
    cfg = load_config()
    llm = patch.get("llm") or {}
    for k in ("base_url", "model"):
        if isinstance(llm.get(k), str):
            setattr(cfg.llm, k, llm[k].strip())
    if "api_key" in llm:
        if llm["api_key"] is None:
            cfg.llm.api_key = ""
        elif isinstance(llm["api_key"], str) and llm["api_key"].strip():
            cfg.llm.api_key = llm["api_key"].strip()
    dl = patch.get("download") or {}
    if isinstance(dl.get("proxy"), str):
        cfg.download.proxy = dl["proxy"].strip()
    if isinstance(dl.get("proxy_domains"), list):
        cfg.download.proxy_domains = [str(x).strip() for x in dl["proxy_domains"] if str(x).strip()]
    if isinstance(dl.get("cookies_from_browser"), str):
        cfg.download.cookies_from_browser = dl["cookies_from_browser"].strip()
    if isinstance(dl.get("max_height"), int) and 144 <= dl["max_height"] <= 2160:
        cfg.download.max_height = dl["max_height"]
    wh = patch.get("whisper") or {}
    for k in ("model", "device", "initial_prompt"):
        if isinstance(wh.get(k), str):
            setattr(cfg.whisper, k, wh[k].strip())
    if isinstance(wh.get("hf_mirror"), bool):
        cfg.whisper.hf_mirror = wh["hf_mirror"]
    if isinstance(patch.get("ffmpeg"), str):
        cfg.ffmpeg = patch["ffmpeg"].strip()
    write(cfg)
    return public(load_config())
