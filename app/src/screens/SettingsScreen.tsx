// 设置：分栏 —— AI 接口（自动检测模型、连接测试、联网搜索）、用量、学习、外观、同步与词典、关于
import Constants from 'expo-constants';
import {
  BarChart3, BookOpen, Bot, Check, ChevronLeft, CircleCheck, CircleHelp, CircleX, Eye, EyeOff, Info, Laptop, Moon, Palette, RefreshCw,
  Search, Sparkles, Sun, SunMoon,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiGuide } from '../components/ApiGuide';
import { RubyText } from '../components/Ruby';
import { Button, Card, ErrorNote, Segmented, SectionLabel } from '../components/Ui';
import { ensureDict, localDictInfo, type DictInfo } from '../lib/dict';
import { ATTRIBUTION as GRAMMAR_ATTRIBUTION } from '../lib/grammar';
import { listModels, testModel, type ModelInfo } from '../lib/llm';
import { getPcUrl, pingPc, setPcUrl } from '../lib/packages';
import { kvGet, kvSet } from '../lib/db';
import { lastSyncStatus, onSynced, syncNow, type SyncStatus } from '../lib/sync';
import { checkUpdate, plainNotes, type UpdateInfo } from '../lib/updates';
import { deepseekSearch, loadOwnSearchKey, saveOwnSearchKey } from '../lib/search';
import {
  DEEPSEEK_URL, DEFAULT_LLM, isDeepSeek, loadLlmSettings, saveLlmSettings, visionEndpoint, visionModelOf,
  type ApiFormat, type Level, type LlmSettings,
} from '../lib/settings';
import {
  dailyCalls, deepinfraMonth, deepseekBalance, localUsage, providerKeys,
  type DeepInfraMonth, type DeepSeekBalance, type UsageKind, type UsageRange, type UsageTotal,
} from '../lib/usage';
import { ACCENTS, radius, TEXT_SCALES, useColors, useTheme, type AccentId, type ThemeMode } from '../theme';

const LEVELS: Level[] = ['入门', 'N5', 'N4', 'N3', 'N2', 'N1'];

type Tab = 'ai' | 'usage' | 'learn' | 'look' | 'sync' | 'about';

const TABS: Array<{ id: Tab; label: string; Icon: typeof Sun }> = [
  { id: 'ai', label: 'AI 接口', Icon: Bot },
  { id: 'usage', label: '用量', Icon: BarChart3 },
  { id: 'learn', label: '学习', Icon: BookOpen },
  { id: 'look', label: '外观', Icon: Palette },
  { id: 'sync', label: '同步与词典', Icon: Laptop },
  { id: 'about', label: '关于', Icon: Info },
];

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('ai');
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.line }]}>
              <Icon size={15} color={on ? c.accentInk : c.ink2} />
              <Text style={{ color: on ? c.accentInk : c.ink2, fontSize: 13.5, fontWeight: on ? '700' : '500' }}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
        <ScrollView key={tab} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          {tab === 'ai' ? <><AiSection /><SearchSection /></> : null}
          {tab === 'usage' ? <UsageSection /> : null}
          {tab === 'learn' ? <LearningSection /> : null}
          {tab === 'look' ? <AppearanceSection /> : null}
          {tab === 'sync' ? <><PcSection /><DeviceSyncSection /><DictSection /></> : null}
          {tab === 'about' ? <AboutSection /> : null}
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

