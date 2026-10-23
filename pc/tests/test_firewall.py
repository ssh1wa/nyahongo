import base64
import subprocess
import sys

import pytest

from nihongo_pc import firewall

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="只有 Windows 有防火墙规则")


def _fake_run(returncode, calls):
    def run(cmd, **kw):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, returncode, b"", b"")
    return run


def test_needs_rule_follows_netsh_result(monkeypatch):
    calls = []
    monkeypatch.setattr(subprocess, "run", _fake_run(1, calls))
    assert firewall.needs_rule(8765) is True
    assert calls[0][-1] == "name=Nyahongo PC 8765"
    monkeypatch.setattr(subprocess, "run", _fake_run(0, calls))
    assert firewall.needs_rule(8765) is False


def test_needs_rule_is_quiet_when_netsh_unavailable(monkeypatch):
    def boom(*a, **k):
        raise OSError("没有 netsh")
    monkeypatch.setattr(subprocess, "run", boom)
    assert firewall.needs_rule(8765) is False  # 查不了就不打扰用户


def test_allow_builds_elevated_netsh_command(monkeypatch):
    calls = []
    monkeypatch.setattr(subprocess, "run", _fake_run(0, calls))
    monkeypatch.setattr(firewall, "needs_rule", lambda port: False)
    assert firewall.allow(8765) is True
    cmd = calls[0]
    script = base64.b64decode(cmd[cmd.index("-EncodedCommand") + 1]).decode("utf-16-le")
    assert "-Verb RunAs" in script
    assert 'name="Nyahongo PC 8765"' in script
    assert "dir=in action=allow protocol=TCP localport=8765" in script


def test_allow_false_when_user_declines(monkeypatch):
    monkeypatch.setattr(subprocess, "run", _fake_run(1, []))
    monkeypatch.setattr(firewall, "needs_rule", lambda port: True)  # 授权框点了「否」，规则还是没有
    assert firewall.allow(8765) is False
