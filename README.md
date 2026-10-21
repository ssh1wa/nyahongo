# ことば精听

个人用的日语精听工具：电脑负责下载视频、AI 转写和解析，手机负责逐句学习和复习。

```
pc/    电脑端：下载 → Whisper 转写 → AI 校对 → 分词注音查词 → 打包学习包；网页界面 + 局域网同步
app/   安卓端（Expo / React Native）：同步学习包、逐句播放器、生词本复习、翻译、练习
```

## 电脑端

双击 `pc/启动.bat`，浏览器会打开学习库。粘贴 B 站 / YouTube 链接，或者把本地视频拖进窗口即可。详细说明见 [pc/README.md](pc/README.md)。

AI 校对和词条翻译需要在 `pc/config.toml` 的 `[llm]` 里配置 OpenAI 兼容接口（这个文件不会提交到 git）。不配置也能用，只是没有标点校对、整句翻译和中文释义。

## 手机端

1. 编译 APK：双击 `app/build-apk.bat`（复用 `D:\Myproject\APPs\KotobaBiyori\.toolchain` 里的 JDK、Android SDK 和 Gradle 缓存）
2. 把 `app/android/app/build/outputs/apk/release/app-release.apk` 装到手机上
3. 手机和电脑连同一个 Wi-Fi，在 App 的「设置」里填电脑网页右上角显示的「手机同步」地址
4. 回到「学习库」，下载学习包

修改 `app/app.json` 里的插件或权限后，要先运行 `npx expo prebuild --platform android` 重新生成 `app/android`。

## 学习包格式

```
media.mp4 / media.m4a   压缩后的媒体
meta.json               标题、来源、时长、句数、处理用的模型
subtitles.json          句子：时间戳、原文、整句中文、分词（原形、读音、词性、注音分段、JMdict 词条 id）
dictionary.json         这一集用到的 JMdict 词条（读音、词性、中英文义项）
thumb.jpg               封面
```

## 数据来源

- 词典：[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) © Electronic Dictionary Research and Development Group，CC BY-SA 4.0；JSON 版本来自 [jmdict-simplified](https://github.com/scriptin/jmdict-simplified)
- 中文释义：由 AI 翻译 JMdict 的英文义项，词条本身（写法、读音、词性、义项划分）全部来自 JMdict
- 复习算法：FSRS（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)）
