"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  permissionDefinitions,
  roleLabels,
  rolePermissionMatrix,
  type RoleKey,
} from "../lib/auth/permissions";
import type { ClientAccessOrganization } from "./access-provider";
import { AppShell, StatusBadge } from "./app-shell";
import { Icon, type IconName } from "./icons";
import { XapiSettingsPanel } from "./xapi-settings-panel";
import styles from "./settings-live-page.module.css";

type SettingsTab = "integrations" | "general" | "security";

const settingsTabs: Array<{
  id: SettingsTab;
  index: string;
  label: string;
  detail: string;
  icon: IconName;
}> = [
  {
    id: "integrations",
    index: "01",
    label: "التكاملات",
    detail: "نقاط الاستقبال والمفاتيح",
    icon: "source",
  },
  {
    id: "general",
    index: "02",
    label: "هوية الجهة",
    detail: "الاسم والنطاق والحالة",
    icon: "organizations",
  },
  {
    id: "security",
    index: "03",
    label: "الأمان والصلاحيات",
    detail: "الدور ونطاق الوصول",
    icon: "shield",
  },
];

const organizationStatus = {
  active: { label: "نشطة", tone: "success" as const },
  suspended: { label: "معلّقة", tone: "warning" as const },
  archived: { label: "مؤرشفة", tone: "muted" as const },
};

const permissionLabels = new Map(
  permissionDefinitions.map((permission) => [permission.key, permission.label]),
);

export function SettingsLivePage({
  organization,
  canManageIntegrations,
}: {
  organization: ClientAccessOrganization;
  canManageIntegrations: boolean;
}) {
  const [tab, setTab] = useState<SettingsTab>("integrations");
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({
    integrations: null,
    general: null,
    security: null,
  });

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: SettingsTab,
  ) {
    const currentIndex = settingsTabs.findIndex((item) => item.id === currentTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex + 1) % settingsTabs.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      nextIndex = (currentIndex - 1 + settingsTabs.length) % settingsTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = settingsTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = settingsTabs[nextIndex].id;
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <AppShell title="الإعدادات">
      <header className={styles.pageIntro}>
        <div className={styles.pageIdentity}>
          <span className={styles.pageIndex} aria-hidden="true">08</span>
          <div>
            <p>وثيقة ضبط الجهة</p>
            <h1>الإعدادات</h1>
            <span>
              قراءة واعتماد نطاق الجهة والتكاملات والدور الحالي من موضع واحد.
            </span>
          </div>
        </div>
        <dl className={styles.contextStamp}>
          <div>
            <dt>الجهة الحالية</dt>
            <dd>{organization.name_ar}</dd>
          </div>
          <div>
            <dt>النطاق</dt>
            <dd dir="ltr">{organization.slug}</dd>
          </div>
          <div>
            <dt>الحالة</dt>
            <dd>
              <StatusBadge tone={organizationStatus[organization.status].tone}>
                {organizationStatus[organization.status].label}
              </StatusBadge>
            </dd>
          </div>
        </dl>
      </header>

      <div className={styles.settingsDocument}>
        <nav
          className={styles.clauseIndex}
          aria-label="أقسام وثيقة الضبط"
          role="tablist"
          aria-orientation="vertical"
        >
          <header>
            <span>فهرس الوثيقة</span>
            <strong>03 بنود</strong>
          </header>
          {settingsTabs.map((item) => (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[item.id] = element;
              }}
              id={`settings-tab-${item.id}`}
              type="button"
              role="tab"
              tabIndex={tab === item.id ? 0 : -1}
              aria-selected={tab === item.id}
              aria-controls={`settings-panel-${item.id}`}
              className={tab === item.id ? styles.activeClause : undefined}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, item.id)}
            >
              <span className={styles.clauseNumber}>{item.index}</span>
              <Icon name={item.icon} size={18} />
              <span className={styles.clauseCopy}>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          ))}
          <p className={styles.indexNote}>
            استخدم أسهم لوحة المفاتيح للتنقل بين البنود.
          </p>
        </nav>

        <section
          id={`settings-panel-${tab}`}
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`settings-tab-${tab}`}
          className={styles.documentBody}
        >
          {tab === "integrations" && (
            <IntegrationDocument
              organization={organization}
              canManage={canManageIntegrations}
            />
          )}
          {tab === "general" && <OrganizationDocument organization={organization} />}
          {tab === "security" && <SecurityDocument organization={organization} />}
        </section>
      </div>
    </AppShell>
  );
}

function DocumentHeading({
  index,
  label,
  title,
  description,
  status,
}: {
  index: string;
  label: string;
  title: string;
  description: string;
  status?: ReactNode;
}) {
  return (
    <header className={styles.documentHeading}>
      <span className={styles.documentIndex}>{index}</span>
      <div>
        <p>{label}</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </div>
      {status && <div className={styles.documentStatus}>{status}</div>}
    </header>
  );
}

function IntegrationDocument({
  organization,
  canManage,
}: {
  organization: ClientAccessOrganization;
  canManage: boolean;
}) {
  return (
    <div className={styles.integrationDocument}>
      <DocumentHeading
        index="01"
        label="بند التكاملات"
        title="استقبال الأداء اللحظي"
        description="مفاتيح الجهة ونقطة استقبال أحداث xAPI. القيم الخام لا تظهر بعد إنشائها."
        status={
          <StatusBadge tone={canManage ? "success" : "muted"}>
            {canManage ? "إدارة مسموحة" : "قراءة فقط"}
          </StatusBadge>
        }
      />
      {!canManage && (
        <p className={styles.readOnlyNotice} role="note">
          <Icon name="lock" size={17} />
          دورك الحالي يستطيع قراءة إعدادات التكامل، لكنه لا يستطيع إنشاء مفتاح أو إلغاءه.
        </p>
      )}
      <XapiSettingsPanel
        organizationId={organization.id}
        organizationName={organization.name_ar}
        canManage={canManage}
      />
    </div>
  );
}

