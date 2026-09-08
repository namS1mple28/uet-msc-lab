import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';

// Bundle nội tuyến giữ file HTML dùng được ngoại tuyến, không yêu cầu CDN.
const options={bundle:true,write:false,format:'iife',platform:'browser',target:['es2020'],minify:true,legalComments:'inline',logLevel:'warning'};
const [worker, app]=await Promise.all([
  build({...options,entryPoints:['src/analysis/worker.js']}),
  build({...options,entryPoints:['src/analysis/main.js']}),
]);
const [template,css,regular,bold,license]=await Promise.all([
  readFile('src/analysis/template.html','utf8'),readFile('src/analysis/style.css','utf8'),
  readFile('vendor/fonts/NotoSans-Regular.ttf'),readFile('vendor/fonts/NotoSans-Bold.ttf'),
  readFile('vendor/fonts/OFL.txt','utf8')
]);
const fonts=`@font-face{font-family:NotoSans;font-style:normal;font-weight:400;src:url(data:font/ttf;base64,${regular.toString('base64')}) format('truetype')}@font-face{font-family:NotoSans;font-style:normal;font-weight:700;src:url(data:font/ttf;base64,${bold.toString('base64')}) format('truetype')}`;
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const globals=`globalThis.__MSC_WORKER_SOURCE__=${json(worker.outputFiles[0].text)};globalThis.__MSC_PDF_FONT_REGULAR__=${json(regular.toString('base64'))};globalThis.__MSC_PDF_FONT_BOLD__=${json(bold.toString('base64'))};`;
const js=(globals+app.outputFiles[0].text).replace(/<\/script/gi,'<\\/script');
if(!template.includes('<!--__STUDIO_CSS__-->') || !template.includes('<!--__STUDIO_JS__-->'))throw new Error('Thiếu vị trí chèn bundle trong template.');
const html=template.replace('<!--__STUDIO_CSS__-->',()=>`<!-- NotoSans: ${license.replace(/--/g,'—')} -->\n<style>${fonts}\n${css.replace('/*__FONT_CSS__*/','')}</style>`).replace('<!--__STUDIO_JS__-->',()=>`<script>${js}</script>`);
await writeFile('analysis.html',html);
console.log(`Materials Data Studio: ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MiB, bundle ngoại tuyến.`);
