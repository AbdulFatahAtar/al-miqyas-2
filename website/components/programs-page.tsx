"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppShell, StatusBadge } from "./app-shell";
import { AccessibleDialog } from "./accessible-dialog";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import styles from "./programs-page.module.css";

type ProgramVersion = {
  id: string;
  version_number: number;
  pass_threshold: number;
  status: "draft" | "published" | "retired";
  live_performance_config: {
    duration_minutes?: number;
    scenes?: Array<{ id: string; title: string; assessment: string }>;
  };
};

type ProgramRecord = {
  id: string;
  title_ar: string;
  title_en: string | null;
  slug: string;
  certificate_prefix: string;
  status: "draft" | "active" | "archived";
  program_versions: ProgramVersion[];
};

type CohortRecord = {
  id: string;
  program_id: string;
  program_version_id: string;
  code: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  status: "draft" | "open" | "in_progress" | "closed" | "archived";
};

type ProgramForm = {
  titleAr: string;
  titleEn: string;
  slug: string;
  certificatePrefix: string;
  passThreshold: string;
};

type CohortForm = {
  title: string;
  code: string;
  programId: string;
  startsOn: string;
  endsOn: string;
};

const initialProgramForm: ProgramForm = {
  titleAr: "",
  titleEn: "",
  slug: "",
  certificatePrefix: "",
  passThreshold: "80",
};

const initialCohortForm: CohortForm = {
  title: "",
  code: "",
  programId: "",
  startsOn: "",
  endsOn: "",
};

function latestVersion(program: ProgramRecord) {
  return [...program.program_versions].sort(
    (a, b) => b.version_number - a.version_number,
  )[0];
}

function cohortStatusLabel(status: CohortRecord["status"]) {
  const labels: Record<CohortRecord["status"], string> = {
    draft: "مسودة",
    open: "مفتوحة",
    in_progress: "قيد التشغيل",
    closed: "مغلقة",
    archived: "مؤرشفة",
  };

  return labels[status];
}

