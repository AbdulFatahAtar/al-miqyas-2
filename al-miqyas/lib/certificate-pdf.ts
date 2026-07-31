import { jsPDF } from "jspdf";
import QRCode from "qrcode";

export type CertificatePdfData = {
  certificateNumber: string;
  verifyCode: string;
  traineeName: string;
  traineeCode: string;
  programTitle: string;
  organizationName: string;
  cohortTitle: string;
  issuedAt: string;
};

const canvasWidth = 2100;
const canvasHeight = 1485;
const navy = "#101827";
const navySoft = "#1d2a3d";
const gold = "#b78a32";
const goldSoft = "#dcc27c";
const amadPurple = "#8b4df4";
const ivory = "#f7f3e9";
const muted = "#6d6a63";

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("تعذر تحميل أصل هوية الأمد."));
    image.src = source;
  });
}

function formatIssuedDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    dateStyle: "long",
  }).format(new Date(value));
}

function setArabicFont(
  context: CanvasRenderingContext2D,
  size: number,
  weight: 400 | 500 | 600 | 700 = 400,
) {
  context.font = `${weight} ${size}px "IBM Plex Sans Arabic", Arial, sans-serif`;
}

function drawCenteredText(
  context: CanvasRenderingContext2D,
  text: string,
  y: number,
  options: {
    color?: string;
    size: number;
    weight?: 400 | 500 | 600 | 700;
  },
) {
  setArabicFont(context, options.size, options.weight);
  context.fillStyle = options.color ?? navy;
  context.textAlign = "center";
  context.direction = "rtl";
  context.fillText(text, canvasWidth / 2, y);
}

function fitCenteredText(
  context: CanvasRenderingContext2D,
  text: string,
  y: number,
  maximumWidth: number,
  startingSize: number,
  minimumSize: number,
  weight: 400 | 500 | 600 | 700,
  color = navy,
) {
  let size = startingSize;
  setArabicFont(context, size, weight);

  while (size > minimumSize && context.measureText(text).width > maximumWidth) {
    size -= 2;
    setArabicFont(context, size, weight);
  }

  context.fillStyle = color;
  context.textAlign = "center";
  context.direction = "rtl";
  context.fillText(text, canvasWidth / 2, y);
}

function drawLabelValue(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
  direction: CanvasDirection = "rtl",
) {
  context.textAlign = "center";
  context.direction = "rtl";
  context.fillStyle = muted;
  setArabicFont(context, 27, 500);
  context.fillText(label, x, y);

  context.direction = direction;
  context.fillStyle = navy;
  setArabicFont(context, 30, 600);
  context.fillText(value, x, y + 47);
}

