// The wheel drawing: one segment per slot, in the order the admin set, drawn clockwise from the top pointer.
// The rotation only SHOWS the result the Worker drew (targetRotation lands on the centre of that segment).
import React from 'react';
import type { WheelSlot } from '../../services/wheel';

// the site's identity, a little lighter: soft navy / light gold / cream; "حظ أوفر" in a neutral paper tone
const FILLS = ['#E5EBF3', '#F6EBCB', '#C9D5E5', '#FBF7EC', '#DCE7F4', '#ECD59A'];
const NONE_FILL = '#F3EDE1';
const INK = '#263F5F';

function splitLabel(s: string): string[] {
  const t = s.trim();
  if (t.length <= 11) return [t];
  const mid = Math.floor(t.length / 2);
  let cut = -1;
  for (let d = 0; d <= mid; d++) {
    if (t[mid - d] === ' ') { cut = mid - d; break; }
    if (t[mid + d] === ' ') { cut = mid + d; break; }
  }
  return cut > 0 ? [t.slice(0, cut), t.slice(cut + 1)] : [t.slice(0, 12), t.slice(12)];
}

export default function WheelDial({ slots, rotation, durationMs, highlight }: { slots: WheelSlot[]; rotation: number; durationMs: number; highlight: string | null }) {
  const n = Math.max(slots.length, 1);
  const seg = (2 * Math.PI) / n;
  const font = Math.max(0.05, Math.min(0.09, 0.72 / n));
  const pt = (a: number, r = 1) => `${(Math.sin(a) * r).toFixed(5)} ${(-Math.cos(a) * r).toFixed(5)}`;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[19rem] sm:max-w-[22rem]" data-testid="wheel-dial" data-slots={slots.length}>
      {/* pointer (top) */}
      <div aria-hidden="true" className="absolute left-1/2 top-[-4px] z-10 -translate-x-1/2">
        <svg width="30" height="34" viewBox="0 0 30 34"><path d="M15 34 L2 6 Q15 -4 28 6 Z" fill="#C08A2B" stroke="#FFFDF9" strokeWidth="2" /></svg>
      </div>
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-gold-200 to-gold-400 p-[6px] shadow-gold">
        <svg
          viewBox="-1.02 -1.02 2.04 2.04" className="h-full w-full rounded-full bg-paper-50" role="img"
          aria-label={slots.map((s) => s.label).join('، ')}
          style={{ transformOrigin: '50% 50%', transform: `rotate(${rotation}deg)`, transition: durationMs ? `transform ${durationMs}ms cubic-bezier(.12,.72,.18,1)` : 'none' }}
          data-testid="wheel-svg" data-rotation={rotation}
        >
          {slots.map((s, i) => {
            const a0 = i * seg;
            const a1 = (i + 1) * seg;
            const fill = s.color || (s.type === 'none' ? NONE_FILL : FILLS[i % FILLS.length]);
            // labels in the lower half are turned 180° around their own position so they never read upside down
            const centreDeg = ((i + 0.5) * 360) / n;
            const flip = centreDeg > 90 && centreDeg < 270;
            const lines = flip ? splitLabel(s.label).reverse() : splitLabel(s.label);
            const yOf = (k: number) => -0.6 + k * font * 1.15;
            const midY = yOf((lines.length - 1) / 2);
            return (
              <g key={s.id} data-testid="wheel-segment" data-slot-id={s.id} data-slot-type={s.type} data-index={i}>
                <path d={n === 1 ? 'M0 -1 A1 1 0 1 1 -0.0001 -1 Z' : `M0 0 L${pt(a0)} A1 1 0 ${seg > Math.PI ? 1 : 0} 1 ${pt(a1)} Z`} fill={fill} stroke="#FFFDF9" strokeWidth="0.012" opacity={highlight && highlight !== s.id ? 0.55 : 1} />
                <g transform={`rotate(${centreDeg})`}>
                  {s.icon && <text x="0" y={-0.8} textAnchor="middle" dominantBaseline="middle" fontSize={font * 1.3} transform={flip ? 'rotate(180 0 -0.8)' : undefined}>{s.icon}</text>}
                  <g transform={flip ? `rotate(180 0 ${midY})` : undefined}>
                    {lines.map((l, k) => (
                      <text key={k} x="0" y={yOf(k)} textAnchor="middle" dominantBaseline="middle" fontSize={font} fontWeight={800} fill={INK} style={{ fontFamily: '"Readex Pro","IBM Plex Sans Arabic",system-ui,sans-serif' }}>{l}</text>
                    ))}
                  </g>
                </g>
              </g>
            );
          })}
          <circle r="0.16" fill="#FFFDF9" stroke="#D4A645" strokeWidth="0.03" />
          <circle r="0.06" fill="#35547B" />
        </svg>
      </div>
    </div>
  );
}
