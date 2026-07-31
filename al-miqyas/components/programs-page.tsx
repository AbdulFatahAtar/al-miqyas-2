"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppShell, PageHeader, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

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
  titleAr: "تهيئة الموظفين الجدد — ديوان المظالم",
  titleEn: "New Employee Onboarding",
  slug: "diwan-onboarding",
  certificatePrefix: "DIWAN",
  passThreshold: "80",
};

const initialCohortForm: CohortForm = {
  title: "الدفعة الأولى — تهيئة موظفي ديوان المظالم",
  code: "DIWAN-2026-01",
  programId: "",
  startsOn: "",
  endsOn: "",
};

const livePerformanceConfig = {
  source_document: "سيناريو-تهيئة-الموظفين-الجدد-v2.docx",
  platform: "Meta Quest 3",
  duration_minutes: 41,
  scenes: [
    { id: "S0", title: "الترحيب والتهيئة", assessment: "none" },
    { id: "S1", title: "التعريف بالديوان", assessment: "knowledge" },
    { id: "S2", title: "جولة داخل المبنى", assessment: "exploration" },
    { id: "S3", title: "الهيكل التنظيمي", assessment: "knowledge" },
    { id: "S4", title: "مدونة السلوك الوظيفي", assessment: "decision" },
    { id: "S5", title: "المنصات الرقمية وأنظمة العمل", assessment: "live_performance" },
    { id: "S6", title: "محاكاة اليوم الأول", assessment: "live_performance" },
    { id: "S7", title: "التقييم النهائي والشهادة", assessment: "knowledge" },
  ],
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

export function ProgramsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [cohorts, setCohorts] = useState<CohortRecord[]>([]);
  const [orgId, setOrgId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [role, setRole] = useState("");
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

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setErrorMessage("تعذر التحقق من جلسة المستخدم.");
      setIsLoading(false);
      return;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("org_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership) {
      setErrorMessage("لا توجد عضوية نشطة مرتبطة بهذا الحساب.");
      setIsLoading(false);
      return;
    }

    setOrgId(membership.org_id);
    setRole(membership.role);

    const [
      { data: organization },
      { data: programData, error: programsError },
      { data: cohortData, error: cohortsError },
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("name_ar")
        .eq("id", membership.org_id)
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
        .eq("org_id", membership.org_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("cohorts")
        .select("id, program_id, program_version_id, code, title, starts_on, ends_on, status")
        .eq("org_id", membership.org_id)
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
  }, [supabase]);

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
            p_live_performance_config: livePerformanceConfig,
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
    const diwanProgram =
      programs.find((program) => program.slug === "diwan-onboarding") ?? programs[0];

    setErrorMessage("");
    setSuccessMessage("");
    setEditingCohort(null);
    setCohortForm({
      ...initialCohortForm,
      programId: diwanProgram?.id ?? "",
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

  const canCreate = role === "owner" || role === "trainer";
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

  return (
    <AppShell title="البرامج والدفعات">
      <PageHeader
        eyebrow="إدارة القياس"
        title="البرامج والدفعات"
        description="البرامج والدفعات المعروضة هنا محفوظة فعلياً داخل الجهة الحالية."
        actions={
          canCreate ? (
            <>
              <button
                className="button button-secondary"
                onClick={openCohortModal}
                disabled={programs.length === 0}
              >
                <Icon name="plus" size={17} />
                دفعة جديدة
              </button>
              <button
                className="button button-primary"
                onClick={openProgramCreateModal}
              >
                <Icon name="plus" size={17} />
                برنامج جديد
              </button>
            </>
          ) : undefined
        }
      />

      {successMessage && (
        <div className="inline-feedback success-feedback">
          <Icon name="check" size={18} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="inline-feedback danger-feedback" role="alert">
          <Icon name="warning" size={18} />
          {errorMessage}
        </div>
      )}

      <div className="live-data-notice">
        <Icon name="shield" size={17} />
        <span>
          <strong>اتصال فعلي بقاعدة البيانات.</strong> تعرض الصفحة بيانات{" "}
          {organizationName || "الجهة الحالية"} وفق صلاحيات RLS.
        </span>
      </div>

      {isLoading ? (
        <section className="content-section loading-state">
          جارٍ تحميل البرامج والدفعات...
        </section>
      ) : (
        <>
          {programs.length === 0 ? (
            <section className="content-section empty-state">
              <Icon name="programs" size={30} />
              <h2>لا توجد برامج بعد</h2>
              <p>أنشئ البرنامج الأول ليصبح أساس الدفعات والمتدرّبين ومصادر القياس.</p>
              {canCreate && (
                <button
                  className="button button-primary"
                  onClick={openProgramCreateModal}
                >
                  إنشاء برنامج ديوان المظالم
                </button>
              )}
            </section>
          ) : (
            <div className="program-list">
              {programs.map((program) => {
                const version = latestVersion(program);
                const sceneCount =
                  version?.live_performance_config?.scenes?.length ?? 0;
                const duration =
                  version?.live_performance_config?.duration_minutes;
                const cohortCount = cohorts.filter(
                  (cohort) => cohort.program_id === program.id,
                ).length;

                return (
                  <article className="program-row" key={program.id}>
                    <div className="program-accent system" />
                    <div className="program-main">
                      <span className="eyebrow">
                        {program.status === "draft"
                          ? "مسودة حقيقية"
                          : "برنامج نشط"}
                      </span>
                      <h2>{program.title_ar}</h2>
                      <p>
                        {organizationName} ·{" "}
                        <span dir="ltr">{program.slug}</span>
                      </p>
                    </div>
                    <div className="program-meta">
                      <span>
                        <small>حد الاجتياز</small>
                        <strong>{version?.pass_threshold ?? "—"}%</strong>
                      </span>
                      <span>
                        <small>المشاهد</small>
                        <strong>{sceneCount || "—"}</strong>
                      </span>
                      <span>
                        <small>الدفعات</small>
                        <strong>{cohortCount}</strong>
                      </span>
                    </div>
                    <div className="program-integrations">
                      <StatusBadge tone="warning">Jotform غير مربوط</StatusBadge>
                      <StatusBadge tone="muted">xAPI بانتظار التهيئة</StatusBadge>
                      {duration && <small>{duration} دقيقة للمشهد الكامل</small>}
                    </div>
                    <div className="row-actions">
                      <span className="program-prefix" dir="ltr">
                        {program.certificate_prefix}
                      </span>
                      {canCreate && (
                        <button
                          className="button button-secondary button-compact"
                          onClick={() => openProgramEditModal(program)}
                          disabled={
                            program.status !== "draft" ||
                            version?.status !== "draft"
                          }
                          title={
                            program.status !== "draft" ||
                            version?.status !== "draft"
                              ? "النسخة المنشورة لا تُعدل مباشرة"
                              : undefined
                          }
                        >
                          <Icon name="edit" size={15} />
                          تعديل
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <section className="content-section cohorts-section">
            <div className="section-title">
              <div>
                <span className="eyebrow">التشغيل الفعلي</span>
                <h2>الدفعات</h2>
              </div>
              <span className="cohort-count">{cohorts.length} دفعة</span>
            </div>

            {cohorts.length === 0 ? (
              <div className="cohorts-empty">
                <Icon name="sessions" size={28} />
                <div>
                  <strong>لا توجد دفعات تشغيلية بعد</strong>
                  <p>
                    أنشئ الدفعة الأولى كمسودة. لن يمكن فتحها قبل نشر البرنامج
                    وربط مصادر القياس.
                  </p>
                </div>
                {canCreate && programs.length > 0 && (
                  <button
                    className="button button-secondary"
                    onClick={openCohortModal}
                  >
                    إنشاء الدفعة الأولى
                  </button>
                )}
              </div>
            ) : (
              <div className="cohort-list">
                {cohorts.map((cohort) => {
                  const program = programs.find(
                    (item) => item.id === cohort.program_id,
                  );
                  const version = program?.program_versions.find(
                    (item) => item.id === cohort.program_version_id,
                  );
                  const isDraft = cohort.status === "draft";

                  return (
                    <article className="cohort-row" key={cohort.id}>
                      <div className="cohort-identity">
                        <span className="eyebrow">
                          نسخة البرنامج {version?.version_number ?? "—"}
                        </span>
                        <h3>{cohort.title}</h3>
                        <span className="program-prefix" dir="ltr">
                          {cohort.code}
                        </span>
                      </div>
                      <div className="cohort-program">
                        <small>البرنامج المرتبط</small>
                        <strong>{program?.title_ar ?? "برنامج غير متاح"}</strong>
                      </div>
                      <div className="cohort-dates">
                        <span>
                          <small>البداية</small>
                          <strong>{cohort.starts_on ?? "غير محدد"}</strong>
                        </span>
                        <span>
                          <small>النهاية</small>
                          <strong>{cohort.ends_on ?? "غير محدد"}</strong>
                        </span>
                      </div>
                      <div className="cohort-readiness">
                        <StatusBadge tone={isDraft ? "warning" : "system"}>
                          {cohortStatusLabel(cohort.status)}
                        </StatusBadge>
                        {isDraft && (
                          <small>التشغيل مقفل حتى اكتمال التكاملات</small>
                        )}
                      </div>
                      <div className="row-actions">
                        {canCreate && (
                          <button
                            className="button button-secondary button-compact"
                            onClick={() => openCohortEditModal(cohort)}
                            disabled={!isDraft}
                            title={
                              !isDraft
                                ? "الدفعة غير المسودة لا تُعدل مباشرة"
                                : undefined
                            }
                          >
                            <Icon name="edit" size={15} />
                            تعديل
                          </button>
                        )}
                        <button
                          className="button button-secondary"
                          disabled={isDraft}
                          title={
                            isDraft
                              ? "انشر البرنامج واربط Jotform وxAPI أولاً"
                              : undefined
                          }
                        >
                          تشغيل الدفعة
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {programOpen && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={closeProgramModal}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="program-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
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
                <strong>8 مشاهد · 41 دقيقة</strong>
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
          </section>
        </div>
      )}

      {cohortOpen && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={closeCohortModal}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cohort-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="cohort-modal-title">
                {editingCohort ? "تعديل الدفعة" : "إنشاء الدفعة الأولى"}
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
          </section>
        </div>
      )}
    </AppShell>
  );
}
