# 生成 PWA 图标：奶油底圆角 + 笑脸 + 小星星
from PIL import Image, ImageDraw
import math, os

def make_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.22)
    # 圆角底（奶油色）
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(255, 248, 240, 255))
    # 细描边
    d.rounded_rectangle([2, 2, size - 3, size - 3], radius=max(4, r - 2),
                        outline=(240, 230, 218, 255), width=max(2, size // 128))
    # 眼睛
    ey = int(size * 0.44)
    er = size * 0.055
    c = (74, 63, 53, 255)
    d.ellipse([size * 0.30 - er, ey - er, size * 0.30 + er, ey + er], fill=c)
    d.ellipse([size * 0.70 - er, ey - er, size * 0.70 + er, ey + er], fill=c)
    # 微笑
    d.arc([size * 0.32, size * 0.40, size * 0.68, size * 0.62], start=20, end=160,
          fill=c, width=max(6, size // 48))
    # 右上角星星（柠檬黄）
    cx, cy, sr = size * 0.80, size * 0.24, size * 0.14
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rad = sr if i % 2 == 0 else sr * 0.45
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    d.polygon(pts, fill=(255, 217, 107, 255))
    return img

os.makedirs('icons', exist_ok=True)
make_icon(512).save('icons/icon-512.png')
make_icon(192).save('icons/icon-192.png')
print('图标生成完成：icon-192.png / icon-512.png')
