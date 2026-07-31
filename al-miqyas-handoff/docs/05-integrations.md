# 05 — التكاملات

## 1. Jotform

### النماذج الحية الحالية (مرجع)
| النموذج | Form ID |
|---|---|
| الاختبار القبلي — نبض الأمد BLS | 261781032160044 |
| الاختبار البعدي — نبض الأمد BLS | 261781060293052 |
| استبيان سالك المشاعر (مرجع نمط) | 261347718881063 |

### أ. التعبئة المسبقة والقفل (Prefill + read-only)
- يُضاف لكل نموذج حقل نصي قصير باسم فريد `traineeId`
- التعبئة عبر الرابط: `https://form.jotform.com/{FORM_ID}?traineeId=AMD-7K9FQ`
  (اسم المَعطى = الاسم الفريد للحقل في Jotform)
- **يُقفل الحقل للقراءة فقط** من إعدادات الحقل — يُملأ من الرابط حصراً، لا بيد
  المتدرّب. هذا غير قابل للتنازل: الحقل القابل للتحرير يعيد الخطأ اليدوي.
- إن قدّم Jotform خيار إخفاء الحقل مع بقاء قيمته في الإرسال، يُفضَّل الإخفاء
  (تجربة أنظف للمتدرّب).

### ب. Webhook (فوري)
- من إعدادات النموذج → Integrations → Webhooks →
  `https://miqyas.al-amad.com.sa/api/webhooks/jotform`
- يُرسل Jotform الإرسال كاملاً POST عند كل submit
- نتحقق من مصدر الطلب (secret في query param أو تحقق من IP) ثم:
  1. استخراج `traineeId` و`submission_id` والإجابات
  2. تجاهل إن كان `submission_id` موجوداً (idempotency)
  3. تصحيح مقابل `answer_key` للبرنامج → حفظ في `assessments`
  4. إن كان `kind = post` وتوفر قبلي + جلسة لحظية → تشغيل محرك الأثر

### ج. السحب الدوري (Reconciliation — كل ساعة)
- Endpoint: `GET https://api.jotform.com/form/{FORM_ID}/submissions?apiKey={KEY}`
- المفتاح في متغير بيئة `JOTFORM_API_KEY` (سرّي، server-side فقط)
- الغرض: التقاط أي إرسال فاته الـ webhook. نفس مسار المعالجة، نفس idempotency.
- **تم التحقق عملياً (يوليو 2026)**: سحب النموذجين أعلاه عبر API يعمل ويعيد
  البيانات كاملة.

## 2. xAPI (الأداء اللحظي من لوحة الأمد)

### Endpoint
`POST https://miqyas.al-amad.com.sa/api/xapi`
- Header: `Authorization: Bearer {org_api_key}`
- Body: xAPI statement (مفرد أو مصفوفة)

### شكل الـ statement المعتمد (subset)
```json
{
  "actor": {
    "account": {
      "homePage": "https://miqyas.al-amad.com.sa",
      "name": "AMD-7K9FQ"
    }
  },
  "verb": { "id": "https://miqyas.al-amad.com.sa/verbs/adjusted",
            "display": { "ar": "ضبط" } },
  "object": { "id": "https://miqyas.al-amad.com.sa/objects/compression-depth",
              "definition": { "name": { "ar": "عمق الضغط" } } },
  "result": { "success": true,
              "extensions": { "value": 5.2, "unit": "cm", "inRange": true } },
  "context": { "registration": "{session_id}",
               "extensions": { "programId": "{program_uuid}" } },
  "timestamp": "2026-07-13T09:41:22Z"
}
```
- **القاعدة الذهبية**: `actor.account.name` هو المعرّف الموحّد حرفياً — نفس النص
  الذي في Jotform. أي انحراف في التنسيق يكسر الربط.
- قاموس الأفعال المبدئي: بدأ / تحقّق / فعّل / ضبط / استخدم / طبّق / أكمل —
  يُعتمد نهائياً بالتنسيق مع معمار AmadXR (بوابات الإتقان الإلزامية ونقاط
  الفحص الإحدى عشرة القائمة).

## 3. QR والبطاقات

- التوليد server-side بمكتبة `qrcode` عند تسجيل المتدرّب
- محتوى QR بطاقة المتدرّب = رابط prefill القبلي (ويُعاد استخدامه للبعدي عبر
  صفحة توجيه ذكية: `miqyas.al-amad.com.sa/t/AMD-7K9FQ` تعرض زرّي "القبلي/البعدي"
  حسب حالة المتدرّب — أفضل من QR منفصل لكل نموذج)
- التكامل مع نظام البطاقات القائم (cards.al-amad.com.sa / Supabase
  wdcirfndlgdhlgvjoavr): نمط التوليد والتصميم موجود — يُستنسخ لا يُبنى من الصفر
- QR الشهادة = `miqyas.al-amad.com.sa/verify/{verify_code}`

## 4. متغيرات البيئة (انظر .env.example)

| المتغير | الوصف |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | رابط مشروع Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | المفتاح العام (RLS يحمي) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side فقط — لا يصل للمتصفح أبداً |
| `JOTFORM_API_KEY` | مفتاح Jotform — server-side فقط |
| `JOTFORM_WEBHOOK_SECRET` | سرّ التحقق من مصدر الـ webhook |
