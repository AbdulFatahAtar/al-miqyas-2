import Link from "next/link";
import { ThemeToggle } from "../../components/theme-toggle";
import { requireAuthenticatedUser } from "../../lib/auth/server";
import styles from "../route-state.module.css";

export default async function ForbiddenPage() {
  await requireAuthenticatedUser("/forbidden");

  return (
    <main className={styles.statePage}>
      <header className={styles.stateMasthead}>
        <Link href="/dashboard" className={styles.wordmark}>
          منظومة المقياس
        </Link>
        <ThemeToggle compact />
      </header>
      <section className={styles.stateLedger} aria-labelledby="access-denied-title">
        <div className={styles.stateCode} aria-hidden="true">
          <span>قرار وصول</span>
          <strong>403</strong>
        </div>
        <div className={styles.stateCopy}>
          <p>الطلب مرفوض من طبقة الصلاحيات</p>
          <h1 id="access-denied-title">لا تملك صلاحية فتح هذه الصفحة</h1>
          <span>
            تم التحقق من الجلسة، لكن الدور الحالي لا يسمح بهذا الإجراء أو بهذا
            النطاق. تغيير الرابط يدويًا لا يتجاوز صلاحيات الحساب.
          </span>
          <div className={styles.stateActions}>
            <Link className="button button-primary" href="/dashboard">
              العودة إلى الملخص
            </Link>
            <Link className="button button-secondary" href="/account">
              عرض حسابي
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
