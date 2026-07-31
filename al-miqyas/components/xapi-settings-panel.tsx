"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";

type OrganizationOption = {
  id: string;
  name: string;
  role: string;
  slug: string;
};

type XapiKeyRecord = {
  id: string;
  org_id: string;
  label: string;
  key_prefix: string;
  status: "active" | "revoked";
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type CreatedKeyResponse = {
  key: XapiKeyRecord;
  token: string;
  warning: string;
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "لم يُستخدم";
  }

  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function XapiSettingsPanel() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [keys, setKeys] = useState<XapiKeyRecord[]>([]);
  const [label, setLabel] = useState("تكامل AmadXR");
  const [createdToken, setCreatedToken] = useState("");
  const [testTokenValue, setTestTokenValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [endpoint, setEndpoint] = useState(
    "/api/integrations/xapi/statements",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadKeys = useCallback(async (targetOrganizationId: string) => {
    if (!targetOrganizationId) {
      setKeys([]);
      return;
    }

    const response = await fetch(
      `/api/integrations/xapi/keys?organizationId=${encodeURIComponent(
        targetOrganizationId,
      )}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as {
      keys?: XapiKeyRecord[];
      message?: string;
    };

    if (!response.ok) {
      throw new Error(payload.message || "تعذر تحميل مفاتيح التكامل.");
    }

    setKeys(payload.keys ?? []);
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadOrganizations() {
      setIsLoading(true);
      setError("");

      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select("org_id, role")
        .eq("status", "active")
        .in("role", ["owner"]);

      if (membershipsError || !memberships?.length) {
        if (isActive) {
          setError("إدارة مفاتيح التكامل متاحة لمالك الجهة فقط.");
          setIsLoading(false);
        }
        return;
      }

      const organizationIds = memberships.map(
        (membership) => membership.org_id,
      );
      const { data: organizationRows, error: organizationsError } =
        await supabase
          .from("organizations")
          .select("id, name_ar, slug")
          .in("id", organizationIds)
          .eq("status", "active");

      if (organizationsError || !organizationRows?.length) {
        if (isActive) {
          setError("تعذر تحميل الجهات التي تديرها.");
          setIsLoading(false);
        }
        return;
      }

      const options = organizationRows.map((organization) => ({
        id: organization.id,
        name: organization.name_ar,
        slug: organization.slug,
        role:
          memberships.find(
            (membership) => membership.org_id === organization.id,
          )?.role ?? "owner",
      }));
      const preferredOrganization =
        options.find((organization) =>
          organization.slug.includes("diwan"),
        ) ?? options[0];

      if (!isActive) {
        return;
      }

      setOrganizations(options);
      setOrganizationId(preferredOrganization.id);

      try {
        await loadKeys(preferredOrganization.id);
      } catch (loadError) {
        if (isActive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "تعذر تحميل مفاتيح التكامل.",
          );
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadOrganizations();

    return () => {
      isActive = false;
    };
  }, [loadKeys, supabase]);

  useEffect(() => {
    setEndpoint(
      `${window.location.origin}/api/integrations/xapi/statements`,
    );
  }, []);

  async function changeOrganization(targetOrganizationId: string) {
    setOrganizationId(targetOrganizationId);
    setCreatedToken("");
    setTestTokenValue("");
    setTestPassed(false);
    setMessage("");
    setError("");
    setIsLoading(true);

    try {
      await loadKeys(targetOrganizationId);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "تعذر تحميل مفاتيح التكامل.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function createKey() {
    if (!organizationId || label.trim().length < 2) {
      setError("أدخل اسمًا واضحًا للمفتاح.");
      return;
    }

    setIsSaving(true);
    setCreatedToken("");
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/integrations/xapi/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          label: label.trim(),
        }),
      });
      const payload = (await response.json()) as
        | CreatedKeyResponse
        | { message?: string };

      if (!response.ok || !("token" in payload)) {
        throw new Error(
          ("message" in payload && payload.message) ||
            "تعذر إنشاء مفتاح التكامل.",
        );
      }

      setCreatedToken(payload.token);
      setTestTokenValue(payload.token);
      setTestPassed(false);
      setKeys((currentKeys) => [payload.key, ...currentKeys]);
      setMessage("أُنشئ المفتاح. انسخه الآن قبل إغلاق هذه الرسالة.");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "تعذر إنشاء مفتاح التكامل.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function copyToken() {
    if (!createdToken) {
      return;
    }

    await navigator.clipboard.writeText(createdToken);
    setMessage("تم نسخ المفتاح. احفظه في مدير أسرار AmadXR فقط.");
  }

  async function testToken() {
    if (
      !organizationId ||
      testTokenValue.trim().length < 40 ||
      testTokenValue.trim().length > 200
    ) {
      setError("الصق مفتاح xAPI كاملًا داخل حقل الاختبار.");
      return;
    }

    setIsTesting(true);
    setTestPassed(false);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/integrations/xapi/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          token: testTokenValue.trim(),
        }),
      });
      const payload = (await response.json()) as {
        status?: string;
        accepted?: number;
        duplicates?: number;
        traineeCode?: string;
        message?: string;
      };

      if (
        !response.ok ||
        payload.status !== "passed" ||
        payload.accepted !== 1 ||
        payload.duplicates !== 1
      ) {
        throw new Error(
          payload.message || "فشل اختبار استقبال حدث xAPI.",
        );
      }

      setTestPassed(true);
      setMessage(
        `نجح الاختبار للمتدرّب ${payload.traineeCode}: قُبل الحدث ومُنع تكراره.`,
      );
      setTestTokenValue("");
      await loadKeys(organizationId);
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "فشل اختبار استقبال حدث xAPI.",
      );
    } finally {
      setIsTesting(false);
    }
  }

  async function revokeKey(keyId: string) {
    if (
      !window.confirm(
        "سيُوقف هذا المفتاح فورًا، وستُرفض كل الطلبات التي تستخدمه. هل تريد المتابعة؟",
      )
    ) {
      return;
    }

    setError("");
    setMessage("");

    const response = await fetch(
      `/api/integrations/xapi/keys/${encodeURIComponent(keyId)}`,
      { method: "DELETE" },
    );
    const payload = (await response.json()) as { message?: string };

    if (!response.ok) {
      setError(payload.message || "تعذر إلغاء المفتاح.");
      return;
    }

    setKeys((currentKeys) =>
      currentKeys.map((key) =>
        key.id === keyId
          ? {
              ...key,
              status: "revoked",
              revoked_at: new Date().toISOString(),
            }
          : key,
      ),
    );
    setMessage("أُلغي المفتاح ولن يقبل النظام أي طلب جديد به.");
  }

  const activeKeyCount = keys.filter(
    (key) => key.status === "active",
  ).length;
  return (
    <div className="xapi-settings">
      <div className="section-title">
        <div>
          <span className="eyebrow">الأداء اللحظي</span>
          <h2>تكامل AmadXR عبر xAPI</h2>
        </div>
        <StatusBadge tone={activeKeyCount > 0 ? "success" : "warning"}>
          {activeKeyCount > 0
            ? `${activeKeyCount} مفتاح نشط`
            : "لا يوجد مفتاح نشط"}
        </StatusBadge>
      </div>

      <p className="xapi-settings-intro">
        أنشئ مفتاحًا مستقلًا لديوان المظالم، ثم سلّمه لمسؤول AmadXR
        عبر مدير أسرار آمن. القيمة الخام تظهر مرة واحدة فقط.
      </p>

      {error && (
        <div className="inline-feedback danger-feedback">
          <Icon name="warning" size={17} />
          {error}
        </div>
      )}
      {message && (
        <div className="inline-feedback success-feedback">
          <Icon name="check" size={17} />
          {message}
        </div>
      )}

      <div className="xapi-endpoint-card">
        <div>
          <span>نقطة الاستقبال</span>
          <code dir="ltr">{endpoint}</code>
        </div>
        <div>
          <span>إصدار البروتوكول</span>
          <code dir="ltr">xAPI 1.0.3 · Contract 1.0</code>
        </div>
      </div>

      <div className="xapi-key-create">
        <label>
          الجهة
          <select
            value={organizationId}
            onChange={(event) =>
              void changeOrganization(event.target.value)
            }
            disabled={isLoading || organizations.length === 0}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          اسم المفتاح
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={120}
            placeholder="مثال: تكامل AmadXR للإنتاج"
          />
        </label>
        <button
          type="button"
          className="button button-primary"
          onClick={() => void createKey()}
          disabled={isSaving || isLoading || !organizationId}
        >
          <Icon name="plus" size={17} />
          {isSaving ? "جارٍ الإنشاء…" : "إنشاء مفتاح"}
        </button>
      </div>

      {createdToken && (
        <section className="xapi-secret-card" aria-live="polite">
          <div>
            <Icon name="shield" size={20} />
            <span>
              <strong>هذه آخر مرة سيظهر فيها المفتاح</strong>
              <small>لا ترسله بالبريد أو المحادثات ولا تحفظه في الكود.</small>
            </span>
          </div>
          <code dir="ltr">{createdToken}</code>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void copyToken()}
          >
            نسخ المفتاح
          </button>
        </section>
      )}

      <section className="xapi-test-card">
        <div className="xapi-test-copy">
          <span className="xapi-key-mark">
            <Icon name="source" size={18} />
          </span>
          <div>
            <strong>اختبار الاستقبال ومنع التكرار</strong>
            <small>
              الصق المفتاح هنا. سيبقى في ذاكرة الصفحة مؤقتًا ولن يُحفظ في
              قاعدة البيانات.
            </small>
          </div>
        </div>
        <label>
          <span className="sr-only">مفتاح xAPI للاختبار</span>
          <input
            type="password"
            dir="ltr"
            value={testTokenValue}
            onChange={(event) => {
              setTestTokenValue(event.target.value);
              setTestPassed(false);
            }}
            placeholder="miq_xapi_••••••••_••••••••••••••••"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="button button-primary"
          onClick={() => void testToken()}
          disabled={
            isTesting ||
            testPassed ||
            activeKeyCount === 0 ||
            testTokenValue.trim().length < 40
          }
        >
          <Icon name={testPassed ? "check" : "source"} size={17} />
          {testPassed
            ? "نجح الاختبار"
            : isTesting
              ? "جارٍ الاختبار…"
              : "اختبار المفتاح"}
        </button>
      </section>

      <div className="xapi-key-list">
        <div className="xapi-key-list-head">
          <div>
            <span className="eyebrow">المفاتيح</span>
            <h3>السجل الآمن</h3>
          </div>
          <small>لا تُعرض القيم الخام بعد الإنشاء</small>
        </div>

        {isLoading ? (
          <div className="empty-state">
            <p>جارٍ تحميل مفاتيح الجهة…</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="empty-state">
            <Icon name="shield" size={25} />
            <h3>لا توجد مفاتيح</h3>
            <p>أنشئ أول مفتاح قبل محاولة فتح الدفعة.</p>
          </div>
        ) : (
          keys.map((key) => (
            <article className="xapi-key-row" key={key.id}>
              <div className="xapi-key-mark">
                <Icon name="shield" size={18} />
              </div>
              <div className="xapi-key-name">
                <strong>{key.label}</strong>
                <code dir="ltr">{key.key_prefix}••••••••</code>
              </div>
              <div className="xapi-key-usage">
                <span>آخر استخدام</span>
                <strong>{formatTimestamp(key.last_used_at)}</strong>
              </div>
              <StatusBadge
                tone={key.status === "active" ? "success" : "danger"}
              >
                {key.status === "active" ? "نشط" : "ملغى"}
              </StatusBadge>
              <button
                type="button"
                className="button button-secondary"
                disabled={key.status === "revoked"}
                onClick={() => void revokeKey(key.id)}
              >
                إلغاء
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