function drawElectronicSeal(
  context: CanvasRenderingContext2D,
  mark: HTMLImageElement,
  centerX: number,
  centerY: number,
  verifyCode: string,
) {
  const seed = Array.from(verifyCode).reduce(
    (value, character) =>
      (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0,
    2166136261,
  );
  const fingerprint = verifyCode.replace("VER-", "").slice(-12);
  const ringText = `AL-AMAD • MIQYAS • VERIFIED • ${fingerprint} • `;

  context.save();
  context.translate(centerX, centerY);
  context.rotate(-0.025);

  context.fillStyle = "rgba(183, 138, 50, 0.055)";
  context.strokeStyle = gold;
  context.lineWidth = 7;
  context.beginPath();
  context.arc(0, 0, 154, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.strokeStyle = navy;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(0, 0, 143, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = goldSoft;
  context.lineWidth = 1.5;
  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    const encoded = (seed >>> (index % 24)) & 1;
    const innerRadius = encoded ? 125 : 130;
    const outerRadius = encoded ? 140 : 136;
    context.beginPath();
    context.moveTo(
      Math.cos(angle) * innerRadius,
      Math.sin(angle) * innerRadius,
    );
    context.lineTo(
      Math.cos(angle) * outerRadius,
      Math.sin(angle) * outerRadius,
    );
    context.stroke();
  }

  context.save();
  context.beginPath();
  context.arc(0, 0, 120, 0, Math.PI * 2);
  context.clip();
  context.strokeStyle = amadPurple;
  context.globalAlpha = 0.18;
  context.lineWidth = 1.5;
  for (let layer = 0; layer < 4; layer += 1) {
    context.beginPath();
    for (let index = 0; index <= 360; index += 1) {
      const angle = (index / 360) * Math.PI * 2;
      const radius =
        78 +
        18 * Math.sin((7 + (seed % 5)) * angle + layer * 0.8) +
        8 * Math.sin(13 * angle + (seed % 11));
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();
    context.stroke();
  }
  context.restore();

  context.save();
  context.fillStyle = navySoft;
  context.font = '600 11px "IBM Plex Mono", monospace';
  context.textAlign = "center";
  context.direction = "ltr";
  const characterAngle = (Math.PI * 2) / ringText.length;
  Array.from(ringText).forEach((character, index) => {
    const angle =
      -Math.PI / 2 + index * characterAngle + characterAngle / 2;
    context.save();
    context.rotate(angle);
    context.translate(0, -134);
    context.rotate(Math.PI / 2);
    context.fillText(character, 0, 0);
    context.restore();
  });
  context.restore();

  context.globalAlpha = 0.88;
  context.drawImage(mark, -40, -37, 80, 80);
  context.globalAlpha = 1;

  context.fillStyle = "rgba(247, 243, 233, 0.94)";
  context.strokeStyle = "rgba(183, 138, 50, 0.42)";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(-96, -92, 192, 30, 10);
  context.fill();
  context.stroke();
  context.beginPath();
  context.roundRect(-76, 52, 152, 29, 9);
  context.fill();
  context.stroke();
  context.beginPath();
  context.roundRect(-68, 88, 136, 26, 8);
  context.fill();
  context.stroke();

  context.textAlign = "center";
  context.direction = "rtl";
  context.fillStyle = gold;
  setArabicFont(context, 19, 700);
  context.fillText("ختم تحقق إلكتروني", 0, -70);
  setArabicFont(context, 20, 700);
  context.fillText("شركة الأمد", 0, 74);

  context.direction = "ltr";
  context.fillStyle = navySoft;
  context.font = '700 13px "IBM Plex Mono", monospace';
  context.fillText(fingerprint, 0, 107);
  context.restore();
}

function drawCornerMotif(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scaleX: 1 | -1,
  scaleY: 1 | -1,
) {
  context.save();
  context.translate(x, y);
  context.scale(scaleX, scaleY);
  context.strokeStyle = goldSoft;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(0, 108);
  context.lineTo(0, 0);
  context.lineTo(108, 0);
  context.stroke();
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(22, 92);
  context.lineTo(22, 22);
  context.lineTo(92, 22);
  context.stroke();
  context.restore();
}

export async function downloadCertificatePdf(
  data: CertificatePdfData,
) {
  await document.fonts.ready;

  const [brandMark, qrImage] = await Promise.all([
    loadImage("/brand/al-amad-mark-transparent.png"),
    QRCode.toDataURL(
      `${window.location.origin}/verify/${encodeURIComponent(data.verifyCode)}`,
      {
        width: 340,
        margin: 1,
        color: {
          dark: navy,
          light: ivory,
        },
        errorCorrectionLevel: "H",
      },
    ).then(loadImage),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("تعذر تهيئة مساحة رسم الشهادة.");
  }

  context.fillStyle = ivory;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.strokeStyle = navy;
  context.lineWidth = 18;
  context.strokeRect(34, 34, canvasWidth - 68, canvasHeight - 68);
  context.strokeStyle = gold;
  context.lineWidth = 4;
  context.strokeRect(57, 57, canvasWidth - 114, canvasHeight - 114);

  drawCornerMotif(context, 85, 85, 1, 1);
  drawCornerMotif(context, canvasWidth - 85, 85, -1, 1);
  drawCornerMotif(context, 85, canvasHeight - 85, 1, -1);
  drawCornerMotif(
    context,
    canvasWidth - 85,
    canvasHeight - 85,
    -1,
    -1,
  );

  context.globalAlpha = 0.022;
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 11; column += 1) {
      context.drawImage(
        brandMark,
        120 + column * 190,
        110 + row * 190,
        66,
        66,
      );
    }
  }
  context.globalAlpha = 1;

  context.drawImage(
    brandMark,
    canvasWidth - 258,
    123,
    108,
    108,
  );
  context.textAlign = "center";
  context.direction = "rtl";
  context.fillStyle = navy;
  setArabicFont(context, 34, 700);
  context.fillText("شركة الأمد", canvasWidth - 370, 170);
  context.fillStyle = muted;
  setArabicFont(context, 23, 500);
  context.fillText("منظومة المقياس", canvasWidth - 370, 210);

  context.textAlign = "center";
  context.fillStyle = muted;
  setArabicFont(context, 24, 500);
  context.fillText("الجهة المصدرة", 320, 154);
  context.fillStyle = navy;
  setArabicFont(context, 32, 700);
  context.fillText(data.organizationName, 320, 202);

  context.strokeStyle = gold;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(600, 300);
  context.lineTo(canvasWidth - 600, 300);
  context.stroke();
  context.fillStyle = gold;
  context.beginPath();
  context.arc(canvasWidth / 2, 300, 8, 0, Math.PI * 2);
  context.fill();

  context.textAlign = "center";
  context.direction = "ltr";
  context.fillStyle = navySoft;
  context.font = '600 17px "IBM Plex Mono", monospace';
  context.fillText("CERTIFICATE OF COMPLETION", canvasWidth / 2, 354);

  drawCenteredText(context, "شهادة إتمام واجتياز", 425, {
    size: 64,
    weight: 700,
    color: gold,
  });
  drawCenteredText(
    context,
    "تُمنح هذه الشهادة تقديرًا لإتمام متطلبات البرنامج وتحقيق معيار الاجتياز المعتمد",
    490,
    {
      size: 27,
      weight: 400,
      color: muted,
    },
  );
  drawCenteredText(context, "إلى المتدرّب", 570, {
    size: 26,
    weight: 500,
    color: muted,
  });
  fitCenteredText(
    context,
    data.traineeName,
    662,
    1450,
    76,
    54,
    700,
  );

  context.strokeStyle = goldSoft;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(560, 708);
  context.lineTo(canvasWidth - 560, 708);
  context.stroke();

  drawCenteredText(context, "لإتمامه بنجاح برنامج", 778, {
    size: 27,
    weight: 400,
    color: muted,
  });
  fitCenteredText(
    context,
    data.programTitle,
    858,
    1460,
    50,
    38,
    700,
    navySoft,
  );
  fitCenteredText(
    context,
    data.cohortTitle,
    920,
    1350,
    29,
    23,
    500,
    muted,
  );

  context.fillStyle = "rgba(16, 24, 39, 0.035)";
  context.strokeStyle = "rgba(16, 24, 39, 0.14)";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(470, 980, 1160, 126, 18);
  context.fill();
  context.stroke();
  context.strokeStyle = "rgba(16, 24, 39, 0.1)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(845, 996);
  context.lineTo(845, 1090);
  context.moveTo(1255, 996);
  context.lineTo(1255, 1090);
  context.stroke();

  drawLabelValue(
    context,
    685,
    1020,
    "تاريخ الإصدار",
    formatIssuedDate(data.issuedAt),
  );
  drawLabelValue(
    context,
    canvasWidth / 2,
    1020,
    "معرّف المتدرّب",
    data.traineeCode,
    "ltr",
  );
  drawLabelValue(
    context,
    1415,
    1020,
    "رقم الشهادة",
    data.certificateNumber,
    "ltr",
  );

  drawElectronicSeal(
    context,
    brandMark,
    300,
    1195,
    data.verifyCode,
  );

  context.fillStyle = ivory;
  context.strokeStyle = goldSoft;
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(canvasWidth - 430, 1055, 300, 300, 16);
  context.fill();
  context.stroke();
  context.drawImage(qrImage, canvasWidth - 405, 1080, 250, 250);
  context.textAlign = "center";
  context.direction = "rtl";
  context.fillStyle = muted;
  setArabicFont(context, 20, 500);
  context.fillText("امسح للتحقق", canvasWidth - 280, 1380);

  context.textAlign = "center";
  context.direction = "rtl";
  context.fillStyle = navy;
  setArabicFont(context, 24, 600);
  context.fillText(
    "وثيقة رقمية قابلة للتحقق - صلاحيتها مرتبطة بالحالة المسجلة في منظومة المقياس",
    canvasWidth / 2,
    1205,
  );
  context.fillStyle = muted;
  setArabicFont(context, 20, 400);
  context.fillText(
    "لا يعتمد الختم المرئي وحده؛ المرجع النهائي هو رابط التحقق الإلكتروني.",
    canvasWidth / 2,
    1248,
  );

  context.direction = "ltr";
  context.font = '600 19px "IBM Plex Mono", monospace';
  context.fillStyle = navySoft;
  context.fillText(data.verifyCode, canvasWidth / 2, 1305);

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  pdf.setProperties({
    title: `Certificate ${data.certificateNumber}`,
    subject: "Verifiable training completion certificate",
    author: "شركة الأمد - منظومة المقياس",
    creator: "منظومة المقياس",
    keywords: `certificate,${data.traineeCode},${data.verifyCode}`,
  });
  pdf.addImage(
    canvas.toDataURL("image/jpeg", 0.96),
    "JPEG",
    0,
    0,
    297,
    210,
    undefined,
    "FAST",
  );
  pdf.save(`${data.certificateNumber}.pdf`);
}
