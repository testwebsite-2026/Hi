(function () {
  'use strict';

  var STORE_KEY = 'p77-registration';

  var $ = function (id) { return document.getElementById(id); };
  var views = { start: $('view-start'), form: $('view-form'), done: $('view-done') };
  var form = $('form');
  var alertBox = $('form-alert');
  var submitBtn = $('btn-submit');
  var canvas = $('cert');
  var current = null; // the registration shown on the certificate

  // Event details (date, venue, verse...) come from the server, set by the admin.
  var EVENT = {};
  try { EVENT = JSON.parse($('event-data').textContent) || {}; } catch (e) { /* certificate falls back to defaults */ }

  /* ------------------------------------------------------------- views */

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    window.scrollTo(0, 0);
    var heading = views[name].querySelector('[tabindex="-1"]');
    if (heading) heading.focus({ preventScroll: true });
  }

  /* ----------------------------------------------------------- storage */

  function saveLocal(reg) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(reg)); } catch (e) { /* private mode */ }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var reg = raw ? JSON.parse(raw) : null;
      return reg && reg.fullName && reg.ref ? reg : null;
    } catch (e) { return null; }
  }
  function clearLocal() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  /* -------------------------------------------------------- validation */

  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.,'’\-]*$/u;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function collect() {
    var fd = new FormData(form);
    var get = function (k) { return String(fd.get(k) || '').replace(/\s+/g, ' ').trim(); };
    return {
      fullName: get('fullName'),
      course: get('course'),
      yearLevel: get('yearLevel'),
      section: get('section'),
      contact: get('contact'),
      email: get('email'),
      attendance: get('attendance'),
      website: get('website')
    };
  }

  function check(d) {
    var e = {};
    if (d.fullName.length < 2 || !NAME_RE.test(d.fullName)) e.fullName = 'Enter your full name (letters only).';
    if (d.course.length < 2) e.course = 'Enter your course or program.';
    if (!d.yearLevel) e.yearLevel = 'Choose your year level.';
    if (!d.section) e.section = 'Enter your section.';
    if (!/^(?:\+?63|0)9\d{9}$/.test(d.contact.replace(/[\s\-()]/g, ''))) e.contact = 'Enter a valid mobile number, e.g. 09123456789.';
    if (!EMAIL_RE.test(d.email)) e.email = 'Enter a valid email address.';
    if (d.attendance !== 'yes' && d.attendance !== 'no') e.attendance = 'Please confirm whether you will attend.';
    return e;
  }

  var ORDER = ['fullName', 'course', 'yearLevel', 'section', 'contact', 'email', 'attendance'];

  function showErrors(errors) {
    var first = null;
    ORDER.forEach(function (k) {
      var wrap = form.querySelector('[data-field="' + k + '"]');
      var out = $('err-' + k);
      var msg = errors[k] || '';
      out.textContent = msg;
      wrap.classList.toggle('invalid', !!msg);
      var input = wrap.querySelector('input, select');
      if (input) {
        if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      }
      if (msg && !first) first = wrap.querySelector('input, select');
    });
    if (first) first.focus();
  }

  function clearError(key) {
    var wrap = form.querySelector('[data-field="' + key + '"]');
    if (!wrap) return;
    wrap.classList.remove('invalid');
    $('err-' + key).textContent = '';
  }

  form.addEventListener('input', function (ev) {
    var wrap = ev.target.closest && ev.target.closest('[data-field]');
    if (wrap) clearError(wrap.getAttribute('data-field'));
    alertBox.hidden = true;
  });

  /* ------------------------------------------------------------ submit */

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    alertBox.hidden = true;

    var data = collect();
    var errors = check(data);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    showErrors({});

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting\u2026';

    fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (r) {
        if (r.body && r.body.ok && r.body.registration) {
          var reg = r.body.registration;
          saveLocal(reg);
          form.reset();
          showDone(reg);
          return;
        }
        if (r.body && r.body.errors) showErrors(r.body.errors);
        alertBox.textContent = (r.body && r.body.message) || 'Something went wrong. Please try again.';
        alertBox.hidden = false;
      })
      .catch(function () {
        alertBox.textContent = 'Cannot reach the server. Check your connection and try again.';
        alertBox.hidden = false;
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit registration';
      });
  });

  /* -------------------------------------------------------------- done */

  function showDone(reg) {
    current = reg;
    var pretty = Cert.displayName(reg.fullName);
    var first = pretty.split(' ')[0] || pretty;

    $('done-message').textContent = reg.attendance === 'no'
      ? 'Thank you, ' + first + '. We received your response and noted that you cannot attend. Your certificate is below.'
      : 'Thank you, ' + first + '! Your registration is confirmed.' +
        (EVENT.venue && EVENT.dateShort ? ' See you at ' + EVENT.venue + ' on ' + EVENT.dateShort + '.' : '');
    $('done-ref').textContent = 'Reference no. ' + reg.ref;
    canvas.setAttribute('aria-label', 'Certificate of registration for ' + pretty);

    show('done');
    Cert.draw(canvas, { name: reg.fullName, ref: reg.ref, createdAt: reg.createdAt, event: EVENT });
  }

  function slug(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Participant';
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function baseName() {
    return 'Project77-Certificate-' + slug(Cert.displayName(current ? current.fullName : ''));
  }

  $('btn-png').addEventListener('click', function () {
    if (!current) return;
    canvas.toBlob(function (blob) {
      if (blob) saveBlob(blob, baseName() + '.png');
    }, 'image/png');
  });

  $('btn-pdf').addEventListener('click', function () {
    if (!current) return;
    canvas.toBlob(function (blob) {
      if (!blob) return;
      blob.arrayBuffer().then(function (buf) {
        saveBlob(Cert.buildPdf(new Uint8Array(buf), canvas.width, canvas.height), baseName() + '.pdf');
      });
    }, 'image/jpeg', 0.93);
  });

  /* -------------------------------------------------------------- nav */

  // The banner and the start button are optional (the admin can hide the banner or close registration).
  var dlg = $('dlg-inspo');
  if (dlg && $('btn-inspo')) {
    $('btn-inspo').addEventListener('click', function () {
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    });
    $('lb-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) dlg.close(); });
  }

  if ($('btn-start')) $('btn-start').addEventListener('click', function () { show('form'); });
  $('btn-back').addEventListener('click', function () { show('start'); });
  $('btn-again').addEventListener('click', function () {
    clearLocal();
    current = null;
    form.reset();
    showErrors({});
    show('form');
  });

  if (EVENT.registrationOpen === false) $('btn-again').hidden = true;

  var saved = loadLocal();
  if (saved) showDone(saved);
})();
