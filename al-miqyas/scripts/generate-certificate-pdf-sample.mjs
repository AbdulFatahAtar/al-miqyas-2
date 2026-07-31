import { readFile, mkdir, writeFile } from "node:fs/promises";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import sharp from "../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js";

const width = 2100;
const height = 1485;
const navy = "#101827";
const gold = "#b78a32";
const ivory = "#f7f3e9";
const muted = "#6d6a63";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const mark = await readFile(
  new URL(
    "../public/brand/al-amad-mark-transparent.png",
    import.meta.url,
  ),
);
const markData = `data:image/png;base64,${mark.toString("base64")}`;
const verifyCode = "VER-8A61E9099A40D87534A1F39B7A5F8D7A";
const sealSeed = Array.from(verifyCode).reduce(
  (value, character) =>
    (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0,
  2166136261,
);
const sealFingerprint = verifyCode.replace("VER-", "").slice(-12);
const sealRingText =
  `AL-AMAD • MIQYAS • VERIFIED • ${sealFingerprint} • `;
const qrData = await QRCode.toDataURL(
  `http://localhost:3000/verify/${verifyCode}`,
  {
    width: 340,
    margin: 1,
    errorCorrectionLevel: "H",
    color: { dark: navy, light: ivory },
  },
);

const sample = {
  traineeName: "متدرّب اختبار دورة الشهادة",
  traineeCode: "AMD-TST24",
  organizationName: "ديوان المظالم",
  programTitle: "تهيئة الموظفين الجدد - ديوان المظالم",
  cohortTitle: "الدفعة الأولى - تهيئة موظفي ديوان المظالم",
  certificateNumber: "AMD-DIWAN-2026-0000001",
  issuedAt: "٢٨ يوليو ٢٠٢٦",
};

const corner = (x, y, transform = "") => `
  <g transform="translate(${x} ${y}) ${transform}">
    <path d="M0 108V0H108" fill="none" stroke="#dcc27c" stroke-width="5"/>
    <path d="M22 92V22H92" fill="none" stroke="#dcc27c" stroke-width="2"/>
  </g>`;

const pattern = Array.from({ length: 77 }, (_, index) => {
  const column = index % 11;
  const row = Math.floor(index / 11);
  return `<image href="${markData}" x="${120 + column * 190}" y="${110 + row * 190}" width="66" height="66" opacity=".022"/>`;
}).join("");

const sealTicks = Array.from({ length: 72 }, (_, index) => {
  const angle = (index / 72) * Math.PI * 2;
  const encoded = (sealSeed >>> (index % 24)) & 1;
  const innerRadius = encoded ? 125 : 130;
  const outerRadius = encoded ? 140 : 136;
  return `<path d="M${Math.cos(angle) * innerRadius} ${Math.sin(angle) * innerRadius}L${Math.cos(angle) * outerRadius} ${Math.sin(angle) * outerRadius}" stroke="#dcc27c" stroke-width="1.5"/>`;
}).join("");

const sealRosettes = Array.from({ length: 4 }, (_, layer) => {
  const points = Array.from({ length: 361 }, (__, index) => {
    const angle = (index / 360) * Math.PI * 2;
    const radius =
      78 +
      18 *
        Math.sin((7 + (sealSeed % 5)) * angle + layer * 0.8) +
      8 * Math.sin(13 * angle + (sealSeed % 11));
    return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
  });
  return `<polyline points="${points.join(" ")}" fill="none" stroke="#8b4df4" stroke-opacity=".18" stroke-width="1.5"/>`;
}).join("");

const sealRingCharacters = Array.from(sealRingText)
  .map((character, index) => {
    const angle =
      -90 +
      (index * 360) / sealRingText.length +
      180 / sealRingText.length;
    return `<text transform="rotate(${angle}) translate(0 -134) rotate(90)" text-anchor="middle" fill="#1d2a3d" font-family="monospace" font-size="11" font-weight="600">${escapeXml(character)}</text>`;
  })
  .join("");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="sealClip"><circle r="120"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="${ivory}"/>
  ${pattern}
  <rect x="34" y="34" width="${width - 68}" height="${height - 68}" fill="none" stroke="${navy}" stroke-width="18"/>
  <rect x="57" y="57" width="${width - 114}" height="${height - 114}" fill="none" stroke="${gold}" stroke-width="4"/>
  ${corner(85, 85)}
  ${corner(width - 85, 85, "scale(-1 1)")}
  ${corner(85, height - 85, "scale(1 -1)")}
  ${corner(width - 85, height - 85, "scale(-1 -1)")}

  <image href="${markData}" x="${width - 258}" y="123" width="108" height="108"/>
  <text x="${width - 370}" y="170" text-anchor="middle" fill="${navy}" font-family="SF Arabic, Arial" font-size="34" font-weight="700" direction="rtl">${escapeXml("شركة الأمد")}</text>
  <text x="${width - 370}" y="210" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="23" font-weight="500" direction="rtl">${escapeXml("منظومة المقياس")}</text>

  <text x="320" y="154" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="24" font-weight="500" direction="rtl">${escapeXml("الجهة المصدرة")}</text>
  <text x="320" y="202" text-anchor="middle" fill="${navy}" font-family="SF Arabic, Arial" font-size="32" font-weight="700" direction="rtl">${escapeXml(sample.organizationName)}</text>

  <path d="M600 300H${width - 600}" stroke="${gold}" stroke-width="3"/>
  <circle cx="${width / 2}" cy="300" r="8" fill="${gold}"/>

  <text x="${width / 2}" y="354" text-anchor="middle" fill="#1d2a3d" font-family="monospace" font-size="17" font-weight="600">CERTIFICATE OF COMPLETION</text>
  <text x="${width / 2}" y="425" text-anchor="middle" fill="${gold}" font-family="SF Arabic, Arial" font-size="64" font-weight="700" direction="rtl">${escapeXml("شهادة إتمام واجتياز")}</text>
  <text x="${width / 2}" y="490" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="27" direction="rtl">${escapeXml("تُمنح هذه الشهادة تقديرًا لإتمام متطلبات البرنامج وتحقيق معيار الاجتياز المعتمد")}</text>
  <text x="${width / 2}" y="570" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="26" font-weight="500" direction="rtl">${escapeXml("إلى المتدرّب")}</text>
  <text x="${width / 2}" y="662" text-anchor="middle" fill="${navy}" font-family="SF Arabic, Arial" font-size="72" font-weight="700" direction="rtl">${escapeXml(sample.traineeName)}</text>
  <path d="M560 708H${width - 560}" stroke="#dcc27c" stroke-width="2"/>

  <text x="${width / 2}" y="778" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="27" direction="rtl">${escapeXml("لإتمامه بنجاح برنامج")}</text>
  <text x="${width / 2}" y="858" text-anchor="middle" fill="#1d2a3d" font-family="SF Arabic, Arial" font-size="50" font-weight="700" direction="rtl">${escapeXml(sample.programTitle)}</text>
  <text x="${width / 2}" y="920" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="27" font-weight="500" direction="rtl">${escapeXml(sample.cohortTitle)}</text>

  <rect x="470" y="980" width="1160" height="126" rx="18" fill="${navy}" fill-opacity=".035" stroke="${navy}" stroke-opacity=".14" stroke-width="2"/>
  <path d="M845 996V1090M1255 996V1090" stroke="${navy}" stroke-opacity=".1" stroke-width="1.5"/>
  <text x="685" y="1020" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="27" font-weight="500" direction="rtl">${escapeXml("تاريخ الإصدار")}</text>
  <text x="685" y="1067" text-anchor="middle" fill="${navy}" font-family="SF Arabic, Arial" font-size="30" font-weight="600" direction="rtl">${escapeXml(sample.issuedAt)}</text>
  <text x="${width / 2}" y="1020" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="27" font-weight="500" direction="rtl">${escapeXml("معرّف المتدرّب")}</text>
  <text x="${width / 2}" y="1067" text-anchor="middle" fill="${navy}" font-family="monospace" font-size="30" font-weight="600">${sample.traineeCode}</text>
  <text x="1415" y="1020" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="27" font-weight="500" direction="rtl">${escapeXml("رقم الشهادة")}</text>
  <text x="1415" y="1067" text-anchor="middle" fill="${navy}" font-family="monospace" font-size="25" font-weight="600">${sample.certificateNumber}</text>

  <g transform="translate(300 1195) rotate(-1.4)">
    <circle r="154" fill="${gold}" fill-opacity=".055" stroke="${gold}" stroke-width="7"/>
    <circle r="143" fill="none" stroke="${navy}" stroke-width="2"/>
    ${sealTicks}
    <g clip-path="url(#sealClip)">${sealRosettes}</g>
    ${sealRingCharacters}
    <image href="${markData}" x="-40" y="-37" width="80" height="80" opacity=".88"/>
    <rect x="-96" y="-92" width="192" height="30" rx="10" fill="${ivory}" fill-opacity=".94" stroke="${gold}" stroke-opacity=".42"/>
    <rect x="-76" y="52" width="152" height="29" rx="9" fill="${ivory}" fill-opacity=".94" stroke="${gold}" stroke-opacity=".42"/>
    <rect x="-68" y="88" width="136" height="26" rx="8" fill="${ivory}" fill-opacity=".94" stroke="${gold}" stroke-opacity=".42"/>
    <text x="0" y="-70" text-anchor="middle" fill="${gold}" font-family="SF Arabic, Arial" font-size="19" font-weight="700" direction="rtl">${escapeXml("ختم تحقق إلكتروني")}</text>
    <text x="0" y="74" text-anchor="middle" fill="${gold}" font-family="SF Arabic, Arial" font-size="20" font-weight="700" direction="rtl">${escapeXml("شركة الأمد")}</text>
    <text x="0" y="107" text-anchor="middle" fill="#1d2a3d" font-family="monospace" font-size="13" font-weight="700">${sealFingerprint}</text>
  </g>

  <rect x="${width - 430}" y="1055" width="300" height="300" rx="16" fill="${ivory}" stroke="#dcc27c" stroke-width="3"/>
  <image href="${qrData}" x="${width - 405}" y="1080" width="250" height="250"/>
  <text x="${width - 280}" y="1380" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="20" font-weight="500" direction="rtl">${escapeXml("امسح للتحقق")}</text>

  <text x="${width / 2}" y="1205" text-anchor="middle" fill="${navy}" font-family="SF Arabic, Arial" font-size="24" font-weight="600" direction="rtl">${escapeXml("وثيقة رقمية قابلة للتحقق - صلاحيتها مرتبطة بالحالة المسجلة في منظومة المقياس")}</text>
  <text x="${width / 2}" y="1248" text-anchor="middle" fill="${muted}" font-family="SF Arabic, Arial" font-size="20" direction="rtl">${escapeXml("لا يعتمد الختم المرئي وحده؛ المرجع النهائي هو رابط التحقق الإلكتروني.")}</text>
  <text x="${width / 2}" y="1305" text-anchor="middle" fill="#1d2a3d" font-family="monospace" font-size="19" font-weight="600">${verifyCode}</text>
</svg>`;

const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 96 }).toBuffer();
const pdf = new jsPDF({
  orientation: "landscape",
  unit: "mm",
  format: "a4",
  compress: true,
});
pdf.setProperties({
  title: `Certificate ${sample.certificateNumber}`,
  subject: "Verifiable training completion certificate",
  author: "شركة الأمد - منظومة المقياس",
  creator: "منظومة المقياس",
});
pdf.addImage(
  `data:image/jpeg;base64,${jpeg.toString("base64")}`,
  "JPEG",
  0,
  0,
  297,
  210,
  undefined,
  "FAST",
);

const outputDirectory = new URL("../output/pdf/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  new URL("certificate-design-sample.pdf", outputDirectory),
  Buffer.from(pdf.output("arraybuffer")),
);