function OrganizationDocument({
  organization,
}: {
  organization: ClientAccessOrganization;
}) {
  const status = organizationStatus[organization.status];

  return (
    <div>
      <DocumentHeading
        index="02"
        label="بند هوية الجهة"
        title="البيانات المعتمدة"
        description="هذه القيم من سجل الجهة الحالي وليست حقولًا تجريبية. تعديل الحالة محصور في مركز منصة الأمد."
        status={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      />

      <dl className={styles.definitionLedger}>
        <DefinitionRow
          index="01"
          label="الاسم العربي"
          value={organization.name_ar}
          source="organizations.name_ar"
        />
        <DefinitionRow
          index="02"
          label="الاسم الإنجليزي"
          value={organization.name_en ?? "غير مضاف"}
          source="organizations.name_en"
          direction="auto"
        />
        <DefinitionRow
          index="03"
          label="المعرّف المختصر"
          value={organization.slug}
          source="organizations.slug"
          direction="ltr"
        />
        <div className={styles.definitionRow}>
          <dt><span className={styles.rowIndex}>04</span><b>لون الجهة</b></dt>
          <dd className={styles.colorValue}>
            <i style={{ backgroundColor: organization.brand_color }} aria-hidden="true" />
            <bdi dir="ltr">{organization.brand_color}</bdi>
          </dd>
          <dd className={styles.rowSource} dir="ltr">organizations.brand_color</dd>
        </div>
        <DefinitionRow
          index="05"
          label="الشعار"
          value={organization.logo_url ? "شعار مسجّل" : "لم يُرفع شعار بعد"}
          source="organizations.logo_url"
        />
      </dl>

      <section className={styles.governanceNote} aria-labelledby="governance-title">
        <Icon name="shield" size={21} />
        <div>
          <span>قاعدة حوكمة</span>
          <h3 id="governance-title">حالة الجهة لا يغيّرها مالك الجهة</h3>
          <p>
            التعليق والأرشفة والاستعادة إجراءات منصة، وتُسجّل في سجل التدقيق عند تنفيذها.
          </p>
        </div>
      </section>
    </div>
  );
}

function SecurityDocument({
  organization,
}: {
  organization: ClientAccessOrganization;
}) {
  const role = organization.role as RoleKey;
  const permissions = rolePermissionMatrix[role];
  const isPlatformOwner = role === "platform_owner";

  return (
    <div>
      <DocumentHeading
        index="03"
        label="بند الأمان والصلاحيات"
        title="نطاق الدور الحالي"
        description={
          isPlatformOwner
            ? "هذا حساب منصة رئيسي؛ يعرض النطاق الشامل، بينما يبقى كل إجراء مقيدًا بسياق الجهة وسجل التدقيق."
            : "الصلاحيات المعروضة تخص عضويتك داخل الجهة الحالية، ولا تمنح وصولًا لبيانات جهة أخرى."
        }
        status={<StatusBadge tone="system">{permissions.length} صلاحية</StatusBadge>}
      />

      <section className={styles.roleDecision} aria-labelledby="role-title">
        <span className={styles.roleMark}><Icon name="shield" size={22} /></span>
        <div>
          <span>الدور المطبّق</span>
          <h3 id="role-title">{roleLabels[role]}</h3>
          <bdi dir="ltr">{role}</bdi>
        </div>
        <p>
          {isPlatformOwner
            ? "النفاذ الشامل لا يلغي عزل السياق؛ التحقق يتم في الخادم وقاعدة البيانات وتُسجّل إجراءات المنصة."
            : "التحقق الفعلي يتم في الخادم وقواعد البيانات؛ هذه القائمة تشرح النطاق ولا تستبدل الحماية."}
        </p>
      </section>

      <section className={styles.permissionRegister} aria-labelledby="permissions-title">
        <header>
          <div>
            <span>سجل السماح</span>
            <h3 id="permissions-title">الإجراءات المتاحة لهذا الدور</h3>
          </div>
          <small>
            {isPlatformOwner ? "نطاق المنصة والجهة المحددة" : `ضمن ${organization.name_ar}`}
          </small>
        </header>
        <ol>
          {permissions.map((permission, index) => (
            <li key={permission}>
              <span className={styles.permissionIndex}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={styles.permissionState} aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
              <div>
                <strong>{permissionLabels.get(permission) ?? permission}</strong>
                <code dir="ltr">{permission}</code>
              </div>
              <b>مسموح</b>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function DefinitionRow({
  index,
  label,
  value,
  source,
  direction,
}: {
  index: string;
  label: string;
  value: string;
  source: string;
  direction?: "ltr" | "auto";
}) {
  return (
    <div className={styles.definitionRow}>
      <dt><span className={styles.rowIndex}>{index}</span><b>{label}</b></dt>
      <dd dir={direction}>{value}</dd>
      <dd className={styles.rowSource} dir="ltr">{source}</dd>
    </div>
  );
}
