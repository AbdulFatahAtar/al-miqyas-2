export type StageStatus =
  | "validated"
  | "received"
  | "waiting"
  | "failed"
  | "review"
  | "blocked"
  | "eligible";

export type ScenarioKey = "complete" | "incomplete" | "failed";

export type JourneyStage = {
  id: "pre" | "live" | "post" | "report" | "certificate";
  index: string;
  label: string;
  shortLabel: string;
  source: string;
  status: StageStatus;
  statusLabel: string;
  receivedAt: string;
  note: string;
};

export const trainee = {
  name: "نورة سعد القحطاني",
  role: "ممرضة متدرّبة",
  code: "AMD-7K9FQ",
  program: "نبض الأمد · الإنعاش القلبي الرئوي الأساسي",
  cohort: "دفعة يوليو 2026",
  organization: "كلية الطب · جامعة أم القرى",
  tenantMark: "ط",
};

const baseStages: JourneyStage[] = [
  {
    id: "pre",
    index: "01",
    label: "القياس القبلي",
    shortLabel: "قبلي",
    source: "Jotform",
    status: "validated",
    statusLabel: "موثّق",
    receivedAt: "13 يوليو · 09:12",
    note: "اكتمل خط الأساس وربط بالمعرّف الموحد.",
  },
  {
    id: "live",
    index: "02",
    label: "الأداء اللحظي",
    shortLabel: "لحظي",
    source: "AmadXR · xAPI",
    status: "validated",
    statusLabel: "موثّق",
    receivedAt: "13 يوليو · 10:41",
    note: "استُقبلت تسعة أحداث ضمن جلسة واحدة.",
  },
  {
    id: "post",
    index: "03",
    label: "القياس البعدي",
    shortLabel: "بعدي",
    source: "Jotform",
    status: "validated",
    statusLabel: "موثّق",
    receivedAt: "13 يوليو · 11:28",
    note: "اجتازت المتدرّبة حد البرنامج بنتيجة 90%.",
  },
  {
    id: "report",
    index: "04",
    label: "تقرير الأثر",
    shortLabel: "الأثر",
    source: "محرك المقياس",
    status: "validated",
    statusLabel: "محسوب",
    receivedAt: "13 يوليو · 11:29",
    note: "اكتملت المقارنة وربطت المصادر الثلاثة.",
  },
  {
    id: "certificate",
    index: "05",
    label: "الشهادة",
    shortLabel: "الشهادة",
    source: "منظومة المقياس",
    status: "eligible",
    statusLabel: "مستحقة",
    receivedAt: "13 يوليو · 11:30",
    note: "الشهادة قابلة للإصدار لأن نتيجة البعدي تجاوزت 80%.",
  },
];

export const scenarioLabels: Record<ScenarioKey, string> = {
  complete: "رحلة مكتملة",
  incomplete: "بيانات ناقصة",
  failed: "مصدر فاشل",
};

export function getScenarioStages(scenario: ScenarioKey): JourneyStage[] {
  const stages = baseStages.map((stage) => ({ ...stage }));

  if (scenario === "incomplete") {
    stages[1] = {
      ...stages[1],
      status: "waiting",
      statusLabel: "بانتظار البيانات",
      receivedAt: "لم تصل جلسة",
      note: "وصل القياس البعدي، لكن لم تصل جلسة أداء لحظي مطابقة.",
    };
    stages[3] = {
      ...stages[3],
      status: "blocked",
      statusLabel: "غير مكتمل",
      receivedAt: "متوقف",
      note: "يمكن عرض نتيجة المعرفة، لكن تقرير الأثر الكامل ينتظر الجلسة.",
    };
    stages[4] = {
      ...stages[4],
      status: "review",
      statusLabel: "تحتاج مراجعة",
      receivedAt: "لم تُصدر",
      note: "الاجتياز المعرفي متحقق، ويحتاج الإصدار إلى مراجعة اكتمال الرحلة.",
    };
  }

  if (scenario === "failed") {
    stages[1] = {
      ...stages[1],
      status: "failed",
      statusLabel: "فشل الاستقبال",
      receivedAt: "13 يوليو · 10:41",
      note: "رُفضت الجلسة بسبب عدم تطابق معرّف الفاعل مع المعرّف الموحد.",
    };
    stages[3] = {
      ...stages[3],
      status: "review",
      statusLabel: "تحتاج مراجعة",
      receivedAt: "متوقف",
      note: "النتائج محفوظة، لكن الدليل اللحظي مرفوض ويحتاج معالجة.",
    };
    stages[4] = {
      ...stages[4],
      status: "blocked",
      statusLabel: "غير صادرة",
      receivedAt: "متوقفة",
      note: "لم تصدر الشهادة آلياً بسبب وجود مصدر مرفوض يحتاج مراجعة.",
    };
  }

  return stages;
}

export const liveEvents = [
  ["10:41:08", "بدأ", "التجربة الغامرة", "موثّق"],
  ["10:41:24", "تحقّق", "استجابة المصاب", "3 ثوانٍ"],
  ["10:41:37", "فعّل", "منظومة الطوارئ", "صحيح"],
  ["10:42:04", "ضبط", "عمق الضغط", "5.2 سم"],
  ["10:42:19", "ضبط", "معدّل الضغط", "112/دقيقة"],
  ["10:43:11", "أكمل", "دورة إنعاش", "دقة 89%"],
] as const;
