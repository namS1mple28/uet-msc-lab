# -*- coding: utf-8 -*-
"""Dựng 3 trang riêng từ msc-lab.html (bản gộp)."""
import io, os, re, sys

MASTER = "src/msc-lab.html"
src = io.open(MASTER, encoding="utf-8").read()

# Hai chế độ dựng:
#   python build.py              -> bản web, link tương đối, ghi ra thư mục gốc
#   python build.py --artifact   -> bản artifact claude.ai, link tuyệt đối, ghi ra dist-artifact/
ARTIFACT = "--artifact" in sys.argv
ART_URL = {
  "lab" : "https://claude.ai/code/artifact/a923bc34-1071-4147-aaf2-48490f11def9",
  "fab" : "https://claude.ai/code/artifact/619b4163-9ee6-437c-bd29-c3e93587a320",
  "atom": "https://claude.ai/code/artifact/6713282a-fdd9-44f6-894a-00def5b97a3d",
}
OUT_DIR = "dist-artifact" if ARTIFACT else "."
if ARTIFACT and not os.path.isdir(OUT_DIR):
    os.makedirs(OUT_DIR)

PAGES = {
 "lab": dict(
   file="index.html",
   title="Phòng Lab Hóa Học MSC",
   eyebrow="Phòng thí nghiệm hóa học ảo · UET MSC",
   h1="Lắp dụng cụ, pha chế, đun nóng — như trong phòng thực hành",
   lead="Tủ dụng cụ 18 món và 26 hóa chất. Kéo ra bàn, lắp ghép, rót, đun, lọc, dẫn khí. "
        "Phản ứng giải theo ion và bảng tính tan, pH giải từ phương trình cân bằng — không có con số nào tra bảng dựng sẵn.",
   stats=[("18","dụng cụ kéo thả và lắp ghép được"),
          ("26","hóa chất, gồm cả chất rắn phản ứng với axit"),
          ("6","bài thực hành chấm tự động")],
   cta=("lab","Vào bàn thí nghiệm","mix","Bàn tính toán"),
 ),
 "fab": dict(
   file="vat-lieu.html",
   title="Xưởng Vật Liệu MSC",
   eyebrow="Chế tạo và đo đạc vật liệu · UET MSC",
   h1="Chế tạo vật liệu, đo đạc, rồi đưa vào linh kiện",
   lead="Bảy trạm từ phối liệu tới thử nghiệm linh kiện. Vạch nhiễu xạ tính từ thừa số cấu trúc F(hkl) của từng ô mạng, "
        "hiệu suất pin so với trần Shockley–Queisser, ảnh SEM dựng từ kích thước hạt thật của mẫu.",
   stats=[("7","trạm: phối liệu → lò nung → XRD, SEM, UV–Vis, đo điện, linh kiện"),
          ("8","pha tinh thể mô tả bằng vị trí nguyên tử thật"),
          ("±0,03°","sai lệch vạch XRD so với chuẩn ICDD")],
   cta=("fab","Vào xưởng vật liệu",None,None),
 ),
 "atom": dict(
   file="nguyen-tu.html",
   title="Bảng Tuần Hoàn MSC",
   eyebrow="Cấu trúc nguyên tử · UET MSC",
   h1="118 nguyên tố, cấu hình electron và orbital xoay được",
   lead="Cấu hình theo quy tắc Aufbau kèm 20 ngoại lệ thực nghiệm. Đám mây orbital dựng từ hàm sóng nguyên tử hydro thật — "
        "đa thức Laguerre và điều hòa cầu — nên các nút cầu và nút phẳng hiện ra đúng chỗ.",
   stats=[("118","nguyên tố với số liệu thực nghiệm, ô trống nếu chưa có"),
          ("51","orbital 3D xoay và cắt đôi được"),
          ("16.000","hạt lấy mẫu theo |ψ|²")],
   cta=("atom","Mở bảng tuần hoàn",None,None),
 ),
}

