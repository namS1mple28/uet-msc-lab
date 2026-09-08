# Origin parity roadmap cho Materials Data Studio

Tài liệu này dùng Origin/OriginPro làm chuẩn tham chiếu về workflow, không tuyên bố
Materials Data Studio là bản sao tương đương hoàn toàn. Mục tiêu là tái tạo các thao tác
phân tích và biên tập figure có giá trị cho Materials Science trong một ứng dụng browser
offline, đồng thời giữ provenance và validity guard của kết quả khoa học.

Nguồn tham chiếu chính thức:

- [Graph axes](https://docs.originlab.com/origin-help/graphaxes/),
  [Plot Details](https://docs.originlab.com/origin-help/pd-dialog-layers-tab/) và
  [legend customization](https://docs.originlab.com/origin-help/legend-manualcontrol/)
- [Peak Analyzer](https://docs.originlab.com/origin-help/peakanalyzer/) và
  [Fit Peaks](https://docs.originlab.com/origin-help/fitpeak-pa/)
- [Signal Processing](https://docs.originlab.com/origin-help/signal-processing/) và
  [smoothing algorithms](https://docs.originlab.com/origin-help/smooth-algorithm/)
- [Curve-fitting function families](https://docs.originlab.com/origin-help/curve-fitting-function/)
- [Batch Processing](https://docs.originlab.com/origin-help/batch-processing/)

## Mức parity

| Mức | Ý nghĩa |
|---|---|
| Core | Đã có trong bản đầu và có test |
| Phase 2 | Được triển khai trong nhánh `feat/origin-tooling-v2` |
| Roadmap | Hợp lý trong browser nhưng chưa thuộc Phase 2 |
| External | Cần backend, database, instrument driver hoặc định dạng proprietary |

## Feature matrix

| Nhóm | Core | Phase 2 | Roadmap / giới hạn |
|---|---|---|---|
| Worksheet | Multi-file CSV/TXT/DAT/XLSX, column roles, units, mask, lineage, undo/redo | Giữ tương thích project schema v1 | Column formula, categorical columns, sort/filter worksheet nâng cao, workbook nhiều sheet |
| Graph hierarchy | Figure nhiều panel, overlay, stacked offset, dual Y | Page/Layer/Plot controls và backward defaults | Layer linking nâng cao, inset/ternary/polar/3D |
| Axes | Linear/log, reverse, range, labels, tick format | Grid, major/minor tick controls, axis line/background/margins | Broken axis, nonlinear custom transform, categorical axis |
| Plot style | Line/scatter/stick, marker, dash, width, error bars | Visibility, order, opacity, fill, symbol/error-bar styling | Pattern/gradient fill, colormap editor, contour/surface |
| Legend & annotation | Legend, text annotation, reference line | Position/orientation/frame/background và styled annotation/reference | Rich-text object editor, arbitrary drawing objects |
| Themes | Figure state lưu trong project | Ba publication presets và theme application | User theme library, theme import/export, batch theme pipeline |
| Export | Full-data SVG/PDF vector, PNG 300/600 dpi, physical size | Style parity giữa preview/restore/export | EPS/EMF, CMYK/prepress, linked report book |
| Preprocessing | Crop, mask, offset, scale, normalize, resample, moving average, Savitzky–Golay, derivative, integral, baseline | Median/MAD despike với `replace` hoặc `mask` | LOWESS/LOESS, FFT/IIR filters, wavelet, deconvolution |
| Statistics | Linear/polynomial regression metrics trong fitting | ROI descriptive statistics | Hypothesis tests, ANOVA, PCA/PLS, clustering, DOE |
| Peak analysis | Detection, baseline, multi-peak Gaussian/Lorentzian/pseudo-Voigt, bounds/fixed/weights | RSS, DoF, adjusted R², AIC, BIC và reduced χ² | Component/cumulative curves, more peak families, global/shared-parameter fit, confidence/prediction bands, batch reports |
| XRD | Bragg d-spacing, Scherrer, profile-aware instrumental correction, reference sticks | Williamson–Hall UDM và cubic lattice parameter | Search/match database, indexing tổng quát, Rietveld refinement |
| Raman/FTIR | Baseline, smoothing, peak fitting/ratio, transmittance→absorbance | Dùng diagnostics/report chung | Library matching, cosmic-ray workflow nhiều spectra, mapping hyperspectral |
| UV–Vis | Wavelength/energy, Tauc direct/indirect, absorbance/transmittance/reflectance, Kubelka–Munk | Urbach energy với ROI và optical assumptions xác nhận | Joint optical-model fitting, ellipsometry, multilayer transfer matrix |
| Automation | Reproducible operations và project JSON | Operation parameters của tool mới được lưu | Analysis templates, batch files/folders, macro/pipeline builder |
| Ecosystem | Chạy offline, không gửi dữ liệu lên server | Không thay đổi nguyên tắc này | Python/LabTalk bridge, database connectors và instrument control là External |
| Proprietary formats | CSV/TXT/DAT/XLSX/project JSON | — | OPJU/OGWU parsing chính xác là External |

## Phase 2 acceptance criteria

1. Project cũ `schemaVersion: 1` mở được; thuộc tính FigureSpec mới đều có default.
2. Figure preview, restore và SVG/PNG/PDF dùng cùng một FigureSpec; export không tự
   downsample dữ liệu.
3. Mọi control mới có label, keyboard focus rõ, touch target phù hợp và layout dùng được
   ở 320, 640, 768 và 1024 px.
4. `despike` không âm thầm xóa điểm: chế độ `mask` lưu mask, chế độ `replace` tạo dataset
   dẫn xuất và ghi đầy đủ tham số.
5. Fit diagnostics chỉ có giá trị khi fit hợp lệ. `reducedChiSquare` chỉ được báo cho
   weighted fit có uncertainty hợp lệ và DoF > 0.
6. Williamson–Hall yêu cầu ít nhất ba peak hợp lệ, FWHM đã xác định, wavelength được xác
   nhận và báo rõ instrumental correction. Không suy diễn crystallite size thành particle size.
7. Cubic lattice parameter yêu cầu chỉ số `(hkl)` do người dùng cung cấp; không tự index peak.
8. Urbach energy yêu cầu explicit signal/optical assumption và ROI tuyến tính do người dùng
   chọn; không tự chọn vùng hoặc trình bày fit lỗi như kết quả thành công.
9. Numerical fixtures, Chromium và Firefox regression đều pass; ba phòng lab hiện có không
   bị thay đổi hành vi.

## Ranh giới khoa học và kỹ thuật

- Peak search/match, phase identification và Rietveld cần reference database cùng mô hình
  crystallographic chuyên dụng; không thay bằng heuristic rồi gắn nhãn “Origin parity”.
- OPJU, LabTalk và instrument connectivity phụ thuộc định dạng/API proprietary hoặc môi trường
  desktop; project JSON là định dạng tái lập chính của web app.
- Các thuật toán mới phải có provenance, unit và validity status. Kết quả thiếu dữ liệu,
  covariance suy biến hoặc không hội tụ luôn là `invalid`, không chỉ là warning trang trí.
