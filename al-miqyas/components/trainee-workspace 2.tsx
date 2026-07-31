"use client";

import { useMemo, useState } from "react";
import {
  getScenarioStages,
  liveEvents,
  scenarioLabels,
  trainee,
  type JourneyStage,
  type ScenarioKey,
  type StageStatus,
} from "../lib/demo-data";
import { Icon } from "./icons";

const navigation = [
  ["overview", "الملخص"],
  ["programs", "البرامج والدفعات"],
  ["trainees", "المتدرّبون"],
  ["sessions", "الجلسات الحية"],
  ["reports", "التقارير"],
  ["certificates", "الشهادات"],
  ["settings", "الإعدادات"],
] as const;

const stageTone: Record<StageStatus, string> = {
  validated: "success",
  received: "system",
  waiting: "warning",
  failed: "danger",
  review: "warning",
  blocked: "muted",
  eligible: "success",
};

function StatusMark({ status, label }: { status: StageStatus; label: string }) {
  return (
    <span className={`status-mark status-${stageTone[status]}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

function EvidenceHeader({ stage }: { stage: JourneyStage }) {
  return (
    <div className="evidence-header">
      <div className="evidence-source">
        <Icon name="source" size={18} />
        <div>
          <span>مصدر الدليل</span>
          <strong dir="auto">{stage.source}</strong>
        </div>
      </div>
      <div className="evidence-source">
        <Icon name="clock" size={18} />
        <div>
          <span>آخر تحديث</span>
          <strong>{stage.receivedAt}</strong>
        </div>
      </div>
      <StatusMark status={stage.status} label={stage.statusLabel} />
    </div>
  );
}

function Metric({ label, value, unit, tone = "primary", detail }: { label: string; value: string; unit?: string; tone?: string; detail: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div className={`metric-value metric-${tone}`}>
        <b>{value}</b>
        {unit && <small>{unit}</small>}
      </div>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function PreStage() {
  return (
    <div className="stage-grid two-columns">
      <section className="data-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">خط الأساس المعرفي</span>
            <h3>سبع إجابات صحيحة من عشر</h3>
          </div>
          <span className="score-number">70%</span>
        </div>
        <div className="score-track" aria-label="نتيجة القياس القبلي 70 بالمئة">
          <span style={{ width: "70%" }} />
          <i style={{ insetInlineStart: "80%" }}><em>حد الاجتياز 80%</em></i>
        </div>
        <p>هذه النتيجة خط أساس للمقارنة، ولا تمنع المتدرّبة من إكمال التجربة التدريبية.</p>
      </section>
      <section className="data-section quiet-section">
        <span className="section-kicker">الثقة الذاتية</span>
        <h3>متوسط قبلي منخفض</h3>
        <Metric label="متوسط البنود الثلاثة" value="2.0" unit="من 5" detail="تُعرض في التقرير ولا تدخل في الاجتياز" />
      </section>
    </div>
  );
}

function LiveStage({ status }: { status: StageStatus }) {
  if (status === "waiting" || status === "failed") {
    return (
      <div className={`state-panel ${status === "failed" ? "state-danger" : "state-warning"}`}>
        <div className="state-symbol" aria-hidden="true">{status === "failed" ? "!" : "…"}</div>
        <div>
          <h3>{status === "failed" ? "رُفضت جلسة الأداء اللحظي" : "بانتظار جلسة الأداء اللحظي"}</h3>
          <p>{status === "failed" ? "actor.account.name لا يطابق AMD-7K9FQ. حُفظت البيانات الخام للمراجعة ولم تُربط بالمتدرّبة." : "لم تصل جلسة xAPI مطابقة حتى الآن. سنعرض القياسات الأخرى دون ادعاء اكتمال تقرير الأثر."}</p>
          <button type="button" className="secondary-button">{status === "failed" ? "فتح سجل الرفض" : "فحص آخر استقبال"}</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="metrics-row">
        <Metric label="دقة القرارات" value="89%" tone="system" detail="تسعة أحداث موثقة" />
        <Metric label="عمق الضغط" value="5.2" unit="سم" tone="success" detail="ضمن النطاق 5.0–6.0" />
        <Metric label="معدّل الضغط" value="112" unit="/دقيقة" tone="success" detail="ضمن النطاق 100–120" />
      </div>
      <section className="event-log" aria-label="سجل أحداث الأداء اللحظي">
        <div className="table-heading">
          <div>
            <span className="section-kicker">الجلسة XR-260713-04</span>
            <h3>تسلسل الأدلة المستلمة</h3>
          </div>
          <span className="demo-badge">بيانات تجريبية</span>
        </div>
        <div className="event-table" role="table">
          {liveEvents.map(([time, verb, object, result]) => (
            <div className="event-row" role="row" key={`${time}-${verb}`}>
              <span className="event-time" role="cell">{time}</span>
              <strong role="cell">{verb}</strong>
              <span role="cell">{object}</span>
              <span className="event-result" role="cell">{result}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function PostStage() {
  return (
    <div className="stage-grid two-columns">
      <section className="data-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">النتيجة البعدية</span>
            <h3>تسع إجابات صحيحة من عشر</h3>
          </div>
          <span className="score-number score-success">90%</span>
        </div>
        <div className="score-track success-track" aria-label="نتيجة القياس البعدي 90 بالمئة">
          <span style={{ width: "90%" }} />
          <i style={{ insetInlineStart: "80%" }}><em>حد الاجتياز 80%</em></i>
        </div>
        <p>اجتازت المتدرّبة حد البرنامج بفارق عشر نقاط مئوية.</p>
      </section>
      <section className="comparison-section">
        <span className="section-kicker">المقارنة المباشرة</span>
        <div className="comparison-line"><span>قبلي</span><b>70%</b><i style={{ width: "70%" }} /></div>
        <div className="comparison-line comparison-after"><span>بعدي</span><b>90%</b><i style={{ width: "90%" }} /></div>
        <div className="delta-callout"><b>+20</b><span>نقطة مئوية في المعرفة</span></div>
      </section>
    </div>
  );
}

function ReportStage({ status }: { status: StageStatus }) {
  if (status !== "validated") {
    return (
      <div className="state-panel state-warning">
        <div className="state-symbol" aria-hidden="true">!</div>
        <div>
          <h3>التقرير الكامل غير جاهز</h3>
          <p>يمكن عرض المقارنة المعرفية، لكن لا يجوز تقديم التقرير بوصفه مكتملًا قبل حل حالة الأداء اللحظي.</p>
          <button type="button" className="secondary-button">عرض الأدلة الناقصة</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="metrics-row">
        <Metric label="نمو المعرفة" value="+20" unit="نقطة" tone="success" detail="70% ← 90%" />
        <Metric label="نمو الثقة" value="+2.7" unit="من 5" tone="success" detail="2.0 ← 4.7" />
        <Metric label="الأداء اللحظي" value="89%" tone="system" detail="تسعة أحداث موثقة" />
      </div>
      <div className="verdict-strip">
        <Icon name="shield" size={28} />
        <div><span>حكم الرحلة</span><strong>مجتازة معرفياً · الأدلة مكتملة</strong></div>
        <p>الاجتياز يعتمد على نتيجة البعدي. بقية المصادر توثق الأثر ولا تغيّر الحكم.</p>
      </div>
    </>
  );
}

function CertificateStage({ status }: { status: StageStatus }) {
  const available = status === "eligible";
  return (
    <div className="certificate-layout">
      <section className={`certificate-preview ${available ? "" : "certificate-disabled"}`}>
        <div className="certificate-topline">
          <span className="tenant-placeholder">شعار الجهة</span>
          <span>تُشغّل بمنظومة المقياس · شركة الأمد</span>
        </div>
        <div className="certificate-body">
          <span>شهادة إتقان معتمدة</span>
          <h3>{trainee.name}</h3>
          <p>أتمّت متطلبات برنامج {trainee.program} وفق معيار الاجتياز المعتمد.</p>
          <div className="certificate-number"><small>رقم الشهادة</small><b>{available ? "AMD-BLS-2026-00417" : "لم تُصدر"}</b></div>
        </div>
      </section>
      <aside className="issuance-panel">
        <span className="section-kicker">حالة الإصدار</span>
        <h3>{available ? "الشهادة مستحقة" : "الإصدار متوقف"}</h3>
        <p>{available ? "نتيجة البعدي 90%. سيُنشأ رمز تحقق عشوائي عند الإصدار الحقيقي." : "لا توجد شهادة قابلة للتحقق حتى تكتمل مراجعة الأدلة."}</p>
        <button type="button" className="primary-button" disabled={!available}>{available ? "معاينة الإصدار" : "غير متاحة الآن"}</button>
        <span className="honest-placeholder">رمز QR الحقيقي يُولد بعد ربط قاعدة البيانات</span>
      </aside>
    </div>
  );
}

function StageContent({ stage }: { stage: JourneyStage }) {
  if (stage.id === "pre") return <PreStage />;
  if (stage.id === "live") return <LiveStage status={stage.status} />;
  if (stage.id === "post") return <PostStage />;
  if (stage.id === "report") return <ReportStage status={stage.status} />;
  return <CertificateStage status={stage.status} />;
}

export function TraineeWorkspace({ traineeCode }: { traineeCode: string }) {
  const [scenario, setScenario] = useState<ScenarioKey>("complete");
  const [activeStageId, setActiveStageId] = useState<JourneyStage["id"]>("pre");
  const stages = useMemo(() => getScenarioStages(scenario), [scenario]);
  const activeStage = stages.find((stage) => stage.id === activeStageId) ?? stages[0];

  return (
    <div className="application-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-symbol"><span /><span /><span /></div>
          <div><strong>منظومة المقياس</strong><span>سجل الإتقان</span></div>
        </div>

        <div className="tenant-context">
          <span className="tenant-avatar">{trainee.tenantMark}</span>
          <div><small>الجهة الحالية</small><strong>{trainee.organization}</strong></div>
          <Icon name="chevron" size={16} />
        </div>

        <nav aria-label="التنقل الرئيسي">
          {navigation.map(([icon, label]) => (
            <button type="button" className={label === "المتدرّبون" ? "nav-item nav-active" : "nav-item"} key={label}>
              <Icon name={icon} size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="operator-card">
          <span className="operator-avatar">م</span>
          <div><strong>مشرف الجهة</strong><span>صلاحية Owner</span></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="mobile-brand">منظومة المقياس</div>
          <div className="breadcrumb"><span>المتدرّبون</span><Icon name="chevron" size={14} /><strong>{traineeCode}</strong></div>
          <div className="system-state"><span /> النظام يعمل</div>
        </header>

        <div className="workspace-content">
          <section className="trainee-heading">
            <div>
              <div className="heading-meta"><span className="demo-badge">نسخة بصرية · بيانات تجريبية</span><span>{trainee.cohort}</span></div>
              <h1>{trainee.name}</h1>
              <p>{trainee.role} · {trainee.program}</p>
            </div>
            <div className="trainee-code"><span>المعرّف الموحد</span><strong dir="ltr">{traineeCode}</strong></div>
          </section>

          <section className="scenario-control" aria-label="معاينة حالات رحلة المتدرب">
            <div><span>اختبار حالات الرحلة</span><small>أداة مؤقتة للنسخة البصرية</small></div>
            <div className="scenario-options">
              {(Object.keys(scenarioLabels) as ScenarioKey[]).map((key) => (
                <button type="button" key={key} aria-pressed={scenario === key} onClick={() => setScenario(key)}>{scenarioLabels[key]}</button>
              ))}
            </div>
          </section>

          <section className="journey" aria-labelledby="journey-title">
            <div className="journey-title-row">
              <div><span>رحلة الدليل</span><h2 id="journey-title">من خط الأساس إلى إثبات الإتقان</h2></div>
              <span className="journey-summary">{stages.filter((stage) => stage.status === "validated" || stage.status === "eligible").length} من 5 مكتملة</span>
            </div>

            <div className="stage-rail" role="tablist" aria-label="مراحل رحلة المتدرب">
              {stages.map((stage) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeStage.id === stage.id}
                  className={`stage-tab stage-${stageTone[stage.status]} ${activeStage.id === stage.id ? "stage-active" : ""}`}
                  key={stage.id}
                  onClick={() => setActiveStageId(stage.id)}
                >
                  <span className="stage-index">{stage.index}</span>
                  <span className="stage-copy"><strong>{stage.label}</strong><small>{stage.statusLabel}</small></span>
                  <span className="stage-node" />
                </button>
              ))}
            </div>

            <article className="stage-panel" role="tabpanel">
              <div className="stage-panel-title">
                <div><span>المحطة {activeStage.index} من 05</span><h2>{activeStage.label}</h2><p>{activeStage.note}</p></div>
              </div>
              <EvidenceHeader stage={activeStage} />
              <div className="stage-body"><StageContent stage={activeStage} /></div>
            </article>
          </section>
        </div>
      </main>
    </div>
  );
}
