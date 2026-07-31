import React, { useState, useEffect, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  ReferenceArea, BarChart, Bar,
} from "recharts";

/* ============================================================
   منظومة المقياس v2 — نموذج أولي مطوّر
   شركة الأمد التقنية
   الجديد في v2:
   1) المعرّف الموحّد AMD-XXXXX عبر QR + حقل مقفل (Jotform prefill)
   2) بيانات ميدانية حقيقية (نبض الأمد BLS — يوليو 2026)
   3) تقرير الأثر بعنوانه الصحيح: رفع الأضعف وضغط التشتّت
   4) تعدد الجهات (white-label): كل جهة بهويتها ولونها وشعارها
   ============================================================ */

const BASE = {
  ink: "#0B0E14", surface: "#131A26", surface2: "#1B2434", line: "#26324A",
  teal: "#35C6E6", gain: "#5FD08A", text: "#ECEAE3", muted: "#8A96AB", dim: "#5A6478",
};

/* — الجهات (تعدد المستأجرين): كل جهة تملك حسابها وهويتها — */
const TENANTS = [
  { slug: "uqu-med", name: "كلية الطب — جامعة أم القرى", short: "ط", accent: "#C9A24B",
    program: "نبض الأمد — دورة الإنعاش القلبي الرئوي الأساسي (BLS Provider)" },
  { slug: "demo-academy", name: "أكاديمية الإتقان للتدريب — عرض", short: "إ", accent: "#9B7BEF",
    program: "برنامج الاستجابة للطوارئ الصناعية — عرض توضيحي" },
];

const TRAINEE = { name: "نورة سعد القحطاني", role: "ممرضة متدرّبة", code: "AMD-7K9FQ", date: "13 / 07 / 2026" };

/* بيانات فردية (متدرّبة العرض) */
const IND = { preKnow: 7, postKnow: 9, total: 10, preEff: 2.0, postEff: 4.7, pass: 80 };

/* بيانات الدفعة الحقيقية — مسحوبة فعلياً من Jotform API (يوليو 2026) */
const COHORT = {
  label: "بيانات ميدانية حقيقية — دفعة نبض الأمد، يوليو 2026",
  nPre: 12, nPost: 7,
  avgPre: 8.92, avgPost: 9.43,
  minPre: 5, minPost: 8,
  sdPre: 1.62, sdPost: 0.79,
};

const EFF_ITEMS = [
  { label: "الثقة في أداء ضغطات صحيحة العمق والمعدّل", pre: 2, post: 5 },
  { label: "الثقة في استخدام جهاز AED دون تردّد", pre: 1, post: 4 },
  { label: "الثقة في إدارة حالة توقّف قلبي حقيقية", pre: 3, post: 5 },
];

const XAPI = [
  { verb: "بدأ", object: "التجربة الغامرة", result: "—" },
  { verb: "تحقّق", object: "استجابة المصاب", result: "خلال 3 ثوانٍ" },
  { verb: "فعّل", object: "منظومة الطوارئ", result: "طلب المساعدة + AED" },
  { verb: "بدأ", object: "ضغطات الصدر", result: "الموضع صحيح" },
  { verb: "ضبط", object: "عمق الضغط", result: "5.2 سم — ضمن النطاق" },
  { verb: "ضبط", object: "معدّل الضغط", result: "112 — ضمن النطاق" },
  { verb: "استخدم", object: "جهاز AED", result: "توصيل صحيح" },
  { verb: "طبّق", object: "الصدمة الكهربائية", result: "بعد إخلاء المحيط" },
  { verb: "أكمل", object: "دورة إنعاش كاملة", result: "دقة 89%" },
];

const STAGES = [
  { label: "القياس القبلي", sub: "مسح QR رقم 1 — التقاط خط الأساس" },
  { label: "الأداء اللحظي", sub: "مسح QR رقم 2 — قياس أثناء التجربة" },
  { label: "القياس البعدي", sub: "مسح QR رقم 3 — التقاط ما بعد التجربة" },
  { label: "تقرير الأثر", sub: "حساب الفرق وربط المصادر الثلاثة" },
  { label: "الشهادة", sub: "إصدار الإثبات القابل للتحقّق" },
];

