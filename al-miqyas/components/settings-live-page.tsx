"use client";

import { useState } from "react";
import { AppShell, PageHeader } from "./app-shell";
import { XapiSettingsPanel } from "./xapi-settings-panel";

type SettingsTab = "integrations" | "general" | "security";

export function SettingsLivePage() {
  const [tab, setTab] = useState<SettingsTab>("integrations");

  return (
    <AppShell title="الإعدادات">
      <PageHeader
        eyebrow="إعدادات الجهة"
        title="الإعدادات"
        description="إدارة التكاملات والمفاتيح والسياسات المرتبطة بالجهة الحالية."
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="أقسام الإعدادات">
          <button
            className={tab === "integrations" ? "active" : ""}
            onClick={() => setTab("integrations")}
          >
            التكاملات
          </button>
          <button
            className={tab === "general" ? "active" : ""}
            onClick={() => setTab("general")}
          >
            الهوية العامة
          </button>
          <button
            className={tab === "security" ? "active" : ""}
            onClick={() => setTab("security")}
          >
            الأمان والصلاحيات
          </button>
        </nav>

        <section className="content-section settings-panel">
          {tab === "integrations" && <XapiSettingsPanel />}
          {tab === "general" && (
            <div className="empty-state">
              <h2>إدارة هوية الجهة لم تُربط بعد</h2>
              <p>هذه الصفحة ستُحوّل إلى بيانات حقيقية ضمن المهمة 5.</p>
            </div>
          )}
          {tab === "security" && (
            <div className="empty-state">
              <h2>إدارة الأدوار ستُستكمل لاحقًا</h2>
              <p>
                عزل البيانات مطبق في قاعدة البيانات، أما واجهة الإدارة فتدخل
                ضمن المهمة 5.
              </p>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

