(() => {
  const links = document.querySelectorAll('.navigation .nav-link');
  links.forEach(link => link.addEventListener('click', () => {
    links.forEach(item => item.classList.toggle('active', item === link));
  }));
  document.getElementById('password').addEventListener('keydown', event => {
    if (event.key === 'Enter') document.getElementById('login').click();
  });
  const search = document.getElementById('library-search');
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') document.getElementById('library-section').scrollIntoView({behavior:'auto', block:'start'});
  });
})();
