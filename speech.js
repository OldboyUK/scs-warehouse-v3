(function () {
  if (window.__scsSpeech) return;
  window.__scsSpeech = true;

  var KEY = 'scs-speech';
  var MAX = 400;
  var HOVER_MS = 2000;
  var HOLD_MS = 700;
  var HOLD_SLOP = 12;
  var token = 0;
  var enabled = false;
  var activeEl = null;
  var hoverTimer = null;
  var hoverEl = null;
  var hoverNode = null;
  var hoverSpoken = false;
  var hold = null;
  var suppressNav = false;
  var SPEAKER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  var MUTED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>';
  var PREFERRED = 'h1,h2,h3,h4,h5,h6,p,label,legend,li,td,th,button,summary,figcaption,dt,dd,caption,[role="alert"],[role="status"],.dash-card-title,.dash-card-desc,.page-title,.page-sub,.module-name,.prod-block,.sch-tab,.sch-save,.combo-option,.summary-label,.summary-value';
  var LAYOUT = 'body,main,header,nav,footer,form,section,article,ul,ol,table,thead,tbody,tfoot,tr,.container,.page-content,.home-page,.dash-grid,.dash-section,.app-header,.app-header-inner,.page-heading,.header-actions,.actions,.field,.module-grid,.menu-page,.auth-page,.auth-card,.sch-page,.sch-heading,.sch-nav,.sch-workspace,.sch-scroll,.sch-year,.sch-grid,.sch-board,.home-welcome,.menu-header';

  function userEvent(event) {
    return !!(event && event.isTrusted);
  }

  function supported() {
    return typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function';
  }

  function read() {
    try {
      return localStorage.getItem(KEY) === 'on';
    } catch (err) {
      return false;
    }
  }

  function save(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (err) { /* keep the current view */ }
  }

  function clearHighlight() {
    if (activeEl && activeEl.classList) activeEl.classList.remove('speech-reading');
    var stuck = document.querySelectorAll('.speech-reading');
    for (var i = 0; i < stuck.length; i++) stuck[i].classList.remove('speech-reading');
    activeEl = null;
  }

  function clearGesture() {
    if (hoverTimer) window.clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverEl = null;
    hoverNode = null;
    hoverSpoken = false;
    if (hold && hold.timer) window.clearTimeout(hold.timer);
    hold = null;
  }

  function stop() {
    token += 1;
    clearGesture();
    suppressNav = false;
    clearHighlight();
    if (supported()) {
      try { window.speechSynthesis.cancel(); } catch (err) { /* already stopped */ }
    }
  }

  function notify(message) {
    var el = document.getElementById('speechNotice');
    if (!el) {
      el = document.createElement('p');
      el.id = 'speechNotice';
      el.className = 'speech-notice';
      el.setAttribute('role', 'status');
      el.setAttribute('data-speech', 'off');
      document.body.appendChild(el);
    }
    el.hidden = false;
    el.textContent = message;
    window.clearTimeout(el._timer);
    el._timer = window.setTimeout(function () { el.hidden = true; }, 4000);
  }

  function paint(button) {
    if (!button) return;
    var on = enabled;
    button.classList.toggle('is-on', on);
    button.innerHTML = on ? SPEAKER : MUTED;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = on ? 'Turn off text to speech' : 'Turn on text to speech';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function scoreVoice(voice) {
    var score = 0;
    var lang = (voice.lang || '').toLowerCase();
    var name = (voice.name || '').toLowerCase();
    if (lang.indexOf('en') === 0) score += 4;
    if (lang === 'en-gb') score += 2;
    if (voice.localService) score += 1;
    if (voice.default) score += 1;
    if (/natural|neural|premium|enhanced/.test(name)) score += 3;
    return score;
  }

  function pickVoice() {
    var voices = [];
    try { voices = window.speechSynthesis.getVoices() || []; } catch (err) { return null; }
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < voices.length; i++) {
      var value = scoreVoice(voices[i]);
      if (value > bestScore) {
        best = voices[i];
        bestScore = value;
      }
    }
    return best;
  }

  function extractText(el) {
    var chunks = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        chunks.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (node !== el && (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('data-speech') === 'off')) return;
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
    walk(el);
    var text = chunks.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) text = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (text.length > MAX) text = text.slice(0, MAX).replace(/\s+\S*$/, '').trim();
    return text;
  }

  function isVisible(el) {
    if (!el || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function chooseElement(target) {
    if (!target || !target.closest || target.closest('[data-speech="off"]')) return null;
    var preferred = target.closest(PREFERRED);
    if (preferred && isVisible(preferred) && !preferred.closest('[data-speech="off"]')) return preferred;
    var el = target;
    while (el && el !== document.body) {
      if (el.matches && el.matches('[data-speech="off"]')) return null;
      if (el.matches && el.matches(LAYOUT)) break;
      var parent = el.parentElement;
      if (parent && (parent === document.body || (parent.matches && parent.matches(LAYOUT))) && isVisible(el)) return el;
      el = parent;
    }
    return null;
  }

  function isPageLink(link) {
    var href = link.getAttribute('href') || '';
    if (!href || href === '#' || href.charAt(0) === '#') return false;
    if (/^(javascript:|mailto:|tel:)/i.test(href)) return false;
    if (link.hasAttribute('download')) return false;
    var target = (link.getAttribute('target') || '').toLowerCase();
    return !target || target === '_self';
  }

  function navControl(node) {
    if (!node || !node.closest) return null;
    if (node.closest('#speechToggle, #themeToggle, [data-speech="off"]')) return null;
    var link = node.closest('a[href]');
    if (link && isPageLink(link)) return link;
    var button = node.closest('button, [role="button"]');
    if (!button) return null;
    if (button.id === 'logoutBtn' || button.id === 'leaveMenuYes' || button.id === 'successOkBtn') return button;
    var code = button.getAttribute('onclick') || '';
    if (/\bgoHome\s*\(|location\s*\.\s*(href|assign|replace)/.test(code)) return button;
    return null;
  }

  function speakFrom(node, fallback) {
    var el = chooseElement(node) || fallback;
    if (!el || (el.closest && el.closest('#speechToggle'))) return false;
    var text = extractText(el);
    if (!text) return false;
    speak(text, el);
    return true;
  }

  function disarmHover() {
    var spoken = hoverSpoken;
    hoverSpoken = false;
    if (hoverTimer) window.clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverEl = null;
    hoverNode = null;
    if (spoken) stop();
  }

  function onPointerOver(event) {
    if (!enabled || !userEvent(event) || event.pointerType !== 'mouse') return;
    var nav = navControl(event.target);
    if (!nav) return;
    if (nav === hoverEl) {
      hoverNode = event.target;
      return;
    }
    disarmHover();
    hoverEl = nav;
    hoverNode = event.target;
    hoverTimer = window.setTimeout(function () {
      hoverTimer = null;
      if (!enabled || hoverEl !== nav) return;
      if (speakFrom(hoverNode || nav, nav)) hoverSpoken = true;
    }, HOVER_MS);
  }

  function onPointerOut(event) {
    if (!hoverEl || !userEvent(event) || (event.pointerType && event.pointerType !== 'mouse')) return;
    var from = navControl(event.target);
    if (from !== hoverEl) return;
    var to = event.relatedTarget && event.relatedTarget.closest ? navControl(event.relatedTarget) : null;
    if (to === hoverEl) return;
    disarmHover();
  }

  function clearHold() {
    if (hold && hold.timer) window.clearTimeout(hold.timer);
    hold = null;
  }

  function onPointerCancel(event) {
    if (!userEvent(event)) return;
    clearHold();
  }

  function onPointerDown(event) {
    if (!enabled || !userEvent(event) || event.button !== 0) return;
    if (event.pointerType === 'mouse') return;
    var nav = navControl(event.target);
    if (!nav) return;
    clearHold();
    hold = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      nav: nav,
      node: event.target,
      fired: false,
      timer: window.setTimeout(function () {
        if (!hold || hold.nav !== nav || !enabled) return;
        hold.fired = true;
        speakFrom(hold.node || nav, nav);
      }, HOLD_MS)
    };
  }

  function onPointerMove(event) {
    if (!hold || !userEvent(event) || event.pointerId !== hold.id || hold.fired) return;
    var dx = event.clientX - hold.x;
    var dy = event.clientY - hold.y;
    if ((dx * dx) + (dy * dy) > HOLD_SLOP * HOLD_SLOP) clearHold();
  }

  function onPointerUp(event) {
    if (!hold || !userEvent(event) || event.pointerId !== hold.id) return;
    var fired = hold.fired;
    clearHold();
    if (!fired) return;
    suppressNav = true;
    event.preventDefault();
    window.setTimeout(function () { suppressNav = false; }, 700);
  }

  function onContextMenu(event) {
    if (!enabled || !userEvent(event)) return;
    if (navControl(event.target)) event.preventDefault();
  }

  function speak(text, el) {
    if (!enabled || !text || !supported()) return;
    var mine = ++token;
    clearHighlight();
    try { window.speechSynthesis.cancel(); } catch (err) { /* continue with a fresh utterance */ }
    var utter;
    try {
      utter = new SpeechSynthesisUtterance(text);
    } catch (err) {
      notify('Text to speech could not start in this browser.');
      return;
    }
    utter.lang = document.documentElement.lang || 'en';
    var voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.onstart = function () {
      if (mine !== token || !el || !el.classList) return;
      clearHighlight();
      activeEl = el;
      el.classList.add('speech-reading');
    };
    utter.onend = function () {
      if (mine !== token) return;
      clearHighlight();
    };
    utter.onerror = function (event) {
      if (mine !== token) return;
      clearHighlight();
      var reason = event && event.error;
      if (reason && reason !== 'canceled' && reason !== 'interrupted') {
        notify('Text to speech could not start in this browser.');
      }
    };
    try {
      window.speechSynthesis.speak(utter);
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (err) {
      clearHighlight();
      notify('Text to speech could not start in this browser.');
    }
  }

  function onClickCapture(event) {
    if (!suppressNav) return;
    suppressNav = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function onClick(event) {
    if (!enabled || !userEvent(event) || event.button !== 0) return;
    var target = event.target;
    if (!target) return;
    if (target.nodeType !== 1) target = target.parentElement;
    if (!target || !target.closest) return;
    if (target.closest('#speechToggle, [data-speech="off"], input, textarea, select, option, [contenteditable="true"]')) return;
    if (navControl(target)) return;
    var el = chooseElement(target);
    if (!el || el.closest('#speechToggle')) return;
    var text = extractText(el);
    if (!text) return;
    speak(text, el);
  }

  function onChange(event) {
    if (!enabled || !userEvent(event)) return;
    var target = event.target;
    if (!target || target.tagName !== 'SELECT') return;
    if (target.closest('[data-speech="off"]')) return;
    var option = target.options && target.options[target.selectedIndex];
    if (!option) return;
    var text = (option.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX) text = text.slice(0, MAX);
    if (!text) return;
    speak(text, target);
  }

  function setEnabled(on) {
    enabled = !!on && supported();
    if (!enabled) stop();
    else {
      try { window.speechSynthesis.getVoices(); } catch (err) { /* voices arrive later */ }
    }
    if (document.documentElement) {
      if (enabled) document.documentElement.setAttribute('data-speech', 'on');
      else document.documentElement.removeAttribute('data-speech');
    }
    paint(document.getElementById('speechToggle'));
  }

  function mount() {
    if (document.getElementById('speechToggle')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'speechToggle';
    button.className = 'icon-btn speech-toggle';
    button.setAttribute('data-speech', 'off');
    paint(button);
    button.addEventListener('click', function () {
      if (!supported()) {
        setEnabled(false);
        notify('Text to speech is not available in this browser.');
        return;
      }
      var next = !enabled;
      save(next);
      setEnabled(next);
    });

    var theme = document.getElementById('themeToggle');
    if (theme && theme.parentNode) {
      theme.parentNode.insertBefore(button, theme);
      return;
    }

    var actions = document.querySelector('.app-header .header-actions');
    if (actions) {
      actions.insertBefore(button, actions.firstChild);
      return;
    }

    var menuBtn = document.getElementById('mainMenu');
    if (menuBtn && menuBtn.parentNode) {
      menuBtn.parentNode.insertBefore(button, menuBtn);
      return;
    }

    var corner = document.querySelector('.theme-toggle-corner');
    if (corner) {
      corner.insertBefore(button, corner.firstChild);
      return;
    }

    if (!document.body) return;
    corner = document.createElement('div');
    corner.className = 'theme-toggle-corner';
    corner.appendChild(button);
    document.body.appendChild(corner);
  }

  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('pagehide', stop);

  if (supported()) {
    try {
      window.speechSynthesis.addEventListener('voiceschanged', function () {
        try { window.speechSynthesis.getVoices(); } catch (err) { /* ignore */ }
      });
    } catch (err) { /* older browsers expose voices without the event */ }
  }

  setEnabled(read());

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.addEventListener('storage', function (event) {
    if (event.key === KEY) setEnabled(read());
  });
})();
