# Phòng thí nghiệm ảo & Materials Data Studio UET MSC

Bộ ba phòng thí nghiệm mô phỏng chạy thẳng trên trình duyệt, làm cho
[CLB Khoa học Vật liệu — Trường Đại học Công nghệ, ĐHQGHN](https://uetmsc.framer.website/).

### 👉 Dùng ngay: **https://nams1mple28.github.io/uet-msc-lab/**

| Trang | Nội dung |
|---|---|
| [Phòng lab hóa học](https://nams1mple28.github.io/uet-msc-lab/) | Kéo dụng cụ ra bàn, pha chế, đun, lọc, dẫn khí |
| [Xưởng vật liệu](https://nams1mple28.github.io/uet-msc-lab/vat-lieu.html) | Chế tạo mẫu qua 8 trạm rồi đo XRD, SEM, UV–Vis |
| [Bảng tuần hoàn](https://nams1mple28.github.io/uet-msc-lab/nguyen-tu.html) | 118 nguyên tố, cấu hình electron, orbital 3D |
| [Phân tích dữ liệu](https://nams1mple28.github.io/uet-msc-lab/analysis.html) | Worksheet, xử lý phổ, peak fitting, XRD, Raman/FTIR, UV–Vis/Tauc và figure publication-ready |

Không cần cài gì. Mở file HTML là chạy. Có chế độ nền sáng và nền tối.

## Materials Data Studio

Trang `analysis.html` chạy hoàn toàn trong browser và không gửi dữ liệu đo lên server. Workflow:

**CSV/TXT/DAT/XLSX hoặc paste → worksheet/mask → preprocessing → fitting → materials analysis → figure export.**

- Import nhiều file, chọn sheet/header/X/Y/error/unit; cảnh báo cell trống, X trùng hoặc không đơn điệu mà không âm thầm xóa dữ liệu.
- Crop, offset, scale, normalize, resample, moving average, Savitzky–Golay, derivative/integral và baseline constant/linear/polynomial/ALS.
- Peak detection và multi-peak fitting bằng Gaussian, Lorentzian hoặc pseudo-Voigt, có bounds/fixed parameters, weighted fitting, residuals, RMSE, R² và trạng thái convergence.
- XRD: Bragg d-spacing và Scherrer với instrumental broadening được xác nhận; Raman/FTIR: absorbance, peak ratio; UV–Vis: Tauc direct/indirect, thickness và Kubelka–Munk.
- Figure 1×1/1×2/2×1/2×2, overlay/offset/reference sticks, error bars, dual Y, linear/log/reversed axes và annotations; xuất full-data SVG/PDF vector hoặc PNG 300/600 dpi theo kích thước mm.
- Raw data bất biến; undo/redo, IndexedDB autosave và project JSON versioned giữ dataset lineage, operations, fit results và figures để tái lập.

Dữ liệu mẫu đều mang nhãn **synthetic**. Kết quả Scherrer là crystallite size, không mặc định là particle size; Tauc không tự suy ra transition type chỉ từ R².

## Phòng lab hóa học

Tủ 19 dụng cụ và 33 hóa chất. Kéo cốc, bình tam giác, ống nghiệm, buret, kiềng ba chân, đèn cồn,
cân điện tử… ra bàn rồi lắp ghép và thao tác.

Phản ứng không phải hiệu ứng dựng sẵn mà giải theo ion: trung hòa, giải phóng khí, kết tủa theo
bảng tính tan, tạo phức, hiđroxit lưỡng tính tan lại trong kiềm dư, và oxi hóa khử. Đun sôi làm
bay hơi nước nên dung dịch đặc dần đúng như thật.

**12 bài thực hành** chấm tự động, kèm 5 bộ dựng sẵn: chuẩn độ, thu khí CO₂, lọc kết tủa, thử màu
ngọn lửa, thử ion màu.

## Xưởng vật liệu

Một mẫu vật đi qua 8 trạm và mang theo trạng thái thật (pha, kích thước hạt, độ kết tinh, sai hỏng):

**Phối liệu → Tiền chất → Lò nung → XRD → SEM → UV–Vis → Đo điện → Linh kiện**

Trạm tiền chất mô phỏng **từng bước một** cho 7 phương pháp tổng hợp (sol–gel, thủy nhiệt, CVD,
MBE, nghiền bi, Czochralski, phủ quay) — 31 cảnh hoạt ảnh, mỗi bước phải làm xong mới mở bước sau.

Các máy đo tính từ chính trạng thái của mẫu: vạch XRD dựng từ thừa số cấu trúc F(hkl) của ô mạng,
ảnh SEM dựng từ kích thước hạt, hiệu suất pin so với trần Shockley–Queisser.

## Bảng tuần hoàn

118 nguyên tố với cấu hình electron theo quy tắc Aufbau kèm 20 ngoại lệ thực nghiệm. Đám mây
orbital 3D xoay và cắt đôi được, dựng từ hàm sóng nguyên tử hydro thật (đa thức Laguerre và hàm
điều hòa cầu), lấy mẫu Monte Carlo 16.000 hạt theo |ψ|².

## Độ chính xác

Mọi con số tính từ công thức gốc, không tra bảng dựng sẵn. Một vài mốc đã đối chiếu:

- Cường độ vạch XRD của silic khớp **NIST SRM 640** (100 / 64 / 37 / 10 / 14)
- Vị trí vạch nhiễu xạ lệch **≤ 0,03°** so với chuẩn ICDD
- Trần Shockley–Queisser đạt đỉnh **33,7% tại 1,34 eV**, đúng giá trị kinh điển
- Áp suất autoclave theo phương trình Antoine: 100 °C → **1,013 bar** (= 1 atm)
- Chuẩn độ CH₃COOH: nửa điểm tương đương cho **pH = pKa = 4,74**

Chỗ nào chưa có số liệu thực nghiệm đáng tin cậy (nguyên tố 104–118) thì để trống, không điền số
dự đoán.

## Phát triển

```bash
git clone <repo>
cd uet-msc-lab
npm ci                       # Node.js 22+, dependency đúng lockfile
python3 build.py             # dựng 4 trang, gồm bundle Data Studio ngoại tuyến
python3 build.py --artifact  # dựng 3 phòng lab cho artifact claude.ai
npm test                     # data model, import và numerical fixtures
npm run test:browser         # Chromium + Firefox, worker/export/regression
```

Chỉ sửa `src/msc-lab.html` cho ba phòng lab và các module trong `src/analysis/` cho Data Studio.
Bốn file HTML ở thư mục gốc được sinh tự động và sẽ bị ghi đè khi build.

Xem [`AGENTS.md`](AGENTS.md) để biết kiến trúc, các mốc trong file nguồn và những ràng buộc về
độ chính xác cần giữ.

## Giấy phép

MIT — dùng thoải mái cho việc dạy và học.
