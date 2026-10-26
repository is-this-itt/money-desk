// Checks that keep serve.ps1 in step with the files and page it relies on.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ps = fs.readFileSync(path.join(root, 'serve.ps1'), 'utf8');

test('the taskbar badge points at files that exist and finds the window by the page title', () => {
  for (const f of ['Money Desk.vbs', 'money-desk.ico']) {
    assert.ok(ps.includes(`'${f}'`), f);
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
  const title = /<title>([^<]*)<\/title>/.exec(fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8'))[1];
  assert.ok(ps.includes(`title.ToString() != "${title}"`));
  const setup = fs.readFileSync(path.join(root, 'Add to Desktop and Start menu.vbs'), 'utf8');
  assert.ok(setup.includes('\\Money Desk.vbs') && setup.includes('\\money-desk.ico'));
});
