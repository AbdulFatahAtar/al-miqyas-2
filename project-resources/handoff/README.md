# منظومة المقياس — حزمة تسليم المشروع
## Al-Miqyas: Measurement & Proof System — Project Handoff Package

**شركة الأمد التقنية** — Al-Amad Technology Co. · Makkah, Saudi Arabia
**Prepared:** July 2026 · **Owner:** Tariq Aldafi (tariq@al-amad.com.sa)

---

## ما هذا المشروع؟ (What is this?)

المقياس هو نظام القياس والإثبات الخاص بشركة الأمد — وهو **قلب تمايز الشركة**.
الأمد تبني منظومة محاكاة احترافية متكاملة لصناعة الإتقان، وتمايزها ليس في تقنية
الأجهزة بل في **نظام القياس**: قياس قبلي، أداء لحظي بالبيانات، قياس بعدي، شهادة معتمدة.

Al-Miqyas ingests data from 3 sources, joins them on a **single unified trainee ID**,
computes learning impact, and issues verifiable certificates:

```
Pre-test (Jotform) ──┐
Live performance ────┼──► Supabase (owned store) ──► Compute engine (Next.js/Vercel)
  (XR dashboard/xAPI)│                                        │
Post-test (Jotform) ─┘                              ┌─────────┴─────────┐
                                                    ▼                   ▼
                                              Impact report      Verifiable certificate
```

**This is a B2B multi-tenant system**: each client organization (جهة تدريبية) gets its
own account, branding (logo + colors), trainees, programs, and reports — fully isolated.

---

## محتويات الحزمة (Package contents)

| ملف | المحتوى |
|---|---|
| `docs/01-project-brief.md` | وثيقة المشروع: الرؤية، القرارات المحسومة، نتائج البيانات الحقيقية |
| `docs/02-architecture.md` | المعمار التقني، التقنيات، تعدد المستأجرين، الدومين والاستضافة |
| `docs/03-database-schema.sql` | مخطط قاعدة البيانات كاملاً مع RLS — جاهز للتنفيذ على Supabase |
| `docs/04-roadmap.md` | خارطة طريق 12 أسبوعاً بمخرجات كل مرحلة ومعايير قبولها |
| `docs/05-integrations.md` | تكاملات Jotform (prefill/webhook/API) و xAPI و QR وصفحة التحقق |
| `prototype/al-miqyas-v2.jsx` | النموذج الأولي المطوّر (v2) — المرجع البصري والوظيفي للواجهات |
| `.env.example` | قالب متغيرات البيئة |

**Start here:** read `01-project-brief.md` → `02-architecture.md` → run the schema →
follow the roadmap. The prototype is your visual spec — the production UI should match
its logic and Arabic-first RTL design.

---

## قرارات محسومة — غير قابلة للنقاش (Non-negotiable decisions)

1. **Unified trainee ID** `AMD-XXXXX` — generated ONCE at registration, propagated to
   every touchpoint (pre-test, XR session, post-test) via QR + URL prefill. Never
   collected manually twice. This decision exists because real field data broke:
   12 pre-test vs 7 post-test submissions matched only by hand-typed phone numbers.
2. **Owned infrastructure**: Supabase (DB/Auth/Edge Functions) + Vercel (Next.js app),
   under Al-Amad's own accounts, on subdomain **miqyas.al-amad.com.sa**. The system is
   Al-Amad IP — no logic lives inside third-party tools.
3. **Jotform is a capture device, not a database.** It collects answers; everything is
   pulled/pushed into Supabase immediately. The impact logic lives in our engine only.
4. **Multi-tenancy via Postgres RLS from day one** — not bolted on later.
5. **Arabic-first, RTL-first UI.** Latin numerals everywhere. Tested on iPhone/Safari.

---

## التواصل والدعم (Support)

- Product owner: Tariq Aldafi — tariq@al-amad.com.sa · WhatsApp +966554489390
- Technical co-founder: Eng. Youssef Al-Husseini (الشريك التقني)
- All code goes into Al-Amad-owned GitHub repos. All credentials via Al-Amad accounts.