function Num({ children, size = 15, color = BASE.text, weight = 600 }) {
  return <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: size, color, fontWeight: weight, letterSpacing: "0.02em" }}>{children}</span>;
}

function Ring({ pct, color, size = 112, label }) {
  const r = size / 2 - 9, circ = 2 * Math.PI * r, off = circ * (1 - pct / 100);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={BASE.line} strokeWidth="7" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="7" fill="none"
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <Num size={25} color={color}>{pct}%</Num>
        {label && <span style={{ fontSize: 11, color: BASE.muted }}>{label}</span>}
      </div>
    </div>
  );
}

/* — محاكاة الحقل المقفل (Jotform prefill عبر QR) — */
function LockedIdField({ accent }) {
  const [scanned, setScanned] = useState(false);
  return (
    <div style={{ background: BASE.surface2, border: `1px dashed ${accent}66`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: BASE.text, fontWeight: 600 }}>كيف يدخل المعرّف؟ لا كتابة — مسح</span>
        {!scanned && (
          <button onClick={() => setScanned(true)} style={{
            fontFamily: "inherit", cursor: "pointer", background: accent, color: BASE.ink,
            border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600,
          }}>محاكاة مسح QR</button>
        )}
      </div>
      <div style={{ fontSize: 12, color: BASE.dim, marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace", direction: "ltr", textAlign: "left", overflowWrap: "anywhere" }}>
        form.jotform.com/261781032160044<span style={{ color: scanned ? accent : BASE.dim }}>?traineeId={scanned ? TRAINEE.code : "…"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, background: BASE.ink, border: `1px solid ${scanned ? accent : BASE.line}`, borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "border-color .4s" }}>
          <span style={{ fontSize: 12, color: BASE.dim }}>معرّف المتدرّب</span>
          <Num size={15} color={scanned ? accent : BASE.dim}>{scanned ? TRAINEE.code : "— — — — —"}</Num>
        </div>
        <span title="حقل مقفل — يُملأ من الرابط فقط" style={{ fontSize: 18, color: scanned ? accent : BASE.dim }}>🔒</span>
      </div>
      {scanned && (
        <div className="fade" style={{ fontSize: 12, color: BASE.muted, marginTop: 10, lineHeight: 1.8 }}>
          مُلئ الحقل من الرابط وقُفل للقراءة فقط. المتدرّب يجيب عن الأسئلة فقط —
          فيصل المعرّف <Num size={12} color={accent}>{TRAINEE.code}</Num> متطابقاً حرفياً في المصادر الثلاثة.
        </div>
      )}
    </div>
  );
}

function StagePre({ accent }) {
  const prePct = Math.round(IND.preKnow / IND.total * 100);
  return (
    <div className="fade">
      <Head n="1" title="القياس القبلي" note="يمسح المتدرّب بطاقته، فيُفتح النموذج ومعرّفه مملوء ومقفل — ثم يُلتقط خط الأساس المعرفي والثقة الذاتية." />
      <LockedIdField accent={accent} />
      <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, marginTop: 14 }}>
        <Panel title="المعرفة المعرفية — خط الأساس" accent={BASE.teal}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Ring pct={prePct} color={BASE.dim} label={`${IND.preKnow} من ${IND.total}`} />
            <div style={{ fontSize: 13, color: BASE.muted, lineHeight: 1.9 }}>
              أجابت المتدرّبة عن <Num color={BASE.text}>{IND.preKnow}</Num> من <Num color={BASE.text}>{IND.total}</Num> أسئلة —
              دون حدّ الاجتياز (<Num color={accent}>{IND.pass}%</Num>).
            </div>
          </div>
        </Panel>
        <Panel title="الثقة الذاتية (1–5)" accent={BASE.teal}>
          {EFF_ITEMS.map((e, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, color: BASE.text, marginBottom: 5 }}>{e.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ flex: 1, height: 7, background: BASE.surface2, borderRadius: 5 }}>
                  <div style={{ width: `${e.pre / 5 * 100}%`, height: "100%", background: BASE.dim, borderRadius: 5 }} />
                </div>
                <Num size={12} color={BASE.dim}>{e.pre}.0</Num>
              </div>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${BASE.line}`, paddingTop: 9, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: BASE.muted }}>المتوسط القبلي</span>
            <Num size={15} color={BASE.dim}>{IND.preEff.toFixed(1)} / 5</Num>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function StageLive({ accent }) {
  const [series, setSeries] = useState([{ t: 0, rate: 60 }]);
  const [events, setEvents] = useState([]);
  const [rate, setRate] = useState(60);
  const [depth, setDepth] = useState(3.1);
  const [acc, setAcc] = useState(0);
  const tick = useRef(0), evIdx = useRef(0);

  useEffect(() => {
    const iv = setInterval(() => {
      tick.current += 1;
      setRate((p) => Math.round((p + (112 - p) * 0.28 + (Math.random() * 6 - 3)) * 10) / 10);
      setDepth((p) => Math.round((p + (5.2 - p) * 0.25 + (Math.random() * 0.2 - 0.1)) * 10) / 10);
      setAcc((p) => Math.min(89, p + 5 + Math.random() * 4));
      setSeries((s) => {
        const last = s[s.length - 1].rate;
        return [...s, { t: tick.current, rate: Math.round(last + (112 - last) * 0.28 + (Math.random() * 6 - 3)) }].slice(-24);
      });
      if (tick.current % 2 === 0 && evIdx.current < XAPI.length) {
        const e = XAPI[evIdx.current]; evIdx.current += 1;
        const s = 8 + tick.current * 4;
        setEvents((prev) => [{ ...e, ts: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` }, ...prev].slice(0, 6));
      }
    }, 850);
    return () => clearInterval(iv);
  }, []);

  const inBand = rate >= 100 && rate <= 120;
  return (
    <div className="fade">
      <Head n="2" title="الأداء اللحظي" live note={<>
        عند محطة التجربة يُمسح نفس الـ QR، فتُبثّ كل حركة كأحداث xAPI باسم الفاعل
        {" "}<Num size={13} color={accent}>{TRAINEE.code}</Num> — نفس النص حرفياً. هذا ما لا تلتقطه أي ورقة.
      </>} />
      <div className="grid3" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <Gauge label="معدّل الضغط" unit="ضغطة/دقيقة" value={rate.toFixed(0)} ok={inBand} band="النطاق 100–120" />
        <Gauge label="عمق الضغط" unit="سم" value={depth.toFixed(1)} ok={depth >= 5 && depth <= 6} band="النطاق 5.0–6.0" />
        <Gauge label="دقة القرارات" unit="%" value={acc.toFixed(0)} ok={acc >= 80} band="حد الكفاءة ≥ 80%" />
      </div>
      <Panel title="معدّل الضغط لحظياً" accent={BASE.teal} style={{ marginTop: 12 }}>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
              <ReferenceArea y1={100} y2={120} fill={BASE.teal} fillOpacity={0.08} />
              <XAxis dataKey="t" hide />
              <YAxis domain={[40, 140]} tick={{ fill: BASE.dim, fontSize: 11, fontFamily: "IBM Plex Mono" }} width={28} axisLine={false} tickLine={false} />
              <Line type="monotone" dataKey="rate" stroke={BASE.teal} strokeWidth={2.4} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title={`سجلّ أحداث xAPI — الفاعل: ${TRAINEE.code}`} accent={BASE.teal} style={{ marginTop: 12 }}>
        <div style={{ minHeight: 180 }}>
          {events.length === 0 && <div style={{ color: BASE.dim, fontSize: 13, padding: "18px 0", textAlign: "center" }}>بانتظار أول حدث…</div>}
          {events.map((e, i) => (
            <div key={i} className="evRow" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", borderBottom: `1px solid ${BASE.line}`, opacity: i === 0 ? 1 : Math.max(0.25, 0.6 - i * 0.06) }}>
              <Num size={11} color={BASE.dim}>{e.ts}</Num>
              <span style={{ fontSize: 12, color: BASE.teal, minWidth: 44 }}>{e.verb}</span>
              <span style={{ fontSize: 13, color: BASE.text, flex: 1 }}>{e.object}</span>
              <span style={{ fontSize: 11.5, color: BASE.muted }}>{e.result}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Gauge({ label, unit, value, ok, band }) {
  const col = ok ? BASE.gain : BASE.teal;
  return (
    <div style={{ background: BASE.surface, border: `1px solid ${BASE.line}`, borderRadius: 14, padding: "14px 16px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: BASE.muted }}>{label}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: col }}>
          <span className="pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: col }} />
          {ok ? "ضمن النطاق" : "قيد الضبط"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "6px 0 2px" }}>
        <Num size={34} color={col}>{value}</Num>
        <span style={{ fontSize: 12, color: BASE.dim }}>{unit}</span>
      </div>
      <span style={{ fontSize: 11, color: BASE.dim }}>{band}</span>
    </div>
  );
}

function StagePost({ accent }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGo(true), 120); return () => clearTimeout(t); }, []);
  const postPct = Math.round(IND.postKnow / IND.total * 100);
  return (
    <div className="fade">
      <Head n="3" title="القياس البعدي" note="مسح ثالث لنفس البطاقة — نفس البنود ونفس المعرّف المقفل، لتكون المقارنة عادلة والربط آلياً." />
      <div className="grid2" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        <Panel title="المعرفة المعرفية" accent={accent}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Ring pct={go ? postPct : 0} color={accent} label={`${IND.postKnow} من ${IND.total}`} />
            <div style={{ fontSize: 13, color: BASE.muted, lineHeight: 1.9 }}>
              أصبحت الإجابات الصحيحة <Num color={accent}>{IND.postKnow}</Num> من <Num color={BASE.text}>{IND.total}</Num> —
              متجاوزةً حدّ الاجتياز (<Num color={accent}>{IND.pass}%</Num>).
            </div>
          </div>
        </Panel>
        <Panel title="الثقة الذاتية (1–5)" accent={accent}>
          {EFF_ITEMS.map((e, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, color: BASE.text, marginBottom: 6 }}>{e.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: BASE.dim, width: 32 }}>قبلي</span>
                <div style={{ flex: 1, height: 7, background: BASE.surface2, borderRadius: 5 }}>
                  <div style={{ width: `${e.pre / 5 * 100}%`, height: "100%", background: BASE.dim, borderRadius: 5 }} />
                </div>
                <Num size={11} color={BASE.dim}>{e.pre}.0</Num>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 11, color: accent, width: 32 }}>بعدي</span>
                <div style={{ flex: 1, height: 7, background: BASE.surface2, borderRadius: 5 }}>
                  <div style={{ width: go ? `${e.post / 5 * 100}%` : "0%", height: "100%", background: accent, borderRadius: 5, transition: "width 1s ease .3s" }} />
                </div>
                <Num size={11} color={accent}>{e.post}.0</Num>
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

/* — v2: تقرير الأثر بمحوريه: الفرد + الدفعة (بيانات حقيقية) — */
function StageReport({ accent }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGo(true), 160); return () => clearTimeout(t); }, []);
  const prePct = IND.preKnow / IND.total * 100, postPct = IND.postKnow / IND.total * 100;
  const sdDrop = Math.round((1 - COHORT.sdPost / COHORT.sdPre) * 100);
  const barData = [
    { name: "أدنى درجة", قبلي: COHORT.minPre, بعدي: COHORT.minPost },
    { name: "المتوسط", قبلي: COHORT.avgPre, بعدي: COHORT.avgPost },
  ];
  return (
    <div className="fade">
      <Head n="4" title="تقرير الأثر" note="المصادر الثلاثة مربوطة آلياً بالمعرّف الموحّد. والقصة الأهم ليست المتوسط — بل رفع الأضعف وضغط التشتّت." />

      <Panel title="أثر الدفعة — رفع الأضعف وضغط التشتّت" accent={accent} badge={COHORT.label}>
        <div className="grid3" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 14 }}>
          <Stat label="أدنى درجة في الدفعة" val={`${COHORT.minPre} ← ${COHORT.minPost}`} unit="من 10" note="لم يخرج أحد ضعيفاً" color={BASE.gain} />
          <Stat label="التشتّت (انحراف معياري)" val={`−${sdDrop}%`} unit={`${COHORT.sdPre} ← ${COHORT.sdPost}`} note="تقارب الأداء حول الإتقان" color={BASE.gain} />
          <Stat label="المتوسط" val={`${COHORT.avgPre} ← ${COHORT.avgPost}`} unit="من 10" note="مؤشر ثانوي — أثر السقف" color={BASE.muted} />
        </div>
        <div style={{ height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 10, right: 6, left: 6, bottom: 0 }} barGap={6}>
              <XAxis dataKey="name" tick={{ fill: BASE.muted, fontSize: 13 }} axisLine={{ stroke: BASE.line }} tickLine={false} />
              <YAxis domain={[0, 10]} tick={{ fill: BASE.dim, fontSize: 11, fontFamily: "IBM Plex Mono" }} width={26} axisLine={false} tickLine={false} />
              <Bar dataKey="قبلي" fill={BASE.dim} radius={[4, 4, 0, 0]} isAnimationActive={go} />
              <Bar dataKey="بعدي" fill={accent} radius={[4, 4, 0, 0]} isAnimationActive={go} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 12.5, color: BASE.muted, lineHeight: 1.9, marginTop: 8, padding: "10px 14px", background: `${accent}0D`, border: `1px solid ${accent}33`, borderRadius: 10 }}>
          الدفعة دخلت بمعرفة نظرية عالية أصلاً (89%) — لذا لا يُقاس الأثر بالمتوسط، بل بأن
          الأضعف قفز من <Num size={12} color={BASE.gain}>50%</Num> إلى <Num size={12} color={BASE.gain}>80%</Num>
          وانكمش التشتّت إلى النصف. المنظومة تضمن ألّا يخرج متدرّب ضعيفاً.
        </div>
      </Panel>

      <Panel title={`رحلة المتدرّبة — ${TRAINEE.code}`} accent={accent} style={{ marginTop: 14 }}>
        <div className="grid3" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <Stat label="نمو المعرفة" val={`+${Math.round(postPct - prePct)}`} unit="نقطة مئوية" note={`${Math.round(prePct)}% ← ${Math.round(postPct)}%`} color={BASE.gain} />
          <Stat label="نمو الثقة الذاتية" val={`+${(IND.postEff - IND.preEff).toFixed(1)}`} unit="من 5" note={`${IND.preEff.toFixed(1)} ← ${IND.postEff.toFixed(1)}`} color={BASE.gain} />
          <Stat label="الأداء اللحظي" val="89%" unit="دقة القرارات" note="9 أحداث xAPI موثّقة" color={BASE.teal} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "12px 14px", background: `${BASE.gain}0D`, border: `1px solid ${BASE.gain}44`, borderRadius: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", border: `2px solid ${BASE.gain}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 6.5" stroke={BASE.gain} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <div style={{ fontSize: 16, color: BASE.gain, fontWeight: 700 }}>مجتازة</div>
            <div style={{ fontSize: 12.5, color: BASE.muted }}>معرفة ≥ 80% + معايير الأداء اللحظي متحققة — تُصدر الشهادة تلقائياً.</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, val, unit, note, color }) {
  return (
    <div style={{ background: BASE.surface2, border: `1px solid ${BASE.line}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12.5, color: BASE.muted, marginBottom: 7 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <Num size={24} color={color}>{val}</Num>
        <span style={{ fontSize: 11, color: BASE.dim }}>{unit}</span>
      </div>
      <div style={{ fontSize: 11.5, color: BASE.dim, marginTop: 6 }}>{note}</div>
    </div>
  );
}

function StageCert({ tenant }) {
  const accent = tenant.accent;
  return (
    <div className="fade">
      <Head n="5" title="الشهادة" note="إثبات معتمد بهوية الجهة، قابل للتحقّق عبر QR يقود إلى صفحة تحقق عامة — لا ورقة حضور." />
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 560, background: `linear-gradient(160deg, ${BASE.surface2}, ${BASE.surface})`, border: `1px solid ${accent}55`, borderRadius: 18, padding: "28px 26px", boxShadow: `0 0 40px ${accent}18` }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ width: 34, height: 34, borderRadius: 9, background: accent, color: BASE.ink, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }}>{tenant.short}</span>
              <span style={{ fontSize: 13, color: BASE.text, fontWeight: 600 }}>{tenant.name}</span>
            </div>
            <div style={{ fontSize: 11, color: accent, letterSpacing: "0.18em" }}>تُشغَّل بمنظومة المقياس · شركة الأمد التقنية</div>
            <div style={{ width: 40, height: 2, background: accent, margin: "14px auto", opacity: 0.6 }} />
            <div style={{ fontSize: 14, color: BASE.muted }}>شهادة إتقان معتمدة</div>
            <div style={{ fontSize: 25, color: BASE.text, fontWeight: 700, margin: "10px 0 4px" }}>{TRAINEE.name}</div>
            <div style={{ fontSize: 13, color: BASE.muted }}>{TRAINEE.role}</div>
            <div style={{ fontSize: 13.5, color: BASE.text, lineHeight: 2, margin: "14px auto", maxWidth: 430 }}>
              أتمّت بنجاح متطلبات <b style={{ color: accent }}>{tenant.program}</b>،
              بقياس قبلي وبعدي موثّق وأداء لحظي مطابق للمعايير المعتمدة.
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 24, margin: "4px 0 18px", flexWrap: "wrap" }}>
              <CertM k="المعرفة" v="90%" />
              <CertM k="الثقة" v="4.7/5" />
              <CertM k="الأداء اللحظي" v="89%" />
              <CertM k="التصنيف" v="مجتازة" c={BASE.gain} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${BASE.line}`, paddingTop: 16, flexWrap: "wrap", gap: 14 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: BASE.dim, marginBottom: 3 }}>معرّف التحقّق</div>
                <Num size={13} color={BASE.text}>AMD-BLS-2026-0417</Num>
                <div style={{ fontSize: 11, color: BASE.dim, margin: "7px 0 3px" }}>صفحة التحقّق</div>
                <div style={{ fontSize: 11.5, color: BASE.muted, direction: "ltr" }}>miqyas.al-amad.com.sa/verify/…</div>
              </div>
              <FakeQR seed={TRAINEE.code} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CertM({ k, v, c = BASE.text }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: BASE.muted, marginBottom: 4 }}>{k}</div>
      <Num size={17} color={c}>{v}</Num>
    </div>
  );
}

