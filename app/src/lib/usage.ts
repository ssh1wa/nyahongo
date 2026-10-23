// API 用量：本机每次调用都记一笔（按天汇总），另外直接查服务商账户（DeepInfra 本月账单、DeepSeek 余额）
import { getDb } from './db';
import { loadLlmSettings, visionEndpoint } from './settings';

export type UsageKind = 'text' | 'vision' | 'search' | 'fetch';

// 本机的用量 + 同步过来的其他设备的用量（usage_remote）
const ALL_USAGE = `(SELECT day, kind, model, calls, input, output FROM usage
  UNION ALL SELECT day, kind, model, calls, input, output FROM usage_remote)`;

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 记一次调用。记账失败不能影响正常功能，所以吞掉错误。 */
export async function recordUsage(kind: UsageKind, model: string, input = 0, output = 0): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO usage (day, kind, model, calls, input, output) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(day, kind, model) DO UPDATE SET calls = calls + 1, input = input + excluded.input, output = output + excluded.output`,
      localDay(), kind, model, Math.max(0, Math.round(input)), Math.max(0, Math.round(output)),
    );
  } catch {}
}

export type UsageTotal = { kind: UsageKind; model: string; calls: number; input: number; output: number };
export type UsageRange = 'today' | 'week' | 'month';

export async function localUsage(range: UsageRange): Promise<UsageTotal[]> {
  const now = new Date();
  const from = range === 'today' ? localDay(now)
    : range === 'week' ? localDay(new Date(now.getTime() - 6 * 86400000))
      : `${localDay(now).slice(0, 7)}-01`;
  const db = await getDb();
  return db.getAllAsync<UsageTotal>(
    `SELECT kind, model, SUM(calls) AS calls, SUM(input) AS input, SUM(output) AS output
     FROM ${ALL_USAGE} WHERE day >= ? GROUP BY kind, model ORDER BY kind, calls DESC`,
    from,
  );
}

/** 每天的调用次数（最近 n 天，含今天），画小柱状图用。 */
export async function dailyCalls(days = 14): Promise<Array<{ day: string; calls: number }>> {
  const db = await getDb();
  const from = localDay(new Date(Date.now() - (days - 1) * 86400000));
  const rows = await db.getAllAsync<{ day: string; calls: number }>(
    `SELECT day, SUM(calls) AS calls FROM ${ALL_USAGE} WHERE day >= ? GROUP BY day`, from,
  );
  const map = new Map(rows.map((r) => [r.day, r.calls]));
  return Array.from({ length: days }, (_, i) => {
    const day = localDay(new Date(Date.now() - (days - 1 - i) * 86400000));
    return { day, calls: map.get(day) ?? 0 };
  });
}

// ---------- 服务商账户 ----------

export type ProviderModelCost = { model: string; input: number; output: number; usd: number };
export type DeepInfraMonth = { period: string; usd: number; models: ProviderModelCost[] };

/**
 * DeepInfra 本月账单（整个账户，PC 端用同一个 Key 的消耗也算在内）。
 * 接口返回的 rate / cost 单位是美分。
 */
export async function deepinfraMonth(key: string): Promise<DeepInfraMonth> {
  const now = new Date();
  const period = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  const res = await fetch(`https://api.deepinfra.com/payment/usage?from=${period}`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401 || res.status === 403) throw new Error('这个 Key 没有查询账单的权限');
  if (!res.ok) throw new Error(`查询 DeepInfra 用量失败（HTTP ${res.status}）`);
  const data = await res.json();
  const month = (Array.isArray(data?.months) ? data.months : []).find((m: any) => m?.period === period);
  const byModel = new Map<string, ProviderModelCost>();
  for (const it of Array.isArray(month?.items) ? month.items : []) {
    const name = String(it?.model?.model_name ?? '其他');
    const row = byModel.get(name) ?? { model: name, input: 0, output: 0, usd: 0 };
    const units = Number(it?.units) || 0;
    if (it?.pricing_type === 'input_tokens') row.input += units;
    if (it?.pricing_type === 'output_tokens') row.output += units;
    row.usd += (units * (Number(it?.rate) || 0)) / 100;
    byModel.set(name, row);
  }
  const models = [...byModel.values()].sort((a, b) => b.usd - a.usd);
  return { period, usd: models.reduce((s, m) => s + m.usd, 0), models };
}

export type DeepSeekBalance = { currency: string; total: number; granted: number; toppedUp: number };

export async function deepseekBalance(key: string): Promise<DeepSeekBalance[]> {
  const res = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  if (res.status === 401) throw new Error('DeepSeek Key 无效');
  if (!res.ok) throw new Error(`查询 DeepSeek 余额失败（HTTP ${res.status}）`);
  const data = await res.json();
  return (Array.isArray(data?.balance_infos) ? data.balance_infos : [])
    .map((b: any) => ({ currency: String(b?.currency ?? ''), total: Number(b?.total_balance) || 0, granted: Number(b?.granted_balance) || 0, toppedUp: Number(b?.topped_up_balance) || 0 }))
    .filter((b: DeepSeekBalance) => b.total > 0 || b.currency === 'CNY');
}

/** 设置里用到了哪些服务商、各自的 Key（同一家只查一次）。 */
export async function providerKeys(searchKey: string): Promise<{ deepinfra: string[]; deepseek: string[] }> {
  const s = await loadLlmSettings();
  const v = visionEndpoint(s);
  const pick = (host: string) => [...new Set(
    [[s.baseUrl, s.apiKey], [v.baseUrl, v.apiKey]].filter(([u, k]) => u.includes(host) && k.trim()).map(([, k]) => k.trim()),
  )];
  const deepseek = pick('api.deepseek.com');
  if (searchKey.trim() && !deepseek.includes(searchKey.trim())) deepseek.push(searchKey.trim());
  return { deepinfra: pick('deepinfra.com'), deepseek };
}