// 常用服务商：点一下自动填接口地址、接口格式和推荐模型。DeepSeek 官方一个 Key 文字、看图、联网搜索都能用，放第一个推荐。
// 申请 Key 的教程在 components/ApiGuide.tsx（id 对应）
const PROVIDERS: Array<{ id: string; name: string; url: string; format: ApiFormat; model: string; vision: boolean; tag?: string }> = [
  { id: 'deepseek', name: 'DeepSeek', tag: '推荐', url: DEEPSEEK_URL, format: 'openai', model: 'deepseek-flash', vision: true },
  { id: 'bailian', name: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', format: 'openai', model: '', vision: true },
  { id: 'siliconflow', name: '硅基流动', url: 'https://api.siliconflow.cn/v1', format: 'openai', model: '', vision: true },
  { id: 'deepinfra', name: 'DeepInfra', url: 'https://api.deepinfra.com/v1/openai', format: 'openai', model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', vision: true },
  { id: 'anthropic', name: 'Claude', url: 'https://api.anthropic.com', format: 'anthropic', model: '', vision: true },
  { id: 'gemini', name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta', format: 'gemini', model: '', vision: true },
];

const FORMATS: Array<{ value: ApiFormat; label: string }> = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
];
const FORMAT_HINT: Record<ApiFormat, { placeholder: string; hint: string }> = {
  openai: { placeholder: 'https://api.deepseek.com', hint: '大多数服务商都是这种，地址一般以 /v1 结尾（DeepSeek 不用）' },
  anthropic: { placeholder: 'https://api.anthropic.com', hint: 'Claude 官方，或 DeepSeek 的 https://api.deepseek.com/anthropic' },
  gemini: { placeholder: 'https://generativelanguage.googleapis.com/v1beta', hint: 'Google Gemini 官方接口' },
};

const normUrl = (u: string) => u.trim().replace(/\/+$/, '');
const providerOf = (url: string, format: ApiFormat) => PROVIDERS.find((p) => normUrl(p.url) === normUrl(url) && p.format === format);

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; text?: string };
type EndpointPatch = { url?: string; format?: ApiFormat; model?: string };

/** 接口地址优先：格式 + 地址自己填；下面的常用服务商点一下自动填好 */
function EndpointEditor({ url, format, onChange, onGuide }: {
  url: string; format: ApiFormat; onChange: (p: EndpointPatch) => void; onGuide: () => void;
}) {
  const c = useColors();
  const current = providerOf(url, format);
  const chip = (on: boolean) => [styles.preset, { backgroundColor: on ? c.accentSoft : c.surface2, borderColor: on ? c.accent : 'transparent' }];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.ink2, fontSize: 13 }}>接口格式</Text>
        <Segmented options={FORMATS} value={format} onChange={(v) => onChange({ format: v })} />
      </View>
      <Field label="接口地址" value={url} onChange={(v) => onChange({ url: v })} placeholder={FORMAT_HINT[format].placeholder} url />
      <Text style={{ color: c.muted, fontSize: 12, marginTop: -4 }}>{FORMAT_HINT[format].hint}</Text>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: c.ink2, fontSize: 13 }}>常用服务商（点一下自动填好）</Text>
          <Pressable onPress={onGuide} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <CircleHelp size={16} color={c.accent} />
            <Text style={{ color: c.accent, fontSize: 12.5 }}>怎么申请 Key</Text>
          </Pressable>
        </View>
        <View style={styles.presets}>
          {PROVIDERS.map((p) => {
            const on = current?.id === p.id;
            return (
              <Pressable key={p.id} onPress={() => onChange({ url: p.url, format: p.format, ...(p.model ? { model: p.model } : {}) })} style={chip(on)}>
                <Text style={{ color: on ? c.accent : c.ink2, fontSize: 13, fontWeight: on ? '700' : '500' }}>
                  {p.name}{p.tag ? `（${p.tag}）` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function KeyField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const c = useColors();
  const [show, setShow] = useState(false);
  return (
    <Field
      label={label}
      value={value}
      onChange={onChange}
      secure={!show}
      placeholder={placeholder}
      right={<Pressable onPress={() => setShow((v) => !v)} hitSlop={8} style={{ padding: 8 }}>{show ? <EyeOff size={18} color={c.muted} /> : <Eye size={18} color={c.muted} />}</Pressable>}
    />
  );
}

function AiSection() {
  const c = useColors();
  const [s, setS] = useState<LlmSettings>(DEFAULT_LLM);
  const [loaded, setLoaded] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [picker, setPicker] = useState<'model' | 'visionModel' | null>(null);
  const [guide, setGuide] = useState(false);
  const [tests, setTests] = useState<Record<'model' | 'visionModel', TestState>>({ model: { status: 'idle' }, visionModel: { status: 'idle' } });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 拍照识字另选一家（文字模型不能看图时）
  const [separate, setSeparate] = useState(false);
  const [visionModels, setVisionModels] = useState<ModelInfo[] | null>(null);
  const [loadingVision, setLoadingVision] = useState(false);
  const [visionError, setVisionError] = useState('');

  useEffect(() => { loadLlmSettings().then((x) => { setS(x); setSeparate(!!x.visionBaseUrl); setLoaded(true); }); }, []);

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

  // 填好 Key 后自动检测一次可用模型
  const lastDetected = useRef('');
  useEffect(() => {
    if (!loaded) return;
    const sig = `${s.apiFormat}|${s.baseUrl}|${s.apiKey}`;
    if (!s.apiKey.trim() || !s.baseUrl.trim() || sig === lastDetected.current) return;
    const t = setTimeout(() => { lastDetected.current = sig; void detect(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.apiKey, s.baseUrl, s.apiFormat, loaded]);
  const lastVision = useRef('');
  useEffect(() => {
    if (!loaded || !separate) return;
    const sig = `${s.visionApiFormat}|${s.visionBaseUrl}|${vision.apiKey}`;
    if (!vision.apiKey.trim() || !s.visionBaseUrl.trim() || sig === lastVision.current) return;
    const t = setTimeout(() => { lastVision.current = sig; void detectVision(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.visionBaseUrl, s.visionApiFormat, vision.apiKey, separate, loaded]);

  const test = async (which: 'model' | 'visionModel') => {
    setTests((t) => ({ ...t, [which]: { status: 'testing' } }));
    await saveLlmSettings(s);
    try {
      const ms = await testModel(s, which === 'visionModel');
      setTests((t) => ({ ...t, [which]: { status: 'ok', text: `能用 · 回复用了 ${(ms / 1000).toFixed(1)} 秒` } }));
    } catch (e) {
      setTests((t) => ({ ...t, [which]: { status: 'fail', text: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const modelRow = (which: 'model' | 'visionModel', label: string, hint: string, emptyText = '点击选择模型') => {
    const t = tests[which];
    const list = which === 'visionModel' && separate ? visionModels : models;
    // 换了服务商以后，原来选的模型这家可能没有
    const missing = !!s[which] && !!list && list.length > 0 && !list.some((m) => m.id === s[which]);
    const canTest = which === 'visionModel' ? !!vision.apiKey && !!visionModelOf(s) : !!s.apiKey && !!s.model;
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.ink2, fontSize: 13 }}>{label}</Text>
        <Pressable onPress={() => setPicker(which)} style={[styles.select, { borderColor: missing ? c.warn : c.line, backgroundColor: c.bg }]}>
          <Text numberOfLines={1} style={{ flex: 1, color: s[which] ? c.ink : c.muted, fontSize: 14.5 }}>{s[which] || emptyText}</Text>
          {which === 'visionModel' && s.visionModel ? (
            <Pressable onPress={() => update({ visionModel: '' })} hitSlop={8}><Text style={{ color: c.muted, fontSize: 12.5 }}>清除</Text></Pressable>
          ) : null}
          <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>选择</Text>
        </Pressable>
        {missing ? <Text style={{ color: c.warn, fontSize: 12 }}>这家服务的模型列表里没有它，请重新选择</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: c.muted, fontSize: 12 }}>{hint}</Text>
          <Button label="测试" kind="secondary" small onPress={() => test(which)} loading={t.status === 'testing'} disabled={!canTest} />
        </View>
        {t.status === 'ok' ? <StatusLine ok text={t.text!} /> : t.status === 'fail' ? <StatusLine text={t.text!} /> : null}
      </View>
    );
  };

  const changeMain = (p: EndpointPatch) => {
    update({ ...(p.url !== undefined ? { baseUrl: p.url } : {}), ...(p.format ? { apiFormat: p.format } : {}), ...(p.model ? { model: p.model } : {}) });
    setModels(null);
    setTests({ model: { status: 'idle' }, visionModel: { status: 'idle' } });
  };
  const changeVision = (p: EndpointPatch) => {
    update({ ...(p.url !== undefined ? { visionBaseUrl: p.url } : {}), ...(p.format ? { visionApiFormat: p.format } : {}) });
    setVisionModels(null);
  };

  const deepseekMain = isDeepSeek(s.baseUrl);
  return (
    <>
      <SectionLabel>AI 服务</SectionLabel>
      <Card style={{ gap: 14 }}>
        <Text style={{ color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>
          翻译、讲解、出题、拍照识字都要用 AI。填上 AI 服务的接口地址和在它官网申请的 API Key 就能用，按用量付费。
        </Text>
        {!deepseekMain ? (
          <View style={[styles.recommend, { backgroundColor: c.accentSoft }]}>
            <Text style={{ color: c.ink, fontSize: 13, lineHeight: 19, flex: 1 }}>
              推荐用 DeepSeek 官方：一个 Key 就能翻译讲解、拍照识字、联网搜索，中文好、便宜、国内直接能连。
            </Text>
            <Button label="用 DeepSeek" small onPress={() => changeMain({ url: DEEPSEEK_URL, format: 'openai', model: 'deepseek-flash' })} />
          </View>
        ) : null}
        <EndpointEditor url={s.baseUrl} format={s.apiFormat} onChange={changeMain} onGuide={() => setGuide(true)} />
        <KeyField label="API Key" value={s.apiKey} onChange={(v) => update({ apiKey: v })} placeholder="只保存在这台设备的加密存储里" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: c.muted, fontSize: 12.5 }}>
            {loadingModels ? '正在读取这家的模型列表…' : models ? `这家有 ${models.length} 个模型可选` : '填好 Key 后会自动读取模型列表'}
          </Text>
          <Button label="重新读取" kind="ghost" small onPress={() => detect()} loading={loadingModels} disabled={!s.apiKey} icon={<RefreshCw size={14} color={c.ink2} />} />
        </View>
        {modelError ? <ErrorNote message={modelError} /> : null}
        {modelRow('model', '模型', deepseekMain ? 'DeepSeek 选 deepseek-flash 就行' : '翻译、讲解、语法课、出题都用它')}
      </Card>

      <SectionLabel>拍照识字</SectionLabel>
      <Card style={{ gap: 14 }}>
        <Text style={{ color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>
          拍书页、漫画或截图来识别日文，需要能看图的模型。
        </Text>
        <Segmented
          options={[{ value: 'same', label: '用上面那家' }, { value: 'separate', label: '另选一家' }]}
          value={separate ? 'separate' : 'same'}
          onChange={(v) => {
            const on = v === 'separate';
            setSeparate(on);
            setVisionModels(null);
            if (!on) update({ visionBaseUrl: '', visionApiKey: '', visionApiFormat: 'openai' });
            else if (!s.visionBaseUrl) update({ visionBaseUrl: DEEPSEEK_URL, visionApiFormat: 'openai' });
          }}
        />
        {!separate && deepseekMain && !s.visionModel ? (
          <StatusLine ok text="DeepSeek 的 deepseek-flash 能直接看图，不用另外设置" />
        ) : null}
        {separate ? (
          <View style={{ gap: 12 }}>
            <EndpointEditor url={s.visionBaseUrl} format={s.visionApiFormat} onChange={changeVision} onGuide={() => setGuide(true)} />
            <KeyField label="这家的 API Key" value={s.visionApiKey} onChange={(v) => update({ visionApiKey: v })} placeholder="和上面同一家可以不填" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: c.muted, fontSize: 12.5 }}>
                {loadingVision ? '正在读取模型列表…' : visionModels ? `有 ${visionModels.filter((m) => m.vision).length} 个能看图的模型` : '填好 Key 后会自动读取模型列表'}
              </Text>
              <Button label="重新读取" kind="ghost" small onPress={() => detectVision()} loading={loadingVision} disabled={!s.visionBaseUrl.trim() || !vision.apiKey} icon={<RefreshCw size={14} color={c.ink2} />} />
            </View>
            {visionError ? <ErrorNote message={visionError} /> : null}
          </View>
        ) : null}
        {modelRow(
          'visionModel',
          '看图模型',
          separate ? '模型名里带 VL、Vision 的一般都能看图' : '不选就用上面的文字模型；它不能看图时再单独选',
          separate ? '点击选择模型' : `和文字模型相同（${s.model || '未选'}）`,
        )}
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
      {guide ? <ApiGuide onClose={() => setGuide(false)} /> : null}
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

/** 全屏选择模型。用 Modal：放在设置页的滚动区域里会被裁掉，列表显示不全 */
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

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.back}><ChevronLeft size={26} color={c.ink} /></Pressable>
          <Text style={{ color: c.ink, fontSize: 18, fontWeight: '800', flex: 1 }}>{visionOnly ? '选择看图模型' : '选择模型'}</Text>
          <Button label="刷新" kind="ghost" small onPress={onRefresh} loading={loading} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
          <View style={[styles.inputWrap, { borderColor: c.line, backgroundColor: c.surface }]}>
            <Search size={16} color={c.muted} style={{ marginLeft: 10 }} />
            <TextInput value={q} onChangeText={setQ} placeholder="搜索，例如 deepseek、qwen" placeholderTextColor={c.muted} autoCapitalize="none" style={[styles.input, { color: c.ink }]} />
          </View>
          {visionOnly ? (
            <Segmented options={[{ value: 'vision', label: '能看图的' }, { value: 'all', label: '全部' }]} value={all ? 'all' : 'vision'} onChange={(v) => setAll(v === 'all')} />
          ) : null}
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>
            {visionOnly
              ? '是否能看图是按模型名猜的，选好后回去点「测试」确认一下。'
              : '不知道选哪个：优先选名字里带 DeepSeek 或 Qwen 的较新版本，中文好、价格便宜。'}
          </Text>
        </View>
        <FlatList
          data={list}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30, gap: 6 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ color: c.muted, padding: 10 }}>{loading ? '正在读取…' : models ? '没有匹配的模型' : '还没有读取到模型列表，确认 API Key 后点「刷新」'}</Text>}
          renderItem={({ item: m }) => {
            const on = m.id === current;
            return (
              <Pressable onPress={() => onPick(m.id)} style={[styles.modelRow, { backgroundColor: on ? c.accentSoft : c.surface, borderColor: on ? c.accent : c.line }]}>
                <Text style={{ flex: 1, color: c.ink, fontSize: 14 }}>{m.id}</Text>
                {m.vision ? <Text style={{ color: c.accent, fontSize: 11, fontWeight: '700' }}>看图</Text> : null}
                {on ? <Check size={18} color={c.accent} /> : null}
              </Pressable>
            );
          }}
          ListFooterComponent={q.trim() && !list.some((m) => m.id === q.trim()) ? (
            <Button label={`直接使用「${q.trim()}」`} kind="secondary" small onPress={() => onPick(q.trim())} style={{ marginTop: 6 }} />
          ) : null}
        />
      </View>
    </Modal>
  );
}

// ---------- 联网搜索 ----------

function SearchSection() {
  const c = useColors();
  const [own, setOwn] = useState('');
  const [reuse, setReuse] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadOwnSearchKey().then(setOwn);
    loadLlmSettings().then((s) => setReuse(s.baseUrl.includes('api.deepseek.com') && !!s.apiKey));
  }, []);
  const change = (v: string) => {
    setOwn(v);
    setTest({ status: 'idle' });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveOwnSearchKey(v), 500);
  };
  const run = async () => {
    setTest({ status: 'testing' });
    await saveOwnSearchKey(own);
    const started = Date.now();
    try {
      const hits = await deepseekSearch('日本語 勉強', { count: 3 });
      setTest({ status: 'ok', text: `能用 · 搜到 ${hits.length} 条 · ${((Date.now() - started) / 1000).toFixed(1)} 秒` });
    } catch (e) {
      setTest({ status: 'fail', text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <SectionLabel>联网搜索（可选）</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>
          打开后，「阅读」里 AI 写文章前会先上网查资料，导入网址时也能更准地读出网页正文。
          不打开也能用，AI 写文章时只查日语维基百科。
        </Text>
        <Text style={{ color: c.muted, lineHeight: 18, fontSize: 12.5 }}>
          搜索用的是 DeepSeek 的服务，需要 DeepSeek 的 API Key（在 platform.deepseek.com 申请）。费用很低，大约每千次搜索 5 元人民币，搜不到不收费。
        </Text>
        {reuse ? (
          <StatusLine ok text="上面的 AI 服务已经是 DeepSeek，会直接用那个 Key，这里不用再填" />
        ) : (
          <KeyField label="DeepSeek API Key" value={own} onChange={change} placeholder="不填就只查日语维基百科" />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: c.muted, fontSize: 12 }}>
            {own.trim() || reuse ? '现在：AI 写文章时会查全网' : '现在：AI 写文章时只查日语维基百科'}
          </Text>
          <Button label="测试" kind="secondary" small onPress={run} loading={test.status === 'testing'} disabled={!own.trim() && !reuse} />
        </View>
        {test.status === 'ok' ? <StatusLine ok text={test.text!} /> : test.status === 'fail' ? <StatusLine text={test.text!} /> : null}
      </Card>
    </>
  );
}

// ---------- 用量 ----------

const fmtTokens = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(2)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)} 万` : String(n));
const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? '< $0.01' : `$${n.toFixed(2)}`);
const shortModel = (m: string) => m.split('/').pop() ?? m;
const KIND_LABEL: Record<UsageKind, string> = { text: '文字模型', vision: '识图模型', search: '联网搜索', fetch: '网页读取' };

type ProviderState = {
  loading: boolean;
  deepinfra: Array<DeepInfraMonth | { error: string }>;
  deepseek: Array<DeepSeekBalance[] | { error: string }>;
  none: boolean;
};

function UsageSection() {
  const c = useColors();
  const [provider, setProvider] = useState<ProviderState>({ loading: true, deepinfra: [], deepseek: [], none: false });
  const [range, setRange] = useState<UsageRange>('today');
  const [local, setLocal] = useState<UsageTotal[] | null>(null);
  const [daily, setDaily] = useState<Array<{ day: string; calls: number }>>([]);

  const loadProvider = async () => {
    setProvider((p) => ({ ...p, loading: true }));
    const keys = await providerKeys(await loadOwnSearchKey());
    const settle = <T,>(p: Promise<T>) => p.catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const [deepinfra, deepseek] = await Promise.all([
      Promise.all(keys.deepinfra.map((k) => settle(deepinfraMonth(k)))),
      Promise.all(keys.deepseek.map((k) => settle(deepseekBalance(k)))),
    ]);
    setProvider({ loading: false, deepinfra, deepseek, none: !keys.deepinfra.length && !keys.deepseek.length });
  };
  useEffect(() => { void loadProvider(); void dailyCalls(14).then(setDaily); }, []);
  useEffect(() => { setLocal(null); void localUsage(range).then(setLocal); }, [range]);

  const byKind = (kind: UsageKind) => (local ?? []).filter((r) => r.kind === kind);
  const sum = (rows: UsageTotal[], k: 'calls' | 'input' | 'output') => rows.reduce((s, r) => s + r[k], 0);
  const maxDaily = Math.max(1, ...daily.map((d) => d.calls));

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}><SectionLabel>服务商账单</SectionLabel></View>
        <Button label="刷新" kind="ghost" small onPress={loadProvider} loading={provider.loading} icon={<RefreshCw size={14} color={c.ink2} />} />
      </View>
      <Card style={{ gap: 14 }}>
        {provider.none ? (
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>这里能直接查 DeepInfra 的本月账单和 DeepSeek 的余额。用其他服务的话，看下面的调用统计。</Text>
        ) : null}
        {provider.loading && !provider.deepinfra.length && !provider.deepseek.length ? <ActivityIndicator color={c.accent} /> : null}
        {provider.deepinfra.map((m, i) => ('error' in m ? <StatusLine key={`di${i}`} text={`DeepInfra：${m.error}`} /> : (
          <View key={`di${i}`} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ flex: 1, color: c.ink2, fontSize: 13 }}>DeepInfra · {m.period.replace('.', ' 年 ')} 月</Text>
              <Text style={{ color: c.ink, fontSize: 22, fontWeight: '800' }}>{fmtUsd(m.usd)}</Text>
            </View>
            {m.models.map((x) => (
              <View key={x.model} style={styles.usageRow}>
                <Text numberOfLines={1} style={{ flex: 1, color: c.ink, fontSize: 13 }}>{shortModel(x.model)}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>输入 {fmtTokens(x.input)} · 输出 {fmtTokens(x.output)}</Text>
                <Text style={{ width: 62, textAlign: 'right', color: c.ink2, fontSize: 13, fontWeight: '700' }}>{fmtUsd(x.usd)}</Text>
              </View>
            ))}
          </View>
        )))}
        {provider.deepinfra.length && provider.deepseek.length ? <View style={[styles.divider, { backgroundColor: c.line }]} /> : null}
        {provider.deepseek.map((b, i) => ('error' in b ? <StatusLine key={`ds${i}`} text={`DeepSeek：${b.error}`} /> : (
          <View key={`ds${i}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={{ flex: 1, color: c.ink2, fontSize: 13 }}>DeepSeek 余额</Text>
            <Text style={{ color: c.ink, fontSize: 22, fontWeight: '800' }}>
              {b.map((x) => `${x.currency === 'CNY' ? '¥' : '$'}${x.total.toFixed(2)}`).join(' / ') || '¥0.00'}
            </Text>
          </View>
        )))}
        {!provider.none ? (
          <Text style={{ color: c.muted, fontSize: 11.5, lineHeight: 17 }}>这是整个账户的数据，PC 端用同一个 Key 的消耗也算在内。DeepInfra 按月结算，数字可能比实际晚几分钟。</Text>
        ) : null}
      </Card>

      <SectionLabel>本机调用</SectionLabel>
      <Card style={{ gap: 14 }}>
        <Segmented options={[{ value: 'today', label: '今天' }, { value: 'week', label: '近 7 天' }, { value: 'month', label: '本月' }]} value={range} onChange={setRange} />
        {!local ? <ActivityIndicator color={c.accent} /> : !local.length ? (
          <Text style={{ color: c.muted, fontSize: 13 }}>这段时间还没有调用过 AI</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {(Object.keys(KIND_LABEL) as UsageKind[]).map((kind) => {
              const rows = byKind(kind);
              if (!rows.length) return null;
              const tokens = kind === 'text' || kind === 'vision';
              return (
                <View key={kind} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Text style={{ flex: 1, color: c.ink, fontSize: 14, fontWeight: '700' }}>{KIND_LABEL[kind]}</Text>
                    <Text style={{ color: c.ink2, fontSize: 13 }}>
                      {sum(rows, 'calls')} 次{tokens ? ` · ${fmtTokens(sum(rows, 'input') + sum(rows, 'output'))} tokens` : ''}
                    </Text>
                  </View>
                  {tokens ? rows.map((r) => (
                    <Text key={r.model} numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>
                      {shortModel(r.model)}：{r.calls} 次 · 输入 {fmtTokens(r.input)} · 输出 {fmtTokens(r.output)}
                    </Text>
                  )) : null}
                </View>
              );
            })}
            {byKind('search').length || byKind('fetch').length ? (
              <Text style={{ color: c.muted, fontSize: 11.5 }}>
                联网搜索和网页读取约 $0.00075 一次，本{range === 'today' ? '日' : range === 'week' ? '周' : '月'}约 {fmtUsd((sum(byKind('search'), 'calls') + sum(byKind('fetch'), 'calls')) * 0.00075)}
              </Text>
            ) : null}
          </View>
        )}
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.ink2, fontSize: 12.5 }}>最近 14 天的调用次数</Text>
          <View style={styles.chart}>
            {daily.map((d) => (
              <View key={d.day} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <View style={{ width: '70%', height: `${Math.max(d.calls ? 6 : 2, (d.calls / maxDaily) * 100)}%`, borderRadius: 3, backgroundColor: d.calls ? c.accent : c.surface2 }} />
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.muted, fontSize: 11 }}>{daily[0]?.day.slice(5)}</Text>
            <Text style={{ color: c.muted, fontSize: 11 }}>今天 {daily[daily.length - 1]?.calls ?? 0} 次</Text>
          </View>
        </View>
        <Text style={{ color: c.muted, fontSize: 11.5, lineHeight: 17 }}>调用统计是这个 App 发出的请求（同步过的其他设备也算在内），不含 PC 端。</Text>
      </Card>
    </>
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
      <SectionLabel>学习伙伴</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Row label="猫に小判" hint="学习攒小判、开宝箱收集猫咪和装饰，右上角有一只猫陪你学">
          <Segmented options={[{ value: 'on', label: '开' }, { value: 'off', label: '纯净' }]} value={prefs.companion ? 'on' : 'off'} onChange={(v) => setPrefs({ companion: v === 'on' })} />
        </Row>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>选「纯净」后界面上不再出现猫和小判，学习时长和小判照常记录，以后重新打开时都还在。</Text>
      </Card>
      <SectionLabel>测试版</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Row label="测试版功能" hint="英语模式：PC 端勾选「英语（测试版）」处理的视频会显示出来，中英双语字幕，点单词查英汉词典">
          <Segmented options={[{ value: 'off', label: '关' }, { value: 'on', label: '开' }]} value={prefs.beta ? 'on' : 'off'} onChange={(v) => setPrefs({ beta: v === 'on' })} />
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

// ---------- 连接 PC 端 ----------

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
      setStatus((await pingPc(url)) ? { ok: true, text: '已连接 PC 端' } : { ok: false, text: '这个地址不是 PC 端的学习库' });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };
  return (
    <>
      <SectionLabel>连接 PC 端</SectionLabel>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Laptop size={20} color={c.accent} />
          <Text style={{ flex: 1, color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>PC 端窗口左下角会显示「手机连接地址」，填到下面。手机和电脑要连同一个 Wi-Fi。还没装 PC 端，看「精听」页右上角问号里的教程。</Text>
        </View>
        <Field label="PC 端地址" value={pc} onChange={setPc} placeholder="例如 192.168.1.5:8765" url />
        <Button label="测试连接并保存" onPress={testPc} loading={testing} disabled={!pc.trim()} />
        {status ? <StatusLine ok={status.ok} text={status.text} /> : null}
      </Card>
    </>
  );
}

// ---------- 多设备同步 ----------

function DeviceSyncSection() {
  const c = useColors();
  const [auto, setAuto] = useState(true);
  const [last, setLast] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void kvGet<boolean>('sync:auto', true).then(setAuto);
    void lastSyncStatus().then(setLast);
    return onSynced(setLast);
  }, []);
  const run = async () => {
    setBusy(true);
    try { setLast(await syncNow()); } finally { setBusy(false); }
  };
  return (
    <>
      <SectionLabel>多设备同步</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>
          手机、平板都连同一台电脑，生词本和复习进度、阅读和翻译记录、语法进度、精听学到哪一句、猫屋的小判和藏品会通过电脑合并同步。
          API Key 和界面设置不同步，学习包每台设备自己下载。
        </Text>
        <Row label="自动同步" hint="打开 App、切回来、退到后台时，连得上电脑就同步一次">
          <Segmented options={[{ value: 'on', label: '开' }, { value: 'off', label: '关' }]} value={auto ? 'on' : 'off'} onChange={(v) => { setAuto(v === 'on'); void kvSet('sync:auto', v === 'on'); }} />
        </Row>
        <Button label="立即同步" onPress={run} loading={busy} icon={<RefreshCw size={16} color={c.accentInk} />} />
        {last ? <StatusLine ok={last.ok} text={`${new Date(last.at).toLocaleString()} · ${last.message}`} /> : (
          <Text style={{ color: c.muted, fontSize: 12.5 }}>还没有同步过</Text>
        )}
      </Card>
    </>
  );
}

