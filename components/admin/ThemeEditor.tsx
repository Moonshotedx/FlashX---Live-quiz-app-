'use client';
import { useEffect, useState } from 'react';
import { PRESETS, PRESET_LABELS, FONTS, gradient, contrastRatio, effectiveBackgroundHex, backgroundCss } from '@/lib/theme';
import type { EditableQuestion } from '@/lib/validate-quiz';
import type { FontName, Theme } from '@/lib/types';
import { uploadFile } from './upload';
import { PhonePreview, PresenterPreview, type PreviewScreen } from './Previews';
import { Spinner } from '@/components/ui/Spinner';

const SAVED_KEY = 'quiz-saved-theme-presets';

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-12 cursor-pointer rounded border border-slate-700 bg-transparent" aria-label={`${label} picker`} />
        <input value={value} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value.toUpperCase())} className="field font-mono" aria-label={`${label} hex`} />
      </div>
    </div>
  );
}

export function ThemeEditor({ theme, onChange, sampleQuestion }: { theme: Theme; onChange: (t: Theme) => void; sampleQuestion: EditableQuestion }) {
  const [screen, setScreen] = useState<PreviewScreen>('open');
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Record<string, Theme>>({});

  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}'));
    } catch {
      /* ignore */
    }
  }, []);

  const set = (patch: Partial<Theme>) => onChange({ ...theme, ...patch, preset: 'custom' });
  const applyPreset = (p: Theme) => onChange({ ...p, eventTitle: theme.eventTitle, logoUrl: theme.logoUrl });

  const upload = async (kind: 'logo' | 'background', file?: File) => {
    if (!file) return;
    setUploading(kind);
    setError('');
    try {
      const url = await uploadFile(file, kind);
      if (kind === 'logo') set({ logoUrl: url });
      else set({ backgroundType: 'image', backgroundValue: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const setBgType = (t: Theme['backgroundType']) => {
    if (t === 'solid') set({ backgroundType: t, backgroundValue: /^#/.test(theme.backgroundValue) ? theme.backgroundValue : theme.gradientFrom });
    else if (t === 'gradient') set({ backgroundType: t, backgroundValue: gradient(theme.gradientFrom, theme.gradientTo) });
    else set({ backgroundType: t, backgroundValue: /^(https?:|\/api\/assets\/)/.test(theme.backgroundValue) ? theme.backgroundValue : '' });
  };

  const bg = effectiveBackgroundHex(theme);
  const warnings: string[] = [];
  if (contrastRatio(theme.textColor, bg) < 4.5) warnings.push(`Text on background contrast is ${contrastRatio(theme.textColor, bg).toFixed(1)}:1 (WCAG AA needs 4.5:1).`);
  if (theme.backgroundType === 'gradient' && contrastRatio(theme.textColor, theme.gradientTo) < 4.5) warnings.push(`Text on the second gradient colour is only ${contrastRatio(theme.textColor, theme.gradientTo).toFixed(1)}:1.`);
  if (contrastRatio('#FFFFFF', theme.primaryColor) < 4.5) warnings.push(`White text on the primary colour is only ${contrastRatio('#FFFFFF', theme.primaryColor).toFixed(1)}:1 (selected answers and buttons).`);
  if (contrastRatio(theme.accentColor, bg) < 3) warnings.push(`Accent colour on background is only ${contrastRatio(theme.accentColor, bg).toFixed(1)}:1 (countdown and scores).`);

  const savePreset = () => {
    const name = prompt('Name for this preset?');
    if (!name?.trim()) return;
    const next = { ...saved, [name.trim()]: { ...theme, preset: name.trim() } };
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <section className="panel space-y-3">
          <h3 className="font-bold text-white">Presets</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(PRESETS).map(([id, p]) => (
              <button
                key={id}
                onClick={() => applyPreset(p)}
                className={`overflow-hidden rounded-xl border-2 text-left transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 active:scale-[0.97] ${
                  theme.preset === id ? 'border-violet-400 shadow-md shadow-violet-500/20' : 'border-slate-700 hover:border-slate-500'
                }`}
              >
                <div className="h-14" style={{ background: backgroundCss(p) }}>
                  <div className="flex h-full items-end gap-1 p-2">
                    <span className="h-3 w-6 rounded" style={{ background: p.primaryColor }} />
                    <span className="h-3 w-6 rounded" style={{ background: p.accentColor }} />
                  </div>
                </div>
                <div className="bg-slate-900 px-2 py-1.5 text-xs font-semibold text-slate-200">{PRESET_LABELS[id]}</div>
              </button>
            ))}
          </div>
          {Object.keys(saved).length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-xs text-slate-400">Saved:</span>
              {Object.entries(saved).map(([name, p]) => (
                <button key={name} className="btn-secondary px-3 py-1 text-xs" onClick={() => applyPreset(p)}>{name}</button>
              ))}
            </div>
          )}
          <button className="btn-secondary" onClick={savePreset}>💾 Save current as preset (this browser)</button>
        </section>

        <section className="panel space-y-4">
          <h3 className="font-bold text-white">Branding</h3>
          <div>
            <label className="label" htmlFor="eventTitle">Event title</label>
            <input id="eventTitle" className="field" value={theme.eventTitle} maxLength={120} onChange={(e) => set({ eventTitle: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {theme.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme.logoUrl} alt="Logo" className="h-14 max-w-[160px] rounded bg-white/10 object-contain p-1" />
            )}
            <label className="btn-secondary cursor-pointer">
              {uploading === 'logo' ? (
                <>
                  <Spinner />
                  Uploading…
                </>
              ) : theme.logoUrl ? (
                'Replace logo'
              ) : (
                'Upload logo (PNG, JPG, SVG, max 1 MB)'
              )}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={(e) => upload('logo', e.target.files?.[0])} />
            </label>
            {theme.logoUrl && <button className="btn-ghost" onClick={() => set({ logoUrl: '' })}>Remove</button>}
          </div>
          <div>
            <label className="label" htmlFor="font">Font</label>
            <select id="font" className="field" value={theme.fontFamily} onChange={(e) => set({ fontFamily: e.target.value as FontName })}>
              {FONTS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
        </section>

        <section className="panel space-y-4">
          <h3 className="font-bold text-white">Colours</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Color label="Primary" value={theme.primaryColor} onChange={(v) => set({ primaryColor: v })} />
            <Color label="Accent" value={theme.accentColor} onChange={(v) => set({ accentColor: v })} />
            <Color label="Text" value={theme.textColor} onChange={(v) => set({ textColor: v })} />
            <Color label="Correct" value={theme.correctColor} onChange={(v) => set({ correctColor: v })} />
            <Color label="Wrong" value={theme.wrongColor} onChange={(v) => set({ wrongColor: v })} />
          </div>
        </section>

        <section className="panel space-y-4">
          <h3 className="font-bold text-white">Background</h3>
          <div className="flex gap-2" role="radiogroup" aria-label="Background type">
            {(['solid', 'gradient', 'image'] as const).map((t) => (
              <button key={t} role="radio" aria-checked={theme.backgroundType === t} onClick={() => setBgType(t)} className={theme.backgroundType === t ? 'btn-primary' : 'btn-secondary'}>
                {t === 'solid' ? 'Solid' : t === 'gradient' ? 'Gradient' : 'Image'}
              </button>
            ))}
          </div>
          {theme.backgroundType === 'solid' && <Color label="Colour" value={/^#/.test(theme.backgroundValue) ? theme.backgroundValue : theme.gradientFrom} onChange={(v) => set({ backgroundValue: v, gradientFrom: v })} />}
          {theme.backgroundType === 'gradient' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Color label="From" value={theme.gradientFrom} onChange={(v) => set({ gradientFrom: v, backgroundValue: gradient(v, theme.gradientTo) })} />
              <Color label="To" value={theme.gradientTo} onChange={(v) => set({ gradientTo: v, backgroundValue: gradient(theme.gradientFrom, v) })} />
            </div>
          )}
          {theme.backgroundType === 'image' && (
            <div className="space-y-3">
              <label className="btn-secondary cursor-pointer">
                {uploading === 'background' ? (
                  <>
                    <Spinner />
                    Uploading…
                  </>
                ) : theme.backgroundValue ? (
                  'Replace image'
                ) : (
                  'Upload background image (max 2 MB)'
                )}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload('background', e.target.files?.[0])} />
              </label>
              <div>
                <label className="label" htmlFor="overlay">Dark overlay: {theme.overlay}%</label>
                <input id="overlay" type="range" min={0} max={90} value={theme.overlay} onChange={(e) => set({ overlay: Number(e.target.value) })} className="w-full accent-violet-500" />
              </div>
            </div>
          )}
        </section>

        {warnings.length > 0 && (
          <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p className="font-semibold">⚠ Low contrast</p>
            <ul className="mt-1 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>

      <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        <section className="panel space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold text-white">Presenter preview (16:9)</h3>
            <div className="flex gap-1" role="tablist">
              {(
                [
                  ['open', 'Open QR'],
                  ['live', 'Live Top 10'],
                  ['leaderboard', 'Leaderboard'],
                ] as const
              ).map(([s, label]) => (
                <button key={s} role="tab" aria-selected={screen === s} onClick={() => setScreen(s)} className={`${screen === s ? 'btn-primary' : 'btn-secondary'} px-3 py-1 text-xs`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <PresenterPreview theme={theme} screen={screen} title={theme.eventTitle || 'Event title'} />
        </section>
        <section className="panel space-y-3">
          <h3 className="font-bold text-white">Phone preview</h3>
          <PhonePreview theme={theme} question={sampleQuestion} />
        </section>
      </div>
    </div>
  );
}

