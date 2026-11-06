/* Shared DOM renderer for the scene editor and the display client. */
(function (root) {
  'use strict';
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function pig(host, cfg, line, action) {
    host.textContent = '';
    var stage = node('div', 'pig-stage'),
      img = node('img', 'pig-portrait');
    var pose = ['scarf', 'point', 'wave', 'serious'].indexOf(action) >= 0 ? action : 'idle';
    var look = root.HomePigLooks ? root.HomePigLooks.get(cfg.look) : { id:'peach', name:'桃桃猪' };
    img.alt = look.name;
    var model, canvas;
    function useIllustration() {
      model = null;
      img.src = (look.id === 'peach' ? '/client/assets/peach-pig.svg' : '/client/assets/pigs/' + look.id + '.svg') + '#' + pose;
      if (canvas && canvas.parentNode === stage) stage.replaceChild(img, canvas);
      else if (!img.parentNode) stage.appendChild(img);
    }
    if (cfg.appearance === '3d' && root.HomePig3D) {
      canvas = node('canvas', 'pig-portrait');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', '3D ' + look.name);
      model = root.HomePig3D.mount(canvas, useIllustration, look);
    }
    if (model) {
      stage.appendChild(canvas);
      model.setPose(pose);
    } else useIllustration();
    stage.appendChild(node('div', line ? 'pig-bubble' : 'pig-bubble pig-greeting',
      line || root.HomePigGreetings.greeting(cfg)));
    host.appendChild(stage);
  }
  function newsConfig(cfg) {
    const words = Array.isArray(cfg.keywords) ? cfg.keywords : String(cfg.theme || '').split(/[,，、\n]/);
    const types = Array.isArray(cfg.categories) ? cfg.categories : [cfg.category];
    const categories = types.filter(t => t === 'news' || t === 'ranking');
    return {
      keywords: [...new Set(words.map(w => String(w).trim()).filter(Boolean))],
      categories: categories.length ? [...new Set(categories)] : ['news','ranking'],
      seconds: Math.min(600, Math.max(2, Math.round(Number(cfg.seconds) || 10))),
      fontSize: Math.min(72, Math.max(12, Number(cfg.fontSize) || 20))
    };
  }

  function matchesNews(items, cfg, now) {
    const words = cfg.keywords.map(word => word.toLowerCase());
    return items.filter(event => {
      if (event.expires <= now || !cfg.categories.includes(event.kind)) return false;
      const a = event.payload;
      const text = [a.topic, a.title, a.summary, a.excerpt].filter(Boolean).join(' ').toLowerCase();
      return !words.length || words.some(word => text.includes(word));
    });
  }

  const carousels = new WeakMap();
  const fadeMs = 320;
  function createCarousel(host) {
    const sheet = node('section', 'news-sheet');
    const article = node('article','news-slide');
    const meta = node('div','news-meta');
    const kind = node('span','news-kind');
    const source = node('span','news-source');
    const title = node('h3','news-title');
    const summary = node('p','news-summary');
    meta.append(kind,source);
    article.append(meta,title,summary);
    sheet.appendChild(article);
    host.textContent = '';
    host.appendChild(sheet);
    let playlist = [], currentId = null, seconds = 10, fontSize = 20, timer = null;
    function fit() {
      const size = Math.min(fontSize, sheet.clientWidth / 10, sheet.clientHeight / 8);
      if (size <= 0) return;
      sheet.style.fontSize = size + 'px';
      const available = article.clientHeight - meta.offsetHeight - title.offsetHeight - size * .625;
      const lines = Math.floor(available / (size * .94 * 1.42));
      summary.style.webkitLineClamp = String(Math.max(1, Math.min(4, lines)));
    }
    const resize = root.ResizeObserver && new root.ResizeObserver(fit);
    if (resize) resize.observe(sheet);

    function display(item) {
      currentId = item ? item.id : null;
      const a = item ? item.payload : {};
      meta.hidden = !item;
      kind.textContent = item && item.kind === 'ranking' ? '热搜' + (a.rank ? ' · 第 ' + a.rank + ' 名' : '') : '新闻';
      source.textContent = a.source || '来源未标注';
      title.textContent = item ? a.title : '暂无符合条件的资讯';
      const detail = [a.summary, a.excerpt].map(text => String(text || '').split(/要刷更多视频[？?]|请下载《联合早报》应用/)[0].trim())
        .find(text => text && text !== a.title);
      const sentences = detail && detail.match(/[^。！？]+[。！？]?/g);
      summary.textContent = item ? (sentences ? sentences.slice(0, 2).join('') : '来源未附文字简述。') : '';
      fit();
    }
    function cancel() {
      clearTimeout(timer);
      timer = null;
      article.classList.remove('news-leaving');
    }
    function schedule() {
      if (timer !== null || playlist.length < 2) return;
      const fade = root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : fadeMs;
      timer = setTimeout(function () {
        if (!host.isConnected) { cancel(); return; }
        if (fade) article.classList.add('news-leaving');
        timer = setTimeout(function () {
          playlist = playlist.filter(e => e.expires > Date.now());
          const index = playlist.findIndex(e => e.id === currentId);
          display(playlist.length ? playlist[(index + 1) % playlist.length] : null);
          cancel();
          schedule();
        }, fade);
      }, seconds * 1000 - fade);
    }
    return {
      update(items, cfg) {
        playlist = items;
        const current = items.find(e => e.id === currentId);
        if (!current || seconds !== cfg.seconds || items.length < 2) cancel();
        seconds = cfg.seconds;
        fontSize = cfg.fontSize;
        display(current || items[0]);
        schedule();
      },
      dispose() { cancel(); if (resize) resize.disconnect(); }
    };
  }
  function cards(host, config, items, now) {
    let carousel = carousels.get(host);
    if (!carousel) {
      carousel = createCarousel(host);
      carousels.set(host,carousel);
    }
    const cfg = newsConfig(config);
    carousel.update(matchesNews(items, cfg, now), cfg);
  }
  function disposeCards(host) {
    const carousel = carousels.get(host);
    if (carousel) { carousel.dispose(); carousels.delete(host); }
  }
  root.HomeBriefing = { pig, cards, disposeCards, newsConfig };
})(typeof window === 'undefined' ? globalThis : window);
