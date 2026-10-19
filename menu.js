(function () {
  if (!SCSAuth.requireAuth('/')) {
    return;
  }

  const welcomeUser = document.getElementById('welcomeUser');
  const logoutBtn = document.getElementById('logoutBtn');

  welcomeUser.textContent = SCSAuth.getUsername() || 'User';

  logoutBtn.addEventListener('click', function () {
    SCSAuth.clearSession();
    window.location.href = '/';
  });
})();
