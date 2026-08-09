# عقد استقبال أحداث الأداء اللحظي — الإصدار الأول

‫**الحالة:** مسودة تنفيذية جاهزة للبناء، وتحتاج عينة حقيقية واحدة من AmadXR قبل اعتمادها نهائيًا.‬

‫**النطاق:** هذا عقد استقبال محدود متوافق مع بنية xAPI، وليس LRS كاملًا. المنظومة تستقبل أدلة الأداء المطلوبة للقياس فقط.‬

## 1. نقطة الاستقبال

```http
POST /api/integrations/xapi/statements
Authorization: Bearer <organization-api-key>
Content-Type: application/json
X-Experience-API-Version: 1.0.3
```

‫يقبل الطلب Statement واحدًا أو مصفوفة لا تتجاوز 100 Statement. الحد الأقصى لحجم الطلب 1 MB.‬

‫تنفذ نقطة الاستقبال استدعاء قاعدة البيانات من الخادم فقط باستخدام `SUPABASE_SERVICE_ROLE_KEY`. لا يملك `anon` أو `authenticated` صلاحية تنفيذ `process_xapi_statements` مباشرة، وأي غياب أو استبدال للمفتاح السري يجعل الخدمة تفشل بحالة `503`. يمنع منعًا باتًا وضع المفتاح في متغير يبدأ بـ `NEXT_PUBLIC_`.‬

## 2. الحقول الإلزامية

| المسار | القاعدة |
|---|---|
| `id` | ‫معرّف UUID ينشئه AmadXR، ويُستخدم لمنع التكرار.‬ |
| `actor.account.homePage` | ‫القيمة الثابتة المتفق عليها مع AmadXR.‬ |
| `actor.account.name` | ‫المعرّف الحرفي `AMD-XXXXX`، وليس الهاتف أو البريد.‬ |
| `verb.id` | ‫معرّف IRI من القاموس المعتمد في هذا الملف.‬ |
| `object.id` | ‫معرّف IRI ثابت للمشهد أو بند القياس.‬ |
| `result` | ‫نتيجة الحدث؛ تختلف باختلاف نوعه.‬ |
| `context.registration` | ‫معرّف UUID لجلسة التجربة الواحدة.‬ |
| `context.extensions` | ‫تحتوي معرّف البرنامج، التسجيل، المشهد، وإصدار العقد.‬ |
| `timestamp` | ‫وقت وقوع الحدث بصيغة ISO 8601 مع المنطقة الزمنية.‬ |

## 3. مفاتيح الامتدادات

‫جميع مفاتيح xAPI Extensions يجب أن تكون IRI كاملة، ولا تُستخدم مفاتيح مختصرة مثل `programId`.‬

```text
https://miqyas.al-amad.com.sa/xapi/extensions/contract-version
https://miqyas.al-amad.com.sa/xapi/extensions/program-id
https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id
https://miqyas.al-amad.com.sa/xapi/extensions/scene-id
https://miqyas.al-amad.com.sa/xapi/extensions/item-id
https://miqyas.al-amad.com.sa/xapi/extensions/attempt-number
https://miqyas.al-amad.com.sa/xapi/extensions/is-correct
https://miqyas.al-amad.com.sa/xapi/extensions/is-in-sequence
https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms
https://miqyas.al-amad.com.sa/xapi/extensions/hints-used
https://miqyas.al-amad.com.sa/xapi/extensions/completed-count
https://miqyas.al-amad.com.sa/xapi/extensions/required-count
```

## 4. قاموس الأفعال

| الفعل | `verb.id` | الاستخدام |
|---|---|---|
| بدء التجربة | `https://miqyas.al-amad.com.sa/xapi/verbs/experience-started` | مرة واحدة في بداية الجلسة |
| بدء مشهد | `https://miqyas.al-amad.com.sa/xapi/verbs/scene-started` | مرة واحدة لكل مشهد |
| تنفيذ بند | `https://miqyas.al-amad.com.sa/xapi/verbs/item-attempted` | سؤال، قرار، موقع، خطوة أو محطة |
| استخدام تلميح | `https://miqyas.al-amad.com.sa/xapi/verbs/hint-used` | عند كل تلميح فعلي |
| إكمال مشهد | `https://miqyas.al-amad.com.sa/xapi/verbs/scene-completed` | مع ملخص نتيجة المشهد |
| إكمال التجربة | `https://miqyas.al-amad.com.sa/xapi/verbs/experience-completed` | مرة واحدة مع ملخص الجلسة |

