// 检查更新：读 GitHub 上最新的 Release，和当前版本比较（和 PC 端 pc/src/nihongo_pc/updates.py 一样的逻辑）
import Constants from 'expo-constants';
import { kvGet, kvSet } from './db';

const REPO = 'ssh1wa/nyahongo';
export const RELEASES = `https://github.com/${REPO}/releases`;
const DAY = 24 * 3600 * 1000;

export type UpdateInfo = {
  current: string;
  latest: string;
  newer: boolean;
  url: string;
  notes: string;
  apk: string | null; // nyahongo.apk 的直接下载地址
};

export const currentVersion = () => Constants.expoConfig?.version ?? '0.0.0';

const parse = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);

/** latest 是否比 current 新（按 主.次.修订 逐位比较） */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const latest = String(data.tag_name ?? '').replace(/^v/, '');
    const apk = (data.assets ?? []).find((a: { name?: string }) => a.name === 'nyahongo.apk');
    return {
      current: currentVersion(),
      latest,
      newer: isNewer(latest, currentVersion()),
      url: data.html_url ?? RELEASES,
      notes: String(data.body ?? '').slice(0, 1500),
      apk: apk?.browser_download_url ?? null,
    };
  } catch (e) {
    throw new Error(`连不上 GitHub：${e instanceof Error && e.name === 'AbortError' ? '超时' : e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 打开 App 时自动检查：一天最多一次，出错不打扰；同一个新版本点过「以后再说」就不再弹 */
export async function autoCheckUpdate(): Promise<UpdateInfo | null> {
  if (Date.now() - (await kvGet<number>('update:checkedAt', 0)) < DAY) return null;
  let info: UpdateInfo;
  try { info = await checkUpdate(); } catch { return null; }
  await kvSet('update:checkedAt', Date.now());
  if (!info.newer || (await kvGet<string>('update:skipped', '')) === info.latest) return null;
  return info;
}

export const skipUpdate = (version: string) => kvSet('update:skipped', version);

/** 更新说明里的 Markdown 简单去掉，弹窗里显示纯文字 */
export const plainNotes = (md: string) =>
  md.replace(/^#+\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
