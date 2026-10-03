const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../../admin/admincommunication.js'),'utf8');
const context=vm.createContext({});vm.runInContext(source.slice(source.indexOf('function parseCorrespondence('),source.indexOf('/* End sender detection. */')),context);
const fixtures=[
 {name:'Missing dots in OCR initials are formatted without changing the name letters',text:'REQUEST LETTER\nTO: PROVINCIAL ENRO\nSUBJECT: Work\n\nFor your compliance.\nMARIA L SANTOS\nDepartment Head',receivedFrom:'MARIA L. SANTOS'},
 {name:'The printed author fills Received From while TO stays separate',text:'REQUEST LETTER\nTO: PROVINCIAL ENRO\nFROM: Municipal Office\nSUBJECT: Assistance\n\nDear Sir,\nPlease assist.\n\nRespectfully yours,\nMARIA L. SANTOS\nMunicipal Mayor',receivedFrom:'MARIA L. SANTOS',recipient:'PROVINCIAL ENRO'},
 {name:'The closing block may continue on page two',text:'OFFICE ORDER\nTO: ALL PERSONNEL\nSUBJECT: Work\n\nPlease comply.\fContinued instructions.\nFor your compliance.\nEnP JOHN FRANCIS L. LUZANO, MPA\nPGDH PG ENRO',receivedFrom:'EnP JOHN FRANCIS L. LUZANO, MPA',page:2},
 {name:'An annex author cannot replace the covering letter sender',text:'REQUEST LETTER\nTO: PROVINCIAL ENRO\nFROM: MUNICIPAL OFFICE\nSUBJECT: Assistance\n\nPlease assist.\fANNEX A\nSupporting report\n\nRespectfully yours,\nPEDRO R. REYES\nDepartment Head',receivedFrom:'MUNICIPAL OFFICE'},
 {name:'An annex signer cannot create a sender missing from the letter',text:'REQUEST LETTER\nTO: PROVINCIAL ENRO\nSUBJECT: Assistance\n\nPlease assist.\fANNEX A\nSupporting report\n\nRespectfully yours,\nPEDRO R. REYES\nDepartment Head',receivedFrom:''},
 {name:'Equal printed signatories require the reviewer to choose',text:'MEMORANDUM\nTO: ALL PERSONNEL\nSUBJECT: Work\n\nFor your compliance.\nMARIA L. SANTOS\nDepartment Head\nPEDRO R. REYES\nDirector',receivedFrom:'',review:true},
 {name:'Body FROM labels cannot become a header sender',text:'REQUEST LETTER\nTO: PROVINCIAL ENRO\nSUBJECT: Assistance\n\nDear Sir,\nFROM: Body reference\nPlease assist.',receivedFrom:''}
];
for(const f of fixtures){const result=context.parseCorrespondence(f.text);assert.equal(result.receivedFrom,f.receivedFrom,f.name);if(f.recipient)assert.equal(result.recipient,f.recipient);if(f.page)assert.equal(result.signatoryCandidates[0].page,f.page);if(f.review)assert(result.needsReview.includes('receivedFrom'));console.log('PASS',f.name);}
fs.writeFileSync(path.join(__dirname,'printed-sender-results.json'),JSON.stringify({method:'Actual full-document Communications sender detector',scenarios:fixtures.map(f=>({scenario:f.name,result:'PASS'}))},null,2));
