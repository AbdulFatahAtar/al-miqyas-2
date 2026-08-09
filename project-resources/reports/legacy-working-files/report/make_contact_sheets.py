from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path("/Users/farhad/Desktop/منظومة القياس /tmp/report/render-v3")
pages = sorted(root.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[1]))
thumb_w = 260
cols = 4
rows = 3
per_sheet = cols * rows

for sheet_index in range((len(pages) + per_sheet - 1) // per_sheet):
    batch = pages[sheet_index * per_sheet:(sheet_index + 1) * per_sheet]
    thumbs = []
    for page in batch:
        img = Image.open(page).convert("RGB")
        ratio = thumb_w / img.width
        thumb = img.resize((thumb_w, int(img.height * ratio)))
        thumbs.append((page, thumb))
    thumb_h = max(t.height for _, t in thumbs)
    canvas = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + 24)), "white")
    draw = ImageDraw.Draw(canvas)
    for idx, (page, thumb) in enumerate(thumbs):
        x = (idx % cols) * thumb_w
        y = (idx // cols) * (thumb_h + 24)
        canvas.paste(thumb, (x, y))
        draw.text((x + 6, y + thumb_h + 4), page.stem, fill="black")
    canvas.save(root / f"contact-{sheet_index + 1}.png")
