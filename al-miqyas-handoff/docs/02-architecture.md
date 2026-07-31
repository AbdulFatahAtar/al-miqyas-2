# 02 — المعمار التقني

## 1. التقنيات (Tech stack)

| الطبقة | التقنية | لماذا |
|---|---|---|
| Frontend + API | **Next.js 14+ (App Router) + TypeScript** | معيار الأمد القائم (React/Next.js design system) |
| Styling | **Tailwind CSS** | RTL-first عبر logical properties |
| Charts | **Recharts** | مستخدمة في نموذج v2 المرفق |
| DB / Auth / Functions | **Supabase** (Postgres + RLS + Auth + Edge Functions) | مملوك للأمد؛ مشروعان قائمان بالفعل (vault + cards) |
| Hosting | **Vercel** | حساب الأمد قائم (al-amad-vault.vercel.app) |
| Forms capture | **Jotform** (API + webhooks + URL prefill) | النماذج الحية قائمة بمعرّفاتها |
| Telemetry | **xAPI subset** (statements POST endpoint) | متوافق مع معمار AmadXR القائم |
| QR | مكتبة `qrcode` (server-side generation) | البطاقات الرقمية قائمة: cards.al-amad.com.sa |
| AI (لاحقاً) | **Anthropic API** | توليد بنوك أسئلة من المحتوى المرجعي (امتداد خط ناسج) |

## 2. الدومين والاستضافة — قرار محسوم

- **الدومين**: `miqyas.al-amad.com.sa` — سجل DNS من نوع CNAME يشير إلى Vercel.
- **تنبيه مهم**: موقع al-amad.com.sa الرئيسي يعمل على WordPress. **لا يُستضاف هذا
  النظام على استضافة WordPress إطلاقاً** — التطبيق يعيش على Vercel والبيانات على
  Supabase، وكلاهما تحت حسابات الأمد المملوكة. "سيرفر الأمد" هنا يعني البنية التحتية
  المملوكة للأمد (Supabase + Vercel)، لا خادم الووردبريس.
- صفحة التحقق العامة: `miqyas.al-amad.com.sa/verify/{code}` — بلا تسجيل دخول.

## 3. تعدد المستأجرين (Multi-tenancy) — B2B white-label

كل جهة تدريبية (مستشفى، كلية، أكاديمية، جهة حكومية) = **organization** مستقلة:

- **العزل**: عمود `org_id` في كل جدول + سياسات RLS تمنع أي وصول عابر للمستأجرين.
  العزل في قاعدة البيانات نفسها — ليس في كود التطبيق فقط.
- **الهوية البصرية لكل جهة**: `name_ar/name_en`, `logo_url`, `brand_color`,
  `slug`. الواجهة تقرأ هذه الحقول وتُلوّن نفسها (انظر النموذج v2 — مبدّل الجهات
  يعرض هذا حياً). الشهادات تصدر بشعار الجهة + توقيع الأمد كمشغّل للمنظومة.
- **الأدوار داخل الجهة**: `owner` / `trainer` / `viewer` عبر جدول `memberships`
  مربوط بـ Supabase Auth.
- **الوصول للبيانات**: كل جهة ترى متدرّبيها وبرامجها وتقاريرها فقط. الأمد (super
  admin) يرى الكل عبر دور `platform_admin`.

## 4. تدفق البيانات (Data flow)

```
[التسجيل] trainee registered → generate AMD-XXXXX → QR card (cards system)
     │
     ▼ (QR scan #1)
[قبلي] Jotform prefilled+locked traineeId ──webhook──► Edge Function: ingest-jotform
     │                                                        │ score + store
     ▼ (QR scan #2 at XR station)                             ▼
[لحظي] AmadXR dashboard ──POST /api/xapi──► xapi_statements (actor = AMD-XXXXX)
     │
     ▼ (QR scan #3)
[بعدي] Jotform prefilled+locked traineeId ──webhook──► ingest-jotform
     │
     ▼ (trigger: post received AND pre exists AND xAPI session exists)
[محرك الأثر] compute: knowledge Δ, min uplift, SD compression (cohort),
             confidence Δ, live-performance summary → impact_reports
     │
     ▼ (pass criteria met)
[شهادة] certificates: verify_code + metrics snapshot → /verify/{code} + QR
```

- **Ingestion مزدوج**: webhook فوري + مهمة سحب دورية (reconciliation) عبر Jotform
  API كل ساعة لالتقاط أي فاقد. لا يُعتمد على webhook وحده.
- **Idempotency**: `submission_id` من Jotform مفتاح فريد — التكرار يُتجاهل.

## 5. بنية المشروع المقترحة (Repo structure)

```
al-miqyas/
├── app/
│   ├── (public)/verify/[code]/page.tsx      # صفحة التحقق العامة
│   ├── (tenant)/[org]/dashboard/            # لوحة الجهة
│   ├── (tenant)/[org]/trainees/             # المتدرّبون + توليد QR
│   ├── (tenant)/[org]/programs/             # البرامج وربط نماذج Jotform
│   ├── (tenant)/[org]/reports/              # تقارير الأثر (فردي/جماعي)
│   └── api/
│       ├── xapi/route.ts                    # استقبال أحداث اللوحة
│       └── webhooks/jotform/route.ts        # استقبال إرسالات النماذج
├── lib/
│   ├── id.ts                                # توليد AMD-XXXXX (أبجدية آمنة)
│   ├── scoring.ts                           # تصحيح الإجابات مقابل مفتاح البرنامج
│   ├── impact.ts                            # حسابات الأثر (Δ, min, SD, ...)
│   └── supabase/                            # عملاء server/client
├── supabase/
│   ├── migrations/                          # من docs/03-database-schema.sql
│   └── functions/ingest-jotform/            # Edge Function
└── docs/                                    # هذه الحزمة
```

## 6. الأمان — الحد الأدنى غير القابل للتنازل

1. RLS مفعّلة على كل الجداول من أول migration. لا استعلام يمر بدون org scope.
2. مفاتيح Jotform API و webhook secrets في متغيرات بيئة Vercel/Supabase فقط —
   لا تُوضع في كود الواجهة أبداً (هذا سبب عدم بناء السحب داخل نموذج المتصفح).
3. endpoint الـ xAPI محمي بمفتاح لكل جهة (`org_api_keys`) + rate limiting.
4. صفحة التحقق تعرض الحد الأدنى: الاسم، البرنامج، الحالة، التاريخ — لا درجات تفصيلية.
5. بيانات المتدرّبين شخصية — تخضع لنظام حماية البيانات الشخصية السعودي (PDPL):
   لا تُصدَّر ولا تُشارك خارج جهتها.