HREF = {"lab":"index.html","fab":"vat-lieu.html","atom":"nguyen-tu.html"}
NAV = {"lab":("Phòng lab hóa học","🧪"),"fab":("Xưởng vật liệu","◈"),"atom":("Bảng tuần hoàn","⚛")}
ORDER = ["lab","fab","atom"]

def hero_html(cfg):
    b = []
    b.append('<section class="hero">\n  <div class="aurora"></div>\n  <div class="hero-in">')
    b.append('    <p class="eyebrow">%s</p>' % cfg["eyebrow"])
    b.append('    <h1>%s</h1>' % cfg["h1"])
    b.append('    <p class="hero-lead">%s</p>' % cfg["lead"])
    g1,t1,g2,t2 = cfg["cta"]
    cta = '      <button class="btn btn-primary" data-goto="%s">%s</button>' % (g1,t1)
    if g2:
        cta += '\n      <button class="btn btn-ghost" data-goto="%s">%s</button>' % (g2,t2)
    b.append('    <div class="hero-cta">\n%s\n    </div>' % cta)
    st = "".join('      <div><div class="hs-k">%s</div><div class="hs-v">%s</div></div>\n' % (k,v)
                 for k,v in cfg["stats"])
    b.append('    <div class="hero-stats">\n%s    </div>' % st)
    b.append('  </div>\n</section>')
    return "\n".join(b)

def nav_html(page):
    rows = []
    for p in ORDER:
        name, ico = NAV[p]
        if p == page:
            rows.append('    <span class="tab" aria-selected="true" style="cursor:default">'
                        '<span class="tab-glyph">%s</span> %s</span>' % (ico, name))
        else:
            href = ART_URL[p] if ARTIFACT else HREF[p]
            tgt = ' target="_top"' if ARTIFACT else ""
            rows.append('    <a class="tab"%s href="%s" style="text-decoration:none">'
                        '<span class="tab-glyph">%s</span> %s</a>' % (tgt, href, ico, name))
    extra = ""
    if page == "lab":
        extra = ('\n    <span style="flex:1"></span>'
                 '\n    <button class="tab" id="tab-lab" aria-controls="panel-lab" aria-selected="true">Bàn thí nghiệm</button>'
                 '\n    <button class="tab" id="tab-mix" aria-controls="panel-mix" aria-selected="false">Bàn tính toán</button>')
    return ('<nav class="tabbar">\n  <div class="tabbar-in" role="tablist">\n%s%s\n  </div>\n</nav>'
            % ("\n".join(rows), extra))

# ---- cắt các khối cần thay ----
hero_re = re.compile(r'<section class="hero">.*?\n</section>', re.S)
nav_re  = re.compile(r'<nav class="tabbar">.*?\n</nav>', re.S)
title_re= re.compile(r'<title>.*?</title>')

built = []
for page, cfg in PAGES.items():
    out = src
    out = title_re.sub('<title>%s</title>' % cfg["title"], out, 1)
    out = hero_re.sub(lambda m: hero_html(cfg), out, 1)
    out = nav_re.sub(lambda m: nav_html(page), out, 1)
    # đặt PAGE trước script chính
    out = out.replace('<script>\n"use strict";',
                      '<script>window.__MSC_PAGE=%r;</script>\n<script>\n"use strict";' % page, 1)
    # ẩn sẵn các panel không thuộc trang này
    for pid in ["fab","lab","mix","atom"]:
        keep = (pid == page) or (page == "lab" and pid == "mix")
        pat = re.compile(r'(<section class="panel wrap" id="panel-%s"[^>]*?)(\s+hidden)?>' % pid)
        rep = (lambda m: m.group(1) + ('>' if keep and pid == page else ' hidden>'))
        out = pat.sub(rep, out, 1)
    io.open(os.path.join(OUT_DIR, cfg["file"]), "w", encoding="utf-8").write(out)
    built.append((cfg["file"], round(len(out)/1024), cfg["title"]))

print(("Bản artifact -> " if ARTIFACT else "Bản web -> ") + OUT_DIR)
for f,kb,t in built:
    print("%-22s %5d KB  %s" % (f,kb,t))
