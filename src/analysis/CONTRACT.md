# Materials Data Studio v1 contracts

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
- Preprocessing params: crop `{min,max}`; offset `{value}`; scale `{value}`; normalize `{mode:'maximum'|'area'}`; resample `{step}`; movingAverage `{window}`; savgol `{window,degree}`; derivative `{order:1|2}`; baseline `{mode:'constant'|'linear'|'polynomial'|'als',value,anchors:[{x,y}],degree,regions:[[min,max]],lambda,p,iterations}`.
- ROI optional `params.roi=[min,max]`. Masks honored, non-finite/unordered/duplicate inputs rejected for operations requiring monotonic X; no silent resampling or filtering invalid rows.
- detectPeaks `{prominence,minDistance,minWidth}` returns result `{type:'peaks',peaks:[{center,height,fwhm,area?}]}`.
- fit `{model:'linear'|'polynomial'|'gaussian'|'lorentzian'|'pseudoVoigt',degree:2,peaks:[{center,height,fwhm,eta:0.5,fixed:{},bounds:{center:[a,b],height:[a,b],fwhm:[a,b],eta:[0,1]}}],weighted:false,roi,baseline:0}`.
- FitResult `{type:'fit',model,status:'success'|'invalid',message,parameters,peaks:[],x,yFit,residuals,rmse,r2,uncertainty,iterations,roi}`. Add datasetId and datasetRevision on result. Degenerate covariance means invalid (except fully fixed models: no uncertainty). Numerical degrees/FWHM and units explicit.
- xrd params `{peaks,lambda:1.5406,K:0.9,instrumentFwhm:0,correction:'none'|'gaussian'|'lorentzian',profile:'gaussian'|'lorentzian'|'pseudoVoigt',confirmed:true}` => peaks incl dAngstrom, sizeNm or null, warning. Reject common broadening correction for pseudoVoigt. beta radians.
- transmittance `{percent:true}` converts to absorbance. tauc `{xMode:'wavelength'|'energy',signal:'alpha'|'absorbance'|'transmittance'|'reflectance',thicknessNm,percent:true,transition:'direct'|'indirect',confirmed:true,roi:[min,max]}` => dataset transform with extras `{Eg,fit,...}` only fit if explicit ROI; use hc=1239.841984 eV nm. peakRatio `{peaks,a:0,b:1,metric:'height'|'area'}`.

## UI (main.js, plotting.js, style.css, template.html; Terra owns)
- Import model/IO/engine interfaces above. Engine asynchronously through `WorkerClient` from worker-client.js (root owns): `run(type,dataset,params,onProgress)` => Promise engine result; `cancel()`; cancellation rejects. Root embeds worker source as `globalThis.__MSC_WORKER_SOURCE__`. Main entry `main.js`.
- Plotting module import Plotly from `plotly.js-dist-min`; fonts local embedded by root build through CSS token `/*__FONT_CSS__*/`. Root provides PDF font strings `globalThis.__MSC_PDF_FONT_REGULAR__` and `__MSC_PDF_FONT_BOLD__` (base64 TTF). jsPDF/svg2pdf imports local deps.
- `FigureSpec` is owned by Terra; serialize fully into project.figures and restore. Data full precision: render preview reduction allowed, final export full data. Controls for overlay, offset, per-series color/style/axis/panel, layouts, range/ticks/labels, ROI, annotations/reference lines, scientific formatting and paper export.
- HTML template must contain `<!--__STUDIO_CSS__-->` in head and `<!--__STUDIO_JS__-->` before closing body. Root bundles/embeds dependencies and worker; no external scripts/fonts/fetch needed.
- Expose `globalThis.MSCStudio = {getProject:()=>project,...}` only for browser testing/read-only project access; prefer testing through UI. Use unique stable DOM ids for key controls.

## Ownership
Root: build.py, scripts/build-analysis.mjs, package.json/lock, worker-client.js, worker.js, existing lab bridges, docs/CI/browser integration tests.
Sol: engine.js and tests/numerical.test.js.
Terra: main.js, plotting.js, style.css, template.html (may add UI helpers).
Luna: model.js, io.js, storage.js, samples.js, tests/data.test.js.
All: no editing generated root HTML, no git commits/pushes (root handles), communicate deviations immediately.
