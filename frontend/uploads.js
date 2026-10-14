(() => {
  const input = $('file'), button = $('upload');
  const status = $('upload-status'), results = $('upload-results');
  const count = value => value.toLocaleString('fa-IR');

  input.onchange = () => {
    results.replaceChildren();
    status.textContent = input.files.length
      ? count(input.files.length) + ' فایل انتخاب شده است.'
      : 'فایل‌های موردنظر را انتخاب کنید.';
  };

  button.onclick = async () => {
    if (button.disabled) return;
    const files = Array.from(input.files);
    if (!files.length) {
      status.textContent = 'ابتدا یک یا چند فایل MP3 انتخاب کنید.';
      return;
    }
    let added = 0, skipped = 0, failed = 0;
    results.replaceChildren();
    button.disabled = input.disabled = true;
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index], row = document.createElement('li');
        row.textContent = file.name + ' — در حال آپلود…';
        results.append(row);
        status.textContent = 'در حال آپلود فایل ' + count(index + 1) + ' از ' + count(files.length);
        button.textContent = 'در حال افزودن ' + count(index + 1) + ' از ' + count(files.length);
        try {
          const form = new FormData();
          form.append('file', file);
          const response = await fetch('/api/upload', {
            method: 'POST', body: form
          });
          if (response.status === 401) { location.replace('/login'); return; }
          if (response.status === 409) {
            skipped++;
            row.className = 'skipped';
            row.textContent = file.name + ' — تکراری؛ در صف یا در حال پخش است.';
          } else if (!response.ok) {
            let message = 'آپلود انجام نشد (خطای ' + response.status + ').';
            try {
              const data = await response.json();
              if (typeof data.detail === 'string') message = data.detail;
            } catch (_) {}
            const messages = {
              'Only MP3 files are accepted': 'فقط فایل MP3 پذیرفته می‌شود.',
              'Empty file': 'فایل خالی است.',
              'Invalid MP3': 'فایل MP3 معتبر نیست.'
            };
            throw Error(messages[message] || message);
          } else {
            added++;
            row.className = 'success';
            row.textContent = file.name + ' — به صف اضافه شد.';
          }
        } catch (error) {
          failed++;
          row.className = 'error';
          row.textContent = file.name + ' — خطا: ' + (error.message || 'ارتباط با سرور برقرار نشد.');
        }
      }
      status.textContent = 'پایان آپلود: ' + count(added) + ' اضافه شد، ' + count(skipped)
        + ' تکراری بود، ' + count(failed) + ' ناموفق بود.';
      input.value = '';
    } finally {
      button.disabled = input.disabled = false;
      button.textContent = 'افزودن فایل‌ها به صف';
    }
  };
})();
