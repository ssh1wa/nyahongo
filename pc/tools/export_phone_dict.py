"""把手机用的离线词典导出到 App 里，打 APK 时预装。

词典文件（约 76 MB）不进 git：app/assets/dict/jmdict.sqlite；版本信息 app/src/data/dictInfo.json 进 git，
App 用它判断预装的词典有没有更新。电脑上新翻译了词条（比如 PC 端「预翻译常用词」）之后重新运行一次。

运行（在 pc 目录）：uv run python tools/export_phone_dict.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from nihongo_pc import phone_dict  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "app/assets/dict/jmdict.sqlite"
INFO = ROOT / "app/src/data/dictInfo.json"


def main() -> None:
    src = phone_dict.ensure_fresh()
    info = phone_dict.info()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, TARGET)
    INFO.write_text(json.dumps({k: info[k] for k in ("version", "entries", "zh", "size")}, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    print(f"已导出：{info['entries']} 个词条，{info['zh']} 个有中文释义，{info['size'] / 1048576:.0f} MB")


if __name__ == "__main__":
    main()
