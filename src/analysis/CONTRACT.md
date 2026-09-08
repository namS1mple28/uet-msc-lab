# Materials Data Studio contracts (schema v1, Phase 2 tools)

Shared contract for implementation. Use plain ES modules, no framework. Vietnamese UI, English symbols. Do not change these interfaces without coordinating with root.

## Model (model.js; Luna owns)
- `makeDataset({name, x, y, error=null, xLabel='X', yLabel='Y', xUnit='', yUnit='', source={kind:'import'}, ...})` => Dataset `{id, revision:1, name, x:number[], y:number[], error:null|number[], mask:boolean[], xLabel,yLabel,xUnit,yUnit,source,parentId:null,operations:[]}`; mask true means EXCLUDED. Preserve invalid cells as null and report issues; no silent drop.
- `validateDataset(dataset)` => array of human-readable issue strings (empty means valid).
- `deriveDataset(dataset, {x,y,error,mask,name,operation})` => new dataset with unique id, parentId, source preserved and appended operation.
- `makeProject()` => `{schemaVersion:1,id,name,datasets:[],figures:[],results:[],operations:[],activeDatasetId:null}`.
- `validateProject(project)` throws on unsafe/invalid structure, numeric limits; `serializeProject`, `parseProject`; `History` with `push(project)`, `undo()`, `redo()` returning cloned snapshots or null. Push initial and each successful edit.
- Limits exported `LIMITS = {fileBytes:20*1024*1024, points:1000000, peaks:10, timeoutMs:30000}`.

## IO (io.js, storage.js, samples.js; Luna owns)
- `readFile(file, options={})` async => `{sheets:[{name,rows:any[][]}],warnings:string[]}`. CSV/TXT/DAT use options.delimiter ('auto', 'whitespace', '\t', ',', ';'), decimal ('.' or ','); XLSX supports cached values, no code execution. `parseText(text, options)` same return shape synchronously.
- `tableToDataset(rows, {name,headerRow:0,xColumn:0,yColumn:1,errorColumn:null,xLabel,yLabel,xUnit,yUnit,decimal:'.',source})` => dataset. headerRow=-1 means no header. Invalid cells retained as null. No silent sorting.
- `datasetCSV(dataset)` => full original precision CSV, include mask; `downloadFile(content,filename,mime)` browser helper.
- `saveProject(project)`, `loadProject()` async IndexedDB; `saveTransfer(dataset)` => id, `loadTransfer(id)` => dataset|null. Shared DB `msc-data-studio`, version 1, object stores `projects`, `transfers`, keyPath `id`; autosave project under key `autosave` using wrapper `{id:'autosave',project}`; transfers `{id,dataset}`.
- `sampleDatasets()` => Dataset[] with deterministic synthetic XRD, Raman and ideal direct-gap UV/Vis alpha data plus labels/units/source metadata and tutorial field.

