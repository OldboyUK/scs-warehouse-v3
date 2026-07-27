(function (global) {
  const SESSION_KEY = 'scs_auth_session';
  const SESSION_MS = 8 * 60 * 60 * 1000;

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw);
      if (!data.username || !data.expiresAt || Date.now() > data.expiresAt) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }

      return data;
    } catch (_) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function setSession(username) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      username: String(username || '').trim(),
      expiresAt: Date.now() + SESSION_MS
    }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function isAuthenticated() {
    return !!getSession();
  }

  function getUsername() {
    const session = getSession();
    return session ? session.username : null;
  }

  function requireAuth(loginPath) {
    if (isAuthenticated()) return true;
    window.location.href = loginPath || 'login.html';
    return false;
  }

  global.SCSAuth = {
    getSession,
    setSession,
    clearSession,
    isAuthenticated,
    getUsername,
    requireAuth
  };
})(window);
