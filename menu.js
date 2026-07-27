(function () {
  if (!SCSAuth.requireAuth('/')) {
    return;
  }

  const welcomeUser = document.getElementById('welcomeUser');
  const logoutBtn = document.getElementById('logoutBtn');
  const hrBtn = document.getElementById('hrBtn');
  const qualityBtn = document.getElementById('qualityBtn');
  const comingSoonOverlay = document.getElementById('comingSoonOverlay');
  const closeComingSoon = document.getElementById('closeComingSoon');

  welcomeUser.textContent = SCSAuth.getUsername() || 'User';

  logoutBtn.addEventListener('click', function () {
    SCSAuth.clearSession();
    window.location.href = '/';
  });

  hrBtn.addEventListener('click', showComingSoon);
  qualityBtn.addEventListener('click', showComingSoon);

  closeComingSoon.addEventListener('click', hideComingSoon);
  comingSoonOverlay.addEventListener('click', function (event) {
    if (event.target === comingSoonOverlay) {
      hideComingSoon();
    }
  });

  function showComingSoon() {
    comingSoonOverlay.hidden = false;
  }

  function hideComingSoon() {
    comingSoonOverlay.hidden = true;
  }
})();
