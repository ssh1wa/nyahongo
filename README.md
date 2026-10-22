# にゃほんご

用 AI 帮你学日语的安卓 App：翻译并拆解句子、读适合自己水平的文章、逐句精听视频和播客、背单词、学语法。学习的时候还有一只猫陪你（猫に小判）。

配套的**电脑端**负责把视频、播客做成带字幕的「学习包」，手机连上电脑下载后就能逐句精听。只用翻译、阅读、语法、生词本的话，不装电脑端也可以。

## 截图

<table>
<tr>
<td align="center" width="25%"><img src="docs/screenshots/translate.webp" width="200" alt="翻译：中日互译，拆解词汇和语法"><br><sub>翻译：中日互译，拆解词汇和语法</sub></td>
<td align="center" width="25%"><img src="docs/screenshots/reading.webp" width="200" alt="阅读：按你的水平写文章，每句带注音"><br><sub>阅读：按你的水平写文章，每句带注音</sub></td>
<td align="center" width="25%"><img src="docs/screenshots/reading_sheet.webp" width="200" alt="点一句：译文、重点词、语法，可追问 AI"><br><sub>点一句：译文、重点词、语法，可追问 AI</sub></td>
<td align="center" width="25%"><img src="docs/screenshots/listen.webp" width="200" alt="精听：视频逐句播放，点词查词典"><br><sub>精听：视频逐句播放，点词查词典</sub></td>
</tr>
<tr>
<td align="center" width="25%"><img src="docs/screenshots/word.webp" width="200" alt="生词本：词典释义 + AI 详细讲解"><br><sub>生词本：词典释义 + AI 详细讲解</sub></td>
<td align="center" width="25%"><img src="docs/screenshots/ask.webp" width="200" alt="问 AI：某个场合怎么说，例句带注音"><br><sub>问 AI：某个场合怎么说，例句带注音</sub></td>
<td align="center" width="25%"><img src="docs/screenshots/reading_home.webp" width="200" alt="阅读入口：导入、AI 写、搜索、常读"><br><sub>阅读入口：导入、AI 写、搜索、常读</sub></td>
<td align="center" width="25%"><img src="docs/screenshots/catroom.webp" width="200" alt="猫に小判：学习攒小判，开宝箱收集猫咪"><br><sub>猫に小判：学习攒小判，开宝箱收集猫咪</sub></td>
</tr>
</table>

<sub>精听截图里的视频画面打了马赛克。</sub>

## 能做什么

- **翻译**：中日互译，拆解词汇和语法，可以接着追问 AI
- **阅读**：让 AI 按你的水平写文章（可以先上网查资料）、拍书页和漫画识别日文、读网页、搜维基百科；每句话都有注音和翻译；还能把常读的要求存下来，每天一篇
- **精听**：电脑端处理过的视频、播客逐句播放，单句循环、每句自动暂停、调速；点单词查词典
- **语法**：按 N5～N1 排好的语法课，每课有讲解、例句和小测验；一句一练；直接问 AI「这个语法怎么用」「这个场合怎么说」
- **生词本**：FSRS 记忆算法安排复习，每个词有 AI 详细讲解，记牢的词自动移到「已掌握」
- **查词**：长按任何日文都能选词、复制、查词；安卓系统的文字选择菜单里也会多一个「查词」，在别的 App 里也能用
- **多设备同步**：手机、平板连同一台电脑，学习进度自动合并

## 快速开始

### 1. 安装 App

在本项目的 [Releases](../../releases) 页面下载最新的 `nyahongo.apk`，传到安卓手机上安装（需要允许「安装未知来源应用」）。目前只有安卓版。

### 2. 填一个 AI 服务的 API Key

翻译、讲解、出题都要用 AI，需要你自己申请一个 API Key（按用量付费，日常学习花得很少）。第一次打开 App 会有引导，也可以在「设置 → AI 接口」里填。

