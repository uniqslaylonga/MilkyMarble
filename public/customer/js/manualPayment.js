// public/customer/js/manualPayment.js
// Manual InstaPay QR payment (replaces PayMongo).
//
//   window.openManualPayment({ order, email, amount, onClose })
//
// Flow: customer pays the shop's QR -> uploads the receipt screenshot -> the
// 13-digit reference is read off it automatically (OCR) and dropped into the
// field (still editable) -> submit. A Sales Officer then verifies it.
(function () {
  'use strict';

  var QR_SRC = '/customer/images/instapay-qr.png';
  var REF_LEN = 13;
  var MAX_DIM = 1600;           // downscale big phone screenshots before upload
  var JPEG_QUALITY = 0.85;

  var state = null;             // { order, email, amount, blob, ocrAmount, refOk, busy, onClose }
  var root = null;

  function peso(n) {
    return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function injectStyles() {
    if (document.getElementById('mmPayStyles')) return;
    var css = '' +
      '.mmpay-backdrop{position:fixed;inset:0;background:rgba(89,74,66,.55);display:none;align-items:center;justify-content:center;z-index:99990;padding:16px;}' +
      '.mmpay-backdrop.open{display:flex;}' +
      '.mmpay-card{background:#FFFDFD;border:1.5px solid #FCE1DD;border-radius:24px;max-width:440px;width:100%;max-height:92vh;overflow-y:auto;padding:26px 24px 22px;position:relative;font-family:"Urbanist",Arial,sans-serif;color:#594A42;box-shadow:0 18px 50px rgba(89,74,66,.25);}' +
      '.mmpay-x{position:absolute;top:12px;right:14px;border:none;background:none;font-size:22px;color:#7C4F38;cursor:pointer;line-height:1;}' +
      '.mmpay-title{font-family:"Fredoka",sans-serif;font-size:21px;margin:0 0 4px;}' +
      '.mmpay-sub{font-size:13px;color:#7C4F38;margin:0 0 14px;}' +
      '.mmpay-amount{background:#FFF5F4;border-radius:16px;padding:12px 14px;text-align:center;margin-bottom:12px;}' +
      '.mmpay-amount small{display:block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7C4F38;}' +
      '.mmpay-amount strong{font-family:"Fredoka",sans-serif;font-size:28px;color:#F48A8E;}' +
      '.mmpay-qr{display:block;width:210px;max-width:70%;margin:0 auto 6px;border-radius:14px;border:1.5px solid #FCE1DD;background:#fff;}' +
      '.mmpay-save{display:block;text-align:center;font-size:12px;font-weight:700;color:#F48A8E;text-decoration:none;margin-bottom:14px;}' +
      '.mmpay-step{font-size:12px;font-weight:800;color:#7C4F38;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.04em;}' +
      '.mmpay-drop{display:flex;align-items:center;justify-content:center;gap:8px;border:2px dashed #F8C8CA;border-radius:16px;padding:14px;cursor:pointer;font-weight:700;font-size:14px;color:#F48A8E;background:#FFFAF9;text-align:center;}' +
      '.mmpay-drop:hover{background:#FFF5F4;}' +
      '.mmpay-preview{display:none;max-height:150px;max-width:100%;margin:10px auto 0;border-radius:12px;border:1.5px solid #FCE1DD;}' +
      '.mmpay-read{display:none;font-size:12.5px;font-weight:700;color:#7C4F38;margin-top:8px;}' +
      '.mmpay-label{display:block;font-size:13px;font-weight:800;margin:14px 0 6px;}' +
      '.mmpay-input{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #FCE1DD;border-radius:12px;font-size:17px;font-weight:700;letter-spacing:.08em;font-family:"Urbanist",monospace;color:#594A42;background:#fff;}' +
      '.mmpay-input:focus{outline:none;border-color:#F48A8E;}' +
      '.mmpay-input.bad{border-color:#E85D5D;}' +
      '.mmpay-input.good{border-color:#4CAF50;}' +
      '.mmpay-hint{font-size:12px;margin-top:5px;min-height:16px;font-weight:600;color:#7C4F38;}' +
      '.mmpay-hint.err{color:#d32f2f;}.mmpay-hint.ok{color:#2e7d32;}.mmpay-hint.warn{color:#b26a00;}' +
      '.mmpay-submit{width:100%;margin-top:16px;padding:13px;border:none;border-radius:99px;background:#F48A8E;color:#fff;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit;}' +
      '.mmpay-submit:disabled{background:#F3D3D4;cursor:not-allowed;}' +
      '.mmpay-note{font-size:11.5px;color:#7C4F38;text-align:center;margin-top:10px;}';
    var tag = document.createElement('style');
    tag.id = 'mmPayStyles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function build() {
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.className = 'mmpay-backdrop';
    root.innerHTML = '' +
      '<div class="mmpay-card" role="dialog" aria-modal="true" aria-labelledby="mmPayTitle">' +
        '<button type="button" class="mmpay-x" id="mmPayClose" aria-label="Close">&times;</button>' +
        '<h2 class="mmpay-title" id="mmPayTitle">Pay with InstaPay</h2>' +
        '<p class="mmpay-sub">Order <strong id="mmPayOrderNo"></strong></p>' +
        '<div class="mmpay-amount"><small>Amount to pay</small><strong id="mmPayAmount"></strong></div>' +
        '<div class="mmpay-step">1. Scan &amp; pay the exact amount</div>' +
        '<img class="mmpay-qr" src="' + QR_SRC + '" alt="Milky Marble InstaPay QR code">' +
        '<a class="mmpay-save" href="' + QR_SRC + '" download="milky-marble-instapay-qr.png"><i class="fa-solid fa-download"></i> Save QR (to scan from your gallery)</a>' +
        '<div class="mmpay-step">2. Upload your receipt</div>' +
        '<label class="mmpay-drop" for="mmPayFile"><i class="fa-solid fa-image"></i><span id="mmPayDropText">Choose receipt screenshot</span></label>' +
        '<input type="file" id="mmPayFile" accept="image/jpeg,image/png,image/webp" hidden>' +
        '<img class="mmpay-preview" id="mmPayPreview" alt="Receipt preview">' +
        '<div class="mmpay-read" id="mmPayRead"><i class="fa-solid fa-spinner fa-spin"></i> Reading reference number…</div>' +
        '<label class="mmpay-label" for="mmPayRef">13-digit reference number</label>' +
        '<input type="text" id="mmPayRef" class="mmpay-input" inputmode="numeric" autocomplete="off" maxlength="' + REF_LEN + '" placeholder="0000000000000">' +
        '<div class="mmpay-hint" id="mmPayHint"></div>' +
        '<button type="button" class="mmpay-submit" id="mmPaySubmit" disabled>Submit Payment</button>' +
        '<p class="mmpay-note">A Sales Officer will verify your payment before your order is prepared.</p>' +
      '</div>';
    document.body.appendChild(root);

    root.addEventListener('click', function (e) { if (e.target === root) requestClose(); });
    root.querySelector('#mmPayClose').addEventListener('click', requestClose);
    root.querySelector('#mmPayFile').addEventListener('change', onFileChosen);
    root.querySelector('#mmPayRef').addEventListener('input', onRefInput);
    root.querySelector('#mmPaySubmit').addEventListener('click', submit);
  }

  function $(id) { return root.querySelector('#' + id); }

  function setHint(text, kind) {
    var el = $('mmPayHint');
    el.textContent = text || '';
    el.className = 'mmpay-hint' + (kind ? ' ' + kind : '');
  }

  function refreshSubmit() {
    var ok = state && !state.busy && state.blob && state.refOk;
    $('mmPaySubmit').disabled = !ok;
  }

  // ---- image handling ----------------------------------------------------

  // Phone screenshots are often several MB; shrink so uploads stay fast and
  // under the server's 4 MB cap.
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('Could not process that image.'));
        }, 'image/jpeg', JPEG_QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as an image.')); };
      img.src = url;
    });
  }

  async function onFileChosen(e) {
    var file = e.target.files && e.target.files[0];
    if (!file || !state) return;

    state.blob = null;
    state.ocrAmount = null;
    refreshSubmit();

    var blob;
    try {
      blob = await compressImage(file);
    } catch (err) {
      setHint(err.message, 'err');
      return;
    }
    state.blob = blob;

    var preview = $('mmPayPreview');
    preview.src = URL.createObjectURL(blob);
    preview.style.display = 'block';
    $('mmPayDropText').textContent = 'Change screenshot';

    // Auto-read the reference number.
    var reading = $('mmPayRead');
    reading.style.display = 'block';
    setHint('');
    try {
      var fd = new FormData();
      fd.append('proof', blob, 'receipt.jpg');
      var res = await fetch('/api/payments/ocr', { method: 'POST', credentials: 'include', body: fd });
      var data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Could not read the receipt.');

      if (data.reference) {
        $('mmPayRef').value = data.reference;
        state.ocrAmount = data.amount;
        await onRefInput();
        if (!$('mmPayHint').classList.contains('err')) {
          setHint('Reference number read from your receipt — please double-check it.', 'ok');
        }
      } else {
        setHint(data.message || 'We couldn’t read the reference number. Please type it in.', 'warn');
        $('mmPayRef').focus();
      }
      checkAmountMismatch();
    } catch (err) {
      setHint(err.message || 'We couldn’t read the reference number. Please type it in.', 'warn');
    } finally {
      reading.style.display = 'none';
      refreshSubmit();
    }
  }

  function checkAmountMismatch() {
    if (!state || state.ocrAmount == null) return;
    if (Math.abs(Number(state.ocrAmount) - Number(state.amount)) > 0.009) {
      var prev = $('mmPayHint').textContent;
      setHint((prev ? prev + ' ' : '') + 'Heads up: the receipt shows ' + peso(state.ocrAmount) + ' but your total is ' + peso(state.amount) + '.', 'warn');
    }
  }

  // ---- reference field ---------------------------------------------------

  var refTimer = null;
  function onRefInput() {
    var input = $('mmPayRef');
    var digits = input.value.replace(/\D/g, '').slice(0, REF_LEN);
    if (input.value !== digits) input.value = digits;
    input.classList.remove('bad', 'good');
    state.refOk = false;
    refreshSubmit();

    if (digits.length === 0) { setHint(''); return Promise.resolve(); }
    if (digits.length < REF_LEN) {
      setHint(digits.length + '/' + REF_LEN + ' digits', '');
      return Promise.resolve();
    }

    // Exactly 13 digits: ask the server whether another order already used it.
    clearTimeout(refTimer);
    setHint('Checking…', '');
    var mine = digits;
    return new Promise(function (resolve) {
      refTimer = setTimeout(async function () {
        try {
          var res = await fetch('/api/payments/reference-available?reference=' + encodeURIComponent(mine) +
            '&order_id=' + encodeURIComponent(state.order.id), { credentials: 'include' });
          var data = await res.json();
          if (input.value !== mine) return resolve(); // user kept typing
          if (data.available) {
            input.classList.add('good');
            state.refOk = true;
            setHint('Reference number looks good.', 'ok');
          } else {
            input.classList.add('bad');
            setHint('This reference number has already been used on another order.', 'err');
          }
        } catch (e) {
          // Can't pre-check; the server still enforces uniqueness on submit.
          state.refOk = true;
          setHint('', '');
        }
        refreshSubmit();
        resolve();
      }, 250);
    });
  }

  // ---- submit / close ----------------------------------------------------

  async function submit() {
    if (!state || state.busy) return;
    state.busy = true;
    var btn = $('mmPaySubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      var fd = new FormData();
      fd.append('order_id', state.order.id);
      fd.append('reference', $('mmPayRef').value);
      if (state.ocrAmount != null) fd.append('amount', state.ocrAmount);
      if (state.email) fd.append('email', state.email);
      fd.append('proof', state.blob, 'receipt.jpg');

      var res = await fetch('/api/payments/submit', { method: 'POST', credentials: 'include', body: fd });
      var data = await res.json();

      if (!res.ok || data.status !== 'success') {
        if (data.code === 'REFERENCE_IN_USE') {
          $('mmPayRef').classList.add('bad');
          state.refOk = false;
        }
        throw new Error(data.message || 'Could not submit your payment.');
      }

      var done = state.onClose;
      var orderNo = state.order.order_number;
      hide();
      state = null;
      await notify({
        icon: 'success',
        title: 'Payment Submitted!',
        text: 'We received your receipt for ' + orderNo + '. A Sales Officer will verify it shortly — you’ll get an email once it’s confirmed.'
      });
      if (typeof done === 'function') done(true);
      else window.location.href = '/customer/orders.html';
    } catch (err) {
      setHint(err.message, 'err');
    } finally {
      if (state) {
        state.busy = false;
        btn.textContent = 'Submit Payment';
        refreshSubmit();
      }
    }
  }

  function notify(opts) {
    if (typeof Swal !== 'undefined') {
      return Swal.fire({ icon: opts.icon, title: opts.title, text: opts.text, confirmButtonText: 'OK', confirmButtonColor: '#F48A8E' });
    }
    alert(opts.title + '\n' + opts.text);
    return Promise.resolve();
  }

  async function requestClose() {
    if (!state || state.busy) return;
    var leave = true;
    if (typeof Swal !== 'undefined') {
      var r = await Swal.fire({
        icon: 'question',
        title: 'Pay later?',
        text: 'Your order is saved but won’t be prepared until payment is submitted. You can finish from the Orders page.',
        showCancelButton: true,
        confirmButtonText: 'Close',
        cancelButtonText: 'Keep paying',
        confirmButtonColor: '#F48A8E'
      });
      leave = r.isConfirmed;
    }
    if (!leave) return;
    var done = state.onClose;
    hide();
    state = null;
    if (typeof done === 'function') done(false);
  }

  function hide() {
    if (root) root.classList.remove('open');
    document.body.style.overflow = '';
  }

  window.openManualPayment = function (opts) {
    opts = opts || {};
    var order = opts.order || {};
    if (!order.id) { console.error('openManualPayment: order.id is required'); return; }

    build();
    state = {
      order: order,
      email: opts.email || order.guest_email || order.recipient_email || '',
      amount: Number(opts.amount != null ? opts.amount : order.total_amount) || 0,
      blob: null, ocrAmount: null, refOk: false, busy: false,
      onClose: opts.onClose
    };

    $('mmPayOrderNo').textContent = order.order_number || ('#' + order.id);
    $('mmPayAmount').textContent = peso(state.amount);
    $('mmPayFile').value = '';
    $('mmPayRef').value = '';
    $('mmPayRef').classList.remove('bad', 'good');
    $('mmPayPreview').style.display = 'none';
    $('mmPayRead').style.display = 'none';
    $('mmPayDropText').textContent = 'Choose receipt screenshot';
    $('mmPaySubmit').textContent = 'Submit Payment';
    setHint('');
    refreshSubmit();

    root.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

})();
