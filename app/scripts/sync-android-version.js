// 打包前把 app.json 的版本号同步到 android/app/build.gradle。
// android/ 是 expo prebuild 生成的、不在 git 里，不重新 prebuild 的话里面的版本号不会跟着 app.json 变
// （系统「应用信息」显示的、覆盖安装时比较的都是这里的版本号）。build-apk.bat 会先运行这个脚本。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version, android } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const gradle = fs.readFileSync(gradlePath, 'utf8');

const next = gradle
  .replace(/versionCode \d+/, `versionCode ${android.versionCode}`)
  .replace(/versionName "[^"]*"/, `versionName "${version}"`);
if (!/versionCode \d+/.test(gradle) || !/versionName "/.test(gradle)) {
  console.error('build.gradle 里找不到 versionCode / versionName');
  process.exit(1);
}
if (next !== gradle) fs.writeFileSync(gradlePath, next);
console.log(`Android 版本：${version}（versionCode ${android.versionCode}）`);
