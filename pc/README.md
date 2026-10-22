# にゃほんご 电脑端

把网页视频、播客或本地媒体文件处理成「学习包」：压缩后的媒体 + 带时间戳、分词和注音的日语字幕。手机端从 `library/` 同步学习包。

## 准备

需要 [uv](https://docs.astral.sh/uv/) 和 ffmpeg（`winget install Gyan.FFmpeg`）。

```bash
uv sync
```

按需复制配置文件（代理、Cookie、Whisper 模型都在里面）：

```bash
cp config.example.toml config.toml
```

第一次转写会自动下载 Whisper 模型（large-v3 约 3GB）。如果 Hugging Face 连不上，先设置镜像：

```bash
set HF_ENDPOINT=https://hf-mirror.com
```

## 使用

双击 `启动.bat`，浏览器会自动打开 http://127.0.0.1:8765 ：

- **导入**：粘贴链接后点「开始处理」，或者把本地视频、音频文件拖进窗口
- **学习**：点学习库里的卡片进入逐句播放器。点句子跳转，悬停单词查看读音、原形和词性
- **快捷键**：空格 播放/暂停，← → 上/下一句，R 重听，L 单句循环，P 每句读完自动暂停，F 切换注音

关掉启动.bat 的黑色窗口，服务就停止了。

也可以用命令行：

```bash
uv run nihongo add https://www.bilibili.com/video/BVxxxx
uv run nihongo add https://www.youtube.com/watch?v=xxxx --audio-only
uv run nihongo add D:\anime\ep01.mkv
uv run nihongo list
```

| 参数 | 说明 |
|---|---|
| `--audio-only` | 只保留音频，适合播客 |
| `--force-whisper` | 即使网站有人工日语字幕，也用 Whisper 重新转写 |
| `--no-compress` | 不重新编码，直接复制原文件 |
| `--overwrite` | 覆盖已存在的同名学习包 |

## 学习包格式

```
library/<id>/
  media.mp4 / media.m4a
  meta.json        标题、来源链接、时长、句子数
  subtitles.json   句子列表
```

`subtitles.json` 里每个句子：

```json
{
  "id": 0, "start": 1.23, "end": 3.40, "text": "学校へ行きませんでした。",
  "tokens": [
    {"surface": "学校", "base": "学校", "reading": "がっこう", "pos": "名詞",
     "furigana": [{"text": "学校", "reading": "がっこう"}]},
    {"surface": "行き", "base": "行く", "reading": "いき", "pos": "動詞",
     "furigana": [{"text": "行", "reading": "い"}, {"text": "き", "reading": null}]}
  ]
}
```

`furigana` 的规则和安卓端一致：只有汉字段有 `reading`（平假名），汉字和送假名分开，对不齐时整个词不注音。

## 测试

```bash
uv run pytest
```