## Numerical engine (engine.js and engine tests; Sol owns)
- `runAnalysis({type,dataset,params})` => `{kind:'dataset',data:{x,y,error?,mask?,name?},operation:{type,params}, extras?}` OR `{kind:'result',result:FitResult|materialResult}`.
- Types: `crop`, `offset`, `scale`, `normalize`, `resample`, `movingAverage`, `savgol`, `derivative`, `integrate`, `baseline`, `detectPeaks`, `fit`, `xrd`, `transmittance`, `tauc`, `peakRatio`.
- Phase 2 types: `despike`, `statistics`, `williamsonHall`, `cubicLattice`, `urbach`. Project `schemaVersion` remains `1`; all FigureSpec additions use backward defaults.
- Preprocessing params: crop `{min,max}`; offset `{value}`; scale `{value}`; normalize `{mode:'maximum'|'area'}`; resample `{step}`; movingAverage `{window}`; savgol `{window,degree}`; derivative `{order:1|2}`; baseline `{mode:'constant'|'linear'|'polynomial'|'als',value,anchors:[{x,y}],degree,regions:[[min,max]],lambda,p,iterations}`.
- ROI optional `params.roi=[min,max]`. Masks honored, non-finite/unordered/duplicate inputs rejected for operations requiring monotonic X; no silent resampling or filtering invalid rows.
- detectPeaks `{prominence,minDistance,minWidth}` returns result `{type:'peaks',peaks:[{center,height,fwhm,area?}]}`.
- fit `{model:'linear'|'polynomial'|'gaussian'|'lorentzian'|'pseudoVoigt',degree:2,peaks:[{center,height,fwhm,eta:0.5,fixed:{},bounds:{center:[a,b],height:[a,b],fwhm:[a,b],eta:[0,1]}}],weighted:false,roi,baseline:0}`.
- FitResult `{type:'fit',model,status:'success'|'invalid',message,parameters,peaks:[],x,yFit,residuals,rmse,r2,uncertainty,iterations,roi}`. Add datasetId and datasetRevision on result. Degenerate covariance means invalid (except fully fixed models: no uncertainty). Numerical degrees/FWHM and units explicit.
- xrd params `{peaks,lambda:1.5406,K:0.9,instrumentFwhm:0,correction:'none'|'gaussian'|'lorentzian',profile:'gaussian'|'lorentzian'|'pseudoVoigt',confirmed:true}` => peaks incl dAngstrom, sizeNm or null, warning. A non-`none` correction must match the Gaussian/Lorentzian peak profile; reject common broadening correction for pseudoVoigt. beta radians.
- transmittance `{percent:true}` converts to absorbance. tauc `{xMode:'wavelength'|'energy',signal:'alpha'|'absorbance'|'transmittance'|'reflectance',thicknessNm,percent:true,transition:'direct'|'indirect',confirmed:true,roi:[min,max]}` => dataset transform with extras `{Eg,fit,...}` only fit if explicit ROI; use hc=1239.841984 eV nm. peakRatio `{peaks,a:0,b:1,metric:'height'|'area'}`.
- `despike {window,threshold,action:'replace'|'mask'}` is a Hampel-style rolling median/MAD operation. The local window includes the current sample, honors masks, reports indices, and never silently drops rows. `mask` preserves Y; `replace` uses the local median. Linear ramps/endpoints must not be false positives.
- `statistics {roi?}` reports unmasked descriptive statistics. Sample SD uses `n-1`; trapezoidal area is only reported for strictly monotonic X and contiguous active pairs.
- Every fit reports RSS, degrees of freedom, adjusted R², AIC and BIC using the number of **free** parameters. `reducedChiSquare` exists only for weighted fitting with finite positive σY and DoF > 0; an unweighted residual statistic must not be labelled χ².
- `williamsonHall {peaks,lambda,K,instrumentFwhm,correction,profile,confirmed}` requires at least three peaks and fits `y = β cosθ` against `x = 4 sinθ`, with 2θ/FWHM input in degrees and corrected β in radians. It returns `ε = slope` and `D = Kλ/intercept` (converted from Å to nm) only for positive intercept and non-negative microstrain. Gaussian and Lorentzian instrumental corrections are distinct, must match the selected profile, and a common correction is rejected for pseudo-Voigt.
- `cubicLattice {peaks:[{center,h,k,l}],lambda,zeroShiftDegrees,confirmed}` requires explicit integer hkl and a cubic-phase assumption. It uses corrected `2θ`, `d = λ/(2 sinθ)` and `a = d√(h²+k²+l²)`; one reflection gives no dispersion estimate.
- `urbach {xMode,signal,thicknessNm,percent,confirmed,roi}` requires an explicit ROI expressed in photon energy (eV), with at least three positive absorption-equivalent values, and fits `ln(α-equivalent) = intercept + hν/Eᵤ`; `Eᵤ = 1/slope` only for positive slope. Absorbance/transmittance require thickness. Diffuse reflectance uses `F(R)` as an apparent Kubelka–Munk proxy and must be labelled as assumption-dependent. Non-positive values outside the fit ROI become null with a warning, not a global failure.

