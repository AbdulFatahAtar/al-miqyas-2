"use client";

import { useEffect } from "react";
import styles from "./route-state.module.css";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.statePage}>
      <section className={styles.stateLedger} aria-labelledby="error-title">
        <div className={styles.stateCode} aria-hidden="true">
          <span>حالة النظام</span>
          <strong>500</strong>
        </div>
        <div className={styles.stateCopy}>
          <p>تعذر إكمال قراءة السجل</p>
          <h1 id="error-title">حدث خلل أثناء فتح الصفحة</h1>
          <span>
            لم تُعرض بيانات بديلة أو تجريبية. أعد المحاولة، وإذا استمر الخلل
            فارجع إلى الملخص واختر سجلًا آخر.
          </span>
          <div className={styles.stateActions}>
            <button className="button button-primary" type="button" onClick={reset}>
              إعادة المحاولة
            </button>
            <a className="button button-secondary" href="/dashboard">العودة إلى الملخص</a>
          </div>
        </div>
      </section>
    </main>
  );
}
