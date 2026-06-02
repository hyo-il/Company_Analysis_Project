// 개발 히스토리 페이지 — 좌측 차수 목차 + 우측 상세 본문.
import { listChangelogVersions, getChangelogVersion } from '../data/changelog.js';

function renderVersionInto(container, version) {
  if (!container || !version) return;
  container.innerHTML = '';
  const wrap = document.createElement('article');
  wrap.className = 'history-detail';
  const h3 = document.createElement('h3');
  h3.textContent = `${version.title} — ${version.date}`;
  wrap.appendChild(h3);
  if (version.bullets?.length) {
    const ul = document.createElement('ul');
    ul.className = 'help-notes';
    for (const b of version.bullets) {
      const li = document.createElement('li');
      li.innerHTML = b;
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
  }
  container.appendChild(wrap);
}

export function renderHistory(container) {
  if (!container) return;
  container.innerHTML = '';
  const list = listChangelogVersions();
  if (list.length === 0) {
    container.innerHTML = '<div class="panel"><p>표시할 차수가 없습니다.</p></div>';
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'history-page';

  const left = document.createElement('nav');
  left.className = 'history-toc';
  left.setAttribute('aria-label', '차수 목차');
  const ul = document.createElement('ul');
  for (const v of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-toc-link';
    btn.dataset.targetId = v.id;
    btn.textContent = `${v.title} (${v.date})`;
    btn.addEventListener('click', () => {
      renderVersionInto(detail, getChangelogVersion(v.id));
      setActive(v.id);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
  left.appendChild(ul);

  const detail = document.createElement('section');
  detail.className = 'history-detail-wrap';
  detail.setAttribute('aria-live', 'polite');

  wrap.appendChild(left);
  wrap.appendChild(detail);
  container.appendChild(wrap);

  function setActive(id) {
    for (const a of left.querySelectorAll('.history-toc-link')) {
      a.classList.toggle('active', a.dataset.targetId === id);
    }
  }

  renderVersionInto(detail, getChangelogVersion(list[0].id));
  setActive(list[0].id);
}
