"""本地网页界面的后端：学习库、媒体播放、处理任务队列。

默认只监听本机。开了局域网同步（--lan）后，手机等其他设备只能读取和下载学习包，
导入、删除、处理任务这些操作仍然只允许本机。
"""

from __future__ import annotations

import json
import queue
import re
import shutil
import socket
import threading
import time
import traceback
import uuid
import webbrowser
from dataclasses import asdict, dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import load_config
from .dictionary import ATTRIBUTION
from .package import make_thumbnail
from .pipeline import STAGES, Options, PackageExists, run

WEB_DIR = Path(__file__).parent / "web"
_ID = re.compile(r"^[\w\-]+$")
_FILE = re.compile(r"^(media\.\w+|subtitles\.json|dictionary\.json|meta\.json|thumb\.jpg)$")
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
# 其他设备能访问的路径（只读）
REMOTE_ALLOWED = re.compile(r"^/api/(ping|library(/[\w\-]+(/(files(/[\w.\-]+)?|thumb|media))?)?)$")

app = FastAPI(title="日语学习包")
_lan = {"enabled": False, "port": 8765}


@app.middleware("http")
async def lan_read_only(request: Request, call_next):
    client = request.client.host if request.client else ""
    if client not in LOCAL_HOSTS:
        if request.method not in ("GET", "HEAD") or not REMOTE_ALLOWED.match(request.url.path):
            return JSONResponse({"detail": "其他设备只能读取学习包"}, status_code=403)
    return await call_next(request)


def lan_addresses() -> list[str]:
    """本机在局域网里的 IPv4 地址（排除回环和虚拟网卡常见的 169.254）。"""
    addrs: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.add(info[4][0])
    except OSError:
        pass
    try:  # 找默认出口网卡的地址，不会真的发包
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("223.5.5.5", 53))
            addrs.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith(("127.", "169.254.")))


@app.get("/api/ping")
def ping() -> dict:
    return {"app": "nihongo-pc", "version": 1}


@app.get("/api/lan")
def lan_info() -> dict:
    port = _lan["port"]
    return {"enabled": _lan["enabled"], "urls": [f"http://{a}:{port}" for a in lan_addresses()]}


# ---------- 学习库 ----------

def _pkg_dir(pkg_id: str) -> Path:
    cfg = load_config()
    if not _ID.match(pkg_id):
        raise HTTPException(400, "无效的学习包 id")
    d = cfg.library / pkg_id
    if not (d / "meta.json").exists():
        raise HTTPException(404, "学习包不存在")
    return d


@app.get("/api/library")
def list_library() -> list[dict]:
    cfg = load_config()
    items = []
    for meta_path in cfg.library.glob("*/meta.json") if cfg.library.exists() else []:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        thumb = meta_path.parent / "thumb.jpg"
        if not thumb.exists() and meta.get("media_type") == "video":
            # 早期生成的学习包没有封面，补一张
            make_thumbnail(meta_path.parent / meta["media"], meta_path.parent, cfg.ffmpeg_path())
        meta["has_thumb"] = thumb.exists()
        meta["size_mb"] = round(
            sum(f.stat().st_size for f in meta_path.parent.iterdir()) / 1048576, 1
        )
        items.append(meta)
    items.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    return items


@app.get("/api/library/{pkg_id}")
def get_package(pkg_id: str) -> dict:
    d = _pkg_dir(pkg_id)
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    subtitles = json.loads((d / "subtitles.json").read_text(encoding="utf-8"))
    dict_path = d / "dictionary.json"
    dictionary = json.loads(dict_path.read_text(encoding="utf-8")) if dict_path.exists() else {}
    return {"meta": meta, "subtitles": subtitles, "dictionary": dictionary, "attribution": ATTRIBUTION}


@app.get("/api/library/{pkg_id}/media")
def get_media(pkg_id: str) -> FileResponse:
    d = _pkg_dir(pkg_id)
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    return FileResponse(d / meta["media"])  # 支持 Range，可以拖动进度条


@app.get("/api/library/{pkg_id}/files")
def list_files(pkg_id: str) -> list[dict]:
    """手机同步用：学习包里的文件和大小。"""
    d = _pkg_dir(pkg_id)
    return [{"name": f.name, "size": f.stat().st_size} for f in sorted(d.iterdir()) if _FILE.match(f.name)]


@app.get("/api/library/{pkg_id}/files/{name}")
def get_file(pkg_id: str, name: str) -> FileResponse:
    if not _FILE.match(name):
        raise HTTPException(404)
    path = _pkg_dir(pkg_id) / name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path)


