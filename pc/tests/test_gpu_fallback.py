"""显卡出错时自动改用 CPU 识别，并且告诉用户；其他错误照常抛出。"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from nihongo_pc import transcribe as tr
from nihongo_pc.config import WhisperConfig


class FakeModel:
    def transcribe(self, *_args, **_kwargs):
        return iter([]), SimpleNamespace(duration=10)


def fake_loader(fail_with: Exception | None):
    calls = []

    def load(cfg):
        calls.append(cfg.device)
        if cfg.device != "cpu" and fail_with:
            raise fail_with
        return FakeModel(), "cpu" if cfg.device == "cpu" else "cuda"

    return load, calls


def test_cuda_error_falls_back_to_cpu(monkeypatch):
    load, calls = fake_loader(RuntimeError("CUDA failed with error out of memory"))
    monkeypatch.setattr(tr, "_load_model", load)
    notes = []
    assert tr.transcribe(Path("a.mp4"), WhisperConfig(), notice=notes.append) == []
    assert calls == ["auto", "cpu"]
    assert len(notes) == 1 and "CPU" in notes[0]


def test_other_errors_are_not_hidden(monkeypatch):
    load, _ = fake_loader(ValueError("文件坏了"))
    monkeypatch.setattr(tr, "_load_model", load)
    with pytest.raises(ValueError):
        tr.transcribe(Path("a.mp4"), WhisperConfig(), notice=lambda _m: None)


def test_no_gpu_detected_is_reported(monkeypatch):
    monkeypatch.setattr(tr, "_load_model", lambda cfg: (FakeModel(), "cpu"))
    notes = []
    tr.transcribe(Path("a.mp4"), WhisperConfig(), notice=notes.append)
    assert len(notes) == 1 and "没有检测到" in notes[0]
