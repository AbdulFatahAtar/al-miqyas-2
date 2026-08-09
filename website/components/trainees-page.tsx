"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppShell, StatusBadge } from "./app-shell";
import { AccessibleDialog } from "./accessible-dialog";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import styles from "./trainees-page.module.css";

type TraineeRecord = {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive" | "archived";
};

type TraineeContactRecord = {
  trainee_id: string;
  phone: string | null;
  email: string | null;
};

type CohortRecord = {
  id: string;
  code: string;
  title: string;
  status: "draft" | "open" | "in_progress" | "closed" | "archived";
};

type EnrollmentRecord = {
  id: string;
  trainee_id: string;
  cohort_id: string;
  status: "invited" | "active" | "completed" | "withdrawn" | "cancelled";
  enrolled_at: string;
};

type TraineeForm = {
  fullName: string;
  phone: string;
  email: string;
  cohortId: string;
  status: "active" | "inactive";
};

const initialForm: TraineeForm = {
  fullName: "",
  phone: "",
  email: "",
  cohortId: "",
  status: "active",
};

function statusLabel(status: TraineeRecord["status"]) {
  if (status === "active") return "نشط";
  if (status === "inactive") return "غير نشط";
  return "مؤرشف";
}

export function TraineesPage({
  organizationId,
  accessRole,
}: {
  organizationId: string;
  accessRole: "platform_owner" | "owner" | "trainer" | "viewer";
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [trainees, setTrainees] = useState<TraineeRecord[]>([]);
  const [cohorts, setCohorts] = useState<CohortRecord[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([]);
  const [orgId, setOrgId] = useState(organizationId);
  const [role, setRole] = useState(accessRole);
  const [organizationName, setOrganizationName] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTrainee, setEditingTrainee] =
    useState<TraineeRecord | null>(null);
  const [form, setForm] = useState<TraineeForm>(initialForm);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    setOrgId(organizationId);
    setRole(accessRole);

    const [
      { data: organization },
      { data: traineeData, error: traineesError },
      { data: contactData, error: contactsError },
      { data: cohortData, error: cohortsError },
      { data: enrollmentData, error: enrollmentsError },
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("name_ar")
        .eq("id", organizationId)
        .single(),
      supabase
        .from("trainees")
        .select("id, code, full_name, status")
        .eq("org_id", organizationId)
        .order("created_at", { ascending: false }),
      accessRole === "viewer"
        ? Promise.resolve({
            data: [] as TraineeContactRecord[],
            error: null,
          })
        : supabase.rpc("get_trainee_contacts", {
            target_org_id: organizationId,
          }),
      supabase
        .from("cohorts")
        .select("id, code, title, status")
        .eq("org_id", organizationId)
        .neq("status", "archived")
        .order("created_at", { ascending: false }),
      supabase
        .from("enrollments")
        .select("id, trainee_id, cohort_id, status, enrolled_at")
        .eq("org_id", organizationId)
        .order("enrolled_at", { ascending: false }),
    ]);

    if (traineesError || cohortsError || enrollmentsError) {
      setErrorMessage("تعذر تحميل سجل المتدربين من قاعدة البيانات.");
      setIsLoading(false);
      return;
    }

    setOrganizationName(organization?.name_ar ?? "الجهة الحالية");
    const contacts = (contactData ?? []) as TraineeContactRecord[];
    const contactByTrainee = new Map(
      contacts.map((contact) => [contact.trainee_id, contact]),
    );
    setTrainees(
      ((traineeData ?? []) as Omit<TraineeRecord, "phone" | "email">[]).map(
        (trainee) => ({
          ...trainee,
          phone: contactByTrainee.get(trainee.id)?.phone ?? null,
          email: contactByTrainee.get(trainee.id)?.email ?? null,
        }),
      ),
    );
    setCohorts((cohortData ?? []) as CohortRecord[]);
    setEnrollments((enrollmentData ?? []) as EnrollmentRecord[]);
    if (contactsError && accessRole !== "viewer") {
      setErrorMessage(
        "حُمّل سجل المتدرّبين، لكن تعذر تحميل بيانات التواصل الخاصة.",
      );
    }
    setIsLoading(false);
  }, [accessRole, organizationId, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentEnrollment = useCallback(
    (traineeId: string) =>
      enrollments.find(
        (enrollment) =>
          enrollment.trainee_id === traineeId &&
          !["withdrawn", "cancelled"].includes(enrollment.status),
      ),
    [enrollments],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return trainees.filter((trainee) => {
      const matchesQuery =
        !normalizedQuery ||
        `${trainee.full_name} ${trainee.code} ${trainee.phone ?? ""} ${
          trainee.email ?? ""
        }`
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || trainee.status === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [query, statusFilter, trainees]);

  const canManage =
    role === "platform_owner" || role === "owner" || role === "trainer";

  const openCreateModal = () => {
    setErrorMessage("");
    setSuccessMessage("");
    setEditingTrainee(null);
    setForm({
      ...initialForm,
      cohortId: cohorts[0]?.id ?? "",
    });
    setModalOpen(true);
  };

  const openEditModal = (trainee: TraineeRecord) => {
    const enrollment = currentEnrollment(trainee.id);

    setErrorMessage("");
    setSuccessMessage("");
    setEditingTrainee(trainee);
    setForm({
      fullName: trainee.full_name,
      phone: trainee.phone ?? "",
      email: trainee.email ?? "",
      cohortId: enrollment?.cohort_id ?? "",
      status: trainee.status === "inactive" ? "inactive" : "active",
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTrainee(null);
    setForm(initialForm);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!form.phone.trim() && !form.email.trim()) {
      setErrorMessage("أدخل رقم الجوال أو البريد الإلكتروني على الأقل.");
      return;
    }

    if (!editingTrainee && !form.cohortId) {
      setErrorMessage("اختر الدفعة التي سيسجل فيها المتدرب.");
      return;
    }

    setIsSaving(true);

    if (editingTrainee) {
      const { error } = await supabase.rpc("update_trainee_profile", {
        p_org_id: orgId,
        p_trainee_id: editingTrainee.id,
        p_full_name: form.fullName,
        p_phone: form.phone || null,
        p_email: form.email || null,
        p_status: form.status,
      });

      if (error) {
        const message =
          error.code === "23505"
            ? "البريد الإلكتروني مستخدم لمتدرب آخر داخل الجهة."
            : error.code === "42883" ||
                error.message.includes("update_trainee_profile")
              ? "دالة تعديل المتدرب غير موجودة. طبّق ملف SQL رقم 006."
              : "فشل تعديل المتدرب. لم تُحفظ أي تغييرات.";

        setErrorMessage(message);
        setIsSaving(false);
        return;
      }

      closeModal();
      setIsSaving(false);
      setSuccessMessage("حُفظت بيانات المتدرب وسُجل التعديل في سجل التدقيق.");
      await loadData();
      return;
    }

    const { data, error } = await supabase.rpc(
      "create_trainee_with_enrollment",
      {
        p_org_id: orgId,
        p_cohort_id: form.cohortId,
        p_full_name: form.fullName,
        p_phone: form.phone || null,
        p_email: form.email || null,
      },
    );

    if (error) {
      const message =
        error.code === "23505"
          ? "يوجد متدرب مسجل بالبريد الإلكتروني نفسه داخل الجهة."
          : error.code === "42883" ||
              error.message.includes("create_trainee_with_enrollment")
            ? "دالة تسجيل المتدرب غير موجودة. طبّق ملف SQL رقم 006."
            : "فشل تسجيل المتدرب. لم تُحفظ أي بيانات.";

      setErrorMessage(message);
      setIsSaving(false);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    closeModal();
    setIsSaving(false);
    setSuccessMessage(
      `سُجل المتدرب وربط بالدفعة. المعرّف الموحد: ${
        result?.trainee_code ?? "تم إنشاؤه"
      }`,
    );
    await loadData();
  };

  const activeCount = trainees.filter(
    (trainee) => trainee.status === "active",
  ).length;
  const enrolledCount = new Set(
    enrollments
      .filter((enrollment) =>
        !["withdrawn", "cancelled"].includes(enrollment.status),
      )
      .map((enrollment) => enrollment.trainee_id),
  ).size;
  const contactCount = trainees.filter(
    (trainee) => Boolean(trainee.phone || trainee.email),
  ).length;

  return (
    <AppShell title="المتدرّبون">
      <div className={styles.page}>
        <header className={styles.ledgerHead}>
          <div className={styles.headingCopy}>
            <span className={styles.folio}>٠٣ / سجل الهوية الموحدة</span>
            <h1>المتدرّبون</h1>
            <p>
              مرجع الأشخاص المرتبطين بدفعات القياس؛ كل صف يبدأ بمعرّف ثابت
              ويقود إلى سجل دليل المتدرّب الكامل.
            </p>
          </div>
          {canManage ? (
            <button
              className={styles.primaryAction}
              onClick={openCreateModal}
              disabled={cohorts.length === 0}
            >
              <Icon name="plus" size={17} />
              تسجيل متدرّب
            </button>
          ) : (
            <span className={styles.readOnlyState}>
              <Icon name="lock" size={16} />
              صلاحية قراءة فقط
            </span>
          )}
          <div className={styles.sourceStamp}>
            <Icon name="shield" size={18} />
            <span>
              <small>سياق العزل</small>
              <strong>{organizationName || "الجهة الحالية"}</strong>
            </span>
            <code dir="ltr">AMD-XXXXX · RLS</code>
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

        <dl className={styles.summaryRail} aria-label="ملخص سجل المتدرّبين">
          <div>
            <dt>إجمالي السجل</dt>
            <dd>{isLoading ? "—" : trainees.length}</dd>
            <small>معرّفات ثابتة</small>
          </div>
          <div>
            <dt>النشطون</dt>
            <dd>{isLoading ? "—" : activeCount}</dd>
            <small>متاحون للقياس</small>
          </div>
          <div>
            <dt>مرتبطون بدفعة</dt>
            <dd>{isLoading ? "—" : enrolledCount}</dd>
            <small>تسجيل غير ملغى</small>
          </div>
          <div>
            <dt>بيانات التواصل</dt>
            <dd>{isLoading ? "—" : accessRole === "viewer" ? "محجوبة" : contactCount}</dd>
            <small>{accessRole === "viewer" ? "بحسب الدور" : "سجل متاح"}</small>
          </div>
        </dl>

        <section className={styles.registrySection} aria-labelledby="trainees-ledger-title">
          <div className={styles.sectionHeading}>
            <div>
              <span>السجل أ</span>
              <h2 id="trainees-ledger-title">دليل المتدرّبين</h2>
            </div>
            <strong>{isLoading ? "جارٍ الفهرسة" : `${filtered.length} نتيجة`}</strong>
          </div>

          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              <span>البحث في السجل</span>
              <div>
                <Icon name="search" size={18} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={
                    accessRole === "viewer"
                      ? "الاسم أو AMD-XXXXX"
                      : "الاسم أو AMD-XXXXX أو وسيلة التواصل"
                  }
                  autoComplete="off"
                />
              </div>
            </label>
            <label className={styles.filterField}>
              <span>قرار الحالة</span>
              <div>
                <Icon name="filter" size={17} />
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value as "all" | "active" | "inactive",
                    )
                  }
                >
                  <option value="all">كل الحالات</option>
                  <option value="active">النشطون</option>
                  <option value="inactive">غير النشطين</option>
                </select>
              </div>
            </label>
          </div>

          {isLoading ? (
            <div className={styles.loadingState} aria-live="polite">
              <span className={styles.loadingLine} />
              <span>جارٍ مطابقة الهوية بالدفعة الحالية…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon name={trainees.length === 0 ? "trainees" : "search"} size={28} />
              <div>
                <h3>{trainees.length === 0 ? "السجل خالٍ" : "لا يوجد تطابق"}</h3>
                <p>
                  {trainees.length === 0
                    ? cohorts.length === 0
                      ? "أنشئ دفعة أولاً؛ التسجيل يتطلب علاقة تشغيل حقيقية."
                      : "سجّل أول متدرّب ليُنشأ معرّفه الموحد ويرتبط بالدفعة."
                    : "غيّر كلمات البحث أو قرار الحالة؛ لم تُحذف أي سجلات."}
                </p>
              </div>
              {canManage && trainees.length === 0 && cohorts.length > 0 && (
                <button className={styles.primaryAction} onClick={openCreateModal}>
                  تسجيل أول متدرّب
                </button>
              )}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.ledgerTable}>
                <thead>
                  <tr>
                    <th>المتدرّب</th>
                    <th>المعرّف الموحد</th>
                    <th>الدفعة الحالية</th>
                    <th>مصدر التواصل</th>
                    <th>قرار الحالة</th>
                    <th><span className="sr-only">الإجراء</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((trainee) => {
                    const enrollment = currentEnrollment(trainee.id);
                    const cohort = cohorts.find(
                      (item) => item.id === enrollment?.cohort_id,
                    );

                    return (
                      <tr key={trainee.id} data-status={trainee.status}>
                        <td>
                          <Link
                            className={styles.traineeLink}
                            href={`/trainees/${trainee.code}`}
                          >
                            <span>
                              <strong>{trainee.full_name}</strong>
                              <small>فتح سجل الدليل</small>
                            </span>
                            <Icon name="chevron" size={15} />
                          </Link>
                          <details className={styles.mobileDisclosure}>
                            <summary>تفاصيل السجل</summary>
                            <dl>
                              <div><dt>المعرّف</dt><dd dir="ltr">{trainee.code}</dd></div>
                              <div><dt>الدفعة</dt><dd>{cohort?.title ?? "غير مرتبط"}</dd></div>
                              <div><dt>الجوال</dt><dd dir={trainee.phone ? "ltr" : undefined}>{trainee.phone ?? "محجوب أو غير متاح"}</dd></div>
                              <div><dt>البريد</dt><dd dir={trainee.email ? "ltr" : undefined}>{trainee.email ?? "محجوب أو غير متاح"}</dd></div>
                              <div><dt>الحالة</dt><dd>{statusLabel(trainee.status)}</dd></div>
                            </dl>
                            {canManage && trainee.status !== "archived" && (
                              <button className={styles.rowAction} onClick={() => openEditModal(trainee)}>
                                <Icon name="edit" size={15} />
                                تعديل السجل
                              </button>
                            )}
                          </details>
                        </td>
                        <td className={styles.desktopCell}>
                          <span className={styles.lockedCode} dir="ltr">
                            <Icon name="lock" size={14} />
                            {trainee.code}
                          </span>
                        </td>
                        <td className={styles.desktopCell}>
                          <strong>{cohort?.title ?? "غير مرتبط"}</strong>
                          {cohort ? (
                            <small dir="ltr">{cohort.code}</small>
                          ) : (
                            <small>لا يوجد رمز دفعة</small>
                          )}
                        </td>
                        <td className={styles.desktopCell}>
                          <span className={styles.contactStack}>
                            <span dir="ltr">{trainee.phone ?? "—"}</span>
                            <small dir="ltr">{trainee.email ?? "—"}</small>
                          </span>
                        </td>
                        <td className={styles.desktopCell}>
                          <StatusBadge tone={trainee.status === "active" ? "success" : "muted"}>
                            {statusLabel(trainee.status)}
                          </StatusBadge>
                        </td>
                        <td className={styles.desktopCell}>
                          {canManage && trainee.status !== "archived" && (
                            <button className={styles.rowAction} onClick={() => openEditModal(trainee)}>
                              <Icon name="edit" size={15} />
                              تعديل
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

      {modalOpen && (
        <AccessibleDialog
          labelledBy="trainee-modal-title"
          onClose={closeModal}
          disableClose={isSaving}
        >
            <div className="modal-head">
              <h2 id="trainee-modal-title">
                {editingTrainee ? "تعديل بيانات المتدرب" : "تسجيل متدرب"}
              </h2>
              <button
                className="icon-button"
                aria-label="إغلاق"
                onClick={closeModal}
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="form-stack" onSubmit={submit}>
              <label>
                الاسم الكامل
                <input
                  required
                  autoComplete="name"
                  value={form.fullName}
                  onChange={(event) =>
                    setForm({ ...form, fullName: event.target.value })
                  }
                />
              </label>
              <div className="form-grid">
                <label>
                  رقم الجوال
                  <input
                    type="tel"
                    dir="ltr"
                    value={form.phone}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                  />
                </label>
                <label>
                  البريد الإلكتروني
                  <input
                    type="email"
                    dir="ltr"
                    value={form.email}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                  />
                </label>
              </div>
              <small className="form-help">
                يجب إدخال رقم الجوال أو البريد الإلكتروني على الأقل.
              </small>

              {editingTrainee ? (
                <>
                  <div className="read-only-field">
                    <span>المعرّف الموحد</span>
                    <strong dir="ltr">{editingTrainee.code}</strong>
                    <Icon name="lock" size={16} />
                  </div>
                  <div className="read-only-field">
                    <span>الدفعة الحالية</span>
                    <strong>
                      {cohorts.find((item) => item.id === form.cohortId)?.title ??
                        "غير مرتبط"}
                    </strong>
                    <Icon name="lock" size={16} />
                  </div>
                  <label>
                    حالة المتدرب
                    <select
                      value={form.status}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          status: event.target.value as "active" | "inactive",
                        })
                      }
                    >
                      <option value="active">نشط</option>
                      <option value="inactive">غير نشط</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    الدفعة
                    <select
                      required
                      value={form.cohortId}
                      onChange={(event) =>
                        setForm({ ...form, cohortId: event.target.value })
                      }
                    >
                      {cohorts.map((cohort) => (
                        <option key={cohort.id} value={cohort.id}>
                          {cohort.title} · {cohort.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="read-only-field">
                    <span>المعرّف الموحد</span>
                    <strong dir="ltr">سيُنشأ تلقائياً</strong>
                    <Icon name="lock" size={16} />
                  </div>
                </>
              )}

              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={closeModal}
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
                    : editingTrainee
                      ? "حفظ التعديلات"
                      : "تسجيل المتدرب"}
                </button>
              </div>
            </form>
        </AccessibleDialog>
      )}
    </AppShell>
  );
}
