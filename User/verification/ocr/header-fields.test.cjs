const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=process.env.PGENRO_PROJECT_ROOT?path.resolve(process.env.PGENRO_PROJECT_ROOT):path.resolve(__dirname,'../..');
const scripts=['admincommunication.js','officememo-admin.js'].map(name=>fs.readFileSync(path.join(root,'admin',name),'utf8'));
const block=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end)+end.length);
const parser=scripts.map(s=>block(s,'/* Memo document parser:','/* End memo document parser. */'));
const reader=scripts.map(s=>block(s,'/* Browser document reader,','/* End browser document reader. */'));
assert.equal(parser[0],parser[1]);
const context=vm.createContext({});const pdfLines=scripts[0].slice(scripts[0].indexOf('function pdfTextLines('),scripts[0].indexOf('function mergeDocumentText('));vm.runInContext(parser[0]+pdfLines,context);const report=[];
const inline=context.parseDocumentHeader('MEMORANDUM NO. 004\nTO: Personnel  FROM: ENRO  DATE: October 1, 2026\nSUBJECT: Reports');
assert.equal(inline.evidence.addressedTo,2);assert.equal(inline.evidence.issuedBy,2);assert.equal(inline.evidence.date,2);
for(const test of JSON.parse(fs.readFileSync(path.join(__dirname,'header-cases.json'),'utf8'))){const result=context.parseDocumentHeader(test.text);for(const[key,value]of Object.entries(test.expected))assert.deepEqual(result[key],value,`${test.name}: ${key}`);report.push({scenario:test.name,result:'PASS'});console.log('PASS',test.name);}
const items=[{str:'FROM: Mayor',transform:[1,0,0,11,40,740],height:11},{str:'SUBJECT: Work plan',transform:[1,0,0,11,40,700],height:11},{str:'REQUEST LETTER',transform:[1,0,0,11,40,780],height:11},{str:'FOR FY 2027',transform:[1,0,0,11,40,680],height:11}];
assert.equal(context.pdfTextLines(items),'REQUEST LETTER\nFROM: Mayor\nSUBJECT: Work plan\nFOR FY 2027');report.push({scenario:'PDF reading order is geometric and wrapped lines remain contiguous',result:'PASS'});
fs.writeFileSync(path.join(__dirname,'header-results.json'),JSON.stringify({method:'Identical production header parsers from both admin pages; geometric PDF reading order verified',scenarios:report},null,2));console.log(report.length+' header/reader scenarios passed');
