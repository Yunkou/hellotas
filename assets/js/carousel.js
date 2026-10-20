// Image carousels (layouts/partials/carousel.html), the LinkedIn reader view, the event sub-bar and the photo viewer.
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

  document.querySelectorAll('[data-carousel]').forEach(initCarousel);
  document.querySelectorAll('[data-subbar]').forEach(initSubbar);
  document.querySelectorAll('[data-reader]').forEach(initReader);
  initLightbox();
})();