// ---------- 离线词典 ----------

function DictSection() {
  const c = useColors();
  const [local, setLocal] = useState<DictInfo | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    // 第一次打开 App 时会在后台把预装的词典解压到手机里，这里等它完成
    ensureDict().then(() => localDictInfo()).then(setLocal).catch((err) => { setLocal(null); setError(err instanceof Error ? err.message : String(err)); });
  }, []);

  return (
    <>
      <SectionLabel>离线词典</SectionLabel>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: c.ink2, lineHeight: 20, fontSize: 13.5 }}>
          JMdict 日语词典，约 21 万个词条，已经装在 App 里，不用联网。查词优先用它，释义准确，也不花 AI 费用。在「翻译」页输入单词就能直接查。
        </Text>
        {local === undefined ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <ActivityIndicator color={c.accent} />
            <Text style={{ color: c.muted, fontSize: 13 }}>正在准备词典（只有第一次）…</Text>
          </View>
        ) : local ? (
          <StatusLine ok text={`可以使用 · ${local.entries.toLocaleString()} 词条 · 中文释义 ${local.zh.toLocaleString()} 条`} />
        ) : null}
        {error ? <ErrorNote message={`词典准备失败：${error}`} /> : null}
        <Text style={{ color: c.muted, fontSize: 11.5, lineHeight: 17 }}>常用的约 2.2 万个词条已经预先翻译成中文。其余词条原本是英文释义，查到时会让 AI 翻成中文并保存下来，下次就不用再翻。</Text>
      </Card>
    </>
  );
}

