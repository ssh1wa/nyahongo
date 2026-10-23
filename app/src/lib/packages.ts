// 学习包：从 PC 局域网同步、本地存储、读取
import { Directory, File, Paths } from 'expo-file-system';
import { getDb, kvGet, kvSet } from './db';
import { award } from './game';
import type { DictEntry, PackageData, PackageMeta, Sentence } from './types';

const ROOT = new Directory(Paths.document, 'packages');

function ensureRoot() {
  if (!ROOT.exists) ROOT.create({ intermediates: true });
}

const pkgDir = (id: string) => new Directory(ROOT, id);

// ---------- PC 地址 ----------

export const getPcUrl = () => kvGet<string>('pcUrl', '');

/** 规范化并保存电脑地址：补上 http:// 和默认端口 8765。格式不对时抛出可读的错误。 */
export async function setPcUrl(url: string) {
  let u = url.trim().replace(/\s+/g, '').replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  const hostPort = u.replace(/^https?:\/\//i, '');
  if (u && !/^[\w.-]+(:\d{1,5})?$/.test(hostPort)) {
    throw new Error(`地址格式不对：「${url.trim()}」。应该像 192.168.1.5:8765 这样`);
  }
  if (u && !/:\d+$/.test(hostPort)) u = `${u}:8765`;
  await kvSet('pcUrl', u);
  return u;
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`PC 端返回错误 HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('连接电脑超时：确认手机和电脑在同一个 Wi-Fi，且 PC 端已经打开');
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
  }
}

export async function pingPc(base: string): Promise<boolean> {
  const r = await fetchJson<{ app?: string }>(`${base}/api/ping`, 4000);
  return r.app === 'nihongo-pc';
}

export const listRemote = (base: string) => fetchJson<PackageMeta[]>(`${base}/api/library`);

// ---------- 下载 ----------

export type DownloadHandle = { cancel: () => void; done: Promise<void> };

/** 下载一个学习包。先下到 <id>.part，全部完成后再改名，避免留下残缺的学习包。 */
export function downloadPackage(base: string, meta: PackageMeta, onProgress: (fraction: number) => void): DownloadHandle {
  const controller = new AbortController();
  const done = (async () => {
    ensureRoot();
    const files = await fetchJson<Array<{ name: string; size: number }>>(`${base}/api/library/${meta.id}/files`);
    const total = files.reduce((n, f) => n + f.size, 0) || 1;
    const part = new Directory(ROOT, `${meta.id}.part`);
    if (part.exists) part.delete();
    part.create();
    let finished = 0;
    try {
      for (const f of files) {
        await File.downloadFileAsync(`${base}/api/library/${meta.id}/files/${encodeURIComponent(f.name)}`, new File(part, f.name), {
          idempotent: true,
          signal: controller.signal,
          onProgress: ({ bytesWritten }) => onProgress(Math.min((finished + bytesWritten) / total, 0.999)),
        });
        finished += f.size;
      }
      const target = pkgDir(meta.id);
      if (target.exists) target.delete();
      part.rename(meta.id);
    } catch (e) {
      if (part.exists) part.delete();
      throw e;
    }
    const localMeta = JSON.parse(await new File(pkgDir(meta.id), 'meta.json').text()) as PackageMeta;
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO packages (id, meta, downloaded_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, downloaded_at = excluded.downloaded_at`,
      meta.id,
      JSON.stringify({ ...localMeta, size_mb: meta.size_mb, has_thumb: files.some((f) => f.name === 'thumb.jpg') }),
      Date.now(),
    );
    // 别的设备学过这个包（同步过来的进度），下载好就接着那里
    const synced = (await kvGet<Record<string, { last_sentence: number; at: number }>>('sync:progress', {}))[meta.id];
    if (synced) await db.runAsync('UPDATE packages SET last_sentence = ?, progress_at = ? WHERE id = ?', synced.last_sentence, synced.at, meta.id);
    award('download', meta.id);
    onProgress(1);
  })();
  return { cancel: () => controller.abort(), done };
}

// ---------- 本地 ----------

export type LocalPackage = PackageMeta & { downloaded_at: number; last_sentence: number; opened_at: number | null };

export async function listLocal(): Promise<LocalPackage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ meta: string; downloaded_at: number; last_sentence: number; opened_at: number | null }>(
    'SELECT meta, downloaded_at, last_sentence, opened_at FROM packages ORDER BY COALESCE(opened_at, downloaded_at) DESC',
  );
  return rows.map((r) => ({ ...(JSON.parse(r.meta) as PackageMeta), downloaded_at: r.downloaded_at, last_sentence: r.last_sentence, opened_at: r.opened_at }));
}

export async function deleteLocal(id: string) {
  const dir = pkgDir(id);
  if (dir.exists) dir.delete();
  const db = await getDb();
  await db.runAsync('DELETE FROM packages WHERE id = ?', id);
}

export async function loadPackage(id: string): Promise<PackageData> {
  const dir = pkgDir(id);
  const meta = JSON.parse(await new File(dir, 'meta.json').text()) as PackageMeta;
  const subtitles = JSON.parse(await new File(dir, 'subtitles.json').text()) as { sentences: Sentence[] };
  const dictFile = new File(dir, 'dictionary.json');
  const dictionary = dictFile.exists ? (JSON.parse(await dictFile.text()) as Record<string, DictEntry>) : {};
  const db = await getDb();
  await db.runAsync('UPDATE packages SET opened_at = ? WHERE id = ?', Date.now(), id);
  return { meta, sentences: subtitles.sentences, dictionary };
}

export const mediaUri = (meta: PackageMeta) => new File(pkgDir(meta.id), meta.media).uri;

export function thumbUri(id: string): string | null {
  const f = new File(pkgDir(id), 'thumb.jpg');
  return f.exists ? f.uri : null;
}

export async function saveProgress(id: string, sentence: number) {
  const db = await getDb();
  await db.runAsync('UPDATE packages SET last_sentence = ?, progress_at = ? WHERE id = ?', sentence, Date.now(), id);
}
