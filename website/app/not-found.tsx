import Link from "next/link";
import { ThemeToggle } from "../components/theme-toggle";
import styles from "./route-state.module.css";

export default function NotFound() {
  return (
    <main className={styles.statePage}>
      <header className={styles.stateMasthead}>
        <Link href="/" className={styles.wordmark}>منظومة المقياس</Link>
        <ThemeToggle compact />
      </header>
      <section className={styles.stateLedger} aria-labelledby="not-found-title">
        <div className={styles.stateCode} aria-hidden="true">
          <span>نتيجة البحث</span>
          <strong>404</strong>
        </div>
        <div className={styles.stateCopy}>
          <p>لا يوجد سجل مطابق لهذا المسار</p>
          <h1 id="not-found-title">الصفحة غير موجودة</h1>
          <span>
            الرابط قديم أو غير مكتمل. استخدم مسار التحقق للشهادات، أو ارجع إلى
            بوابة الدخول للوصول إلى سجلات الجهة.
          </span>
          <div className={styles.stateActions}>
            <Link className="button button-primary" href="/verify">التحقق من شهادة</Link>
            <Link className="button button-secondary" href="/login">بوابة الدخول</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
