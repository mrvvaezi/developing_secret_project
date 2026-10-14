const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../frontend/uploads.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
assert(/<input[^>]*id="file"[^>]*\bmultiple\b/.test(html));
assert(/src="\/static\/uploads\.js(?:\?[^\"]*)?"/.test(html));

function setup(files, responses) {
  function element() {
    return {disabled: false, value: '', textContent: '', children: [],
      focus() {}, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }};
  }
  const elements = {}, calls = [];
  const get = id => elements[id] || (elements[id] = element());
  get('file').files = files;
  class FormData {
    append(key, value) { this[key] = value; }
  }
  vm.runInNewContext(source, {$: get, document: {createElement: element}, FormData,
    fetch: async (url, options) => {
      assert(get('upload').disabled && get('file').disabled);
      calls.push({url, file: options.body.file});
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }});
  return {get, calls};
}

async function run() {
  const files = ['first.mp3', 'duplicate.mp3', 'invalid.mp3', 'offline.mp3', '<last>.mp3'].map(name => ({name}));
  const mixed = setup(files, [
    {ok: true, status: 200}, {ok: false, status: 409},
    {ok: false, status: 400, json: async () => ({detail: 'Invalid MP3'})},
    new Error('Network failure'), {ok: true, status: 200}
  ]);
  mixed.get('file').onchange();
  assert(mixed.get('upload-status').textContent.includes('۵'));
  const task = mixed.get('upload').onclick();
  await mixed.get('upload').onclick(); // A repeated click must not start another batch.
  await task;
  assert.deepStrictEqual(mixed.calls.map(call => call.file.name), files.map(file => file.name));
  assert(mixed.calls.every(call => call.url === '/api/upload'));
  assert.deepStrictEqual(mixed.get('upload-results').children.map(row => row.className),
    ['success', 'skipped', 'error', 'error', 'success']);
  assert(mixed.get('upload-results').children[2].textContent.includes('معتبر نیست'));
  assert(mixed.get('upload-results').children[4].textContent.startsWith('<last>.mp3'));
  assert(mixed.get('upload-status').textContent.includes('۲ اضافه شد، ۱ تکراری بود، ۲ ناموفق بود'));
  assert(!mixed.get('upload').disabled && !mixed.get('file').disabled);

  const empty = setup([], []);
  await empty.get('upload').onclick();
  assert.strictEqual(empty.calls.length, 0);
  assert(empty.get('upload-status').textContent.includes('انتخاب کنید'));

  const single = setup([{name: 'single.mp3'}], [{ok: true, status: 200}]);
  await single.get('upload').onclick();
  assert.strictEqual(single.calls.length, 1);
  assert(single.get('upload-status').textContent.includes('۱ اضافه شد'));

  const serverError = setup([{name: 'bad.mp3'}, {name: 'good.mp3'}], [
    {ok: false, status: 502, json: async () => { throw Error('Not JSON'); }},
    {ok: true, status: 200}
  ]);
  await serverError.get('upload').onclick();
  assert.strictEqual(serverError.calls.length, 2);
  assert(serverError.get('upload-results').children[0].textContent.includes('502'));
  assert.strictEqual(serverError.get('upload-results').children[1].className, 'success');
  console.log('PASS: batch order, duplicate/error isolation, progress, double-click guard, empty/single selection and non-JSON errors');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
