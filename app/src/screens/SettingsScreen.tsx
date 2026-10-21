// 设置：AI 接口（自动检测模型、连接测试）、学习偏好、外观（主题/主题色/字号）、电脑同步、离线词典、关于
import Constants from 'expo-constants';
import { Check, ChevronLeft, CircleCheck, CircleX, Download, Eye, EyeOff, Laptop, Moon, Palette, RefreshCw, Search, Sparkles, Sun, SunMoon, Trash2 } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RubyText } from '../components/Ruby';
import { Button, Card, ErrorNote, Segmented, SectionLabel } from '../components/Ui';
import { deleteDict, downloadDict, localDictInfo, remoteDictInfo, type DictInfo } from '../lib/dict';
import { ATTRIBUTION as GRAMMAR_ATTRIBUTION } from '../lib/grammar';
import { listModels, testModel, type ModelInfo } from '../lib/llm';
import { getPcUrl, pingPc, setPcUrl } from '../lib/packages';
import { DEFAULT_LLM, loadLlmSettings, saveLlmSettings, visionEndpoint, type Level, type LlmSettings } from '../lib/settings';
import { ACCENTS, radius, TEXT_SCALES, useColors, useTheme, type AccentId, type ThemeMode } from '../theme';

const LEVELS: Level[] = ['入门', 'N5', 'N4', 'N3', 'N2', 'N1'];

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}><ChevronLeft size={26} color={c.ink} /></Pressable>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: '800' }}>设置</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          <AiSection />
          <LearningSection />
          <AppearanceSection />
          <PcSection />
          <DictSection />
          <AboutSection />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, value, onChange, secure, placeholder, url, right }: {
  label: string; value: string; onChange: (v: string) => void; secure?: boolean; placeholder?: string; url?: boolean; right?: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: c.ink2, fontSize: 13 }}>{label}</Text>
      <View style={[styles.inputWrap, { borderColor: c.line, backgroundColor: c.bg }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={secure}
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={url ? 'url' : 'default'}
          style={[styles.input, { color: c.ink }]}
        />
        {right}
      </View>
    </View>
  );
}

// ---------- AI 接口 ----------

// 常见的、国内能直接访问、有识图模型的 OpenAI 兼容接口
const VISION_PRESETS = [
  { name: 'DeepInfra', url: 'https://api.deepinfra.com/v1/openai' },
  { name: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: '硅基流动', url: 'https://api.siliconflow.cn/v1' },
];

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; text?: string };

