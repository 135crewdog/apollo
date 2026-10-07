/* The setup guide. Loads the two script files live from the repository's main branch
 * so the copy a new user pastes is always the current one. No dependencies. */
'use strict';

var TEMPLATE_COPY_URL = 'https://docs.google.com/spreadsheets/d/1ucCJ4fbnNOwo-326-TFRMtDzrQlxeDYF2IdJGExgevg/copy';
var RAW_BASE = 'https://raw.githubusercontent.com/135crewdog/apollo/main/apps-script/';
var FILES = { 'code-js': 'Code.js', 'rules-js': 'rules.js' };

document.getElementById('template-link').href = TEMPLATE_COPY_URL;

Object.keys(FILES).forEach(function (id) {
  var target = document.getElementById(id);
  fetch(RAW_BASE + FILES[id], { cache: 'no-store' })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.text(); })
    .then(function (text) {
      target.textContent = text;
      target.classList.remove('loading');
    })
    .catch(function () {
      target.textContent = 'Could not load ' + FILES[id] + ' from GitHub. Use the link below the code blocks.';
    });
});

document.querySelectorAll('button[data-copy]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var target = document.getElementById(btn.dataset.copy);
    if (target.classList.contains('loading')) return;
    var text = target.textContent;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  });
});

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (err) { /* nothing more to try */ }
  document.body.removeChild(ta);
}
