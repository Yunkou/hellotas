// Site scripts: mobile menu, image carousels, LinkedIn reader view, events filter and search, event sub-bar, copy-link buttons and the photo viewer.
// Sliding is plain CSS scroll-snap, so swiping and scrolling still work if this file fails to load.
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Advance a carousel on its own every `delay` ms.
  //   root      the .carousel element (pause button: root.querySelector('.carousel-pause'))
  //   next      call to move to the next slide (wraps back to the first)
  //   delay     milliseconds between slides, from data-autoplay
  // Holds still while hovered, while something inside has keyboard focus, while the tab is hidden,
  // and after the pause button is pressed. Starts paused for visitors who prefer reduced motion.
  function startAutoplay(root, next, delay) {
    var button = root.querySelector('.carousel-pause');
    var hovering = false;
    var focused = false;
    var paused = reduceMotion;

    function setPaused(value) {
      paused = value;
      button.classList.toggle('is-paused', paused);
      button.setAttribute('aria-label', paused ? button.dataset.labelPlay : button.dataset.labelPause);
    }

    root.addEventListener('mouseenter', function () { hovering = true; });
    root.addEventListener('mouseleave', function () { hovering = false; });
    // Focus on the pause button itself doesn't count, or pressing play would never resume.
    root.addEventListener('focusin', function (e) { focused = e.target !== button; });
    root.addEventListener('focusout', function (e) {
      if (!root.contains(e.relatedTarget)) focused = false;
    });
    button.addEventListener('click', function () { setPaused(!paused); });

    setPaused(paused);
    setInterval(function () {
      if (!paused && !hovering && !focused && !document.hidden) next();
    }, delay);
  }

  function initCarousel(root) {
    var track = root.querySelector('.carousel-track');
    var slides = track.children;
    var dots = root.querySelectorAll('.carousel-dot');
    var counter = root.querySelector('.carousel-current');
    var index = 0;

    function goTo(i) {
      index = (i + slides.length) % slides.length;
      track.scrollTo({ left: slides[index].offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function sync() {
      var i = Math.round(track.scrollLeft / track.clientWidth);
      index = Math.max(0, Math.min(i, slides.length - 1));
      counter.textContent = index + 1;
      dots.forEach(function (dot, j) {
        if (j === index) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
    }

    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { sync(); ticking = false; });
    }, { passive: true });

    root.querySelector('.carousel-prev').addEventListener('click', function () { goTo(index - 1); });
    root.querySelector('.carousel-next').addEventListener('click', function () { goTo(index + 1); });
    dots.forEach(function (dot, j) {
      dot.addEventListener('click', function () { goTo(j); });
    });

    if (root.dataset.autoplay) {
      startAutoplay(root, function () { goTo(index + 1); }, Number(root.dataset.autoplay));
    }
  }

  // LinkedIn reader view (4+ posts): author tabs show one full post at a time.
  // Without this script every post stays visible, stacked.
  function initReader(reader) {
    var tabs = reader.querySelectorAll('.lp-tab');
    var panels = reader.querySelectorAll('.lp-panel');
    var counter = reader.querySelector('.lp-current');
    var index = 0;

    function show(i, focusTab) {
      index = (i + tabs.length) % tabs.length;
      tabs.forEach(function (tab, j) {
        var on = j === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      counter.textContent = index + 1;
      if (focusTab) tabs[index].focus();
    }

    tabs.forEach(function (tab, j) {
      tab.addEventListener('click', function () { show(j); });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1, true); }
      });
    });
    reader.querySelector('.lp-prev').addEventListener('click', function () { show(index - 1); });
    reader.querySelector('.lp-next').addEventListener('click', function () { show(index + 1); });

    reader.classList.add('is-ready');
    show(0);
  }

  // Photo viewer: clicking a photo inside any [data-lightbox] group shows it large.
  // Closes with the × button, a click outside the photo, or Esc; arrows and ←/→ step through the group.
  function initLightbox() {
    if (!document.querySelector('[data-lightbox]')) return;
    var labels = document.body.dataset;
    var dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.innerHTML =
      '<button type="button" class="lightbox-close">×</button>' +
      '<button type="button" class="lightbox-prev">‹</button>' +
      '<figure class="lightbox-figure"><img alt=""><figcaption class="lightbox-count"></figcaption></figure>' +
      '<button type="button" class="lightbox-next">›</button>';
    document.body.appendChild(dialog);

    var img = dialog.querySelector('img');
    var count = dialog.querySelector('.lightbox-count');
    var closeBtn = dialog.querySelector('.lightbox-close');
    var prevBtn = dialog.querySelector('.lightbox-prev');
    var nextBtn = dialog.querySelector('.lightbox-next');
    closeBtn.setAttribute('aria-label', labels.lbClose);
    prevBtn.setAttribute('aria-label', labels.lbPrev);
    nextBtn.setAttribute('aria-label', labels.lbNext);

    var photos = [];
    var index = 0;

    function show(i) {
      index = (i + photos.length) % photos.length;
      img.src = photos[index].src;
      img.alt = photos[index].alt;
      count.textContent = photos.length > 1 ? (index + 1) + ' / ' + photos.length : '';
      prevBtn.hidden = nextBtn.hidden = photos.length < 2;
    }

    document.addEventListener('click', function (e) {
      var group = e.target.closest('[data-lightbox]');
      var photo = e.target.closest('img:not(.carousel-backdrop)');
      if (!group || !photo || !group.contains(photo)) return;
      e.preventDefault(); // Photo Booth photos are links to the full-size file
      var nodes = Array.prototype.slice.call(group.querySelectorAll('img:not(.carousel-backdrop)'));
      photos = nodes.map(function (n) { return { src: n.src, alt: n.alt }; });
      dialog.showModal();
      show(nodes.indexOf(photo));
    });

    closeBtn.addEventListener('click', function () { dialog.close(); });
    prevBtn.addEventListener('click', function () { show(index - 1); });
    nextBtn.addEventListener('click', function () { show(index + 1); });
    // Anything that isn't the photo or a button closes it: the dark backdrop and the space around the photo.
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog || e.target.classList.contains('lightbox-figure')) dialog.close();
    });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
    dialog.addEventListener('close', function () { img.removeAttribute('src'); });
  }

  // Event detail page: a slim bar with the back link and title slides in under the sticky header
  // once the page title has scrolled out of view, and slides away again when it comes back.
  function initSubbar(bar) {
    var anchor = document.querySelector('[data-subbar-anchor]');
    var header = document.querySelector('.site-header');
    if (!anchor || !header) return;
    var focusables = bar.querySelectorAll('a, button');
    var visible = false;

    function setVisible(value) {
      if (value === visible) return;
      visible = value;
      bar.classList.toggle('is-visible', visible);
      bar.setAttribute('aria-hidden', visible ? 'false' : 'true');
      focusables.forEach(function (el) { el.tabIndex = visible ? 0 : -1; });
    }

    // Show once the title's bottom edge has gone up behind the sticky header.
    function update() {
      var headerHeight = header.offsetHeight;
      bar.style.top = headerHeight + 'px';
      setVisible(anchor.getBoundingClientRect().bottom < headerHeight);
    }

    bar.querySelector('.event-subbar-title').addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // "Copy link" buttons: copy data-copy to the clipboard and show data-copied for a moment.
  function initCopy(button) {
    var label = button.textContent;
    var timer;
    button.addEventListener('click', function () {
      var text = button.dataset.copy;
      var done = function () {
        button.textContent = button.dataset.copied;
        button.classList.add('is-copied');
        clearTimeout(timer);
        timer = setTimeout(function () {
          button.textContent = label;
          button.classList.remove('is-copied');
        }, 2000);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { window.prompt('', text); });
      } else {
        window.prompt('', text); // older browsers / plain http: let the visitor copy it by hand
      }
    });
  }

  // Events list: year buttons (All / 2026 / 2025 …), a text search over each card's data-search, and the event count.
  // Every word typed must appear somewhere in the event. The choice is kept in the address (?year=…&q=…)
  // so a filtered view can be bookmarked or shared. Without this script every event stays visible.
  function initEventFilter(root) {
    var tabs = root.querySelectorAll('.year-tab');
    var input = root.querySelector('.events-search-input');
    var status = root.querySelector('.events-status');
    var count = root.querySelector('.events-count');
    var clearLink = status.querySelector('.events-clear');
    var announce = root.querySelector('.events-announce');
    var empty = root.querySelector('.events-empty');
    var groups = root.querySelectorAll('.events-year');
    var year = 'all';

    // Case, accents and full-width letters don't matter: "Pax", "PAX" and "ＰＡＸ" all match.
    function fold(text) {
      return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    var cards = Array.prototype.map.call(root.querySelectorAll('.event-card'), function (card) {
      return { el: card, text: fold(card.dataset.search || '') };
    });

    function apply() {
      var terms = fold(input.value).split(/\s+/).filter(Boolean);
      var shown = 0;

      groups.forEach(function (group) {
        var inYear = year === 'all' || group.dataset.year === year;
        var visible = 0;
        cards.forEach(function (card) {
          if (!group.contains(card.el)) return;
          var match = inYear && terms.every(function (t) { return card.text.indexOf(t) !== -1; });
          card.el.hidden = !match;
          if (match) visible++;
        });
        group.hidden = visible === 0;
        shown += visible;
      });

      tabs.forEach(function (tab) {
        var on = tab.dataset.year === year;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      var filtering = year !== 'all' || terms.length > 0;
      var message = (shown === 1 ? count.dataset.single : count.dataset.plural).replace('{n}', shown);
      status.hidden = shown === 0; // the empty-state box says it instead
      clearLink.hidden = !filtering;
      empty.hidden = shown > 0;
      count.textContent = message;
      announce.textContent = message;

      var params = new URLSearchParams(location.search);
      if (year === 'all') params.delete('year'); else params.set('year', year);
      if (input.value.trim()) params.set('q', input.value.trim()); else params.delete('q');
      var query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    }

    function clear() {
      year = 'all';
      input.value = '';
      apply();
      input.focus();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { year = tab.dataset.year; apply(); });
    });
    input.addEventListener('input', apply);
    root.querySelectorAll('.events-clear').forEach(function (button) {
      button.addEventListener('click', clear);
    });

    // Restore a filtered view from the address, e.g. events/?year=2025&q=melbourne
    var params = new URLSearchParams(location.search);
    if (params.get('year') && root.querySelector('.year-tab[data-year="' + params.get('year') + '"]')) year = params.get('year');
    if (params.get('q')) input.value = params.get('q');
    apply();
  }

  // Narrow screens: the ☰ button opens the menu panel under the header.
  // Closes on a link click, a click outside, Esc, or when the window widens back to desktop.
  function initMobileMenu(button) {
    var menu = document.getElementById(button.getAttribute('aria-controls'));
    if (!menu) return;

    function setOpen(open) {
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? button.dataset.labelClose : button.dataset.labelOpen);
      menu.hidden = !open;
    }

    button.addEventListener('click', function () { setOpen(menu.hidden); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setOpen(false); button.focus(); }
    });
    window.addEventListener('resize', function () {
      if (getComputedStyle(button).display === 'none') setOpen(false);
    });
  }

  document.querySelectorAll('.nav-toggle').forEach(initMobileMenu);
  document.querySelectorAll('[data-carousel]').forEach(initCarousel);
  document.querySelectorAll('[data-copy]').forEach(initCopy);
  document.querySelectorAll('[data-event-filter]').forEach(initEventFilter);
  document.querySelectorAll('[data-subbar]').forEach(initSubbar);
  document.querySelectorAll('[data-reader]').forEach(initReader);
  initLightbox();
})();
