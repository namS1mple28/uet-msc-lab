# Hướng dẫn cho AI agent (Codex, Claude, Copilot…)

Đọc file này trước khi sửa bất cứ thứ gì.

## Điều quan trọng nhất

**Ba file `index.html`, `vat-lieu.html`, `nguyen-tu.html` là file SINH RA TỰ ĐỘNG. Không sửa trực tiếp.**

Nguồn duy nhất là `src/msc-lab.html`. Quy trình bắt buộc:

```bash
# 1. sửa src/msc-lab.html
# 2. dựng lại 3 trang
python build.py
```

Nếu sửa thẳng vào 3 file ở thư mục gốc, lần chạy `build.py` kế tiếp sẽ ghi đè mất hết.

## Kiến trúc

`src/msc-lab.html` là một file HTML đơn, tự chứa mọi thứ (CSS + JS inline, không có dependency
ngoài trừ Google Fonts). Nó chứa **cả bốn khu vực** của dự án:

| Panel HTML | Nội dung |
|---|---|
| `#panel-fab` | Xưởng vật liệu: 8 trạm, từ tiền chất tới thử linh kiện |
| `#panel-lab` | Phòng lab hóa học ảo: bàn kéo thả dụng cụ |
| `#panel-mix` | Bàn tính toán: pha loãng, chuẩn độ, dung dịch đệm |
| `#panel-atom` | Bảng tuần hoàn, cấu hình electron, orbital 3D |

`build.py` sinh ra ba trang bằng cách:

1. Chèn `window.__MSC_PAGE = 'lab' | 'fab' | 'atom'` vào trước `<script>` chính
2. Thay `<title>`, khối `<section class="hero">` và `<nav class="tabbar">`
3. Thêm thuộc tính `hidden` cho các panel không thuộc trang đó

Trong JS, biến `PAGE` cùng ba cờ `hasChem` / `hasFab` / `hasAtom` quyết định phần nào được khởi
tạo. Nhờ vậy trang hóa học **không hề dựng bảng tuần hoàn 118 nguyên tố** hay chạy vòng lặp vẽ
của xưởng vật liệu — mỗi trang chỉ trả giá cho phần của nó.

Bản gộp (`PAGE === "all"`, tức mở thẳng `src/msc-lab.html`) chạy cả bốn panel với thanh tab —
tiện để thử nhanh khi phát triển.

## Các mốc trong file nguồn

Tìm bằng chuỗi `/* =====` — file dùng comment banner để phân đoạn:

- `CHỦ ĐỀ SÁNG / TỐI` — canvas không đọc được biến CSS, nên **mọi màu vẽ phải đi qua `fg(a)`,
  `sh(a)`, `MUT()`, `MUT2()`, `PANEL()`**. Không hardcode `rgba(255,255,255,...)` trong code vẽ.
- `HÓA CHẤT` — bảng `CHEMS` với Ka/Kb thực nghiệm ở 25 °C
- `BÀN PHA CHẾ` — 6 phép tính, biểu đồ chuẩn độ
- `NGUYÊN TỐ` — dữ liệu 118 nguyên tố, cấu hình Aufbau + 20 ngoại lệ
- `ĐÁM MÂY ORBITAL 3D` — hàm sóng hydro (Laguerre + điều hòa cầu), lấy mẫu Monte Carlo
- `BÀN THAO TÁC — mô hình theo ion` — engine phản ứng
- `BÀN THÍ NGHIỆM ẢO` — bàn kéo thả, vẽ canvas
- `PHÒNG LAB VẬT LIỆU` — 8 trạm
- `QUY TRÌNH TẠO TIỀN CHẤT` — `RECIPES` (thông số) và `SCENES` (hoạt ảnh từng bước)
- `MÔ PHỎNG TỪNG BƯỚC TRONG TRẠM TIỀN CHẤT` — bộ vẽ nguyên thủy `pBeaker`, `pFlame`, `pGauge`…

## Nguyên tắc bắt buộc về số liệu

Đây là công cụ dạy học cho câu lạc bộ khoa học vật liệu. **Mọi con số phải tính từ công thức
gốc, không tra bảng dựng sẵn, và phải kiểm chứng được với dữ liệu thực nghiệm.**

Những chỗ đã hiệu chỉnh theo chuẩn — đừng phá:

| Chỗ | Đã khớp với |
|---|---|
| Cường độ vạch XRD | NIST SRM 640 (Si: 100 / 64 / 37 / 10 / 14) |
| Vị trí vạch XRD | ICDD, sai lệch ≤ 0,03° |
| Thừa số tán xạ nguyên tử | Cromer–Mann 9 tham số, `f(0) = Z` |
| Trần hiệu suất pin mặt trời | Shockley–Queisser, đỉnh 33,7% tại 1,34 eV |
| Hiệu suất pin mô phỏng | **không được vượt kỷ lục thế giới** (Si 27,3% · GaAs 29,1% · MAPbI₃ 26,95%) |
| Áp suất autoclave | Phương trình Antoine cho nước (100 °C → 1,013 bar) |
| Định luật phủ quay | Độ dày ∝ ω^(−½) |
| Thô hóa hạt | Dⁿ − D₀ⁿ = k₀·exp(−Q/RT)·t, n = 2/3/4 tùy vật liệu |
| Khối lượng riêng dung dịch | NaCl 1 M → 1,041 g/mL (thực nghiệm 1,040) |
| Chuẩn độ CH₃COOH | Nửa tương đương cho pH = pKa = 4,74 |

Nếu không có số liệu thực nghiệm đáng tin cậy (ví dụ nguyên tố 104–118), **để trống và ghi rõ
là chưa có**, tuyệt đối không điền số dự đoán như thể là số đo.

## Kiểm thử

Chưa có test tự động. Cách đang dùng: mở file trong trình duyệt rồi chạy JS trong console để
kiểm tra kết quả tính toán, ví dụ:

```js
phasePeaks('Si')            // vạch XRD của silic
solarPerf(SMP)              // thông số pin mặt trời của mẫu hiện tại
RECIPES.hydro.calc({c:0.1,pH:11,fill:70,T:180,t:12})   // kết quả thủy nhiệt
tubePh(BENCH.find(o=>o.kind==='vessel'))               // pH của bình đầu tiên
```

Nếu thêm được test tự động (Playwright chẳng hạn) thì rất tốt — ưu tiên kiểm tra các con số
trong bảng ở trên.

## Quy ước code

- Toàn bộ chữ hiển thị bằng **tiếng Việt**, dùng dấu phẩy thập phân trong văn bản (`4,74`)
- Comment trong code cũng bằng tiếng Việt
- Tôn trọng `prefers-reduced-motion` ở mọi hoạt ảnh mới
- Cẩn thận với **vùng chết tạm thời của `let`/`const`**: file này có nhiều đoạn khởi tạo chạy
  trước phần khai báo ở dưới. Đã từng dính hai lỗi kiểu này (`lastToast`, `hex2rgb`) — nếu một
  hàm được gọi từ đoạn dựng cảnh ban đầu thì các biến nó dùng phải khai báo bằng `var` hoặc
  `function`, không dùng `const`.
