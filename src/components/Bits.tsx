import React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Switch, Text, TextInput, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Glass } from './Glass';
import { palette, radius, shadow } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { useKeyboardHeight } from '../theme/useKeyboard';

export type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'muted';

/** 每次调用现取 palette，主题切换后立即生效 */
function toneColors(): Record<Tone, { fg: string; bg: string }> {
  return {
    ok: { fg: palette.ok, bg: palette.okSoft },
    warn: { fg: palette.warn, bg: palette.warnSoft },
    danger: { fg: palette.danger, bg: palette.dangerSoft },
    accent: { fg: palette.accent, bg: palette.accentSoft },
    muted: { fg: palette.inkSoft, bg: palette.chipBg },
  };
}

export function Chip({ label, tone = 'muted', icon }: { label: string; tone?: Tone; icon?: keyof typeof Ionicons.glyphMap }) {
  const sc = useScale();
  const c = toneColors()[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(4), paddingHorizontal: sc.s(9), paddingVertical: sc.s(4), borderRadius: radius.pill, backgroundColor: c.bg, alignSelf: 'flex-start' }}>
      {icon ? <Ionicons name={icon} size={sc.s(12)} color={c.fg} /> : null}
      <Text numberOfLines={1} style={{ fontSize: sc.fs(11.5), color: c.fg, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

export function StatusDot({ tone, size }: { tone: Tone; size?: number }) {
  const sc = useScale();
  const d = size ?? sc.s(9);
  return <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: toneColors()[tone].fg }} />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline, marginVertical: 8 }, style]} />;
}

export function SectionLabel({ title, right, hint }: { title: string; right?: React.ReactNode; hint?: string | null }) {
  const sc = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: sc.s(2), marginBottom: sc.s(9), marginTop: sc.s(4) }}>
      <Text style={{ fontSize: sc.fs(16), fontWeight: '800', color: palette.ink, letterSpacing: 0.4 }}>{title}</Text>
      {hint ? (
        <Text numberOfLines={1} style={{ flex: 1, marginLeft: sc.s(8), fontSize: sc.fs(11.5), color: palette.inkFaint }}>
          {hint}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {right}
    </View>
  );
}

