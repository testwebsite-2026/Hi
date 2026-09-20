/* Certificate renderer + tiny PDF writer.
   Everything happens in the browser: nothing about the certificate is sent to a server. */
(function (root) {
  'use strict';

  var FONT = '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif';
  var W = 1754;   // A4 landscape @ 150 dpi
  var H = 1240;

  var C = {
    moss: '#5d7d19',
    mossDeep: '#3b5a12',
    mossLight: '#a3c132',
    forest: '#23371b',
    teal: '#17a398',
    tealDeep: '#0e6f68',
    blush: '#e98aa3',
    gold: '#c6a24a',
    paper: 'rgba(252, 249, 236, 0.88)'
  };

  // Used only if the page did not supply event details (the server normally does).
  var DEFAULT_EVENT = {
    projectName: 'Project 77',
    title: 'Let Go, Let God',
    dateLong: 'Monday, September 28, 2026',
    timeRange: '1:00 PM to 5:00 PM',
    venue: 'Multipurpose Hall',
    verse: 'I do not say to you seven times, but seventy-seven times.',
    verseRef: 'Matthew 18:22',
    tagline: 'Guided by Grace, Driven by Faith'
  };

  /* ------------------------------------------------------------ helpers */

  var bgPromise = null;
  function loadBackground() {
    if (!bgPromise) {
      bgPromise = new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { resolve(null); };
        img.src = '/assets/cert-bg.jpg';
      });
    }
    return bgPromise;
  }

  function displayName(name) {
    var n = String(name || '').replace(/\s+/g, ' ').trim();
    if (n && (n === n.toLowerCase() || n === n.toUpperCase())) {
      n = n.toLowerCase().replace(/(^|[\s\-'’.])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); });
    }
    return n;
  }

  function formatDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function spaced(ctx, text, cx, y, spacing) {
    var chars = Array.from(text);
    var widths = chars.map(function (ch) { return ctx.measureText(ch).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (chars.length - 1);
    var x = cx - total / 2;
    ctx.save();
    ctx.textAlign = 'left';
    chars.forEach(function (ch, i) {
      ctx.fillText(ch, x, y);
      x += widths[i] + spacing;
    });
    ctx.restore();
  }

  function fit(ctx, text, weightStyle, maxWidth, start, min) {
    var size = start;
    ctx.font = weightStyle + ' ' + size + 'px ' + FONT;
    while (ctx.measureText(text).width > maxWidth && size > min) {
      size -= 2;
      ctx.font = weightStyle + ' ' + size + 'px ' + FONT;
    }
    return size;
  }

  function leaf(ctx, len, angle, fill) {
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.25, -len * 0.36, len * 0.75, -len * 0.36, len, 0);
    ctx.bezierCurveTo(len * 0.75, len * 0.36, len * 0.25, len * 0.36, 0, 0);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(len * 0.06, 0);
    ctx.lineTo(len * 0.9, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function blossom(ctx, r) {
    ctx.save();
    for (var i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.arc(0, -r * 0.95, r * 0.72, 0, Math.PI * 2);
      ctx.fillStyle = C.blush;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = C.gold;
    ctx.fill();
    ctx.restore();
  }

  function sprig(ctx, x, y, sx, sy) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    var g = ctx.createLinearGradient(0, 0, 130, 130);
    g.addColorStop(0, C.mossLight);
    g.addColorStop(1, C.mossDeep);
    leaf(ctx, 150, 0.08, g);
    leaf(ctx, 128, 0.78, g);
    leaf(ctx, 150, Math.PI / 2 - 0.08, g);
    ctx.translate(22, 22);
    blossom(ctx, 15);
    ctx.restore();
  }

  function flourish(ctx, cx, y) {
    var g = ctx.createLinearGradient(cx - 320, 0, cx + 320, 0);
    g.addColorStop(0, 'rgba(198,162,74,0)');
    g.addColorStop(0.5, C.gold);
    g.addColorStop(1, 'rgba(198,162,74,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 320, y - 1.5, 640, 3);
    ctx.save();
    ctx.translate(cx, y);
    var lg = ctx.createLinearGradient(-40, 0, 40, 0);
    lg.addColorStop(0, C.mossLight);
    lg.addColorStop(1, C.mossDeep);
    leaf(ctx, 58, Math.PI + 0.35, lg);
    leaf(ctx, 58, -0.35, lg);
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = C.gold;
    ctx.fill();
    ctx.restore();
  }

  function gradientText(ctx, text, x, y, size, c0, c1, shadow) {
    var g = ctx.createLinearGradient(0, y - size * 0.85, 0, y + size * 0.1);
    g.addColorStop(0, c0);
    g.addColorStop(0.5, '#7a9a1c');
    g.addColorStop(1, c1);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(3, size * 0.05);
    ctx.strokeText(text, x, y);
    if (shadow) {
      ctx.shadowColor = 'rgba(59,90,18,0.35)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 5;
    }
    ctx.fillStyle = g;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* -------------------------------------------------------------- draw */

  function draw(canvas, opts) {
    opts = opts || {};
    var name = displayName(opts.name) || 'Participant';
    var ref = opts.ref || '';
    var dateText = formatDate(opts.createdAt);
    var ev = Object.assign({}, DEFAULT_EVENT, opts.event || {});
    var fullTitle = ev.projectName ? ev.projectName + ': ' + ev.title : ev.title;

    return loadBackground().then(function (bg) {
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext('2d');
      var cx = W / 2;

      // background: the poster, softened
      if (bg) {
        ctx.drawImage(bg, 0, 0, W, H);
      } else {
        var fg = ctx.createLinearGradient(0, 0, W, H);
        fg.addColorStop(0, '#2aa89b');
        fg.addColorStop(1, '#5d7d19');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, W, H);
      }

      // paper panel
      var px = 100, py = 90, pw = W - 200, ph = H - 180;
      ctx.save();
      ctx.shadowColor = 'rgba(9,45,36,0.45)';
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 16;
      roundRect(ctx, px, py, pw, ph, 44);
      ctx.fillStyle = C.paper;
      ctx.fill();
      ctx.restore();

      roundRect(ctx, px, py, pw, ph, 44);
      ctx.lineWidth = 8;
      ctx.strokeStyle = C.moss;
      ctx.stroke();
      roundRect(ctx, px + 22, py + 22, pw - 44, ph - 44, 28);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = C.gold;
      ctx.stroke();

      // corner sprigs
      var inset = 44;
      sprig(ctx, px + inset, py + inset, 1, 1);
      sprig(ctx, px + pw - inset, py + inset, -1, 1);
      sprig(ctx, px + inset, py + ph - inset, 1, -1);
      sprig(ctx, px + pw - inset, py + ph - inset, -1, -1);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // header
      ctx.fillStyle = C.mossDeep;
      ctx.font = 'bold 30px ' + FONT;
      spaced(ctx, 'BATANGAS STATE UNIVERSITY', cx, 165, 6);
      ctx.fillStyle = '#4d5f3a';
      ctx.font = 'italic 30px ' + FONT;
      ctx.fillText('Christian Campus Ministry', cx, 205);

      if (ev.projectName) {
        ctx.fillStyle = C.tealDeep;
        ctx.font = 'bold 26px ' + FONT;
        spaced(ctx, ev.projectName.toUpperCase(), cx, 270, 14);
      }

      // title
      var tSize = fit(ctx, 'Certificate of Registration', 'italic bold', 1250, 104, 60);
      gradientText(ctx, 'Certificate of Registration', cx, 372, tSize, '#b5cc3c', C.mossDeep, true);
      flourish(ctx, cx, 431);

      // body
      ctx.fillStyle = C.forest;
      ctx.font = 'italic 36px ' + FONT;
      ctx.fillText('This certificate is proudly presented to', cx, 490);

      var nSize = fit(ctx, name, 'italic bold', 1240, 112, 28);
      ctx.fillStyle = C.forest;
      ctx.fillText(name, cx, 635);
      var lg = ctx.createLinearGradient(cx - 520, 0, cx + 520, 0);
      lg.addColorStop(0, 'rgba(198,162,74,0)');
      lg.addColorStop(0.5, C.gold);
      lg.addColorStop(1, 'rgba(198,162,74,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(cx - 520, 683, 1040, 3);

      ctx.fillStyle = C.forest;
      ctx.font = 'italic 34px ' + FONT;
      ctx.fillText('in appreciation for completing the registration form for', cx, 752);

      var eSize = fit(ctx, fullTitle, 'italic bold', 1200, 70, 34);
      gradientText(ctx, fullTitle, cx, 828, eSize, '#b5cc3c', C.mossDeep, false);

      ctx.fillStyle = C.forest;
      var when = [ev.dateLong, ev.timeRange, ev.venue].filter(Boolean).join('  |  ');
      fit(ctx, when, 'bold', 1300, 30, 18);
      ctx.fillText(when, cx, 890);

      if (ev.verse) {
        ctx.fillStyle = C.tealDeep;
        fit(ctx, '\u201C' + ev.verse + '\u201D', 'italic', 1250, 32, 20);
        ctx.fillText('\u201C' + ev.verse + '\u201D', cx, 944);
      }
      if (ev.verseRef) {
        ctx.fillStyle = C.tealDeep;
        ctx.font = 'bold 24px ' + FONT;
        spaced(ctx, ev.verseRef.toUpperCase(), cx, 982, 6);
      }

      ctx.fillStyle = C.mossDeep;
      ctx.font = 'italic bold 42px ' + FONT;
      ctx.fillText('Thank you and God bless!', cx, 1036);

      if (ev.tagline) {
        fit(ctx, ev.tagline, 'italic', 1200, 27, 18);
        ctx.fillText(ev.tagline, cx, 1075);
      }

      // reference line
      ctx.font = 'italic 23px ' + FONT;
      ctx.fillStyle = '#4d5f3a';
      ctx.fillText((ref ? 'Ref. ' + ref + '   |   ' : '') + 'Registered on ' + dateText, cx, 1108);

      return canvas;
    });
  }

  /* --------------------------------------------------------------- PDF */

  // Wraps one JPEG in a single-page A4-landscape PDF (no libraries needed).
  function buildPdf(jpeg, imgW, imgH) {
    var PW = 842, PH = 595;
    var enc = new TextEncoder();
    var chunks = [];
    var offset = 0;
    var offsets = {};

    function push(x) {
      var b = typeof x === 'string' ? enc.encode(x) : x;
      chunks.push(b);
      offset += b.length;
    }
    function obj(n, body) {
      offsets[n] = offset;
      push(n + ' 0 obj\n' + body + '\nendobj\n');
    }

    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');

    offsets[4] = offset;
    push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + imgW + ' /Height ' + imgH +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
    push(jpeg);
    push('\nendstream\nendobj\n');

    var content = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q';
    obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');

    var xrefPos = offset;
    var xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i <= 5; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  var api = { draw: draw, buildPdf: buildPdf, displayName: displayName, formatDate: formatDate };
  root.Cert = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
