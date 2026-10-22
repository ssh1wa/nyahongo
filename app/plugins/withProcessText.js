// 在安卓系统的文字选择菜单（复制、全选旁边）加一项「查词」，和词典 App 一样。
// 系统把选中的文字交给 ProcessTextActivity，它转成 <scheme>://lookup?text=… 打开 App，App 里弹出查词面板。
// App 内、App 外（浏览器、聊天软件）选中文字都能用。
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const kotlin = (pkg, scheme) => `package ${pkg}

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/** 系统文字选择菜单里的「查词」：把选中的文字转成 ${scheme}://lookup?text=… 交给 App */
class ProcessTextActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.trim()
    if (!text.isNullOrEmpty()) {
      val uri = Uri.parse("${scheme}://lookup?text=" + Uri.encode(text))
      startActivity(
        Intent(Intent.ACTION_VIEW, uri)
          .setPackage(packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      )
    }
    finish()
  }
}
`;

module.exports = function withProcessText(config, { label = '查词' } = {}) {
  const pkg = config.android.package;
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme;

  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    app.activity = (app.activity ?? []).filter((a) => a.$['android:name'] !== '.ProcessTextActivity');
    app.activity.push({
      $: {
        'android:name': '.ProcessTextActivity',
        'android:label': label,
        'android:exported': 'true',
        'android:excludeFromRecents': 'true',
        'android:noHistory': 'true',
        'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
      },
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.intent.action.PROCESS_TEXT' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'text/plain' } }],
      }],
    });
    return c;
  });

  return withDangerousMod(config, ['android', (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...pkg.split('.'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ProcessTextActivity.kt'), kotlin(pkg, scheme));
    return c;
  }]);
};