export function IconButton({ icon, onPress, tone = 'accent', size = 20, disabled, badge }: { icon: keyof typeof Ionicons.glyphMap; onPress?: () => void; tone?: Tone; size?: number; disabled?: boolean; badge?: string | null }) {
  const sc = useScale();
  const d = sc.s(40);
  const c = toneColors()[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: d,
        height: d,
        borderRadius: d / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? palette.disabledFill : palette.chipBg,
        borderWidth: 1,
        borderColor: disabled ? 'transparent' : palette.hairline,
        opacity: pressed ? 0.75 : 1,
        ...(disabled ? null : (shadow.soft as any)),
      })}
    >
      <Ionicons name={icon} size={sc.s(size)} color={disabled ? palette.disabledInk : c.fg} />
      {badge ? (
        <View style={{ position: 'absolute', top: -2, right: -2, minWidth: sc.s(16), height: sc.s(16), borderRadius: sc.s(8), backgroundColor: palette.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={{ fontSize: sc.fs(9.5), color: '#fff', fontWeight: '800' }}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function GlassButton({ label, icon, onPress, tone = 'accent', disabled, loading, style, size = 'md' }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress?: () => void; tone?: Tone; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; size?: 'sm' | 'md' | 'lg' }) {
  const sc = useScale();
  const c = toneColors()[tone];
  const padV = size === 'sm' ? sc.s(8) : size === 'lg' ? sc.s(15) : sc.s(12);
  const fontSize = size === 'sm' ? sc.fs(12.5) : size === 'lg' ? sc.fs(16) : sc.fs(14);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: sc.s(6),
        paddingVertical: padV,
        paddingHorizontal: sc.s(16),
        borderRadius: radius.pill,
        backgroundColor: disabled ? palette.disabledFill : c.bg,
        borderWidth: 1,
        borderColor: disabled ? 'transparent' : `${c.fg}44`,
        opacity: pressed && !disabled ? 0.8 : 1,
        ...(style as any),
      })}
    >
      {loading ? <ActivityIndicator size="small" color={disabled ? palette.disabledInk : c.fg} /> : icon ? <Ionicons name={icon} size={sc.s(fontSize + 2)} color={disabled ? palette.disabledInk : c.fg} /> : null}
      <Text style={{ fontSize, fontWeight: '800', color: disabled ? palette.disabledInk : c.fg }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, placeholder, multiline, secure, autoCapitalize, keyboardType, hint, right, autoFocus }: { label?: string; value: string; onChangeText: (t: string) => void; placeholder?: string; multiline?: boolean; secure?: boolean; autoCapitalize?: any; keyboardType?: any; hint?: string | null; right?: React.ReactNode; autoFocus?: boolean }) {
  const sc = useScale();
  return (
    <View style={{ marginBottom: sc.s(12) }}>
      {label ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(6) }}>
          <Text style={{ fontSize: sc.fs(12.5), color: palette.inkSoft, fontWeight: '700', flex: 1 }}>{label}</Text>
          {right}
        </View>
      ) : null}
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.inputBg, paddingHorizontal: sc.s(12), paddingVertical: multiline ? sc.s(8) : 0, minHeight: multiline ? sc.s(84) : sc.s(46), justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.inkFaint}
          multiline={multiline}
          secureTextEntry={secure}
          autoFocus={autoFocus}
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
          keyboardType={keyboardType}
          style={{
            fontSize: sc.fs(14),
            color: palette.ink,
            padding: 0,
            height: multiline ? undefined : sc.s(44),
            textAlignVertical: multiline ? 'top' : 'center',
            includeFontPadding: false,
          }}
        />
      </View>
      {hint ? <Text style={{ marginTop: sc.s(5), fontSize: sc.fs(11), color: palette.inkFaint, lineHeight: sc.fs(15) }}>{hint}</Text> : null}
    </View>
  );
}

export function SwitchRow({ title, desc, value, onValueChange, disabled }: { title: string; desc?: string | null; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const sc = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: sc.s(10), gap: sc.s(12) }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: sc.fs(14.5), color: palette.ink, fontWeight: '600' }}>{title}</Text>
        {desc ? <Text style={{ marginTop: sc.s(2), fontSize: sc.fs(11.5), color: palette.inkFaint, lineHeight: sc.fs(16) }}>{desc}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ false: 'rgba(146,160,180,0.30)', true: `${palette.accent}66` }} thumbColor={value ? palette.accent : '#fff'} ios_backgroundColor="rgba(146,160,180,0.30)" />
    </View>
  );
}

export function EmptyState({ icon = 'sparkles-outline', title, desc, action }: { icon?: keyof typeof Ionicons.glyphMap; title: string; desc?: string | null; action?: React.ReactNode }) {
  const sc = useScale();
  return (
    <View style={{ alignItems: 'center', paddingVertical: sc.s(30), paddingHorizontal: sc.s(18) }}>
      <View style={{ width: sc.s(58), height: sc.s(58), borderRadius: sc.s(29), backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: sc.s(12) }}>
        <Ionicons name={icon} size={sc.s(26)} color={palette.accent} />
      </View>
      <Text style={{ fontSize: sc.fs(15), fontWeight: '700', color: palette.ink, textAlign: 'center' }}>{title}</Text>
      {desc ? <Text style={{ marginTop: sc.s(6), fontSize: sc.fs(12), color: palette.inkFaint, textAlign: 'center', lineHeight: sc.fs(18) }}>{desc}</Text> : null}
      {action ? <View style={{ marginTop: sc.s(14) }}>{action}</View> : null}
    </View>
  );
}

