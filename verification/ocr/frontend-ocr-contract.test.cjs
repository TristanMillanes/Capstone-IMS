const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.PGENRO_PROJECT_ROOT || path.resolve(__dirname, '../..');
const shared = fs.readFileSync(path.join(root, 'shared/ocr-form-fields.js'), 'utf8');
const comm = fs.readFileSync(path.join(root, 'admin/admincommunication.js'), 'utf8');
const memo = fs.readFileSync(path.join(root, 'admin/officememo-admin.js'), 'utf8');
const from = (source, start, end) => {
  assert(source.includes(start) && source.includes(end));
  return source.slice(source.indexOf(start), source.indexOf(end));
};

function field(value = '') {
  return {value, dataset: {}, addEventListener() {}};
}

const commInputs = new Map(Object.entries({
  typeSelect: field('Incoming'), controlNoInput: field(),
  docTypeSelect: field(''), dateInput: field('2026-11-14'), statusSelect: field('Pending'),
  officeInput: field(), subjectInput: field(), actionTakenInput: field(), remarksInput: field(),
  memoRecipientInput: field(), memoIssuerInput: field(), ocrTextInput: field(),
}));
commInputs.get('typeSelect').options = ['Incoming', 'Outgoing'].map(value => ({value}));
commInputs.get('docTypeSelect').options = ['Request Letter', 'Memorandum', 'Other Communication'].map(value => ({value}));
commInputs.get('statusSelect').options = ['Pending', 'Forwarded'].map(value => ({value}));
for (const id of ['typeSelect', 'docTypeSelect', 'statusSelect']) commInputs.get(id).tagName = 'SELECT';
const elements = {
  ocrSignatorySelect: {replaceChildren() {}, add() {}},
  ocrSignatoryGroup: {}, communicationOcrReview: {},
  communicationMemoReview: {}, ocrFieldSummary: {}, ocrStatsChip: {style: {}},
  dateFieldLabel: {textContent: 'Date received'},
  communicationForm: {querySelectorAll: () => ['dateInput', 'officeInput', 'subjectInput'].map(id => ({id, ...commInputs.get(id)}))},
};
const $ = id => commInputs.get(id) || elements[id];
const context = vm.createContext({
  $, window: {PGENRO_API: {adminCan: () => true}}, Option: function (text, value) { Object.assign(this, {text, value}); },
  commManualFields: new Set(), commOcrValues: new Map(), ocrFormIds: new Set(commInputs.keys()),
  editing: null, lastOcr: null,
  updateDestination() {
    elements.dateFieldLabel.textContent = $('docTypeSelect').value === 'Memorandum' ? 'Date issued' :
      $('typeSelect').value === 'Outgoing' ? 'Date released' : 'Date received';
  },
  setFieldState(id, state) { $(id).dataset.ocrState = state; },
});
vm.runInContext(shared, context);
vm.runInContext(from(comm, '/* Sender detection reads', '/* End letter-purpose extraction. */'), context);
vm.runInContext(from(comm, '  function applyOcrValue(', '  async function runDocumentRead('), context);

const letter = [
  'REQUEST LETTER', 'COMMUNICATION TYPE: Outgoing', 'CONTROL NO: REF-2026-20',
  'RECEIVED FROM: OFFICE OF THE MAYOR', 'SENT TO: MUNICIPAL ENRO',
  'DATE ISSUED: November 7, 2026', 'DATE RECEIVED: November 8, 2026',
  'SUBJECT / PARTICULARS: Request for seedling delivery', 'ACTION TAKEN: Forwarded to Planning Division',
  'DATE FORWARDED: November 10, 2026', 'REMARKS:', 'STATUS: Forwarded',
  'Dear Sir,', 'Please assist on November 20, 2026.', 'REMARKS: unrelated body text.',
].join('\n');
context.extractFields(letter);
assert.equal($('controlNoInput').value, 'REF-2026-20');
assert.equal($('typeSelect').value, 'Outgoing');
assert.equal($('officeInput').value, 'MUNICIPAL ENRO');
assert.equal($('dateInput').value, '');
assert.equal($('subjectInput').value, 'Request for seedling delivery');
assert.equal($('statusSelect').value, 'Forwarded');
assert.equal($('actionTakenInput').value, 'Forwarded to Planning Division\nDate forwarded: November 10, 2026');
assert.equal($('remarksInput').value, '');

$('subjectInput').value = '';
$('typeSelect').value = 'Incoming';
context.commManualFields.add('subjectInput').add('typeSelect');
context.extractFields(letter);
assert.equal($('typeSelect').value, 'Incoming');
assert.equal($('officeInput').value, 'OFFICE OF THE MAYOR');
assert.equal($('dateInput').value, '2026-11-08');
assert.equal($('subjectInput').value, '');

context.extractFields(letter, {
  formSchemaVersion: 2, communicationType: 'Incoming', route: 'communications',
  metadata: {documentType: 'Request Letter', date: '2026-11-07', receivedDate: '2026-11-08', receivedFrom: '', direction: 'Outgoing'},
  formValues: {docTypeSelect: 'Request Letter', dateInput: '2026-11-08', statusSelect: '', officeInput: '', remarksInput: ''},
});
assert.equal($('officeInput').value, '');
assert.equal($('statusSelect').value, 'Pending');
assert.equal($('remarksInput').value, '');
console.log('PASS Communications follows the selected direction, keeps manual values and respects blank server fields.');

