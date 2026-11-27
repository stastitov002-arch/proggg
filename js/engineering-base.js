(() => {
  const search = document.getElementById('kb-search');
  const grid = document.getElementById('kb-category-grid');
  if (search && grid) {
    const cards = Array.from(grid.querySelectorAll('[data-kb-card]'));
    const count = document.getElementById('kb-search-count');
    const empty = document.getElementById('kb-empty');
    const update = () => {
      const query = search.value.trim().toLocaleLowerCase('ru');
      let visible = 0;
      cards.forEach(card => {
        const match = !query || (card.dataset.search || '').includes(query);
        card.hidden = !match;
        if (match) visible += 1;
      });
      if (count) count.textContent = query ? ('Найдено направлений: ' + visible) : ('Тематических направлений: ' + cards.length);
      if (empty) empty.hidden = visible !== 0;
    };
    search.addEventListener('input', update);
  }

  const article = document.getElementById('kb-article-content');
  const toc = document.getElementById('kb-toc');
  if (article && toc) {
    const headings = Array.from(article.querySelectorAll('h2, h3'));
    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = 'kb-section-' + (index + 1);
      const link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent;
      if (heading.tagName === 'H3') link.className = 'is-sub';
      toc.appendChild(link);
    });
    if (!headings.length) toc.parentElement.hidden = true;
  }
})();