## UI (main.js, plotting.js, style.css, template.html; Terra owns)
- Import model/IO/engine interfaces above. Engine asynchronously through `WorkerClient` from worker-client.js (root owns): `run(type,dataset,params,onProgress)` => Promise engine result; `cancel()`; cancellation rejects. Root embeds worker source as `globalThis.__MSC_WORKER_SOURCE__`. Main entry `main.js`.
- Plotting module import Plotly from `plotly.js-dist-min`; fonts local embedded by root build through CSS token `/*__FONT_CSS__*/`. Root provides PDF font strings `globalThis.__MSC_PDF_FONT_REGULAR__` and `__MSC_PDF_FONT_BOLD__` (base64 TTF). jsPDF/svg2pdf imports local deps.
- `FigureSpec` is owned by Terra; serialize fully into project.figures and restore. Data full precision: render preview reduction allowed, final export full data. Controls for overlay, offset, per-series color/style/axis/panel, layouts, range/ticks/labels, ROI, annotations/reference lines, scientific formatting and paper export.
- Phase 2 FigureSpec follows Origin's Page → Layer → Plot mental model without copying proprietary formats. Figure adds `pageBackground`; each panel adds `plotBackground`, `margins`, `grid`, `axes`, `ticks`, and `legend`; each series adds editable `name`, `visible`, `opacity`, `lineShape`, `fill` and error-bar styling. `normalizeFigure()` migrates v1 figures without overwriting defaults with undefined legacy aliases.
- `applyFigureTheme(figure,'journal'|'presentation'|'xrd')` is a pure transform. Themes, styled annotations/reference lines, trace ordering and every visual property must survive project JSON and full-data SVG/PNG/PDF export.
- HTML template must contain `<!--__STUDIO_CSS__-->` in head and `<!--__STUDIO_JS__-->` before closing body. Root bundles/embeds dependencies and worker; no external scripts/fonts/fetch needed.
- Expose `globalThis.MSCStudio = {getProject:()=>project,...}` only for browser testing/read-only project access; prefer testing through UI. Use unique stable DOM ids for key controls.

## Ownership
Root: build.py, scripts/build-analysis.mjs, package.json/lock, worker-client.js, worker.js, existing lab bridges, docs/CI/browser integration tests.
Sol: engine.js and tests/numerical.test.js.
Terra: main.js, plotting.js, style.css, template.html (may add UI helpers).
Luna: model.js, io.js, storage.js, samples.js, tests/data.test.js.
All: no editing generated root HTML, no git commits/pushes (root handles), communicate deviations immediately.

## Origin benchmark and deliberate non-parity

The Phase 2 benchmark uses only OriginLab's official documentation: [Graph Template Basics](https://docs.originlab.com/origin-help/graph-template-basics/) defines Page → Layer → Plot customization and reusable templates; [Peak Analyzer](https://docs.originlab.com/origin-help/peakanalyzer/) defines baseline, peak finding, integration and fitting workflows; [Fit Peaks report](https://docs.originlab.com/origin-help/peakanalyzer-fitpeak/) lists RSS, DoF, reduced χ², R²/adjusted R², RMSE and covariance outputs; [X-Ray Diffraction Analysis](https://docs.originlab.com/app/x-ray-diffraction-analysis/) documents reference-pattern overlays; and OriginLab's [3D XRD Waterfall](https://www.originlab.com/fileexchange/details.aspx?fid=749&v=0) documents a specialized 3D template.

Realistic offline-browser parity in Phase 2 is the serializable 2D Figure Editor, reusable local presets, spectrum preprocessing/peak fitting and guarded scalar materials analyses above. Deliberately out of scope are proprietary OPJU/OTP compatibility, LabTalk/Python automation, external crystallographic databases/automatic phase identification, Rietveld refinement, vendor connectors, CWT matrices, 3D/matrix/image plots and high-throughput batch templates. Those need separate data licensing, algorithms, compute budgets, or backend/plugin architecture; presenting them as parity would be misleading.
