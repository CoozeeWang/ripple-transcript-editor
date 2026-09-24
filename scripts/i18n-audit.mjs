// Run from repository root: node scripts/i18n-audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const zh = read('frontend/src/i18n/locales/zh-CN.json'), en = read('frontend/src/i18n/locales/en.json');
const exceptions=read('docs/i18n/source-exceptions.json');
const failures=[];
for(const [group,values]of Object.entries(zh))for(const [key,value]of Object.entries(values)){
 const target=en[group]?.[key];
 const parameters=s=>[...new Set(s.match(/{{\w+}}/g)||[])].sort().join(',');
 if(!target||parameters(value)!==parameters(target))failures.push(`Missing text or mismatched parameters: ${group}.${key}`);
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