export function Notice({ tone = 'muted', title, children }: { tone?: Tone; title?: string; children?: React.ReactNode }) {
  const sc = useScale();
  const c = toneColors()[tone];
  return (
    <View style={{ flexDirection: 'row', gap: sc.s(9), backgroundColor: c.bg, borderRadius: radius.md, padding: sc.s(12), borderWidth: 1, borderColor: `${c.fg}33` }}>
      <Ionicons name={tone === 'danger' ? 'alert-circle' : tone === 'warn' ? 'warning' : tone === 'ok' ? 'checkmark-circle' : 'information-circle'} size={sc.s(17)} color={c.fg} style={{ marginTop: sc.s(1) }} />
      <View style={{ flex: 1 }}>
        {title ? <Text style={{ fontSize: sc.fs(13), fontWeight: '800', color: c.fg, marginBottom: sc.s(2) }}>{title}</Text> : null}
        <Text style={{ fontSize: sc.fs(12), color: palette.inkSoft, lineHeight: sc.fs(18) }}>{children}</Text>
      </View>
    </View>
  );
}

/** 水晶玻璃底部弹层 */
export function Sheet({ visible, onClose, title, children, footer, maxHeightRatio = 0.86 }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode; maxHeightRatio?: number }) {
  const sc = useScale();
  const kb = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(13,27,42,0.34)', justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={{ maxHeight: sc.height * maxHeightRatio, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden', backgroundColor: palette.sheetBg, borderWidth: 1, borderColor: palette.edge, marginBottom: kb, ...(shadow.card as any) }}>
          <View style={{ alignItems: 'center', paddingTop: sc.s(9), paddingBottom: sc.s(4) }}>
            <View style={{ width: sc.s(38), height: sc.s(4.5), borderRadius: sc.s(3), backgroundColor: 'rgba(122,144,178,0.34)' }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: sc.gutter, paddingBottom: sc.s(8) }}>
            <Text style={{ flex: 1, fontSize: sc.fs(17), fontWeight: '800', color: palette.ink }} numberOfLines={1}>
              {title}
            </Text>
            <IconButton icon="close" onPress={onClose} tone="muted" size={18} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: sc.gutter, paddingBottom: sc.s(14) }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: sc.gutter, paddingTop: sc.s(8), paddingBottom: sc.insets.bottom + sc.s(12), borderTopWidth: 1, borderTopColor: palette.hairlineSoft, backgroundColor: 'rgba(255,255,255,0.7)' }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function Busy({ label }: { label?: string }) {
  const sc = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8), paddingVertical: sc.s(10), justifyContent: 'center' }}>
      <ActivityIndicator color={palette.accent} />
      <Text style={{ fontSize: sc.fs(12.5), color: palette.inkSoft }}>{label || '处理中…'}</Text>
    </View>
  );
}

export function KeyValue({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  const sc = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: sc.s(4), gap: sc.s(8) }}>
      <Text style={{ width: sc.s(74), fontSize: sc.fs(11.5), color: palette.inkFaint }}>{k}</Text>
      <Text selectable style={{ flex: 1, fontSize: sc.fs(12.5), color: palette.ink, fontWeight: '600', fontFamily: mono ? Platform.select({ ios: 'Menlo', android: 'monospace' }) : undefined }}>{v}</Text>
    </View>
  );
}


export function Collapsible({ title, right, defaultOpen = false, children, subtitle }: { title: string; right?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; subtitle?: string | null }) {
  const sc = useScale();
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Glass pad={0} style={{ marginBottom: sc.s(10) }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', padding: sc.pad, gap: sc.s(10) }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: sc.fs(14.5), fontWeight: '700', color: palette.ink }}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={{ marginTop: sc.s(2), fontSize: sc.fs(11.5), color: palette.inkFaint }}>{subtitle}</Text> : null}
        </View>
        {right}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={sc.s(17)} color={palette.accent} />
      </Pressable>
      {open ? <View style={{ paddingHorizontal: sc.pad, paddingBottom: sc.pad, borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>{children}</View> : null}
    </Glass>
  );
}