// ---------- 关于 ----------

function UpdateCard() {
  const c = useColors();
  const [state, setState] = useState<{ loading: boolean; info?: UpdateInfo; error?: string }>({ loading: false });
  const check = async () => {
    setState({ loading: true });
    try { setState({ loading: false, info: await checkUpdate() }); } catch (e) { setState({ loading: false, error: e instanceof Error ? e.message : String(e) }); }
  };
  const { info } = state;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700', flex: 1 }}>检查更新</Text>
        <Button label={state.loading ? '检查中…' : '检查'} kind="secondary" small onPress={check} disabled={state.loading} />
      </View>
      {state.error ? <ErrorNote message={`${state.error}。也可以在电脑浏览器打开 github.com/ssh1wa/nyahongo/releases 看看`} /> : null}
      {info && !info.newer ? <Text style={{ color: c.ok, fontSize: 13 }}>已经是最新版本（v{info.current}）</Text> : null}
      {info?.newer ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: c.accent, fontSize: 14, fontWeight: '700' }}>新版本 v{info.latest} 已发布（现在是 v{info.current}）</Text>
          {info.notes ? <Text style={{ color: c.ink2, fontSize: 12.5, lineHeight: 19 }} numberOfLines={14}>{plainNotes(info.notes)}</Text> : null}
          <Button label="下载新版 App" onPress={() => void Linking.openURL(info.apk ?? info.url)} />
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>下载后点开安装包直接覆盖安装，学习记录、生词本都会保留。</Text>
        </View>
      ) : null}
    </Card>
  );
}

function AboutSection() {
  const c = useColors();
  const version = Constants.expoConfig?.version ?? '';
  return (
    <>
      <SectionLabel>更新</SectionLabel>
      <UpdateCard />
      <SectionLabel>关于</SectionLabel>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} color={c.accent} />
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>にゃほんご {version}</Text>
        </View>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
          词典：JMdict © Electronic Dictionary Research and Development Group，CC BY-SA 4.0（JSON 版本来自 jmdict-simplified）{'\n'}
          {GRAMMAR_ATTRIBUTION}{'\n'}
          英汉词典（英语模式）：ECDICT（skywind3000，MIT）{'\n'}
          复习算法：FSRS（ts-fsrs，MIT）{'\n'}
          AI 生成的讲解、翻译和例句可能有错，以词典和原始资料为准。
        </Text>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 56 },
  tabs: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1 },
  usageRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chart: { flexDirection: 'row', height: 56, alignItems: 'flex-end' },
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
  recommend: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md },
  preset: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  bar: { height: 5, borderRadius: 3, overflow: 'hidden' },
});