## 5. نموذج Statement

```json
{
  "id": "018f8d7e-3fb2-7a42-a1e2-f45d8c13df01",
  "actor": {
    "account": {
      "homePage": "https://am-ad.com.sa",
      "name": "AMD-PLKDT"
    }
  },
  "verb": {
    "id": "https://miqyas.al-amad.com.sa/xapi/verbs/item-attempted",
    "display": {
      "ar-SA": "نفّذ بندًا"
    }
  },
  "object": {
    "id": "https://miqyas.al-amad.com.sa/xapi/activities/diwan-onboarding/v1/scenes/S4/items/decision-01",
    "definition": {
      "name": {
        "ar-SA": "قرار المحافظة على سرية معلومات القضية"
      }
    }
  },
  "result": {
    "response": "decline-and-explain-confidentiality",
    "success": true,
    "extensions": {
      "https://miqyas.al-amad.com.sa/xapi/extensions/is-correct": true,
      "https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms": 4200,
      "https://miqyas.al-amad.com.sa/xapi/extensions/attempt-number": 1
    }
  },
  "context": {
    "registration": "67aa2e97-4e93-4de4-9fe2-3719fa969a30",
    "extensions": {
      "https://miqyas.al-amad.com.sa/xapi/extensions/contract-version": "1.0",
      "https://miqyas.al-amad.com.sa/xapi/extensions/program-id": "00000000-0000-0000-0000-000000000000",
      "https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id": "00000000-0000-0000-0000-000000000000",
      "https://miqyas.al-amad.com.sa/xapi/extensions/scene-id": "S4",
      "https://miqyas.al-amad.com.sa/xapi/extensions/item-id": "decision-01"
    }
  },
  "timestamp": "2026-07-28T09:41:22Z"
}
```

## 6. أدلة الأداء المطلوبة من كل مشهد

| المشهد | الأحداث المطلوبة | معيار الإكمال المنقول |
|---|---|---|
| `S0` | بدء التجربة، بدء المشهد، إكمال المشهد | الضغط على بدء الجولة |
| `S1` | محاولة لكل سؤال، إكمال المشهد | إجابتان صحيحتان من 3 |
| `S2` | تفاعل لكل موقع، إكمال المشهد | زيارة 5 مواقع من 6 والتفاعل مع معلوماتها |
| `S3` | محاولة لكل سؤال، إكمال المشهد | إجابتان صحيحتان من 3 |
| `S4` | قرار لكل موقف، زمن التردد، رقم المحاولة، إكمال المشهد | قراران صحيحان من 3 |
| `S5` | نتيجة كل مهمة، صحة التسلسل، التلميحات، إكمال المشهد | مهمتان من 3 بالتسلسل الصحيح |
| `S6` | نتيجة كل محطة، صحة التسلسل، التلميحات، إكمال المشهد | 5 محطات من 6 وبحد أقصى 3 تلميحات |
| `S7` | محاولة لكل سؤال، إكمال المشهد، إكمال التجربة | يُسجل اختبار المشهد دليلًا لحظيًا فقط، ولا يحل محل الاختبار البعدي المستقل |

## 7. قواعد المطابقة

1. ‫يُحدد `org_id` من مفتاح الجهة، ولا يُقبل من جسم الطلب.‬
2. ‫يُطابق `actor.account.name` مع `trainees.code` حرفيًا.‬
3. ‫يُطابق `enrollment-id` مع تسجيل ينتمي إلى الجهة والمتدرّب والبرنامج نفسه.‬
4. ‫يُرفض أي تعارض بين `program-id` والتسجيل.‬
5. ‫يجب أن تنتمي جميع عناصر الدفعة في الطلب إلى مفتاح الجهة نفسه.‬
6. ‫لا يُستخدم رقم الهاتف أو البريد أو الاسم للمطابقة.‬