export function ProgramsPage({
  organizationId,
  accessRole,
}: {
  organizationId: string;
  accessRole: "platform_owner" | "owner" | "trainer" | "viewer";
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [cohorts, setCohorts] = useState<CohortRecord[]>([]);
  const [orgId, setOrgId] = useState(organizationId);
  const [organizationName, setOrganizationName] = useState("");
  const [role, setRole] = useState(accessRole);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [programOpen, setProgramOpen] = useState(false);
  const [cohortOpen, setCohortOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<ProgramRecord | null>(null);
  const [editingCohort, setEditingCohort] = useState<CohortRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [programForm, setProgramForm] = useState<ProgramForm>(initialProgramForm);
  const [cohortForm, setCohortForm] = useState<CohortForm>(initialCohortForm);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    setOrgId(organizationId);
    setRole(accessRole);

    const [
      { data: organization },
      { data: programData, error: programsError },
      { data: cohortData, error: cohortsError },
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("name_ar")
        .eq("id", organizationId)
        .single(),
      supabase
        .from("programs")
        .select(`
          id,
          title_ar,
          title_en,
          slug,
          certificate_prefix,
          status,
          program_versions (
            id,
            version_number,
            pass_threshold,
            status,
            live_performance_config
          )
        `)
        .eq("org_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("cohorts")
        .select("id, program_id, program_version_id, code, title, starts_on, ends_on, status")
        .eq("org_id", organizationId)
        .order("created_at", { ascending: false }),
    ]);

    if (programsError || cohortsError) {
      setErrorMessage(
        programsError
          ? "تعذر تحميل البرامج من قاعدة البيانات."
          : "تعذر تحميل الدفعات من قاعدة البيانات.",
      );
      setIsLoading(false);
      return;
    }

    setOrganizationName(organization?.name_ar ?? "الجهة الحالية");
    setPrograms((programData ?? []) as unknown as ProgramRecord[]);
    setCohorts((cohortData ?? []) as CohortRecord[]);
    setIsLoading(false);
  }, [accessRole, organizationId, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const submitProgram = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSaving(true);

    const editingVersion = editingProgram
      ? latestVersion(editingProgram)
      : undefined;
    const { error } =
      editingProgram && editingVersion
        ? await supabase.rpc("update_draft_program", {
            p_org_id: orgId,
            p_program_id: editingProgram.id,
            p_program_version_id: editingVersion.id,
            p_title_ar: programForm.titleAr,
            p_title_en: programForm.titleEn,
            p_slug: programForm.slug,
            p_certificate_prefix: programForm.certificatePrefix,
            p_pass_threshold: Number(programForm.passThreshold),
          })
        : await supabase.rpc("create_program_with_version", {
            p_org_id: orgId,
            p_title_ar: programForm.titleAr,
            p_title_en: programForm.titleEn,
            p_slug: programForm.slug,
            p_certificate_prefix: programForm.certificatePrefix,
            p_pass_threshold: Number(programForm.passThreshold),
            p_live_performance_config: {},
          });

    if (error) {
      setErrorMessage(
        error.code === "23505"
          ? "يوجد برنامج بالرمز أو بادئة الشهادة نفسها."
          : error.code === "55000"
            ? "لا يمكن تعديل برنامج أو نسخة منشورة مباشرة. أنشئ نسخة جديدة بدلاً من تغيير الدليل السابق."
          : error.code === "42883" ||
              error.message.includes("update_draft_program")
            ? "دالة تعديل البرنامج غير موجودة. طبّق ملف SQL رقم 005 ثم أعد المحاولة."
            : "فشل حفظ البرنامج. لم تُحفظ أي تغييرات.",
      );
      setIsSaving(false);
      return;
    }

    setProgramOpen(false);
    setEditingProgram(null);
    setIsSaving(false);
    setSuccessMessage(
      editingProgram
        ? "حُفظت تعديلات البرنامج وسُجلت في سجل التدقيق."
        : "حُفظ البرنامج ونسخته الأولى فعلياً في قاعدة البيانات.",
    );
    setProgramForm(initialProgramForm);
    await loadData();
  };

  const openProgramCreateModal = () => {
    setErrorMessage("");
    setSuccessMessage("");
    setEditingProgram(null);
    setProgramForm(initialProgramForm);
    setProgramOpen(true);
  };

  const openProgramEditModal = (program: ProgramRecord) => {
    const version = latestVersion(program);

    setErrorMessage("");
    setSuccessMessage("");
    setEditingProgram(program);
    setProgramForm({
      titleAr: program.title_ar,
      titleEn: program.title_en ?? "",
      slug: program.slug,
      certificatePrefix: program.certificate_prefix,
      passThreshold: String(version?.pass_threshold ?? 80),
    });
    setProgramOpen(true);
  };

  const closeProgramModal = () => {
    setProgramOpen(false);
    setEditingProgram(null);
    setProgramForm(initialProgramForm);
  };

  const openCohortModal = () => {
    const firstAvailableProgram = programs[0];

    setErrorMessage("");
    setSuccessMessage("");
    setEditingCohort(null);
    setCohortForm({
      ...initialCohortForm,
      programId: firstAvailableProgram?.id ?? "",
    });
    setCohortOpen(true);
  };

  const openCohortEditModal = (cohort: CohortRecord) => {
    setErrorMessage("");
    setSuccessMessage("");
    setEditingCohort(cohort);
    setCohortForm({
      title: cohort.title,
      code: cohort.code,
      programId: cohort.program_id,
      startsOn: cohort.starts_on ?? "",
      endsOn: cohort.ends_on ?? "",
    });
    setCohortOpen(true);
  };

  const closeCohortModal = () => {
    setCohortOpen(false);
    setEditingCohort(null);
    setCohortForm(initialCohortForm);
  };

  const submitCohort = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const selectedProgram = programs.find(
      (program) => program.id === cohortForm.programId,
    );
    const selectedVersion = selectedProgram
      ? editingCohort && editingCohort.program_id === selectedProgram.id
        ? selectedProgram.program_versions.find(
            (version) => version.id === editingCohort.program_version_id,
          ) ?? latestVersion(selectedProgram)
        : latestVersion(selectedProgram)
      : undefined;

    if (!selectedProgram || !selectedVersion) {
      setErrorMessage("تعذر تحديد البرنامج أو نسخته الحالية.");
      return;
    }

    setIsSaving(true);

    const { error } = editingCohort
      ? await supabase.rpc("update_draft_cohort", {
          p_org_id: orgId,
          p_cohort_id: editingCohort.id,
          p_program_id: selectedProgram.id,
          p_program_version_id: selectedVersion.id,
          p_code: cohortForm.code,
          p_title: cohortForm.title,
          p_starts_on: cohortForm.startsOn || null,
          p_ends_on: cohortForm.endsOn || null,
        })
      : await supabase.rpc("create_cohort", {
          p_org_id: orgId,
          p_program_id: selectedProgram.id,
          p_program_version_id: selectedVersion.id,
          p_code: cohortForm.code,
          p_title: cohortForm.title,
          p_starts_on: cohortForm.startsOn || null,
          p_ends_on: cohortForm.endsOn || null,
        });

    if (error) {
      const message =
        error.code === "23505"
          ? "رمز الدفعة مستخدم داخل الجهة. اختر رمزاً مختلفاً."
          : error.code === "55000"
            ? "الدفعة لم تعد قابلة لهذا التغيير. بعد بدء التسجيل يُقفل الرمز والبرنامج والنسخة المرتبطة."
          : error.code === "42883" ||
              error.message.includes(
                editingCohort ? "update_draft_cohort" : "create_cohort",
              )
            ? editingCohort
              ? "دالة تعديل الدفعة غير موجودة. طبّق ملف SQL رقم 005 ثم أعد المحاولة."
              : "دالة إنشاء الدفعة غير موجودة. طبّق ملف SQL رقم 004 ثم أعد المحاولة."
            : editingCohort
              ? "فشل تعديل الدفعة. لم تُحفظ أي تغييرات."
              : "فشل إنشاء الدفعة. لم تُحفظ أي بيانات.";

      setErrorMessage(message);
      setIsSaving(false);
      return;
    }

    setCohortOpen(false);
    setEditingCohort(null);
    setIsSaving(false);
    setSuccessMessage(
      editingCohort
        ? "حُفظت تعديلات الدفعة وسُجلت في سجل التدقيق."
        : "حُفظت الدفعة الأولى كمسودة حقيقية في قاعدة البيانات.",
    );
    await loadData();
  };

  const canCreate =
    role === "platform_owner" || role === "owner" || role === "trainer";
  const selectedCohortProgram = programs.find(
    (program) => program.id === cohortForm.programId,
  );
  const selectedCohortVersion = selectedCohortProgram
    ? editingCohort && editingCohort.program_id === selectedCohortProgram.id
      ? selectedCohortProgram.program_versions.find(
          (version) => version.id === editingCohort.program_version_id,
        ) ?? latestVersion(selectedCohortProgram)
      : latestVersion(selectedCohortProgram)
    : undefined;
  const editingProgramVersion = editingProgram
    ? latestVersion(editingProgram)
    : undefined;
  const activeProgramCount = programs.filter(
    (program) => program.status === "active",
  ).length;
  const runningCohortCount = cohorts.filter((cohort) =>
    ["open", "in_progress"].includes(cohort.status),
  ).length;

  return (
    <AppShell title="البرامج والدفعات">
      <div className={styles.page}>
        <header className={styles.ledgerHead}>
          <div className={styles.headingCopy}>
            <span className={styles.folio}>٠٢ / سجل التشغيل</span>
            <h1>البرامج والدفعات</h1>
            <p>
              سجل إصدارات البرامج وعلاقتها بدفعات التنفيذ، من دون فصل الدليل عن
              قرار التشغيل.
            </p>
          </div>
          {canCreate ? (
            <div className={styles.headingActions}>
              <button
                className={styles.secondaryAction}
                onClick={openCohortModal}
                disabled={programs.length === 0}
              >
                <Icon name="plus" size={17} />
                دفعة جديدة
              </button>
              <button
                className={styles.primaryAction}
                onClick={openProgramCreateModal}
              >
                <Icon name="plus" size={17} />
                برنامج جديد
              </button>
            </div>
          ) : (
            <span className={styles.readOnlyState}>
              <Icon name="lock" size={16} />
              صلاحية قراءة فقط
            </span>
          )}
          <div className={styles.sourceStamp}>
            <Icon name="shield" size={18} />
            <span>
              <small>نطاق السجل</small>
              <strong>{organizationName || "الجهة الحالية"}</strong>
            </span>
            <code dir="ltr">RLS</code>
          </div>
        </header>

        {successMessage && (
          <div className={`${styles.feedback} ${styles.feedbackSuccess}`}>
            <Icon name="check" size={18} />
            <span>{successMessage}</span>
          </div>
        )}
        {errorMessage && (
          <div
            className={`${styles.feedback} ${styles.feedbackDanger}`}
            role="alert"
          >
            <Icon name="warning" size={18} />
            <span>{errorMessage}</span>
            <button type="button" onClick={() => void loadData()}>
              إعادة المحاولة
            </button>
          </div>
        )}

        <dl className={styles.summaryRail} aria-label="ملخص سجل التشغيل">
          <div>
            <dt>البرامج المسجلة</dt>
            <dd>{isLoading ? "—" : programs.length}</dd>
            <small>جميع الحالات</small>
          </div>
          <div>
            <dt>البرامج النشطة</dt>
            <dd>{isLoading ? "—" : activeProgramCount}</dd>
            <small>قرار تشغيل معتمد</small>
          </div>
          <div>
            <dt>الدفعات</dt>
            <dd>{isLoading ? "—" : cohorts.length}</dd>
            <small>مرتبطة بنسخة محددة</small>
          </div>
          <div>
            <dt>قيد التنفيذ</dt>
            <dd>{isLoading ? "—" : runningCohortCount}</dd>
            <small>مفتوحة أو جارية</small>
          </div>
        </dl>

        {isLoading ? (
          <section className={styles.loadingState} aria-live="polite">
            <span className={styles.loadingLine} />
            <span>جارٍ مطابقة البرامج بنسخها ودفعاتها…</span>
          </section>
        ) : (
          <div className={styles.registryStack}>
            <section className={styles.registrySection} aria-labelledby="programs-ledger-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span>السجل أ</span>
                  <h2 id="programs-ledger-title">إصدارات البرامج</h2>
                </div>
                <strong>{programs.length} سجل</strong>
              </div>

              {programs.length === 0 ? (
                <div className={styles.emptyState}>
                  <Icon name="programs" size={28} />
                  <div>
                    <h3>السجل خالٍ من البرامج</h3>
                    <p>
                      لا يمكن إنشاء دفعة أو تسجيل متدرّب قبل وجود برنامج ونسخة
                      قياس مرتبطة به.
                    </p>
                  </div>
                  {canCreate && (
                    <button
                      className={styles.primaryAction}
                      onClick={openProgramCreateModal}
                    >
                      إنشاء البرنامج الأول
                    </button>
                  )}
                </div>
              ) : (
                <ol className={styles.programLedger}>
                  {programs.map((program, index) => {
                    const version = latestVersion(program);
                    const sceneCount =
                      version?.live_performance_config?.scenes?.length ?? 0;
                    const duration =
                      version?.live_performance_config?.duration_minutes;
                    const cohortCount = cohorts.filter(
                      (cohort) => cohort.program_id === program.id,
                    ).length;
                    const isEditable =
                      program.status === "draft" && version?.status === "draft";

                    return (
                      <li className={styles.programRecord} key={program.id}>
                        <span className={styles.recordNumber} aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className={styles.programIdentity}>
                          <div className={styles.decisionLine}>
                            <StatusBadge
                              tone={
                                program.status === "active"
                                  ? "success"
                                  : program.status === "draft"
                                    ? "warning"
                                    : "muted"
                              }
                            >
                              {program.status === "active"
                                ? "نشط"
                                : program.status === "draft"
                                  ? "مسودة"
                                  : "مؤرشف"}
                            </StatusBadge>
                            <span>نسخة {version?.version_number ?? "—"}</span>
                          </div>
                          <h3>{program.title_ar}</h3>
                          {program.title_en && <p dir="ltr">{program.title_en}</p>}
                          <code dir="ltr">{program.slug}</code>
                        </div>

                        <dl className={styles.programFacts}>
                          <div>
                            <dt>حد الاجتياز</dt>
                            <dd>{version?.pass_threshold ?? "—"}%</dd>
                          </div>
                          <div>
                            <dt>مشاهد الأداء</dt>
                            <dd>{sceneCount || "—"}</dd>
                          </div>
                          <div>
                            <dt>المدة</dt>
                            <dd>{duration ? `${duration} د` : "—"}</dd>
                          </div>
                          <div>
                            <dt>الدفعات</dt>
                            <dd>{cohortCount}</dd>
                          </div>
                        </dl>

                        <div className={styles.evidenceRail} aria-label="تسلسل دليل البرنامج">
                          <span>
                            <i>01</i>
                            <small>سجل داخلي</small>
                            <strong>برنامج</strong>
                          </span>
                          <span>
                            <i>02</i>
                            <small>سجل النسخة</small>
                            <strong>
                              {version?.status === "published"
                                ? "منشورة"
                                : version?.status === "draft"
                                  ? "مسودة"
                                  : version?.status === "retired"
                                    ? "متقاعدة"
                                    : "غير متاحة"}
                            </strong>
                          </span>
                          <span>
                            <i>03</i>
                            <small>دليل التشغيل</small>
                            <strong>{cohortCount ? `${cohortCount} دفعة` : "لم يبدأ"}</strong>
                          </span>
                        </div>

                        <div className={styles.recordActions}>
                          <span className={styles.prefixStamp} dir="ltr">
                            {program.certificate_prefix}
                          </span>
                          {canCreate && (
                            <button
                              className={styles.rowAction}
                              onClick={() => openProgramEditModal(program)}
                              disabled={!isEditable}
                              title={!isEditable ? "النسخة المنشورة لا تُعدل مباشرة" : undefined}
                            >
                              <Icon name={isEditable ? "edit" : "lock"} size={15} />
                              {isEditable ? "تعديل المسودة" : "نسخة مقفلة"}
                            </button>
                          )}
                        </div>

                        <details className={styles.mobileDisclosure}>
                          <summary>عرض تفاصيل الدليل</summary>
                          <dl>
                            <div><dt>حد الاجتياز</dt><dd>{version?.pass_threshold ?? "—"}%</dd></div>
                            <div><dt>مشاهد الأداء</dt><dd>{sceneCount || "—"}</dd></div>
                            <div><dt>المدة</dt><dd>{duration ? `${duration} دقيقة` : "غير محددة"}</dd></div>
                            <div><dt>الدفعات</dt><dd>{cohortCount}</dd></div>
                          </dl>
                        </details>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <section className={styles.registrySection} aria-labelledby="cohorts-ledger-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span>السجل ب</span>
                  <h2 id="cohorts-ledger-title">دفعات التنفيذ</h2>
                </div>
                <strong>{cohorts.length} سجل</strong>
              </div>

              {cohorts.length === 0 ? (
                <div className={styles.emptyState}>
                  <Icon name="sessions" size={28} />
                  <div>
                    <h3>لا توجد دفعات مرتبطة</h3>
                    <p>
                      أنشئ دفعة كمسودة واربطها بنسخة البرنامج؛ حالة التشغيل
                      ستبقى صريحة حتى تصبح الدفعة جاهزة.
                    </p>
                  </div>
                  {canCreate && programs.length > 0 && (
                    <button className={styles.secondaryAction} onClick={openCohortModal}>
                      إنشاء الدفعة الأولى
                    </button>
                  )}
                </div>
              ) : (
                <div className={styles.cohortTableWrap}>
                  <table className={styles.cohortTable}>
                    <thead>
                      <tr>
                        <th>الدفعة</th>
                        <th>البرنامج / النسخة</th>
                        <th>نافذة التنفيذ</th>
                        <th>قرار الحالة</th>
                        <th><span className="sr-only">الإجراء</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohorts.map((cohort) => {
                        const program = programs.find((item) => item.id === cohort.program_id);
                        const version = program?.program_versions.find(
                          (item) => item.id === cohort.program_version_id,
                        );
                        const isDraft = cohort.status === "draft";

                        return (
                          <tr key={cohort.id}>
                            <td>
                              <strong>{cohort.title}</strong>
                              <code dir="ltr">{cohort.code}</code>
                              <details className={styles.cohortMobileDisclosure}>
                                <summary>تفاصيل الدفعة</summary>
                                <dl>
                                  <div><dt>البرنامج</dt><dd>{program?.title_ar ?? "برنامج غير متاح"}</dd></div>
                                  <div><dt>النسخة</dt><dd>{version?.version_number ?? "—"}</dd></div>
                                  <div><dt>البداية</dt><dd>{cohort.starts_on ?? "غير محدد"}</dd></div>
                                  <div><dt>النهاية</dt><dd>{cohort.ends_on ?? "غير محدد"}</dd></div>
                                  <div><dt>الحالة</dt><dd>{cohortStatusLabel(cohort.status)}</dd></div>
                                </dl>
                                {canCreate && (
                                  <button
                                    className={styles.rowAction}
                                    onClick={() => openCohortEditModal(cohort)}
                                    disabled={!isDraft}
                                  >
                                    <Icon name={isDraft ? "edit" : "lock"} size={15} />
                                    {isDraft ? "تعديل الدفعة" : "دفعة مقفلة"}
                                  </button>
                                )}
                              </details>
                            </td>
                            <td className={styles.cohortDesktopCell}>
                              <strong>{program?.title_ar ?? "برنامج غير متاح"}</strong>
                              <small>النسخة {version?.version_number ?? "—"}</small>
                            </td>
                            <td className={styles.cohortDesktopCell}>
                              <span>{cohort.starts_on ?? "غير محدد"}</span>
                              <small>إلى {cohort.ends_on ?? "غير محدد"}</small>
                            </td>
                            <td className={styles.cohortDesktopCell}>
                              <StatusBadge tone={isDraft ? "warning" : cohort.status === "archived" ? "muted" : "system"}>
                                {cohortStatusLabel(cohort.status)}
                              </StatusBadge>
                              <small>{isDraft ? "مسودة قابلة للتحرير" : "علاقة البرنامج مقفلة"}</small>
                            </td>
                            <td className={styles.cohortDesktopCell}>
                              {canCreate && (
                                <button
                                  className={styles.rowAction}
                                  onClick={() => openCohortEditModal(cohort)}
                                  disabled={!isDraft}
                                  title={!isDraft ? "الدفعة غير المسودة لا تُعدل مباشرة" : undefined}
                                >
                                  <Icon name={isDraft ? "edit" : "lock"} size={15} />
                                  {isDraft ? "تعديل" : "مقفلة"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {programOpen && (
        <AccessibleDialog
          labelledBy="program-modal-title"
          onClose={closeProgramModal}
          disableClose={isSaving}
        >
            <div className="modal-head">
              <h2 id="program-modal-title">
                {editingProgram ? "تعديل البرنامج" : "إنشاء برنامج جديد"}
              </h2>
              <button
                className="icon-button"
                aria-label="إغلاق"
                onClick={closeProgramModal}
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="form-stack" onSubmit={submitProgram}>
              <label>
                اسم البرنامج بالعربية
                <input
                  required
                  value={programForm.titleAr}
                  onChange={(event) =>
                    setProgramForm({
                      ...programForm,
                      titleAr: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                الاسم الإنجليزي
                <input
                  dir="ltr"
                  value={programForm.titleEn}
                  onChange={(event) =>
                    setProgramForm({
                      ...programForm,
                      titleEn: event.target.value,
                    })
                  }
                />
              </label>
              <div className="form-grid">
                <label>
                  رمز البرنامج
                  <input
                    required
                    dir="ltr"
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={programForm.slug}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        slug: event.target.value.toLowerCase(),
                      })
                    }
                  />
                </label>
                <label>
                  بادئة الشهادة
                  <input
                    required
                    dir="ltr"
                    pattern="[A-Z0-9]{2,12}"
                    value={programForm.certificatePrefix}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        certificatePrefix: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
              </div>
              <label>
                حد الاجتياز
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={programForm.passThreshold}
                  onChange={(event) =>
                    setProgramForm({
                      ...programForm,
                      passThreshold: event.target.value,
                    })
                  }
                />
              </label>
              <div className="read-only-field">
                <span>إعداد السيناريو</span>
                <strong>
                  {editingProgramVersion
                    ? `${editingProgramVersion.live_performance_config?.scenes?.length ?? 0} مشاهد · ${editingProgramVersion.live_performance_config?.duration_minutes ?? "—"} دقيقة`
                    : "غير مرتبط من شاشة إنشاء البرنامج"}
                </strong>
                <Icon name="lock" size={16} />
              </div>
              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={closeProgramModal}
                >
                  إلغاء
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={isSaving || !orgId}
                >
                  {isSaving
                    ? "جارٍ الحفظ..."
                    : editingProgram
                      ? "حفظ التعديلات"
                      : "حفظ البرنامج فعلياً"}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}

      {cohortOpen && (
        <AccessibleDialog
          labelledBy="cohort-modal-title"
          onClose={closeCohortModal}
          disableClose={isSaving}
        >
            <div className="modal-head">
              <h2 id="cohort-modal-title">
                {editingCohort ? "تعديل الدفعة" : "إنشاء دفعة"}
              </h2>
              <button
                className="icon-button"
                aria-label="إغلاق"
                onClick={closeCohortModal}
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="form-stack" onSubmit={submitCohort}>
              <label>
                اسم الدفعة
                <input
                  required
                  value={cohortForm.title}
                  onChange={(event) =>
                    setCohortForm({
                      ...cohortForm,
                      title: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                رمز الدفعة
                <input
                  required
                  dir="ltr"
                  pattern="[A-Z0-9]+(?:-[A-Z0-9]+)*"
                  value={cohortForm.code}
                  onChange={(event) =>
                    setCohortForm({
                      ...cohortForm,
                      code: event.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <label>
                البرنامج
                <select
                  required
                  value={cohortForm.programId}
                  onChange={(event) =>
                    setCohortForm({
                      ...cohortForm,
                      programId: event.target.value,
                    })
                  }
                >
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.title_ar}
                    </option>
                  ))}
                </select>
              </label>
              <div className="read-only-field">
                <span>نسخة البرنامج المرتبطة</span>
                <strong>
                  {selectedCohortVersion
                    ? `${selectedCohortVersion.version_number} · ${
                        selectedCohortVersion.status === "draft"
                          ? "مسودة"
                          : "منشورة"
                      }`
                    : "غير متاحة"}
                </strong>
                <Icon name="lock" size={16} />
              </div>
              <div className="form-grid">
                <label>
                  تاريخ البداية — اختياري
                  <input
                    type="date"
                    dir="ltr"
                    value={cohortForm.startsOn}
                    onChange={(event) =>
                      setCohortForm({
                        ...cohortForm,
                        startsOn: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  تاريخ النهاية — اختياري
                  <input
                    type="date"
                    dir="ltr"
                    min={cohortForm.startsOn || undefined}
                    value={cohortForm.endsOn}
                    onChange={(event) =>
                      setCohortForm({
                        ...cohortForm,
                        endsOn: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="cohort-lock-notice">
                <Icon name="lock" size={17} />
                <span>
                  {editingCohort
                    ? "يمكن تعديل المسودة الآن. بعد بدء التسجيل ستُقفل علاقة البرنامج ورمز الدفعة."
                    : "ستُحفظ الدفعة كمسودة. فتح التشغيل محظور حتى نشر البرنامج وربط الاختبار القبلي والبعدي ومصدر الأداء اللحظي."}
                </span>
              </div>
              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={closeCohortModal}
                >
                  إلغاء
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={isSaving || !orgId || !selectedCohortVersion}
                >
                  {isSaving
                    ? "جارٍ الحفظ..."
                    : editingCohort
                      ? "حفظ التعديلات"
                      : "حفظ الدفعة كمسودة"}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}
    </AppShell>
  );
}
