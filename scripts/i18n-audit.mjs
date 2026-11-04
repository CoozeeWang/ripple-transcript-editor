// Run from repository root: node scripts/i18n-audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readCatalog,messageSignature} from './i18n-catalog.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const failures=[];
const catalogs=['zh-CN','en','zh-TW'].map(locale=>{
 const {catalog,failures:invalid}=readCatalog(fs.readFileSync(path.join(root,`frontend/src/i18n/locales/${locale}.json`),'utf8'),locale);
 failures.push(...invalid);return catalog;
});
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
const [zh,en,tw]=catalogs;
const exceptions=read('docs/i18n/source-exceptions.json');
for(const [group,values]of Object.entries(zh))for(const [key,value]of Object.entries(values)){
 const target=en[group]?.[key], traditional=tw[group]?.[key];
 if(!target||!traditional||messageSignature(value)!==messageSignature(target)||messageSignature(value)!==messageSignature(traditional))failures.push(`Missing text or mismatched parameters/rich links: ${group}.${key}`);
}
for(const [locale,catalog] of Object.entries({en,'zh-TW':tw})) for(const [group,entries] of Object.entries(catalog)) for(const key of Object.keys(entries)) {
 if(!Object.hasOwn(zh[group]??{},key)) failures.push(`Extra key in ${locale}: ${group}.${key}`);
}
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,e.name);
 if(e.isDirectory()){if(e.name!=='i18n')walk(file);continue;}
 if(!/\.tsx?$/.test(file)||file.includes('.test.'))continue;
 const rel=path.relative(path.join(root,'frontend/src'),file), source=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,source,99,true);
 function visit(n){
  if(ts.isCallExpression(n)&&n.expression.getText(sf)==='msg'&&ts.isStringLiteral(n.arguments[0])){
   let parent=n.parent;while(parent&&!ts.isFunctionLike(parent))parent=parent.parent;
   if(!parent)failures.push(`Message frozen at module initialization: ${rel}`);
   const key=n.arguments[0].text,[group,id]=key.split('.');if(!zh[group]?.[id])failures.push(`Unknown key ${key} in ${rel}`);
  }
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isJsxText(n)||ts.isTemplateExpression(n)){
   const text=ts.isTemplateExpression(n)?n.head.text+n.templateSpans.map((v,i)=>'{{v'+i+'}}'+v.literal.text).join(''):n.text;
   if(/[\u3400-\u9fff]/.test(text)&&!exceptions.some(e=>e.file===rel&&e.text===text)) failures.push(`Unreviewed Chinese literal: ${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1} ${text.slice(0,80)}`);
   if(ts.isTemplateExpression(n))n.templateSpans.forEach(v=>visit(v.expression));return;
  }
  ts.forEachChild(n,visit);
 }visit(sf);
}}walk(path.join(root,'frontend/src'));
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('i18n audit passed: resource parameters, literal message keys and reviewed Chinese exceptions.');
