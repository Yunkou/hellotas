/* Pin maps on place cards (layouts/partials/place-card.html with map.pins).
   Leaflet and OpenStreetMap tiles load only when the map scrolls near the screen. Pins at the same spot
   share one marker that lists every club there. If Leaflet can't load, the card falls back to the Google map. */
(function () {
  var maps = document.querySelectorAll(".place-pin-map");
  if (!maps.length) return;

  var LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
  var loading = null;

  function loadLeaflet() {
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET + "leaflet.css";
      document.head.appendChild(css);
      var js = document.createElement("script");
      js.src = LEAFLET + "leaflet.js";
      js.onload = function () { window.L ? resolve(window.L) : reject(); };
      js.onerror = reject;
      document.head.appendChild(js);
    });
    return loading;
  }

  function fallback(el) {
    el.innerHTML = el.dataset.fallback;
    el.classList.add("place-pin-map--fallback");
  }

  function popup(group, el) {
    var box = document.createElement("div");
    box.className = "pin-popup";
    group.forEach(function (pin) {
      var row = document.createElement("p");
      var name = document.createElement("strong");
      name.textContent = pin.name;
      row.appendChild(name);
      row.appendChild(document.createElement("br"));
      row.appendChild(document.createTextNode(pin.venue || el.dataset.contact));
      row.appendChild(document.createElement("br"));
      var link = document.createElement("a");
      link.href = pin.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = el.dataset.clubPage + " ↗";
      row.appendChild(link);
      box.appendChild(row);
    });
    return box;
  }

  function draw(el, L) {
    var pins = JSON.parse(el.dataset.pins);
    var map = L.map(el, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    var spots = {};
    pins.forEach(function (pin) {
      var key = pin.lat + "," + pin.lng;
      (spots[key] = spots[key] || []).push(pin);
    });
    var brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#C8102E";
    var bounds = [];
    Object.keys(spots).forEach(function (key) {
      var group = spots[key];
      var at = [group[0].lat, group[0].lng];
      bounds.push(at);
      L.circleMarker(at, {
        radius: group.length > 1 ? 9 : 7,
        color: "#fff",
        weight: 2,
        fillColor: brand,
        fillOpacity: 0.9
      })
        .bindTooltip(group.map(function (p) { return p.name; }).join(" · "))
        .bindPopup(popup(group, el))
        .addTo(map);
    });
    map.fitBounds(bounds, { padding: [24, 24] });
    // Zoom with the wheel only after the map has been clicked, so the page still scrolls past it
    map.on("click focus", function () { map.scrollWheelZoom.enable(); });
    el.addEventListener("mouseleave", function () { map.scrollWheelZoom.disable(); });
  }

  function start(el) {
    loadLeaflet().then(function (L) { draw(el, L); }, function () { fallback(el); });
  }

  if (!("IntersectionObserver" in window)) {
    maps.forEach(start);
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      start(entry.target);
    });
  }, { rootMargin: "400px 0px" });
  maps.forEach(function (el) { io.observe(el); });
})();
