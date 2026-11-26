(function () {
  var KEY = 'scs-theme';
  var SUN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var MOON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';

  function read() {
    try {
      return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch (err) {
      return 'dark';
    }
  }

  function paint(button, theme) {
    if (!button) return;
    var day = theme === 'light';
    var label = day ? 'Switch to Night Mode' : 'Switch to Day Mode';
    button.innerHTML = day ? MOON : SUN;
    button.setAttribute('aria-pressed', day ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function apply(theme) {
    var next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#E6EBF1' : '#1a2233');
    paint(document.getElementById('themeToggle'), next);
  }

  apply(read());

  function mount() {
    if (document.getElementById('themeToggle')) return;

    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'themeToggle';
    button.className = 'icon-btn theme-toggle';
    paint(button, document.documentElement.getAttribute('data-theme'));
    button.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, next); } catch (err) { /* preference stays for this view */ }
      apply(next);
    });

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

    var logout = document.getElementById('logoutBtn');
    if (logout && logout.parentNode) {
      var group = document.createElement('div');
      group.className = 'header-actions';
      logout.parentNode.insertBefore(group, logout);
      group.appendChild(button);
      group.appendChild(logout);
      return;
    }

    if (!document.body) return;
    var corner = document.createElement('div');
    corner.className = 'theme-toggle-corner';
    corner.appendChild(button);
    document.body.appendChild(corner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.addEventListener('storage', function (event) {
    if (event.key === KEY) apply(read());
  });
})();
