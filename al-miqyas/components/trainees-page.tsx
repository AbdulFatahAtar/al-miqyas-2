"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppShell, PageHeader, StatusBadge } from "./app-shell";
import { Icon } from "./icons";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

type TraineeRecord = {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  status: "active" | "inactive" | "archived";
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

export function TraineesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [trainees, setTrainees] = useState<TraineeRecord[]>([]);
  const [cohorts, setCohorts] = useState<CohortRecord[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([]);
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");
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
      { data: traineeData, error: traineesError },
      { data: cohortData, error: cohortsError },
      { data: enrollmentData, error: enrollmentsError },
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("name_ar")
        .eq("id", membership.org_id)
        .single(),
      supabase
        .from("trainees")
        .select("id, code, full_name, phone, email, status")
        .eq("org_id", membership.org_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("cohorts")
        .select("id, code, title, status")
        .eq("org_id", membership.org_id)
        .neq("status", "archived")
        .order("created_at", { ascending: false }),
      supabase
        .from("enrollments")
        .select("id, trainee_id, cohort_id, status, enrolled_at")
        .eq("org_id", membership.org_id)
        .order("enrolled_at", { ascending: false }),
    ]);

    if (traineesError || cohortsError || enrollmentsError) {
      setErrorMessage("تعذر تحميل سجل المتدربين من قاعدة البيانات.");
      setIsLoading(false);
      return;
    }

    setOrganizationName(organization?.name_ar ?? "الجهة الحالية");
    setTrainees((traineeData ?? []) as TraineeRecord[]);
    setCohorts((cohortData ?? []) as CohortRecord[]);
    setEnrollments((enrollmentData ?? []) as EnrollmentRecord[]);
    setIsLoading(false);
  }, [supabase]);

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

  const canManage = role === "owner" || role === "trainer";

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

  return (
    <AppShell title="المتدرّبون">
      <PageHeader
        eyebrow="سجل المتدرّبين"
        title="المتدرّبون"
        description="سجل فعلي للمتدرّبين ومعرفاتهم والدفعات المرتبطين بها."
        actions={
          canManage ? (
            <button
              className="button button-primary"
              onClick={openCreateModal}
              disabled={cohorts.length === 0}
            >
              <Icon name="plus" size={17} />
              تسجيل متدرّب
            </button>
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
          <strong>سجل حقيقي.</strong> تعرض الصفحة بيانات {organizationName} وفق
          صلاحيات RLS، والمعرّف الموحد لا يمكن تعديله.
        </span>
      </div>

      {isLoading ? (
        <section className="content-section loading-state">
          جارٍ تحميل المتدربين...
        </section>
      ) : (
        <section className="content-section table-section">
          <div className="table-toolbar">
            <label className="search-field">
              <span className="sr-only">بحث</span>
              <Icon name="search" size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث بالاسم أو AMD-XXXXX"
              />
            </label>
            <button
              className="button button-secondary"
              onClick={() =>
                setStatusFilter((value) =>
                  value === "all"
                    ? "active"
                    : value === "active"
                      ? "inactive"
                      : "all",
                )
              }
            >
              <Icon name="filter" size={16} />
              {statusFilter === "all"
                ? "كل الحالات"
                : statusFilter === "active"
                  ? "النشطون"
                  : "غير النشطين"}
            </button>
            <span className="result-count">{filtered.length} نتيجة</span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <Icon name={trainees.length === 0 ? "trainees" : "search"} size={28} />
              <h3>
                {trainees.length === 0
                  ? "لا يوجد متدربون بعد"
                  : "لا توجد نتيجة مطابقة"}
              </h3>
              <p>
                {trainees.length === 0
                  ? "سجّل أول متدرب واربطه بالدفعة الأولى."
                  : "جرّب الاسم أو المعرف الموحد أو وسيلة التواصل."}
              </p>
              {canManage && trainees.length === 0 && cohorts.length > 0 && (
                <button className="button button-primary" onClick={openCreateModal}>
                  تسجيل أول متدرب
                </button>
              )}
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table trainees-data-table">
                <thead>
                  <tr>
                    <th>المتدرب</th>
                    <th>المعرّف</th>
                    <th>الدفعة</th>
                    <th>التواصل</th>
                    <th>الحالة</th>
                    <th>
                      <span className="sr-only">الإجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((trainee) => {
                    const enrollment = currentEnrollment(trainee.id);
                    const cohort = cohorts.find(
                      (item) => item.id === enrollment?.cohort_id,
                    );

                    return (
                      <tr key={trainee.id}>
                        <td>
                          <Link
                            className="trainee-name-link"
                            href={`/trainees/${trainee.code}`}
                          >
                            <strong>{trainee.full_name}</strong>
                            <Icon name="chevron" size={14} />
                          </Link>
                        </td>
                        <td>
                          <span className="locked-code" dir="ltr">
                            {trainee.code}
                          </span>
                        </td>
                        <td>
                          <strong>{cohort?.title ?? "غير مرتبط"}</strong>
                          {cohort && (
                            <small className="table-subtext" dir="ltr">
                              {cohort.code}
                            </small>
                          )}
                        </td>
                        <td>
                          <span className="contact-stack">
                            <span dir="ltr">{trainee.phone ?? "—"}</span>
                            <small dir="ltr">{trainee.email ?? "—"}</small>
                          </span>
                        </td>
                        <td>
                          <StatusBadge
                            tone={
                              trainee.status === "active" ? "success" : "muted"
                            }
                          >
                            {statusLabel(trainee.status)}
                          </StatusBadge>
                        </td>
                        <td>
                          {canManage && trainee.status !== "archived" && (
                            <button
                              className="button button-secondary button-compact"
                              onClick={() => openEditModal(trainee)}
                            >
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
      )}

      {modalOpen && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={closeModal}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trainee-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
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
          </section>
        </div>
      )}
    </AppShell>
  );
}
