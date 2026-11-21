// The wheel drawing: one segment per slot, in the order the admin set, drawn clockwise from the top pointer.
// The rotation only SHOWS the result the Worker drew (targetRotation lands on the centre of that segment).
//
// Arabic labels (layout only — slots, colours, rotation and result are unchanged):
// - drawn in a 100x coordinate system: a font of ~0.09 user units made Chrome shape the Arabic glyphs at a tiny size and
//   scale them up (broken joins, letters out of place); right-to-left; the site's heading font (Readex Pro, 700);
// - every label is MEASURED (canvas, same font) and placed so that each line stays inside its slice at its own radius:
//   up to 8 slots the text runs ACROSS the slice (wide slices), from 9 slots ALONG the radius from the rim inwards
//   (narrow slices: much more room, the icon moves next to the hub); one line, or two balanced lines when needed;
// - one common size for all slices (the largest that fits every label, never below a readable minimum); a label still
//   too long is shortened with "…" — its full name stays in the odds list and the result.
import React, { useEffect, useMemo, useState } from 'react';
import type { WheelSlot } from '../../services/wheel';

// the site's identity, a little lighter: soft navy / light gold / cream; "حظ أوفر" in a neutral paper tone
const FILLS = ['#E5EBF3', '#F6EBCB', '#C9D5E5', '#FBF7EC', '#DCE7F4', '#ECD59A'];
const NONE_FILL = '#F3EDE1';
const INK = '#263F5F';
const FONT_FAMILY = '"Readex Pro","IBM Plex Sans Arabic",system-ui,sans-serif';
const FONT_WEIGHT = 700;

const HUB = 16;          // centre disc radius (wheel radius = 100)
const LINE_H_ACROSS = 1.62; // line spacing (x font size), text across the slice: Readex Pro's tall Arabic never touches
const LINE_H_RADIAL = 1.45; // line spacing, text along the radius
const MAX_FONT = 11;     // user units (~16 px on a 390 px phone)
const MIN_FONT = 6.5;    // never smaller (~9.5 px on a phone)
const RADIAL_FROM = 9;   // from this many slots the labels run along the radius (horizontal up to 8: the winning slot under the pointer reads naturally)
// across mode: label block centred at R_ACROSS, icon near the rim; radial mode: text from the rim inwards, icon near the hub
const R_ACROSS = 58;
const ICON_ACROSS = 84;
const RIM_PAD = 92;      // radial: the outer end of the text
const INNER_MIN = 39;    // radial: the inner end never closer to the centre than this (icons sit inside it)
const ICON_RADIAL = 29;

/** text width at font size 1 (canvas measure with the wheel's own font; a safe estimate without a DOM) */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function widthAt1(text: string): number {
  if (measureCtx === undefined) {
    try { measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { measureCtx = null; }
  }
  if (!measureCtx) return text.length * 0.56;
  measureCtx.font = `${FONT_WEIGHT} 100px ${FONT_FAMILY}`;
  return measureCtx.measureText(text).width / 100;
}

/** usable width across the slice at radius r (side padding included) */
const chordAt = (r: number, seg: number) => Math.min((seg >= Math.PI ? 2 * r : 2 * r * Math.sin(seg / 2)) * 0.84, 120);

type Mode = 'across' | 'radial';
/** does a block of lines fit its slice at font f? */
function fits(lines: string[], f: number, seg: number, mode: Mode): boolean {
  const w = lines.map((l) => widthAt1(l) * f);
  const stack = lines.length * (mode === 'across' ? LINE_H_ACROSS : LINE_H_RADIAL) * f;
  if (mode === 'across') {
    const LINE_H = LINE_H_ACROSS;
    // lines stacked along the radius around R_ACROSS; each must fit the slice's width at ITS radius
    if (R_ACROSS + stack / 2 > ICON_ACROSS - 7 || R_ACROSS - stack / 2 < HUB + 6) return false;
    return lines.every((_, k) => {
      const r = R_ACROSS + ((lines.length - 1) / 2 - k) * LINE_H * f;
      return w[k] <= chordAt(r - (LINE_H * f) / 2, seg);
    });
  }
  // radial: the text runs from RIM_PAD inwards; the stacked lines must fit the slice's width at the text's INNER end
  const len = Math.max(...w);
  const inner = RIM_PAD - len;
  return inner >= INNER_MIN && stack <= chordAt(inner, seg);
}
/** the largest font (binary search) that fits, 0 when even the minimum does not */
function maxFont(lines: string[], seg: number, mode: Mode): number {
  if (!fits(lines, MIN_FONT, seg, mode)) return 0;
  let lo = MIN_FONT; let hi = MAX_FONT;
  if (fits(lines, hi, seg, mode)) return hi;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (fits(lines, mid, seg, mode)) lo = mid; else hi = mid; }
  return lo;
}
/** candidate layouts of a label: one line, and every two-line split at a word boundary */
function candidates(label: string): string[][] {
  const t = label.trim().replace(/\s+/g, ' ');
  const words = t.split(' ');
  const out = [[t]];
  for (let i = 1; i < words.length; i++) out.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  return out;
}
function ellipsize(line: string, maxWidth: number, font: number): string {
  if (widthAt1(line) * font <= maxWidth) return line;
  let s = line;
  while (s.length > 1 && widthAt1(`${s}…`) * font > maxWidth) s = s.slice(0, -1).trimEnd();
  return `${s}…`;
}

