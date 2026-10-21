// 通用小组件
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useColors } from '../theme';

export function Button({ label, onPress, kind = 'primary', loading, disabled, icon, style, small }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean; disabled?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const c = useColors();
  const bg = { primary: c.accent, secondary: c.surface, ghost: 'transparent', danger: c.errSoft }[kind];
  const fg = { primary: c.accentInk, secondary: c.ink, ghost: c.ink2, danger: c.err }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? c.line : 'transparent', opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon}
      <Text style={[styles.label, small && { fontSize: 13 }, { color: fg }]}>{loading ? '请稍候' : label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

export function Segmented<T extends string | number>({ options, value, onChange }: {
  options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.seg, { backgroundColor: c.surface2 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[styles.segItem, on && { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 13, color: on ? c.ink : c.ink2, fontWeight: on ? '700' : '500' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Tag({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'accent' }) {
  const c = useColors();
  const bg = { neutral: c.surface2, ok: c.okSoft, accent: c.accentSoft }[tone];
  const fg = { neutral: c.ink2, ok: c.ok, accent: c.accent }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={{ fontSize: 11.5, color: fg }}>{label}</Text>
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  const c = useColors();
  return (
    <View style={[styles.note, { backgroundColor: c.errSoft }]}>
      <Text style={{ color: c.err, fontSize: 13.5, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

export function Title({ kicker, title }: { kicker?: string; title: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 2 }}>
      {kicker ? <Text style={{ color: c.accent, fontSize: 12, fontWeight: '700' }}>{kicker}</Text> : null}
      <Text style={{ color: c.ink, fontSize: 26, fontWeight: '800' }}>{title}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const c = useColors();
  return <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    height: 46, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  small: { height: 34, paddingHorizontal: 12, borderRadius: radius.sm },
  label: { fontSize: 15, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  seg: { flexDirection: 'row', padding: 3, borderRadius: 10, gap: 2 },
  segItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  note: { padding: 12, borderRadius: radius.md },
});