function AiSection() {
  const c = useColors();
  const [s, setS] = useState<LlmSettings>(DEFAULT_LLM);
  const [loaded, setLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [picker, setPicker] = useState<'model' | 'visionModel' | null>(null);
  const [tests, setTests] = useState<Record<'model' | 'visionModel', TestState>>({ model: { status: 'idle' }, visionModel: { status: 'idle' } });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 识图单独设置接口（比如文字用 DeepSeek 官方，它不能识图）
  const [separate, setSeparate] = useState(false);
  const [visionModels, setVisionModels] = useState<ModelInfo[] | null>(null);
  const [loadingVision, setLoadingVision] = useState(false);
  const [visionError, setVisionError] = useState('');

  useEffect(() => { loadLlmSettings().then((x) => { setS(x); setSeparate(!!x.visionBaseUrl); setLoaded(true); }); }, []);

  const detectVision = async (settings = s) => {
    setLoadingVision(true); setVisionError('');
    try {
      setVisionModels(await listModels(settings, true));
    } catch (e) {
      setVisionModels(null);
      setVisionError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingVision(false);
    }
  };
  const vision = visionEndpoint(s);

  // 改动后自动保存（防抖），不用找保存按钮
  const update = (patch: Partial<LlmSettings>) => {
    setS((cur) => {
      const next = { ...cur, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveLlmSettings(next), 500);
      return next;
    });
  };

  const detect = async (settings = s) => {
    setLoadingModels(true); setModelError('');
    try {
      setModels(await listModels(settings));
    } catch (e) {
      setModels(null);
      setModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  // 填好 Key 后自动检测一次可用模型
  const lastDetected = useRef('');
  useEffect(() => {
    if (!loaded) return;
    const sig = `${s.baseUrl}|${s.apiKey}`;
    if (!s.apiKey.trim() || sig === lastDetected.current) return;
    const t = setTimeout(() => { lastDetected.current = sig; void detect(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.apiKey, s.baseUrl, loaded]);

  const test = async (which: 'model' | 'visionModel') => {
    setTests((t) => ({ ...t, [which]: { status: 'testing' } }));
    await saveLlmSettings(s);
    try {
      const ms = await testModel(s, which === 'visionModel');
      setTests((t) => ({ ...t, [which]: { status: 'ok', text: `可用 · ${(ms / 1000).toFixed(1)} 秒` } }));
    } catch (e) {
      setTests((t) => ({ ...t, [which]: { status: 'fail', text: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const modelRow = (which: 'model' | 'visionModel', label: string, hint: string) => {
    const t = tests[which];
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.ink2, fontSize: 13 }}>{label}</Text>
        <Pressable onPress={() => setPicker(which)} style={[styles.select, { borderColor: c.line, backgroundColor: c.bg }]}>
          <Text numberOfLines={1} style={{ flex: 1, color: s[which] ? c.ink : c.muted, fontSize: 14.5 }}>{s[which] || '点击选择模型'}</Text>
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>选择</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: c.muted, fontSize: 12 }}>{hint}</Text>
          <Button label="测试" kind="secondary" small onPress={() => test(which)} loading={t.status === 'testing'} disabled={!(which === 'visionModel' ? vision.apiKey : s.apiKey) || !s[which]} />
        </View>
        {t.status === 'ok' ? <StatusLine ok text={t.text!} /> : t.status === 'fail' ? <StatusLine text={t.text!} /> : null}
      </View>
    );
  };

  return (
    <>
      <SectionLabel>AI 接口</SectionLabel>
      <Card style={{ gap: 14 }}>
        <Field label="接口地址（OpenAI 兼容）" value={s.baseUrl} onChange={(v) => update({ baseUrl: v })} url />
        <Field
          label="API Key"
          value={s.apiKey}
          onChange={(v) => update({ apiKey: v })}
          secure={!showKey}
          placeholder="保存在手机的加密存储里"
          right={<Pressable onPress={() => setShowKey((v) => !v)} hitSlop={8} style={{ padding: 8 }}>{showKey ? <EyeOff size={18} color={c.muted} /> : <Eye size={18} color={c.muted} />}</Pressable>}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: c.muted, fontSize: 12.5 }}>
            {loadingModels ? '正在检测可用模型…' : models ? `检测到 ${models.length} 个可用模型（${models.filter((m) => m.vision).length} 个能识图）` : '填好 Key 后会自动检测可用模型'}
          </Text>
          <Button label="重新检测" kind="ghost" small onPress={() => detect()} loading={loadingModels} disabled={!s.apiKey} icon={<RefreshCw size={14} color={c.ink2} />} />
        </View>
        {modelError ? <ErrorNote message={modelError} /> : null}
        {modelRow('model', '文字模型', '翻译、精读、语法、练习都用它')}
        <View style={[styles.divider, { backgroundColor: c.line }]} />
        <Row label="识图用单独的接口" hint="文字模型那家不能识图时打开（比如 DeepSeek 官方接口只支持文字）">
          <Segmented
            options={[{ value: 'same', label: '同上' }, { value: 'separate', label: '单独' }]}
            value={separate ? 'separate' : 'same'}
            onChange={(v) => {
              const on = v === 'separate';
              setSeparate(on);
              setVisionModels(null);
              if (!on) update({ visionBaseUrl: '', visionApiKey: '' });
            }}
          />
        </Row>
        {separate ? (
          <View style={{ gap: 12 }}>
            <Field label="识图接口地址" value={s.visionBaseUrl} onChange={(v) => update({ visionBaseUrl: v })} placeholder="https://…/v1" url />
            <View style={styles.presets}>
              {VISION_PRESETS.map((p) => (
                <Pressable key={p.url} onPress={() => update({ visionBaseUrl: p.url })} style={[styles.preset, { backgroundColor: s.visionBaseUrl === p.url ? c.accentSoft : c.surface2 }]}>
                  <Text style={{ color: s.visionBaseUrl === p.url ? c.accent : c.ink2, fontSize: 12.5 }}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="识图 API Key" value={s.visionApiKey} onChange={(v) => update({ visionApiKey: v })} secure={!showKey} placeholder="留空就用上面的 Key" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: c.muted, fontSize: 12.5 }}>
                {loadingVision ? '正在检测…' : visionModels ? `检测到 ${visionModels.length} 个模型（${visionModels.filter((m) => m.vision).length} 个能识图）` : '填好后点「检测模型」'}
              </Text>
              <Button label="检测模型" kind="ghost" small onPress={() => detectVision()} loading={loadingVision} disabled={!s.visionBaseUrl.trim() || !vision.apiKey} icon={<RefreshCw size={14} color={c.ink2} />} />
            </View>
            {visionError ? <ErrorNote message={visionError} /> : null}
          </View>
        ) : null}
        {modelRow('visionModel', '识图模型', separate ? '在上面的识图接口上选择模型' : '拍照、漫画、截图识别文字用')}
      </Card>
      {picker ? (
        <ModelPicker
          models={picker === 'visionModel' && separate ? visionModels : models}
          loading={picker === 'visionModel' && separate ? loadingVision : loadingModels}
          visionOnly={picker === 'visionModel'}
          current={s[picker]}
          onRefresh={() => (picker === 'visionModel' && separate ? detectVision() : detect())}
          onPick={(id) => { update({ [picker]: id } as Partial<LlmSettings>); setTests((t) => ({ ...t, [picker]: { status: 'idle' } })); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

function StatusLine({ ok, text }: { ok?: boolean; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      {ok ? <CircleCheck size={16} color={c.ok} /> : <CircleX size={16} color={c.err} />}
      <Text style={{ flex: 1, color: ok ? c.ok : c.err, fontSize: 12.5, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

function ModelPicker({ models, loading, visionOnly, current, onRefresh, onPick, onClose }: {
  models: ModelInfo[] | null; loading: boolean; visionOnly: boolean; current: string; onRefresh: () => void; onPick: (id: string) => void; onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [all, setAll] = useState(!visionOnly);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (models ?? []).filter((m) => (all || m.vision) && (!k || m.id.toLowerCase().includes(k)));
  }, [models, q, all]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, paddingTop: insets.top, zIndex: 10 }]}>
      <View style={styles.head}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.back}><ChevronLeft size={26} color={c.ink} /></Pressable>
        <Text style={{ color: c.ink, fontSize: 18, fontWeight: '800', flex: 1 }}>{visionOnly ? '选择识图模型' : '选择文字模型'}</Text>
        <Button label="刷新" kind="ghost" small onPress={onRefresh} loading={loading} />
      </View>
      <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
        <View style={[styles.inputWrap, { borderColor: c.line, backgroundColor: c.surface }]}>
          <Search size={16} color={c.muted} style={{ marginLeft: 10 }} />
          <TextInput value={q} onChangeText={setQ} placeholder="搜索，例如 deepseek、qwen" placeholderTextColor={c.muted} autoCapitalize="none" style={[styles.input, { color: c.ink }]} />
        </View>
        {visionOnly ? (
          <Segmented options={[{ value: 'vision', label: '能识图的' }, { value: 'all', label: '全部' }]} value={all ? 'all' : 'vision'} onChange={(v) => setAll(v === 'all')} />
        ) : null}
        <Text style={{ color: c.muted, fontSize: 12 }}>
          {visionOnly ? '「能识图」是按模型名判断的（VL、Vision 等）。选好后可以点「测试」确认。' : '推荐：deepseek-ai/DeepSeek-V4.1-Flash（快、便宜、中文好）'}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30, gap: 6 }}>
        {!models ? <Text style={{ color: c.muted, padding: 10 }}>{loading ? '正在检测…' : '还没有检测到模型，确认 API Key 后点「刷新」'}</Text> : null}
        {list.map((m) => {
          const on = m.id === current;
          return (
            <Pressable key={m.id} onPress={() => onPick(m.id)} style={[styles.modelRow, { backgroundColor: on ? c.accentSoft : c.surface, borderColor: on ? c.accent : c.line }]}>
              <Text style={{ flex: 1, color: c.ink, fontSize: 14 }}>{m.id}</Text>
              {m.vision ? <Text style={{ color: c.accent, fontSize: 11, fontWeight: '700' }}>识图</Text> : null}
              {on ? <Check size={18} color={c.accent} /> : null}
            </Pressable>
          );
        })}
        {q.trim() && !list.some((m) => m.id === q.trim()) ? (
          <Button label={`直接使用「${q.trim()}」`} kind="secondary" small onPress={() => onPick(q.trim())} />
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------- 学习 ----------

function LearningSection() {
  const c = useColors();
  const { prefs, setPrefs } = useTheme();
  const [level, setLevel] = useState<Level>('N4');
  useEffect(() => { loadLlmSettings().then((s) => setLevel(s.level)); }, []);
  const changeLevel = async (l: Level) => {
    setLevel(l);
    const s = await loadLlmSettings();
    await saveLlmSettings({ ...s, level: l });
  };
  return (
    <>
      <SectionLabel>学习</SectionLabel>
      <Card style={{ gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text style={{ color: c.ink2, fontSize: 13 }}>我的日语水平（语法课程、读物、练习的难度）</Text>
          <Segmented options={LEVELS.map((l) => ({ value: l, label: l }))} value={level} onChange={changeLevel} />
        </View>
        <Row label="默认显示注音" hint="精听和阅读里可以随时切换">
          <Segmented options={[{ value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }]} value={prefs.showRuby ? 'on' : 'off'} onChange={(v) => setPrefs({ showRuby: v === 'on' })} />
        </Row>
        <Row label="整句译文" hint="点开：先自己理解，点一下才显示">
          <Segmented options={[{ value: 'tap', label: '点开' }, { value: 'show', label: '显示' }, { value: 'hidden', label: '隐藏' }]} value={prefs.zhMode} onChange={(v) => setPrefs({ zhMode: v })} />
        </Row>
      </Card>
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.ink, fontSize: 14.5 }}>{label}</Text>
        {hint ? <Text style={{ color: c.muted, fontSize: 11.5 }}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

// ---------- 外观 ----------

function AppearanceSection() {
  const c = useColors();
  const { prefs, setPrefs } = useTheme();
  const modes: Array<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
    { value: 'system', label: '跟随系统', Icon: SunMoon },
    { value: 'light', label: '浅色', Icon: Sun },
    { value: 'dark', label: '深色', Icon: Moon },
  ];
  return (
    <>
      <SectionLabel>外观</SectionLabel>
      <Card style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {modes.map(({ value, label, Icon }) => {
            const on = prefs.themeMode === value;
            return (
              <Pressable key={value} onPress={() => setPrefs({ themeMode: value })} style={[styles.modeBtn, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentSoft : c.bg }]}>
                <Icon size={20} color={on ? c.accent : c.ink2} />
                <Text style={{ color: on ? c.accent : c.ink2, fontSize: 13, fontWeight: on ? '700' : '500' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Palette size={16} color={c.ink2} /><Text style={{ color: c.ink2, fontSize: 13 }}>主题色</Text></View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(Object.keys(ACCENTS) as AccentId[]).map((id) => {
              const a = ACCENTS[id];
              const on = prefs.accent === id;
              return (
                <Pressable key={id} onPress={() => setPrefs({ accent: id })} style={{ alignItems: 'center', gap: 4, flex: 1 }}>
                  <View style={[styles.swatch, { backgroundColor: c.dark ? a.dark : a.light, borderColor: on ? c.ink : 'transparent' }]}>
                    {on ? <Check size={18} color={c.dark ? '#16130F' : '#fff'} /> : null}
                  </View>
                  <Text style={{ color: on ? c.ink : c.muted, fontSize: 12 }}>{a.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: c.ink2, fontSize: 13 }}>日文字号</Text>
          <Segmented options={TEXT_SCALES.map((t) => ({ value: t.value, label: t.label }))} value={prefs.textScale} onChange={(v) => setPrefs({ textScale: v })} />
          <View style={[styles.preview, { backgroundColor: c.bg }]}>
            <RubyText segments={[{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '天気', reading: 'てんき' }, { text: 'がいいですね。' }]} size={18} />
          </View>
        </View>
      </Card>
    </>
  );
}

// ---------- 电脑同步 ----------

function PcSection() {
  const c = useColors();
  const [pc, setPc] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => { getPcUrl().then(setPc); }, []);
  const testPc = async () => {
    setTesting(true); setStatus(null);
    try {
      const url = await setPcUrl(pc);
      setPc(url);
      setStatus((await pingPc(url)) ? { ok: true, text: '已连接电脑' } : { ok: false, text: '这个地址不是电脑端的学习库' });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };
  return (
    <>
      <SectionLabel>电脑同步</SectionLabel>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Laptop size={20} color={c.accent} />
          <Text style={{ flex: 1, color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>在电脑上双击「启动.bat」，网页右上角会显示手机同步地址。手机和电脑要连同一个 Wi-Fi。</Text>
        </View>
        <Field label="电脑地址" value={pc} onChange={setPc} placeholder="例如 192.168.1.5:8765" url />
        <Button label="测试连接并保存" onPress={testPc} loading={testing} disabled={!pc.trim()} />
        {status ? <StatusLine ok={status.ok} text={status.text} /> : null}
      </Card>
    </>
  );
}

// ---------- 离线词典 ----------

function DictSection() {
  const c = useColors();
  const [local, setLocal] = useState<DictInfo | null | undefined>(undefined);
  const [remote, setRemote] = useState<(DictInfo & { exists: boolean }) | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    localDictInfo().then(setLocal);
    getPcUrl().then((u) => (u ? remoteDictInfo(u).then(setRemote).catch(() => setRemote(null)) : null));
    return () => abort.current?.abort();
  }, []);

  const download = async () => {
    const pc = await getPcUrl();
    if (!pc) { setError('先在上面填好电脑地址'); return; }
    setError(''); setProgress(0);
    abort.current = new AbortController();
    try {
      setLocal(await downloadDict(pc, setProgress, abort.current.signal));
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  const remove = () => Alert.alert('删除离线词典', '删除后查词会改用 AI 释义，可以随时重新下载。', [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: async () => { await deleteDict(); setLocal(null); } },
  ]);
  const mb = (n?: number) => (n ? `${Math.round(n / 1048576)} MB` : '');
  const newer = remote?.exists && local && remote.version !== local.version;

  return (
    <>
      <SectionLabel>离线词典</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>
          JMdict 日语词典（约 21 万词条），阅读、翻译时查词都用它，不再让 AI 编释义。从电脑下载，约 {mb(remote?.size) || '70 MB'}。
        </Text>
        {local === undefined ? <ActivityIndicator color={c.accent} /> : local ? (
          <StatusLine ok text={`已下载 · ${local.entries.toLocaleString()} 词条 · 中文释义 ${local.zh.toLocaleString()} 条${newer ? ' · 电脑上有更新' : ''}`} />
        ) : <Text style={{ color: c.muted, fontSize: 13 }}>还没有下载</Text>}
        {progress !== null ? (
          <View style={{ gap: 6 }}>
            <View style={[styles.bar, { backgroundColor: c.surface2 }]}><View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: c.accent }} /></View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: c.muted, fontSize: 12 }}>下载中 {Math.round(progress * 100)}%</Text>
              <Pressable onPress={() => abort.current?.abort()}><Text style={{ color: c.accent, fontSize: 12 }}>取消</Text></Pressable>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={local ? (newer ? '更新词典' : '重新下载') : '从电脑下载'} kind={local && !newer ? 'secondary' : 'primary'} onPress={download} icon={<Download size={17} color={local && !newer ? c.ink : c.accentInk} />} style={{ flex: 1 }} />
            {local ? <Button label="删除" kind="danger" onPress={remove} icon={<Trash2 size={16} color={c.err} />} /> : null}
          </View>
        )}
        {error ? <ErrorNote message={error} /> : null}
        <Text style={{ color: c.muted, fontSize: 11.5, lineHeight: 17 }}>没有中文释义的词条，查到时会让 AI 只翻译词典里的英文释义，结果存在手机上。电脑端可以「预翻译常用词」，一次性翻好约 2.2 万个常用词。</Text>
      </Card>
    </>
  );
}

// ---------- 关于 ----------

function AboutSection() {
  const c = useColors();
  const version = Constants.expoConfig?.version ?? '';
  return (
    <>
      <SectionLabel>关于</SectionLabel>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} color={c.accent} />
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>ことば精听 {version}</Text>
        </View>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
          词典：JMdict © Electronic Dictionary Research and Development Group，CC BY-SA 4.0（JSON 版本来自 jmdict-simplified）{'\n'}
          {GRAMMAR_ATTRIBUTION}{'\n'}
          复习算法：FSRS（ts-fsrs，MIT）{'\n'}
          AI 生成的讲解、翻译和例句可能有错，以词典和原始资料为准。
        </Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 56 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.sm },
  input: { flex: 1, height: 44, paddingHorizontal: 12, fontSize: 15 },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1 },
  modeBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderWidth: 1.5, borderRadius: radius.md },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  preview: { padding: 14, borderRadius: radius.md },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
});
