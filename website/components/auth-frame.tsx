"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import styles from "./auth-pages.module.css";

export function AuthFrame({
  children,
  title,
  description,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  description: string;
  wide?: boolean;
}) {
  return (
    <main className={styles.page}>
      <aside className={styles.ledgerAside} aria-label="تعريف المنظومة">
        <div className={styles.brand}>
          <Image
            src="/brand/al-amad-mark-transparent.png"
            alt="شعار شركة الأمد"
            width={48}
            height={48}
          />
          <span>
            <strong>منظومة المقياس</strong>
            <small>شركة الأمد</small>
          </span>
        </div>

        <div className={styles.asideBody}>
          <span className={styles.recordCode} dir="ltr">ACCESS / LEDGER</span>
          <h1>الدخول إلى سجل القياس المؤسسي.</h1>
          <p>
            تجمع المنظومة القياس القبلي والأداء اللحظي والقياس البعدي تحت
            معرّف واحد، وتبقي كل نتيجة مرتبطة بمصدرها وصلاحية الوصول إليها.
          </p>
          <ol className={styles.evidenceRail} aria-label="سلسلة الإثبات">
            <li><i>01</i><strong>هوية المستخدم</strong><span>تُفحص عند الدخول</span></li>
            <li><i>02</i><strong>عضوية الجهة</strong><span>تُحسم بعد الدخول</span></li>
            <li><i>03</i><strong>صلاحية الإجراء</strong><span>تُراجع لكل طلب</span></li>
          </ol>
        </div>

        <div className={styles.asideFoot}>
          <Icon name="shield" size={19} />
          <span>
            لا يفتح تسجيل الدخول بيانات أي جهة قبل التحقق من عضوية نشطة
            وصلاحية صحيحة.
          </span>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.workspaceBar}>
          <div className={styles.mobileBrand}>
            <Image
              src="/brand/al-amad-mark-transparent.png"
              alt="شعار شركة الأمد"
              width={40}
              height={40}
            />
            <strong>منظومة المقياس</strong>
          </div>
          <ThemeToggle compact />
        </header>
        <div className={`${styles.panel} ${wide ? styles.panelWide : ""}`}>
          <header className={styles.docHead}>
            <span className={styles.kicker}>وصول مؤسسي موثق</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </header>
          {children}
          <nav className={styles.footerLinks} aria-label="روابط الوصول العامة">
            <Link href="/verify">التحقق من شهادة</Link>
            <span aria-hidden="true">·</span>
            <Link href="/register">طلب الانضمام</Link>
          </nav>
        </div>
      </section>
    </main>
  );
}