@app.get("/api/library/{pkg_id}/thumb")
def get_thumb(pkg_id: str) -> FileResponse:
    path = _pkg_dir(pkg_id) / "thumb.jpg"
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path)


@app.delete("/api/library/{pkg_id}")
def delete_package(pkg_id: str) -> dict:
    shutil.rmtree(_pkg_dir(pkg_id))
    return {"ok": True}


# ---------- 处理任务 ----------

@dataclass
class Job:
    id: str
    source: str
    display: str  # 界面上显示的名字
    audio_only: bool = False
    overwrite: bool = False
    title: str | None = None
    status: str = "queued"  # queued / running / done / error
    stage: int = 0
    stage_progress: float | None = 0
    detail: str = ""
    error: str = ""
    exists: bool = False  # 出错原因是学习包已存在，可以选择覆盖
    pkg_id: str = ""
    created: float = field(default_factory=time.time)


_jobs: dict[str, Job] = {}
_lock = threading.Lock()
_queue: queue.Queue[str] = queue.Queue()


def _worker() -> None:
    while True:
        job = _jobs[_queue.get()]
        job.status = "running"

        def progress(stage: int, fraction: float | None, detail: str) -> None:
            job.stage, job.stage_progress, job.detail = stage, fraction, detail
            if stage == 0 and fraction == 1:  # 下载阶段结束时 detail 是视频标题
                job.display = detail

        try:
            opts = Options(audio_only=job.audio_only, overwrite=job.overwrite, title=job.title)
            result = run(job.source, load_config(), opts, progress)
            job.pkg_id = result.pkg_dir.name
            job.display = result.title
            job.detail = f"{result.sentence_count} 句 · {result.size_mb:.0f} MB · 用时 {result.seconds:.0f} 秒"
            job.status = "done"
        except PackageExists as e:
            job.status, job.error, job.exists, job.pkg_id = "error", str(e), True, e.pkg_id
        except Exception as e:  # noqa: BLE001 — 任何错误都要显示在界面上，不能让工作线程退出
            traceback.print_exc()
            job.status, job.error = "error", f"{type(e).__name__}: {e}"


def _submit(job: Job) -> dict:
    with _lock:
        _jobs[job.id] = job
    _queue.put(job.id)
    return asdict(job)


class JobRequest(BaseModel):
    source: str
    audio_only: bool = False
    overwrite: bool = False
    title: str | None = None


@app.post("/api/jobs")
def create_job(req: JobRequest) -> dict:
    source = req.source.strip().strip('"')
    if not source:
        raise HTTPException(400, "请输入链接")
    return _submit(Job(id=uuid.uuid4().hex[:8], source=source, display=req.title or source,
                       audio_only=req.audio_only, overwrite=req.overwrite, title=req.title))


@app.post("/api/upload")
async def upload(request: Request, filename: str, audio_only: bool = False) -> dict:
    """浏览器拿不到本地文件路径，所以把文件流式传到 workspace/uploads 再处理。"""
    name = Path(filename).name
    if not name:
        raise HTTPException(400, "缺少文件名")
    up_dir = load_config().workspace / "uploads"
    up_dir.mkdir(parents=True, exist_ok=True)
    target = up_dir / name
    with target.open("wb") as f:
        async for chunk in request.stream():
            f.write(chunk)
    title = Path(name).stem
    return _submit(Job(id=uuid.uuid4().hex[:8], source=str(target), display=title,
                       audio_only=audio_only, title=title))


@app.get("/api/jobs")
def list_jobs() -> dict:
    with _lock:
        jobs = sorted(_jobs.values(), key=lambda j: j.created, reverse=True)
    return {"stages": STAGES, "jobs": [asdict(j) for j in jobs]}


@app.delete("/api/jobs/{job_id}")
def dismiss_job(job_id: str) -> dict:
    with _lock:
        job = _jobs.get(job_id)
        if job and job.status in ("done", "error"):
            del _jobs[job_id]
    return {"ok": True}


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


def serve(port: int = 8765, open_browser: bool = True, lan: bool = False) -> None:
    import uvicorn

    _lan.update(enabled=lan, port=port)
    threading.Thread(target=_worker, daemon=True).start()
    url = f"http://127.0.0.1:{port}"
    print(f"日语学习包界面已启动：{url}（关闭这个窗口即可退出）")
    if lan:
        for a in lan_addresses():
            print(f"手机同步地址：http://{a}:{port}")
        print("第一次开启时 Windows 防火墙可能会弹窗，请允许「专用网络」访问")
    if open_browser:
        threading.Timer(1.0, webbrowser.open, [url]).start()
    uvicorn.run(app, host="0.0.0.0" if lan else "127.0.0.1", port=port, log_level="warning")