function FakeQR({ seed }) {
  const n = 11;
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  const cells = [];
  for (let i = 0; i < n * n; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; cells.push((h >> 6) % 100 < 48); }
  const finder = (r, c) => (r < 3 && c < 3) || (r < 3 && c > n - 4) || (r > n - 4 && c < 3);
  return (
    <div style={{ padding: 8, background: "#fff", borderRadius: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 6px)`, gridAutoRows: 6 }}>
        {cells.map((on, i) => {
          const r = Math.floor(i / n), c = i % n;
          return <div key={i} style={{ width: 6, height: 6, background: finder(r, c) ? (r % 2 === c % 2 ? BASE.ink : "#fff") : (on ? BASE.ink : "#fff") }} />;
        })}
      </div>
    </div>
  );
}

function Head({ n, title, note, live }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: BASE.muted, border: `1px solid ${BASE.line}`, borderRadius: 8, padding: "3px 9px" }}>محطة {n}/5</span>
        <h2 style={{ margin: 0, fontSize: 22, color: BASE.text, fontWeight: 700 }}>{title}</h2>
        {live && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: BASE.teal, marginInlineStart: "auto" }}>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: BASE.teal }} /> بثّ مباشر
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13.5, color: BASE.muted, lineHeight: 1.9, maxWidth: 720 }}>{note}</p>
    </div>
  );
}

function Panel({ title, accent, children, style, badge }) {
  return (
    <div style={{ background: BASE.surface, border: `1px solid ${BASE.line}`, borderRadius: 14, padding: 16, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ width: 3, height: 15, background: accent, borderRadius: 2 }} />
        <span style={{ fontSize: 14, color: BASE.text, fontWeight: 600 }}>{title}</span>
        {badge && <span style={{ fontSize: 10.5, color: BASE.gain, border: `1px solid ${BASE.gain}55`, borderRadius: 6, padding: "2px 8px", marginInlineStart: "auto" }}>{badge}</span>}
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const [stage, setStage] = useState(0);
  const [ti, setTi] = useState(0);
  const tenant = TENANTS[ti];
  const accent = tenant.accent;
  const Body = [StagePre, StageLive, StagePost, StageReport, StageCert][stage];

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: BASE.ink, color: BASE.text, fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        .fade { animation: fade .5s ease; }
        @keyframes fade { from { opacity: 0; transform: translateY(8px);} to { opacity: 1; transform: none; } }
        .pulse { animation: pulse 1.4s ease infinite; }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.3;} }
        .evRow { animation: slideIn .4s ease; }
        @keyframes slideIn { from { opacity:0; transform: translateX(-10px);} to {opacity:1; transform:none;} }
        .navBtn { font-family: inherit; cursor: pointer; border-radius: 10px; padding: 11px 22px; font-size: 14.5px; font-weight: 600; border: none; transition: opacity .2s, transform .1s; }
        .navBtn:active { transform: scale(.98); }
        .navBtn:disabled { opacity: .3; cursor: not-allowed; }
        .step { cursor: pointer; }
        .tBtn { font-family: inherit; cursor: pointer; border-radius: 8px; padding: 6px 12px; font-size: 12px; border: 1px solid; background: transparent; }
        @media (min-width: 720px) {
          .grid2 { grid-template-columns: 1fr 1fr !important; }
          .grid3 { grid-template-columns: 1fr 1fr 1fr !important; }
        }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: ${BASE.line}; border-radius: 3px; }
      `}</style>

      <header style={{ borderBottom: `1px solid ${BASE.line}`, background: `${BASE.surface}CC`, backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: accent, color: BASE.ink, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, transition: "background .4s" }}>{tenant.short}</span>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>منظومة المقياس</h1>
                  <span style={{ fontSize: 10.5, color: BASE.dim, border: `1px solid ${BASE.line}`, borderRadius: 6, padding: "2px 6px" }}>v2</span>
                </div>
                <div style={{ fontSize: 12, color: BASE.muted, marginTop: 2 }}>{tenant.name}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {TENANTS.map((t, i) => (
                <button key={t.slug} className="tBtn" onClick={() => setTi(i)}
                  style={{ borderColor: i === ti ? t.accent : BASE.line, color: i === ti ? t.accent : BASE.dim }}>
                  {t.short} · {i === ti ? "الجهة الحالية" : "تبديل"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: 12, color: BASE.muted }}>{TRAINEE.name} · {TRAINEE.role}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: BASE.surface2, border: `1px solid ${accent}44`, borderRadius: 8, padding: "4px 10px" }}>
              <span style={{ fontSize: 11, color: BASE.dim }}>المعرّف الموحّد</span>
              <Num size={13} color={accent}>{TRAINEE.code}</Num>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 12, overflowX: "auto", paddingBottom: 2 }}>
            {STAGES.map((s, i) => {
              const active = i === stage, done = i < stage;
              return (
                <div key={i} className="step" onClick={() => setStage(i)} style={{ flex: "1 0 auto", minWidth: 92 }}>
                  <div style={{ height: 3, borderRadius: 2, background: active ? accent : done ? accent + "88" : BASE.line, marginBottom: 6, transition: "background .3s" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Num size={11} color={active ? accent : done ? BASE.muted : BASE.dim}>{`0${i + 1}`}</Num>
                    <span style={{ fontSize: 12.5, color: active ? BASE.text : BASE.dim, fontWeight: active ? 600 : 400, whiteSpace: "nowrap" }}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 18px 40px" }}>
        <Body accent={accent} tenant={tenant} />
      </main>

      <footer style={{ position: "sticky", bottom: 0, borderTop: `1px solid ${BASE.line}`, background: `${BASE.surface}EE`, backdropFilter: "blur(8px)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="navBtn" disabled={stage === 0} onClick={() => setStage((s) => Math.max(0, s - 1))} style={{ background: BASE.surface2, color: BASE.text, border: `1px solid ${BASE.line}` }}>السابق</button>
          <span style={{ fontSize: 12, color: BASE.muted, textAlign: "center" }}>{STAGES[stage].sub}</span>
          {stage < 4 ? (
            <button className="navBtn" onClick={() => setStage((s) => Math.min(4, s + 1))} style={{ background: accent, color: BASE.ink }}>التالي ←</button>
          ) : (
            <button className="navBtn" onClick={() => setStage(0)} style={{ background: BASE.surface2, color: accent, border: `1px solid ${accent}55` }}>إعادة العرض</button>
          )}
        </div>
      </footer>
    </div>
  );
}
