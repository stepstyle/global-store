// Dashboard tab: prize wheel settings + prize log (TEST builds only). Every save is checked by the Worker
// (src/wheel.js checkCampaign, the same function used here for the live preview) and refused with the reasons when
// invalid; warnings (possible loss, conflicting conditions) never block. Admin rights are checked by the Worker.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFirebaseAuth } from '../../services/firebase';
import type { SubmitDeps } from '../../services/orderSubmit';
import { BACKEND_ENABLED } from '../../config/deployEnv';
import { getWheelAdmin, getWheelSpins, newSlotId, saveWheelCampaign, slotShares, suggestedWeights, tierW, TIERS, TIER_AR, TIER_SHORT_AR, type AdminCampaign, type AdminFailure, type AdminSlot, type AdminSpinRow, type AdminWheel, type Tier } from '../../services/wheelAdmin';
import { checkCampaign } from '../../../workers/order-worker/src/wheel.js';

const TYPE_AR: Record<AdminSlot['type'], string> = { gift: 'هدية', discount: 'خصم نقدي', free_delivery: 'توصيل مجاني', none: 'حظ أوفر' };
const STATUS_AR: Record<string, string> = { issued: 'أولية (غير مستخدمة)', reserved: 'مرفقة بطلب — بانتظار التسليم', consumed: 'مستحقة ومستخدمة', expired: 'منتهية / ملغاة', none: 'حظ أوفر' };

/** the prizes agreed with the owner — ALL inactive with weight 0 and quantity 0: the owner sets chances and stock */
function agreedTemplate(): AdminCampaign {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86_400_000);
  const s = (o: Partial<AdminSlot> & Pick<AdminSlot, 'id' | 'type' | 'label'>): AdminSlot => ({ weight: 0, quantity: 0, active: false, minOrderJod: 5, appliesTo: 'this_order', ...o });
  return {
    active: false, minOrderJod: 5, budgetJod: 0, startsAt: now.toISOString(), endsAt: end.toISOString(), giftOnCancel: 'return',
    freeFirstChance: true, openGiftsPerPhone: 1, prizeValidDays: 7, terms: '',
    prizes: [
      s({ id: 'ship-1', type: 'free_delivery', label: 'توصيل مجاني', icon: '🚚', valueJod: 3, unitCostJod: 3 }),
      s({ id: 'disc-1', type: 'discount', label: 'خصم دينار', icon: '💸', valueJod: 1, unitCostJod: 1 }),
      { id: 'none-1', type: 'none', label: 'حظ أوفر', weight: 0, active: true },
      s({ id: 'gift-2', type: 'gift', label: 'هدية بقيمة 2 د.أ', icon: '🎁', valueJod: 2, unitCostJod: 2 }),
      s({ id: 'gift-3', type: 'gift', label: 'هدية بقيمة 3 د.أ', icon: '🎁', valueJod: 3, unitCostJod: 3 }),
      s({ id: 'watch-1', type: 'gift', label: 'هدية ساعة', icon: '⌚', valueJod: 0, unitCostJod: 0, minOrderJod: 15 }),
      { id: 'none-2', type: 'none', label: 'حظ أوفر', weight: 0, active: true },
      s({ id: 'gift-4', type: 'gift', label: 'هدية بقيمة 4 د.أ', icon: '🎁', valueJod: 4, unitCostJod: 4 }),
      s({ id: 'toy-1', type: 'gift', label: 'هدية لعبة', icon: '🧸', valueJod: 0, unitCostJod: 0 }),
      s({ id: 'second-4', type: 'discount', label: 'خصم 4 د.أ على الطلب الثاني', icon: '🔁', valueJod: 4, unitCostJod: 4, minOrderJod: 15, appliesTo: 'next_order' }),
      { id: 'none-3', type: 'none', label: 'حظ أوفر', weight: 0, active: true },
      s({ id: 'gift-5', type: 'gift', label: 'هدية بقيمة 5 د.أ', icon: '🎁', valueJod: 5, unitCostJod: 5 }),
      s({ id: 'acc-1', type: 'gift', label: 'نثريات وإكسسوارات', icon: '✏️', valueJod: 0, unitCostJod: 0 }),
      s({ id: 'disc-4', type: 'discount', label: 'خصم 4 د.أ', icon: '💰', valueJod: 4, unitCostJod: 4, minOrderJod: 15 }),
      s({ id: 'disc-5', type: 'discount', label: 'خصم 5 د.أ', icon: '💰', valueJod: 5, unitCostJod: 5, minOrderJod: 15 }),
    ],
  };
}

const toLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const numIn = (v: string) => (v.trim() === '' ? 0 : Number(v));

export default function WheelAdmin() {
  const workerUrl = BACKEND_ENABLED ? String(import.meta.env.VITE_ORDER_ADMIN_URL || import.meta.env.VITE_WORKER_URL || '') : '';
  const deps = useMemo<SubmitDeps>(() => ({ fetch: (url, init) => window.fetch(url, init as RequestInit) as any }), []);
  const [data, setData] = useState<AdminWheel | null>(null);
  const [draft, setDraft] = useState<AdminCampaign | null>(null);
  const [err, setErr] = useState('');
  const [saveMsg, setSaveMsg] = useState<{ tone: 'ok' | 'error'; text: string; list?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [spins, setSpins] = useState<AdminSpinRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState('');
  const token = async () => (await getFirebaseAuth()?.currentUser?.getIdToken().catch(() => null)) ?? null;

  const load = useCallback(async () => {
    setErr('');
    const res = await getWheelAdmin(workerUrl, await token(), deps);
    if (res.ok === false) { const r = res as AdminFailure; setErr(r.status === 403 ? 'هذا الحساب ليس مديرًا: لا يمكنه عرض أو تغيير إعدادات الدولاب.' : r.status === 404 ? 'الدولاب غير مفعّل في هذه النسخة (WHEEL_MODE=off).' : `تعذّر التحميل (${r.code}).`); return; }
    const v = (res as { ok: true; value: AdminWheel }).value;
    setData(v);
    setDraft(v.campaign ? { ...v.campaign, prizes: v.campaign.prizes.map((p) => ({ ...p })) } : null);
  }, [workerUrl, deps]);
  const loadSpins = useCallback(async (status = filter) => {
    const r = await getWheelSpins(workerUrl, await token(), deps, status);
    if (r.ok === true) { const v = (r as { ok: true; value: { spins: AdminSpinRow[]; counts: Record<string, number> } }).value; setSpins(v.spins); setCounts(v.counts); }
  }, [workerUrl, deps, filter]);
  useEffect(() => { void load(); void loadSpins(''); }, [load]);

  const check = useMemo(() => (draft ? checkCampaign(draft) : null), [draft]);
  // the ACTUAL share of every slot for each loyalty tier (what the Worker would draw with these weights)
  const sharesBy = useMemo(() => (draft ? (Object.fromEntries(TIERS.map((t) => [t, slotShares(draft, t)])) as Record<Tier, Record<string, number>>) : null), [draft]);
  /** one tier's weight of a slot; 'weight' (the legacy single weight) follows the NEW-customer weight */
  // computed from the CURRENT slot (functional update): several weights edited in a row never undo each other
  const setTierWeight = (i: number, _p: AdminSlot, t: Tier, v: number) => setDraft((d) => (d ? {
    ...d,
    prizes: d.prizes.map((q, k) => {
      if (k !== i) return q;
      const weights = { new: tierW(q, 'new'), returning: tierW(q, 'returning'), loyal: tierW(q, 'loyal'), [t]: v };
      return { ...q, weights, weight: weights.new };
    }),
  } : d));
  /** fills the SUGGESTED weights into the draft (not saved; the owner reviews costs and budget first) */
  const suggest = () => setDraft((d) => (d ? { ...d, prizes: d.prizes.map((p) => { const w = suggestedWeights(p); return { ...p, weights: w, weight: w.new }; }) } : d));

  const setC = (patch: Partial<AdminCampaign>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setSlot = (i: number, patch: Partial<AdminSlot>) => setDraft((d) => (d ? { ...d, prizes: d.prizes.map((p, k) => (k === i ? { ...p, ...patch } : p)) } : d));
  const move = (i: number, dir: -1 | 1) => setDraft((d) => {
    if (!d) return d;
    const j = i + dir;
    if (j < 0 || j >= d.prizes.length) return d;
    const a = d.prizes.slice();
    [a[i], a[j]] = [a[j], a[i]];
    return { ...d, prizes: a };
  });
  const remove = (i: number) => setDraft((d) => (d ? { ...d, prizes: d.prizes.filter((_, k) => k !== i) } : d));
  const add = (type: AdminSlot['type']) => setDraft((d) => {
    const base = d ?? agreedTemplate();
    const id = newSlotId(base.prizes.map((p) => p.id), type);
    const slot: AdminSlot = type === 'none' ? { id, type, label: 'حظ أوفر', weight: 0, active: true } : { id, type, label: TYPE_AR[type], weight: 0, quantity: 0, active: false, valueJod: type === 'gift' ? 0 : 1, unitCostJod: type === 'gift' ? 0 : 1, minOrderJod: base.minOrderJod, appliesTo: 'this_order' };
    return { ...base, prizes: [...base.prizes, slot] };
  });

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaveMsg(null);
    const res = await saveWheelCampaign(workerUrl, await token(), deps, draft, data?.updateTime ?? null);
    setSaving(false);
    if (res.ok === true) {
      const v = (res as { ok: true; value: AdminWheel }).value;
      setData(v);
      setDraft(v.campaign ? { ...v.campaign, prizes: v.campaign.prizes.map((p) => ({ ...p })) } : draft);
      setSaveMsg({ tone: 'ok', text: 'حُفظت الإعدادات. الزوار يرون الدولاب الجديد فورًا.', list: v.warnings });
      return;
    }
    const r = res as AdminFailure;
    setSaveMsg({
      tone: 'error',
      text: r.code === 'WHEEL_CAMPAIGN_CHANGED' ? 'غيّر شخص آخر (أو نافذة أخرى) الإعدادات بعد فتحك لها. أعد التحميل ثم عدّل من جديد — لم يُحفظ شيء.' : r.status === 403 ? 'هذا الحساب ليس مديرًا — لم يُحفظ شيء.' : r.code === 'WHEEL_CAMPAIGN_INVALID' ? 'الإعدادات غير صالحة — لم يُحفظ شيء:' : `تعذّر الحفظ (${r.code}).`,
      list: r.errors,
    });
  };

  if (err) return <div className="rounded-3xl border border-red-200 bg-red-50 p-5 font-bold text-red-800" data-testid="wheel-admin-error">{err}</div>;
  if (!data) return <p className="p-6 text-slate-500">جارٍ التحميل…</p>;

  const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 focus:border-sky-400 focus:outline-none';
  const lbl = 'block text-[11px] font-black text-slate-500 mb-1';

  return (
    <div className="space-y-6" dir="rtl" data-testid="wheel-admin">
      <div className="rounded-3xl border border-gold-200 bg-gold-50 p-4 text-sm font-bold text-ink-900">
        نسخة تجريبية: الدولاب يعمل فقط في البيئة التجريبية (WHEEL_MODE=test). لا يُفعَّل على الموقع الحقيقي إلا بموافقة ونشر منفصلين.
      </div>

      {!draft ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <p className="font-bold text-slate-700">لا توجد حملة بعد.</p>
          <button type="button" className="mt-3 rounded-xl bg-ink-900 px-4 py-2 font-black text-white" onClick={() => setDraft(agreedTemplate())} data-testid="wheel-admin-template">إنشاء الحملة من الجوائز المتفق عليها (كلها موقوفة، بلا أوزان)</button>
        </div>
      ) : (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-black text-slate-900">إعدادات الحملة</h3>
              <label className="flex items-center gap-2 text-sm font-black">
                <input type="checkbox" checked={draft.active} onChange={(e) => setC({ active: e.target.checked })} data-testid="wheel-admin-active" />
                {draft.active ? 'الدولاب يعمل' : 'الدولاب متوقف'}
              </label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><label className={lbl}>البداية</label><input type="datetime-local" className={field} value={toLocal(draft.startsAt)} onChange={(e) => setC({ startsAt: fromLocal(e.target.value) || draft.startsAt })} /></div>
              <div><label className={lbl}>النهاية</label><input type="datetime-local" className={field} value={toLocal(draft.endsAt)} onChange={(e) => setC({ endsAt: fromLocal(e.target.value) || draft.endsAt })} /></div>
              <div><label className={lbl}>الحد الأدنى العام (د.أ) — لكسب لفة جديدة</label><input type="number" min="0" step="0.5" className={field} value={draft.minOrderJod} onChange={(e) => setC({ minOrderJod: numIn(e.target.value) })} /></div>
              <div><label className={lbl}>الميزانية القصوى (د.أ)</label><input type="number" min="0" step="1" className={field} value={draft.budgetJod} onChange={(e) => setC({ budgetJod: numIn(e.target.value) })} data-testid="wheel-admin-budget" /></div>
              <div><label className={lbl}>صلاحية الجائزة غير المستخدمة</label><p className={`${field} bg-slate-50 text-slate-700`} data-testid="wheel-admin-hold">{data.prizeHoldMinutes ?? 60} دقيقة من لحظة اللفة — بعدها تنتهي ويعود حجزها تلقائيًا (إعداد الخادم WHEEL_PRIZE_HOLD_MINUTES)</p></div>
              <div><label className={lbl}>جوائز مفتوحة لكل رقم هاتف</label><input type="number" min="1" className={field} value={draft.openGiftsPerPhone ?? 1} onChange={(e) => setC({ openGiftsPerPhone: numIn(e.target.value) })} /></div>
              <div><label className={lbl}>عند إلغاء الطلب</label>
                <select className={field} value={draft.giftOnCancel} onChange={(e) => setC({ giftOnCancel: e.target.value as 'return' | 'expire' })}>
                  <option value="return">تعود الجائزة للزبون (حتى انتهاء صلاحيتها)</option>
                  <option value="expire">تُلغى الجائزة</option>
                </select>
              </div>
              <div className="flex items-end"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.freeFirstChance !== false} onChange={(e) => setC({ freeFirstChance: e.target.checked })} /> لفة ترحيبية لكل حساب جديد</label></div>
            </div>
            <div className="mt-3"><label className={lbl}>الشروط التي يراها الزبون</label><textarea className={`${field} min-h-[70px]`} maxLength={2000} value={draft.terms || ''} onChange={(e) => setC({ terms: e.target.value })} /></div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-black text-slate-900">خانات الدولاب ({draft.prizes.length})</h3>
              <div className="flex flex-wrap gap-2">
                {(['gift', 'discount', 'free_delivery', 'none'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => add(t)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50" data-testid={`wheel-admin-add-${t}`}>+ {TYPE_AR[t]}</button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500">الترتيب هنا هو ترتيب الخانات على الدولاب. الاحتمال = الوزن ÷ مجموع أوزان الخانات المفعّلة (يُحسب على الخادم).</p>
            <div className="mt-4 space-y-3">
              {draft.prizes.map((p, i) => (
                <div key={`${p.id}-${i}`} className={`rounded-2xl border p-3 ${p.type === 'none' ? 'border-slate-200 bg-paper-100' : 'border-ink-100 bg-white'}`} data-testid="wheel-admin-slot" data-slot-id={p.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600">{i + 1}</span>
                    <input className={`${field} max-w-[14rem]`} value={p.label} maxLength={40} onChange={(e) => setSlot(i, { label: e.target.value })} aria-label="الاسم" data-testid="wheel-admin-label" />
                    <select className={`${field} max-w-[9rem]`} value={p.type} onChange={(e) => setSlot(i, { type: e.target.value as AdminSlot['type'] })} aria-label="النوع">
                      {(['gift', 'discount', 'free_delivery', 'none'] as const).map((t) => <option key={t} value={t}>{TYPE_AR[t]}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs font-bold"><input type="checkbox" checked={p.active !== false} onChange={(e) => setSlot(i, { active: e.target.checked })} /> مفعّلة</label>
                    <span className="ms-auto flex flex-wrap gap-1 text-[11px] font-black text-ink-700" data-testid="wheel-admin-share">{TIERS.map((t) => <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5" data-testid={`wheel-admin-share-${t}`}>{TIER_SHORT_AR[t]} {Math.round(((sharesBy?.[t][p.id]) || 0) * 1000) / 10}%</span>)}</span>
                    <button type="button" onClick={() => move(i, -1)} className="rounded-lg border px-2 text-sm" aria-label="أعلى">↑</button>
                    <button type="button" onClick={() => move(i, 1)} className="rounded-lg border px-2 text-sm" aria-label="أسفل">↓</button>
                    <button type="button" onClick={() => remove(i)} className="rounded-lg border border-red-200 px-2 text-sm text-red-700" aria-label="حذف">✕</button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6">
                    <div><label className={lbl}>المعرّف</label><input className={field} value={p.id} onChange={(e) => setSlot(i, { id: e.target.value.toLowerCase() })} dir="ltr" /></div>
                    {TIERS.map((t) => (
                      <div key={t}><label className={lbl}>{`الوزن — ${TIER_SHORT_AR[t]}`}</label><input type="number" min="0" step="1" className={field} value={tierW(p, t)} onChange={(e) => setTierWeight(i, p, t, Math.max(0, Math.floor(numIn(e.target.value))))} data-testid={`wheel-admin-weight-${t}`} /></div>
                    ))}
                    {p.type !== 'none' && (
                      <>
                        <div><label className={lbl}>{p.type === 'free_delivery' ? 'سقف التوصيل (د.أ)' : p.type === 'discount' ? 'قيمة الخصم (د.أ)' : 'قيمة الهدية (د.أ)'}</label><input type="number" min="0" step="0.5" className={field} value={p.valueJod ?? 0} onChange={(e) => setSlot(i, { valueJod: numIn(e.target.value) })} data-testid="wheel-admin-value" /></div>
                        <div><label className={lbl}>الحد الأدنى للطلب (د.أ)</label><input type="number" min="0" step="0.5" className={field} value={p.minOrderJod ?? draft.minOrderJod} onChange={(e) => setSlot(i, { minOrderJod: numIn(e.target.value) })} data-testid="wheel-admin-min" /></div>
                        <div><label className={lbl}>الكمية الكلية {data.pool[p.id] !== undefined && data.pool[p.id] !== null ? `(المتبقي ${data.pool[p.id]})` : ''}</label><input type="number" min="0" step="1" className={field} value={p.quantity ?? 0} onChange={(e) => setSlot(i, { quantity: Math.max(0, Math.floor(numIn(e.target.value))) })} data-testid="wheel-admin-qty" /></div>
                        <div><label className={lbl}>تكلفة الوحدة على المكتبة (د.أ)</label><input type="number" min="0" step="0.5" className={field} value={p.unitCostJod ?? 0} onChange={(e) => setSlot(i, { unitCostJod: numIn(e.target.value) })} /></div>
                        {p.type === 'discount' && (
                          <div><label className={lbl}>يُطبَّق على</label>
                            <select className={field} value={p.appliesTo || 'this_order'} onChange={(e) => setSlot(i, { appliesTo: e.target.value as 'this_order' | 'next_order' })}>
                              <option value="this_order">هذا الطلب</option>
                              <option value="next_order">الطلب الثاني (بعد طلب مُسلَّم)</option>
                            </select>
                          </div>
                        )}
                        {p.type === 'gift' && <div><label className={lbl}>منتج الهدية (اختياري — للمخزون)</label><input className={field} value={p.productId || ''} onChange={(e) => setSlot(i, { productId: e.target.value.trim() || null })} dir="ltr" placeholder="product id" /></div>}
                      </>
                    )}
                    <div><label className={lbl}>رمز (إيموجي)</label><input className={field} value={p.icon || ''} maxLength={8} onChange={(e) => setSlot(i, { icon: e.target.value })} /></div>
                    <div><label className={lbl}>اللون</label><input type="color" className="h-9 w-full rounded-xl border border-slate-200" value={p.color || '#E5EBF3'} onChange={(e) => setSlot(i, { color: e.target.value })} /></div>
                    <div><label className={lbl}>من تاريخ</label><input type="datetime-local" className={field} value={toLocal(p.startsAt)} onChange={(e) => setSlot(i, { startsAt: fromLocal(e.target.value) })} /></div>
                    <div><label className={lbl}>إلى تاريخ</label><input type="datetime-local" className={field} value={toLocal(p.endsAt)} onChange={(e) => setSlot(i, { endsAt: fromLocal(e.target.value) })} /></div>
                    <div className="col-span-2"><label className={lbl}>الوصف</label><input className={field} value={p.description || ''} maxLength={200} onChange={(e) => setSlot(i, { description: e.target.value })} /></div>
                    <div className="col-span-2"><label className={lbl}>رابط صورة (https، اختياري)</label><input className={field} value={p.imageUrl || ''} onChange={(e) => setSlot(i, { imageUrl: e.target.value.trim() })} dir="ltr" /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {check && (check.errors.length > 0 || check.warnings.length > 0) && (
            <section className="space-y-2" data-testid="wheel-admin-check">
              {check.errors.length > 0 && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
                  <p className="font-black">لن يُقبل الحفظ قبل تصحيح:</p>
                  <ul className="mt-1 list-disc ps-5">{check.errors.map((e: string, k: number) => <li key={k}>{e}</li>)}</ul>
                </div>
              )}
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-bold text-sky-900" data-testid="wheel-admin-tiers">
                <p className="font-black">الاحتمالات حسب ولاء الزبون</p>
                <p className="mt-1 text-xs leading-relaxed">تُحسب الفئة على الخادم من الطلبات <b>المُسلَّمة</b> منذ أول طلب (الملغاة والمرتجعة لا تُحسب): {TIERS.map((t) => TIER_AR[t]).join('، ')}. اللفة بدون تسجيل دخول تستخدم أوزان «جديد» دائمًا، ونتيجتها لا تتغير بعد تسجيل الدخول.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={suggest} className="rounded-xl border border-sky-300 bg-white px-3 py-1.5 text-xs font-black text-sky-900" data-testid="wheel-admin-suggest">تعبئة أوزان مقترحة للمراجعة</button>
                  <span className="text-[11px] font-bold">اقتراح غير نهائي ولا يُحفظ تلقائيًا: الكميات والميزانية ما زالت 0، وتُعتمد النسب بعد مراجعة التكاليف.</span>
                </div>
              </div>
              {check.warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900" data-testid="wheel-admin-warnings">
                  <p className="font-black">تنبيهات مالية / شروط (لا تمنع الحفظ):</p>
                  <ul className="mt-1 list-disc ps-5">{check.warnings.map((w: string, k: number) => <li key={k}>{w}</li>)}</ul>
                </div>
              )}
            </section>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={saving || !!check?.errors.length} className="rounded-2xl bg-ink-900 px-6 py-3 font-black text-white disabled:opacity-50" data-testid="wheel-admin-save">{saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button>
            <button type="button" onClick={() => { void load(); setSaveMsg(null); }} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">إعادة التحميل (تجاهل التعديلات)</button>
          </div>
          {saveMsg && (
            <div className={`rounded-2xl border p-4 text-sm font-bold ${saveMsg.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`} role="status" data-testid="wheel-admin-save-result" data-tone={saveMsg.tone}>
              {saveMsg.text}
              {saveMsg.list && saveMsg.list.length > 0 && <ul className="mt-1 list-disc ps-5">{saveMsg.list.map((x, k) => <li key={k}>{x}</li>)}</ul>}
            </div>
          )}
        </>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-black text-slate-900">سجل اللفات والجوائز</h3>
          <div className="flex flex-wrap gap-1.5">
            {['', 'issued', 'reserved', 'consumed', 'expired', 'none'].map((s) => (
              <button key={s || 'all'} type="button" onClick={() => { setFilter(s); void loadSpins(s); }} className={`rounded-full px-3 py-1 text-xs font-black ${filter === s ? 'bg-ink-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                {s ? STATUS_AR[s] : 'الكل'}{s && counts[s] !== undefined ? ` (${counts[s]})` : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-right text-xs" data-testid="wheel-admin-spins">
            <thead><tr className="text-slate-500"><th className="p-2">التاريخ</th><th className="p-2">الحساب</th><th className="p-2">النتيجة</th><th className="p-2">الفئة</th><th className="p-2">الحالة</th><th className="p-2">رقم الطلب</th><th className="p-2">الصلاحية</th></tr></thead>
            <tbody>
              {spins.map((s) => (
                <tr key={s.spinId} className="border-t border-slate-100" data-testid="wheel-admin-spin-row" data-status={s.status}>
                  <td className="p-2 whitespace-nowrap">{s.createdAt ? new Date(s.createdAt).toLocaleString('ar-JO') : ''}</td>
                  <td className="p-2"><span className="font-bold">{s.email || '—'}</span><br /><span className="text-[10px] text-slate-400" dir="ltr">{s.uid}</span></td>
                  <td className="p-2 font-bold">{s.label}</td>
                  <td className="p-2 whitespace-nowrap" data-testid="wheel-admin-spin-tier">{s.tier ? TIER_SHORT_AR[s.tier as Tier] ?? s.tier : '—'}{typeof s.deliveredCount === 'number' ? ` (${s.deliveredCount >= 3 ? '3+' : s.deliveredCount})` : ''}</td>
                  <td className="p-2">{STATUS_AR[s.status] || s.status}</td>
                  <td className="p-2 font-mono" dir="ltr">{s.orderId || '—'}</td>
                  <td className="p-2 whitespace-nowrap">{s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('ar-JO') : '—'}</td>
                </tr>
              ))}
              {!spins.length && <tr><td className="p-3 text-slate-500" colSpan={6}>لا توجد لفات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