## 8. منع التكرار وحالات المعالجة

- ‫إذا وصل `statement.id` لأول مرة: يُحفظ ثم يُعالج.‬
- ‫إذا تكرر `statement.id` بنفس المحتوى: تُعاد حالة `duplicate` دون إنشاء سجل ثانٍ.‬
- ‫إذا تكرر `statement.id` بمحتوى مختلف: يُرفض كتصادم معرّف.‬
- ‫`accepted`: تمت مطابقة الجهة والمتدرّب والبرنامج والتسجيل.‬
- ‫`unmatched`: الحدث سليم شكليًا لكن التسجيل غير قابل للمطابقة.‬
- ‫`rejected`: المفتاح أو البنية أو القيم غير صالحة، أو يوجد تعارض بين المعرفات.‬

‫تسجل كل دفعة مكتملة حدثًا واحدًا باسم `xapi.batch_processed` ومربوطًا بمعرّف الطلب نفسه داخل Audit Log، مع العدادات فقط. لا يظهر `raw_statement` أو payload الخام في واجهات المتصفح؛ تعرض الصفحات الحقول المطَبّعة اللازمة للتشغيل.‬

## 9. الاستجابات

```json
{
  "status": "processed",
  "accepted": 1,
  "duplicates": 0,
  "unmatched": 0,
  "rejected": 0,
  "results": [
    {
      "statementId": "018f8d7e-3fb2-7a42-a1e2-f45d8c13df01",
      "status": "accepted"
    }
  ]
}
```

‫تُستخدم حالات HTTP التالية: `200` للنجاح أو التكرار، `207` للدفعة المختلطة، `400` لبنية طلب غير صالحة، `401` لمفتاح مفقود أو خاطئ، `413` للحجم الزائد، `429` لتجاوز الحد، و`503` لفشل الخدمة.‬

## 10. إدارة المفتاح

1. ‫تولد المنظومة مفتاحًا عشوائيًا بطول 32 بايت على الأقل.‬
2. ‫تُعرض القيمة الخام مرة واحدة فقط عند الإنشاء.‬
3. ‫تُحفظ تجزئة SHA-256 فقط في Supabase.‬
4. ‫يمكن لمالك الجهة إنشاء مفتاح أو إلغاؤه، ولا يمكنه استرجاع القيمة الخام بعد إغلاق نافذة الإنشاء.‬
5. ‫لا يُرسل المفتاح في المحادثات أو ملفات المشروع أو السجلات.‬

## 11. اختبارات الإغلاق

- إرسال Statement صحيح وحفظه كـ `accepted`.
- إعادة نفس Statement والحصول على `duplicate` دون صف جديد.
- رفض مفتاح خاطئ.
- رفض `AMD-XXXXX` غير صالح.
- رفض تسجيل تابع لجهة أخرى.
- حفظ Statement سليم بلا تطابق كـ `unmatched`.
- قبول مصفوفة وترتيب نتائجها بحسب ترتيب الإدخال.
- ظهور الأحداث المقبولة في صفحة المتدرّب والجلسة من البيانات الحقيقية.

## 12. المطلوب من AmadXR قبل الاعتماد النهائي

1. ‫عينة Statement حقيقية واحدة من النسخة الحالية، بعد حذف أي سر.‬
2. ‫تأكيد أن AmadXR يستطيع استقبال وتمرير `AMD-XXXXX` و`program-id` و`enrollment-id` عند إطلاق التجربة.‬
3. ‫تأكيد `actor.account.homePage` الثابت الذي سيستخدمه المنتج.‬
4. ‫تأكيد إمكانية إنشاء UUID ثابت لكل Statement وإعادة استخدامه عند إعادة المحاولة الشبكية.‬
5. ‫مراجعة قاموس المشاهد والبنود، خصوصًا بيانات التسلسل والتلميحات في `S5` و`S6`.‬