const memoInputs = {
  formControlNo: field(), formDate: field('2026-11-14'), formAddressedTo: field(),
  formSubject: field(), formIssuedBy: field(), formRemarks: field(),
};
const memoElements = Object.fromEntries(['memoExtractionReview', 'memoReviewSummary', 'memoReviewFields', 'recheckMemoFieldsBtn'].map(id => [id, {}]));
const memoContext = vm.createContext({
  ...memoInputs, window: {}, document: {getElementById: id => memoElements[id]},
  memoOcrText: field(), escapeHtml: value => value, busy: false, fileBusy: false, ocrBusy: false,
});
vm.runInContext(shared, memoContext);
vm.runInContext(from(memo, '/* Memo document parser. */', '  function setMemoOcrStatus('), memoContext);
vm.runInContext("generatedMemoDate='2026-11-14';", memoContext);
memoContext.applyMemoFields([
  'MEMORANDUM NO. 12, s. 2026',
  'TO  ALL SECTION CHIEFS',
  'ISSUED BY  PGENRO ADMIN DIVISION',
  'DATE ISSUED:\n14 Nobyembre 2026',
  'SUBJECT: Work plans',
  'REMARKS:\n\nKeep the original with the official records.',
  '\nFor your compliance.\nANA R. REYES\nDirector',
].join('\n'));
assert.equal(memoInputs.formControlNo.value, '12, s. 2026');
assert.equal(memoInputs.formDate.value, '2026-11-14');
assert.equal(memoInputs.formIssuedBy.value, 'PGENRO ADMIN DIVISION');
assert.equal(memoInputs.formAddressedTo.value, 'ALL SECTION CHIEFS');
assert.equal(memoInputs.formRemarks.value, 'Keep the original with the official records.');
memoInputs.formSubject.value = '';
vm.runInContext("memoManualFields.add('subject')", memoContext);
memoContext.applyMemoFields('REQUEST LETTER\nTO: Another office\nSUBJECT: Wrong document type');
assert.equal(memoInputs.formSubject.value, '');
assert.equal(memoInputs.formAddressedTo.value, '');
assert.equal(memoInputs.formIssuedBy.value, '');
assert.equal(memoInputs.formDate.value, '');
assert.equal(memoInputs.formRemarks.value, '');
assert.match(memoElements.memoReviewSummary.textContent, /no memorandum heading/);
console.log('PASS Office Memos keeps its issuer, fills remarks and clears stale suggestions while preserving manual edits.');

const signedMemo = [
  'OFFICE MEMORANDUM NO. 2026-601', 'TO: ALL SECTION HEADS', 'DATE: 14 November 2026',
  'FROM: ADMINISTRATIVE DIVISION', 'ISSUED BY: —', 'SUBJECT: Monthly reports',
  '', 'Please submit the current reports by November 30.',
  '', 'For immediate and strict compliance.', 'ENGR. ALMA J. DE LA CRUZ', 'PGDH - PGENRO',
].join('\n');
const olderServiceResult = {
  formSchemaVersion: 2, communicationType: 'Incoming', route: 'office_memos',
  metadata: {
    isMemo: true, memoNo: '2026-601', documentType: 'Memorandum', date: '2026-11-14',
    issuedBy: '', addressedTo: 'ALL SECTION HEADS', recipient: 'ALL SECTION HEADS', subject: 'Monthly reports',
    fieldEvidence: {issuedBy: 'ISSUED BY: —'},
  },
  formValues: {
    controlNoInput: '2026-601', docTypeSelect: 'Memorandum', dateInput: '2026-11-14',
    memoRecipientInput: 'ALL SECTION HEADS', memoIssuerInput: '', subjectInput: 'Monthly reports',
  },
};
vm.runInContext("memoManualFields.clear(); memoOcrValues.clear();", memoContext);
for (const input of Object.values(memoInputs)) input.value = '';
memoContext.applyMemoFields(signedMemo, olderServiceResult);
assert.equal(memoInputs.formIssuedBy.value, 'ENGR. ALMA J. DE LA CRUZ');
assert.equal(memoInputs.formAddressedTo.value, 'ALL SECTION HEADS');
assert.equal(memoInputs.formDate.value, '2026-11-14');
assert.equal(memoInputs.formSubject.value, 'Monthly reports');
memoInputs.formIssuedBy.value = 'Manually confirmed signer';
vm.runInContext("memoManualFields.add('issuedBy');", memoContext);
memoContext.applyMemoFields(signedMemo, olderServiceResult);
assert.equal(memoInputs.formIssuedBy.value, 'Manually confirmed signer');

context.commManualFields.clear();
context.commOcrValues.clear();
for (const input of commInputs.values()) input.value = '';
$('typeSelect').value = 'Incoming';
context.extractFields(signedMemo, olderServiceResult);
assert.equal($('memoIssuerInput').value, 'ENGR. ALMA J. DE LA CRUZ');
assert.equal($('memoRecipientInput').value, 'ALL SECTION HEADS');
assert.equal($('dateInput').value, '2026-11-14');
console.log('PASS Both forms recover the printed issuer from full OCR text when older service metadata leaves it blank.');

const manualNumber = 'Desk 07 / ref A';
$('controlNoInput').value = manualNumber;
context.extractFields(letter);
assert.equal($('controlNoInput').value, manualNumber);
$('controlNoInput').value = '';
context.extractFields('REQUEST LETTER\nSUBJECT: Schedule update');
assert.equal($('controlNoInput').value, '');

memoInputs.formControlNo.value = manualNumber;
memoContext.applyMemoFields(signedMemo, olderServiceResult);
assert.equal(memoInputs.formControlNo.value, manualNumber);
memoInputs.formControlNo.value = '';
memoContext.applyMemoFields('MEMORANDUM\nTO: All Personnel\nSUBJECT: Schedule update');
assert.equal(memoInputs.formControlNo.value, '');
console.log('PASS OCR preserves entered control numbers and leaves an unreadable or absent number for manual entry.');
