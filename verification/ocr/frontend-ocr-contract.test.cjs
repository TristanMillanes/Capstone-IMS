const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = process.env.PGENRO_PROJECT_ROOT || path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'admin/admincommunication.js'), 'utf8');
const start = source.indexOf('  function readLabeledFormValue');
const end = source.indexOf('\n  function extractFields(', start);
assert(start >= 0 && end > start, 'The production OCR form mapper must exist.');

const controls = {
  typeSelect: { value: 'Incoming' },
  statusSelect: { options: ['Pending', 'Received', 'Forwarded', 'Released', 'Archived'].map(value => ({ value })) },
  docTypeSelect: { options: ['Request Letter', 'Other Communication'].map(value => ({ value })) }
};
const context = vm.createContext({
  $: id => controls[id],
  parseMemoDate: value => value,
  data: {
    documentType: 'Request Letter',
    subject: 'REQUEST FOR TECHNICAL ASSISTANCE',
    sourceOffice: 'OFFICE OF THE MUNICIPAL MAYOR',
    receivedFrom: '',
    needsReview: ['receivedFrom'],
    isMemo: false
  },
  text: [
    'REQUEST LETTER',
    'STATUS: Forwarded',
    'ACTION TAKEN: Forwarded to Planning Division',
    'REMARKS: Original received and logged.'
  ].join('\n')
});
vm.runInContext(source.slice(start, end) + '\nresult = browserFormValues(data, text);', context);
assert.equal(context.result.statusSelect, 'Forwarded');
assert.equal(context.result.actionTakenInput, 'Forwarded to Planning Division');
assert.equal(context.result.remarksInput, 'Original received and logged.');
assert.equal(context.result.officeInput, 'OFFICE OF THE MUNICIPAL MAYOR');
console.log('PASS browser OCR form mapper fills status, action, remarks and source-office fallback.');
