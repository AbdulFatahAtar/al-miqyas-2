"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";
import { StatusBadge } from "./app-shell";
import { AccessibleDialog } from "./accessible-dialog";
import styles from "./xapi-settings-panel.module.css";

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

export function XapiSettingsPanel({
  organizationId,
  organizationName,
  canManage,
}: {
  organizationId: string;
  organizationName: string;
  canManage: boolean;
}) {
  const [keys, setKeys] = useState<XapiKeyRecord[]>([]);
  const [label, setLabel] = useState("تكامل AmadXR");
  const [createdToken, setCreatedToken] = useState("");
  const [testTokenValue, setTestTokenValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<XapiKeyRecord | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [endpoint, setEndpoint] = useState(
    "/api/integrations/xapi/statements",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadKeys = useCallback(async (
    targetOrganizationId: string,
    signal?: AbortSignal,
  ) => {
    if (!targetOrganizationId) {
      return [];
    }

    const response = await fetch(
      `/api/integrations/xapi/keys?organizationId=${encodeURIComponent(
        targetOrganizationId,
      )}`,
      { cache: "no-store", signal },
    );
    const payload = (await response.json()) as {
      keys?: XapiKeyRecord[];
      message?: string;
    };

    if (!response.ok) {
      throw new Error(payload.message || "تعذر تحميل مفاتيح التكامل.");
    }

    return payload.keys ?? [];
  }, []);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    async function loadOrganizationKeys() {
      setIsLoading(true);
      setError("");

      try {
        const loadedKeys = await loadKeys(organizationId, controller.signal);
        if (isActive) {
          setKeys(loadedKeys);
        }
      } catch (loadError) {
        if (
          isActive &&
          !(loadError instanceof DOMException && loadError.name === "AbortError")
        ) {
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

    void loadOrganizationKeys();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [loadKeys, organizationId]);

  useEffect(() => {
    setEndpoint(
      `${window.location.origin}/api/integrations/xapi/statements`,
    );
  }, []);

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

    try {
      await navigator.clipboard.writeText(createdToken);
      setError("");
      setMessage("تم نسخ المفتاح. احفظه في مدير أسرار AmadXR فقط.");
    } catch {
      setMessage("");
      setError(
        "تعذر النسخ التلقائي. انسخ المفتاح يدويًا قبل إغلاق الصفحة.",
      );
    }
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
      setTestTokenValue("");
      try {
        setKeys(await loadKeys(organizationId));
        setMessage(
          `نجح الاختبار للمتدرّب ${payload.traineeCode}: قُبل الحدث ومُنع تكراره.`,
        );
      } catch {
        setMessage(
          `نجح الاختبار للمتدرّب ${payload.traineeCode}، لكن تعذر تحديث سجل المفاتيح.`,
        );
      }
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

  async function revokeKey() {
    if (!revokeTarget || revokeReason.trim().length < 5) {
      setError("اكتب سببًا واضحًا لإلغاء المفتاح.");
      return;
    }

    setIsRevoking(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/integrations/xapi/keys/${encodeURIComponent(revokeTarget.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: revokeReason.trim() }),
        },
      );
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "تعذر إلغاء المفتاح.");
      }

      setKeys((currentKeys) =>
        currentKeys.map((key) =>
          key.id === revokeTarget.id
            ? {
                ...key,
                status: "revoked",
                revoked_at: new Date().toISOString(),
              }
            : key,
        ),
      );
      setRevokeTarget(null);
      setRevokeReason("");
      setMessage("أُلغي المفتاح ولن يقبل النظام أي طلب جديد به.");
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "تعذر إلغاء المفتاح.",
      );
    } finally {
      setIsRevoking(false);
    }
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
        أنشئ مفتاحًا مستقلًا لجهة {organizationName}، ثم سلّمه لمسؤول AmadXR
        عبر مدير أسرار آمن. القيمة الخام تظهر مرة واحدة فقط.
      </p>

      {error && (
        <div className="inline-feedback danger-feedback" role="alert">
          <Icon name="warning" size={17} />
          {error}
        </div>
      )}
      {message && (
        <div className="inline-feedback success-feedback" role="status">
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
          الجهة الحالية
          <input value={organizationName} readOnly />
        </label>
        <label>
          اسم المفتاح
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={120}
            placeholder="مثال: تكامل AmadXR للإنتاج"
            disabled={!canManage}
          />
        </label>
        <button
          type="button"
          className="button button-primary"
          onClick={() => void createKey()}
          disabled={!canManage || isSaving || isLoading || !organizationId}
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
          <span className={styles.testFieldLabel}>مفتاح xAPI للاختبار</span>
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
            disabled={!canManage}
          />
        </label>
        <button
          type="button"
          className="button button-primary"
          onClick={() => void testToken()}
          disabled={
            !canManage ||
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

      {revokeTarget && (
        <AccessibleDialog
          labelledBy="xapi-revoke-title"
          describedBy="xapi-revoke-description"
          className={styles.revokeDialog}
          disableClose={isRevoking}
          onClose={() => {
            setRevokeTarget(null);
            setRevokeReason("");
          }}
        >
          <div>
            <Icon name="warning" size={20} />
            <span>
              <strong id="xapi-revoke-title">تأكيد إلغاء المفتاح</strong>
              <small id="xapi-revoke-description">
                سيتوقف <bdi dir="ltr">{revokeTarget.key_prefix}</bdi> فورًا،
                ولن يُستعاد عند إعادة تفعيل الجهة.
              </small>
            </span>
          </div>
          <label>
            سبب الإلغاء
            <textarea
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              minLength={5}
              maxLength={500}
              autoFocus
              required
              disabled={isRevoking}
            />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={isRevoking}
              onClick={() => {
                setRevokeTarget(null);
                setRevokeReason("");
              }}
            >
              تراجع
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={isRevoking || revokeReason.trim().length < 5}
              onClick={() => void revokeKey()}
            >
              {isRevoking ? "جارٍ الإلغاء…" : "إلغاء المفتاح نهائيًا"}
            </button>
          </div>
        </AccessibleDialog>
      )}

      <div className="xapi-key-list">
        <div className="xapi-key-list-head">
          <div>
            <span className="eyebrow">المفاتيح</span>
            <h3>السجل الآمن</h3>
          </div>
          <small>لا تُعرض القيم الخام بعد الإنشاء</small>
        </div>

        {isLoading ? (
          <div className="empty-state" aria-live="polite">
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
                disabled={!canManage || key.status === "revoked"}
                onClick={() => {
                  setRevokeTarget(key);
                  setRevokeReason("");
                  setError("");
                  setMessage("");
                }}
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
