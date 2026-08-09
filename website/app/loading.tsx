import styles from "./route-state.module.css";

export default function Loading() {
  return (
    <main className={styles.loadingPage} role="status" aria-live="polite">
      <span className="sr-only">جارٍ تحميل الصفحة</span>
      <div className={styles.loadingIndex} aria-hidden="true">سجل</div>
      <div className={styles.loadingBody} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className={styles.loadingStamp} aria-hidden="true" />
    </main>
  );
}
