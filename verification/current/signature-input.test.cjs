const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../VisitorsLog/visitorslog.js'), 'utf8');
const start = source.indexOf('  function setupSignature(');
const end = source.indexOf('\n})()', start);
assert(start >= 0 && end > start);

const strokes = [], canvasListeners = new Map(), windowListeners = new Map(), frames = new Map();
let layoutReads = 0, capture = null, frameId = 0, currentPath, changes = 0, locked = false;
const ink = {
  beginPath() { currentPath = []; },
  moveTo(x, y) { currentPath.push([x, y]); },
  lineTo(x, y) { currentPath.push([x, y]); },
  stroke() { strokes.push(currentPath); },
  clearRect() { strokes.length = 0; },
};
const canvas = {
  width: 600, height: 270, offsetWidth: 302, offsetHeight: 137,
  clientWidth: 300, clientHeight: 135, clientLeft: 1, clientTop: 1,
  getContext: () => ink,
  getBoundingClientRect() { layoutReads++; return {left: 10, top: 20, width: 302, height: 137}; },
  addEventListener: (event, handler) => canvasListeners.set(event, handler),
  setPointerCapture(id) { capture = id; },
  hasPointerCapture: id => id === capture,
  releasePointerCapture() { capture = null; },
  removeAttribute() {},
  toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
};
const clear = {disabled: true, addEventListener(event, callback) { this.click = callback; }};
const status = {};
const body = {dataset: {}};
const context = vm.createContext({
  document: {body},
  window: {scrollX: 0, scrollY: 120, addEventListener: (event, handler) => windowListeners.set(event, handler)},
  requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: id => frames.delete(id),
});
vm.runInContext(source.slice(start, end), context);
const elements = {visitorSignature: canvas, clearVisitorSignature: clear, signatureStatus: status};
const signature = context.setupSignature(id => elements[id], () => locked, () => changes++);
const event = (x, y, extras = {}) => ({pointerId: 7, pageX: 11 + x, pageY: 141 + y, button: 0, isPrimary: true, pointerType: 'pen', preventDefault() {}, ...extras});
const dispatch = (type, value) => canvasListeners.get(type)(value);

dispatch('pointerdown', event(10, 20));
assert.equal(body.dataset.signing, 'true');
assert.equal(capture, 7);
dispatch('pointermove', event(30, 40, {getCoalescedEvents: () => [event(15, 23), event(22, 30)]}));
dispatch('pointermove', event(36, 45));
dispatch('pointermove', event(120, 120, {pointerId: 8}));
assert.equal(layoutReads, 1);
assert.equal(frames.size, 1);
assert.equal(strokes.length, 0);
const [firstFrame, draw] = frames.entries().next().value;
frames.delete(firstFrame);
draw();
assert.equal(strokes.length, 1);
assert.deepEqual(strokes[0], [[20, 40], [30, 46], [44, 60], [60, 80], [72, 90]]);
assert.equal(status.textContent, 'Signature added.');
assert.equal(changes, 1);
assert.equal(clear.disabled, false);

dispatch('pointermove', event(40, 49));
dispatch('pointerup', event(45, 55));
assert.equal(frames.size, 0);
assert.equal(capture, null);
assert.equal(body.dataset.signing, undefined);
assert.deepEqual(strokes[1], [[72, 90], [80, 98], [90, 110]]);
assert.match(signature.image(), /^data:image\/png;base64,/);

clear.click();
assert.equal(signature.hasInk(), false);
assert.equal(signature.image(), null);
assert.equal(clear.disabled, true);
assert.equal(status.textContent, 'Signature box is empty.');

dispatch('pointerdown', event(11, 20, {pointerType: 'touch'}));
dispatch('pointermove', event(20, 25, {pointerType: 'touch'}));
assert.match(signature.image(), /^data:image\/png;base64,/);
assert.equal(frames.size, 0);
windowListeners.get('resize')();
assert.equal(capture, null);
assert.equal(body.dataset.signing, undefined);
clear.click();
dispatch('pointerdown', event(10, 11, {pointerType: 'mouse'}));
dispatch('pointerup', event(10, 11, {pointerType: 'mouse'}));
assert.equal(signature.hasInk(), false);
locked = true;
dispatch('pointerdown', event(10, 11));
assert.equal(capture, null);
console.log('PASS Signature uses one layout read per stroke, batches samples, keeps the final point, and clears or exports safely.');