export default function WheelDial({ slots, rotation, durationMs, highlight }: { slots: WheelSlot[]; rotation: number; durationMs: number; highlight: string | null }) {
  const n = Math.max(slots.length, 1);
  const seg = (2 * Math.PI) / n;
  const mode: Mode = n >= RADIAL_FROM ? 'radial' : 'across';
  // re-measure once the web fonts are ready (the first measure may use a fallback font)
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let live = true;
    const f = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
    f?.ready?.then(() => { if (live) setFontsTick((x) => x + 1); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const layout = useMemo(() => {
    const per = slots.map((s) => candidates(s.label).map((lines) => ({ lines, f: maxFont(lines, seg, mode) })));
    // the common size: the largest that fits EVERY label in its best form
    const font = Math.max(MIN_FONT, Math.min(MAX_FONT, ...per.map((c) => Math.max(...c.map((x) => x.f)))));
    // each label: ONE line whenever it fits at that size, otherwise the two-line split that fits best
    const lines = per.map((c) => {
      const one = c[0];
      if (one.f >= font) return one.lines;
      const ok = c.filter((x) => x.f >= font);
      const pick = (ok.length ? ok : c).reduce((a, b) => (b.f > a.f ? b : a));
      if (pick.f >= font) return pick.lines;
      // still too long at the minimum: shorten (full name in the odds list / result)
      const maxW = mode === 'radial' ? RIM_PAD - INNER_MIN : chordAt(R_ACROSS, seg);
      return pick.lines.map((l) => ellipsize(l, maxW, font));
    });
    return { font, lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, seg, mode, fontsTick]);
  const { font } = layout;
  const iconSize = mode === 'radial' ? Math.min(8.5, Math.max(6.5, chordAt(ICON_RADIAL, seg) * 0.62)) : Math.min(15, Math.max(10, font * 1.3));
  const pt = (a: number, r = 100) => `${(Math.sin(a) * r).toFixed(3)} ${(-Math.cos(a) * r).toFixed(3)}`;
  const textProps = { textAnchor: 'middle' as const, dominantBaseline: 'central' as const, direction: 'rtl' as const, fontSize: font, fontWeight: FONT_WEIGHT, fill: INK, style: { fontFamily: FONT_FAMILY, direction: 'rtl' as const, unicodeBidi: 'plaintext' as const } };
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[19rem] sm:max-w-[22rem]" data-testid="wheel-dial" data-slots={slots.length}>
      {/* pointer (top) */}
      <div aria-hidden="true" className="absolute left-1/2 top-[-4px] z-10 -translate-x-1/2">
        <svg width="30" height="34" viewBox="0 0 30 34"><path d="M15 34 L2 6 Q15 -4 28 6 Z" fill="#C08A2B" stroke="#FFFDF9" strokeWidth="2" /></svg>
      </div>
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-gold-200 to-gold-400 p-[6px] shadow-gold">
        <svg
          viewBox="-102 -102 204 204" className="h-full w-full rounded-full bg-paper-50" role="img"
          aria-label={slots.map((s) => s.label).join('، ')}
          style={{ transformOrigin: '50% 50%', transform: `rotate(${rotation}deg)`, transition: durationMs ? `transform ${durationMs}ms cubic-bezier(.12,.72,.18,1)` : 'none', textRendering: 'geometricPrecision' }}
          data-testid="wheel-svg" data-rotation={rotation} data-font={font.toFixed(2)} data-layout={mode}
          data-ellipsized={layout.lines.flat().filter((l) => l.endsWith('…')).length}
        >
          {slots.map((s, i) => {
            const a0 = i * seg;
            const a1 = (i + 1) * seg;
            const fill = s.color || (s.type === 'none' ? NONE_FILL : FILLS[i % FILLS.length]);
            const centreDeg = ((i + 0.5) * 360) / n;
            // where this slice will SIT on screen once the wheel stops (its angle + the wheel's rotation): labels are
            // turned by THAT angle, so they read upright at rest — before a spin and after it (incl. the winning slice)
            const screenDeg = (((centreDeg + rotation) % 360) + 360) % 360;
            const ls = layout.lines[i];
            const path = n === 1 ? 'M0 -100 A100 100 0 1 1 -0.01 -100 Z' : `M0 0 L${pt(a0)} A100 100 0 ${seg > Math.PI ? 1 : 0} 1 ${pt(a1)} Z`;
            let label: React.ReactNode;
            let icon: React.ReactNode = null;
            if (mode === 'across') {
              // lower half: the block is turned 180° around its own centre so it never reads upside down
              const flip = screenDeg > 90 && screenDeg < 270;
              label = (
                <g transform={flip ? `rotate(180 0 ${-R_ACROSS})` : undefined}>
                  {ls.map((l, k) => <text key={k} x="0" y={-(R_ACROSS + ((ls.length - 1) / 2 - k) * LINE_H_ACROSS * font)} {...textProps}>{l}</text>)}
                </g>
              );
              if (s.icon) icon = <text x="0" y={-ICON_ACROSS} textAnchor="middle" dominantBaseline="central" fontSize={iconSize} transform={flip ? `rotate(180 0 ${-ICON_ACROSS})` : undefined}>{s.icon}</text>;
            } else {
              // along the radius, from the rim inwards; the left half is turned 180° around the block's centre (upright)
              const len = Math.max(...ls.map((l) => widthAt1(l) * font));
              const rc = RIM_PAD - len / 2;
              const flip = screenDeg > 180;
              label = (
                <g transform={`rotate(-90)${flip ? ` rotate(180 ${rc} 0)` : ''}`}>
                  {ls.map((l, k) => <text key={k} x={rc} y={((k - (ls.length - 1) / 2) * LINE_H_RADIAL * font)} {...textProps}>{l}</text>)}
                </g>
              );
              if (s.icon) icon = <text x="0" y={-ICON_RADIAL} textAnchor="middle" dominantBaseline="central" fontSize={iconSize} transform={screenDeg > 90 && screenDeg < 270 ? `rotate(180 0 ${-ICON_RADIAL})` : undefined}>{s.icon}</text>;
            }
            return (
              <g key={s.id} data-testid="wheel-segment" data-slot-id={s.id} data-slot-type={s.type} data-index={i}>
                <path d={path} fill={fill} stroke="#FFFDF9" strokeWidth="1.2" opacity={highlight && highlight !== s.id ? 0.55 : 1} />
                <g transform={`rotate(${centreDeg})`}>
                  {icon}
                  {label}
                </g>
              </g>
            );
          })}
          <circle r={HUB} fill="#FFFDF9" stroke="#D4A645" strokeWidth="3" />
          <circle r="6" fill="#35547B" />
        </svg>
      </div>
    </div>
  );
}
