(function () {
  const AUTH_USERS_URL = '/.netlify/functions/authUsers';
  const AUTH_LOGIN_URL = '/.netlify/functions/authLogin';

  const form = document.getElementById('loginForm');
  const usernameSelect = document.getElementById('username');
  const pinInput = document.getElementById('pin');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  if (SCSAuth.isAuthenticated()) {
    window.location.replace('/menu.html');
    return;
  }

  pinInput.addEventListener('input', function () {
    pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 8);
    hideError();
  });

  usernameSelect.addEventListener('change', hideError);

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    hideError();

    const username = usernameSelect.value.trim();
    const pin = pinInput.value.trim();

    if (!username) {
      showError('Please select a user.');
      return;
    }

    if (!/^\d{8}$/.test(pin)) {
      showError('Please enter your 8-digit PIN.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(AUTH_LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin })
      });

      const data = JSON.parse(await response.text());

      if (data.result === 'success') {
        SCSAuth.setSession(username);
        window.location.href = '/menu.html';
        return;
      }

      showError('Invalid PIN.');
      pinInput.value = '';
      pinInput.focus();
    } catch (_) {
      showError('Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  });

  loadUsers();

  async function loadUsers() {
    try {
      const response = await fetch(AUTH_USERS_URL);
      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (_) {
        throw new Error('Invalid response from server');
      }

      const users = Array.isArray(data.users) ? data.users : [];

      usernameSelect.innerHTML = '';

      if (data.result === 'error' && data.message) {
        usernameSelect.innerHTML = '<option value="">' + data.message + '</option>';
        usernameSelect.disabled = true;
        loginBtn.disabled = true;
        return;
      }

      if (!users.length) {
        const emptyMsg = data.message ? String(data.message) : 'No users available';
        usernameSelect.innerHTML = '<option value="">' + emptyMsg + '</option>';
        usernameSelect.disabled = true;
        loginBtn.disabled = true;
        return;
      }

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select user…';
      usernameSelect.appendChild(placeholder);

      users.forEach(function (name) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        usernameSelect.appendChild(option);
      });

      usernameSelect.disabled = false;
      loginBtn.disabled = false;
    } catch (_) {
      usernameSelect.innerHTML = '<option value="">Unable to load users — check Auth script deploy</option>';
      usernameSelect.disabled = true;
      loginBtn.disabled = true;
    }
  }

  function showError(message) {
    loginError.textContent = message;
    loginError.hidden = false;
  }

  function hideError() {
    loginError.hidden = true;
  }

  function setLoading(isLoading) {
    loginBtn.disabled = isLoading || usernameSelect.disabled;
    loginBtn.textContent = isLoading ? 'Signing in…' : 'Login';
  }
})();
