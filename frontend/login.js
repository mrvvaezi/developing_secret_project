(() => {
  const form = document.getElementById('login-form');
  const button = document.getElementById('login-submit');
  const status = document.getElementById('login-status');
  const name = document.getElementById('login-name');
  const pin = document.getElementById('login-pin');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'در حال ورود…';
    status.textContent = '';
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: name.value.trim(), password: pin.value})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'ورود انجام نشد؛ دوباره تلاش کنید.');
      pin.value = '';
      location.replace('/');
    } catch (error) {
      status.textContent = error.message || 'ارتباط برقرار نشد؛ دوباره تلاش کنید.';
      pin.value = '';
      pin.focus();
    } finally {
      button.disabled = false;
      button.textContent = 'ورود';
    }
  });
})();