| 服务商 | 申请 Key 的网站 | 说明 |
|---|---|---|
| DeepSeek | platform.deepseek.com | 便宜、中文好；**没有看图模型**，用拍照识字要另选一家 |
| DeepInfra | deepinfra.com | 模型多，文字和看图都有（开发时一直用的这家） |
| 阿里云百炼 | bailian.console.aliyun.com | 国内直连，通义千问系列，能看图 |
| 硅基流动 | cloud.siliconflow.cn | 国内直连，开源模型多，能看图 |

填好 Key 后 App 会自动读取这家的模型列表，选一个就能用。

**联网搜索（可选）**：让 AI 写文章前先上网查资料、在「阅读」里搜全网文章，需要 DeepSeek 的 Key（约每千次搜索 5 元人民币）。不填也能用，只能搜日语维基百科。

### 3. 装电脑端（可选，精听视频需要）

在 [Releases](../../releases) 下载电脑端安装包，详见下面的[电脑端](#电脑端)。App 里「精听」页标题旁的问号里也有图文教程。

## 电脑端

需要一台 **Windows 10 / 11**（64 位）电脑。有 NVIDIA 显卡的话语音转文字会快很多，没有显卡也能用，只是慢一些。

### 安装（推荐）

1. 在 [Releases](../../releases) 下载 `nyahongo-pc-setup.exe`（约 16 MB），双击安装。不需要管理员权限，默认装在你自己的用户目录里
2. 安装时可以勾选「国内网络」：语音识别模型会从国内镜像下载
3. 装完从开始菜单打开「にゃほんご 电脑端」。**第一次启动**会自动下载 Python 和需要的组件（约 2.5 GB），电脑上没有 ffmpeg 的话也会自动装一个，网速慢要等十几分钟，只有这一次。完成后浏览器会打开电脑端网页
4. **填 AI 的 Key**：开始菜单里点「填写 AI Key 和设置（config.toml）」，在 `[llm]` 下填 `base_url`、`api_key` 和 `model`（和手机上用同一家就行），保存后重新打开电脑端。AI 用来校对字幕、加中文翻译；不填也能用，只是没有中文翻译

打开后会有一个黑色窗口，不要关，关掉电脑端就停了。卸载时下载的组件会一起删掉，学习库和配置会留下。

### 从源码运行（可选）

不想用安装包，或者想改代码：

1. 本页面右上角「Code → Download ZIP」，解压到路径里没有空格和中文的文件夹，比如 `D:\nihongo`
2. 安装 uv（Python 环境管理工具）和 ffmpeg，在 PowerShell 里运行：
   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   winget install Gyan.FFmpeg.Essentials
   ```
   装完关掉 PowerShell 再重新打开
3. 把 `pc\config.example.toml` 复制一份改名为 `config.toml`，填好 `[llm]`
4. 双击 `pc\启动.bat`

### 导入视频

在电脑端网页粘贴 B 站、YouTube、niconico 链接，点「开始处理」；或者把电脑里的视频、音频文件拖进窗口。处理流程是：下载 → 语音转文字（视频自带日语字幕时直接用字幕）→ AI 校对和翻译 → 分词、注音、查词典。

- 只想听：勾选「只保留音频（播客）」，文件小很多
- B 站多 P、YouTube 播放列表：勾选「展开整个合集」，每集一个学习包
- 英语视频：勾选「英语（测试版）」，做成中英双语字幕；手机上要在「设置 → 学习」打开「测试版功能」

### 连接手机

1. 手机和电脑连同一个 Wi-Fi
2. 电脑端网页右上角会显示「📱 手机同步：192.168.x.x:8765」
3. App 的「设置 → 同步与词典」里填这个地址，点「测试连接并保存」
4. 回到「精听」页，下拉刷新，下载学习包；顺便在「设置 → 同步与词典」下载离线词典（约 70 MB，查词更准、省 AI 费用）

第一次启动电脑端时 Windows 会问是否允许网络访问，要选「允许」。点错了可以在「Windows 安全中心 → 防火墙 → 允许应用通过防火墙」里把 Python 勾上。

手机、平板都填同一个地址，生词本、复习进度、阅读和翻译记录、语法进度、精听进度、猫に小判的进度会通过电脑自动合并同步。

## 常见问题

**第一次处理视频卡在下载模型 / 下载词典**

语音识别模型（约 3 GB）从 Hugging Face 下载，词典从 GitHub 下载，国内网络可能很慢或连不上。

- 用安装包装的：重新运行安装包，勾选「国内网络」，模型会改从国内镜像下载
- 词典也下载不动、或者从源码运行的：关掉黑色窗口，在 `pc` 文件夹的地址栏输入 `cmd` 回车，在弹出的窗口里运行（代理地址换成你自己的；没有代理就只设第一行的镜像）：

```bat
set HF_ENDPOINT=https://hf-mirror.com
set HTTPS_PROXY=http://127.0.0.1:7890
启动.bat
```

**YouTube、niconico 下载失败**

在 `config.toml` 的 `[download]` 里把 `proxy` 填成你的代理地址。需要登录才能看的视频，把 `cookies_from_browser` 填成你登录用的浏览器（`edge` 或 `chrome`）。

**手机连不上电脑**

检查电脑端的黑色窗口还开着、手机没连到别的 Wi-Fi 或在用流量、Windows 防火墙允许了 Python。

**数据存在哪里**

API Key 只保存在你自己设备的加密存储里。学习记录存在手机本地；开了同步的话，电脑上 `pc\sync\` 里也有一份（会保留最近 30 个旧版本）。App 只会把要处理的内容发给你自己选的 AI 服务。

**AI 讲错了怎么办**

AI 生成的讲解、翻译和例句可能有错，以词典和原始资料为准。查词优先用离线词典（JMdict），词典里没有的词才用 AI 释义，并会标明「AI 释义」。

## 自己编译 App

App 用 Expo（React Native）写成，在 `app/` 目录：

```bash
cd app
npm install
npx expo prebuild --platform android
npx expo run:android --variant release
```

需要 JDK 17 和 Android SDK。`app/build-apk.bat` 是作者自己用的打包脚本，用环境变量 `NIHONGO_TOOLCHAIN` 指向放 JDK、Android SDK 和 Gradle 缓存的文件夹。

测试：

```bash
cd app && npx tsc --noEmit && node --test tests/syncMerge.test.mjs
cd pc && uv run pytest
```

## 项目结构

```
app/   安卓 App（Expo / React Native）
pc/    电脑端：下载 → Whisper 转写 → AI 校对 → 分词注音查词 → 打包学习包；网页界面、局域网同步
art/   猫に小判的像素美术：art/tools/ 里的 Python 脚本用代码画出所有素材
```

电脑端的命令行用法和学习包格式见 [pc/README.md](pc/README.md)。

## 数据来源和许可

- 日语词典：[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) © Electronic Dictionary Research and Development Group，CC BY-SA 4.0；JSON 版本来自 [jmdict-simplified](https://github.com/scriptin/jmdict-simplified)。中文释义由 AI 翻译 JMdict 的英文义项，词条本身（写法、读音、词性、义项划分）全部来自 JMdict
- 英汉词典（英语模式）：[ECDICT](https://github.com/skywind3000/ECDICT) © skywind3000，MIT
- 语法点：[Hanabira](https://hanabira.org) 开源日语语法库（`app/src/data/grammar.json`，去掉了罗马音），署名后可免费使用；课程编排、中文讲解和练习题由 AI 基于这些资料生成
- 复习算法：FSRS（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)，MIT）
- 语音识别：[faster-whisper](https://github.com/SYSTRAN/faster-whisper)；分词：SudachiPy

## 许可证

本项目按 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权：个人学习、研究、非营利用途可以自由使用、修改和分享，**禁止商业用途**。需要商用请联系作者。上面列出的第三方数据按各自的许可证使用。
