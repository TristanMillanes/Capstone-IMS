const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'admin/admincommunication.js'),'utf8');
const scope=vm.createContext({});
for(const [start,end] of [['/* Sender detection reads','/* End sender detection. */'],['/* Memo document parser:','/* End memo document parser. */'],['/* Printed heading and letter-purpose','/* End letter-purpose extraction. */']]){
 const block=source.slice(source.indexOf(start),source.indexOf(end)+end.length);vm.runInContext(block,scope);
}
const cases=[
 ['Inline closing','REQUEST LETTER\nTO: ENRO\nFROM: OFFICE A\nSUBJECT: Work\n\nPlease assist.\n\nRespectfully yours, MARIA L. SANTOS\nMunicipal Mayor','MARIA L. SANTOS'],
 ['Inline designation','REQUEST LETTER\nTO: ENRO\nSUBJECT: Work\n\nPlease assist.\n\nRespectfully yours,\nMARIA L. SANTOS, Municipal Mayor','MARIA L. SANTOS'],
 ['Closing continued on page two','REQUEST LETTER\nTO: ENRO\nSUBJECT: Work\n\nPlease assist.\n\nRespectfully yours,\fMARIA L. SANTOS','MARIA L. SANTOS'],
 ['Honorific without a space','REQUEST LETTER\nTO: ENRO\nSUBJECT: Work\n\nPlease assist.\n\nSigned by: Atty.MARIA L. SANTOS, Municipal Mayor','Atty. MARIA L. SANTOS'],
];
const results=[];
for(const [title,text,name] of cases){assert.equal(scope.parseCorrespondence(text).receivedFrom,name,title);results.push({scenario:title,result:'PASS'});}
const letter='September 20, 2026\n\nHON. JUAN DELA CRUZ\nMunicipal Mayor\nOffice of the Municipal Mayor\n\nDear Mayor:\n\nI respectfully request technical assistance for river rehabilitation.\n\nSincerely yours,\nMARIA L. SANTOS\nDepartment Head';
assert(scope.parseCorrespondence(letter).recipient.includes('HON. JUAN DELA CRUZ'));
const purpose=scope.parseLetterDetails(letter);assert.equal(purpose.documentType,'Request Letter');assert(purpose.subject.includes('request technical assistance'));assert(purpose.needsReview.includes('subject'));
results.push({scenario:'Conventional recipient block and unheaded native-text purpose marked for review',result:'PASS'});
const memo='MEMORANDUM\nTO: ALL PERSONNEL\nSUBJECT: Reports\n\nFor your compliance.';
assert(scope.parseLetterDetails(memo).isMemo);results.push({scenario:'A numberless memorandum still detects its routing destination',result:'PASS'});
fs.writeFileSync(path.join(__dirname,'letter-fields-results.json'),JSON.stringify({passed:true,results},null,2));console.log(results);
