// Lógica del mapa público: capas, comunas, marcadores, filtros, listado y leyenda.
// Los datos llegan con setDatos() (desde la API o del modo demo).
const AppMapa = (function () {
  var centro = [4.1420, -73.6266];
  var mapa = null;
  var capaMarcadores = null;
  var marcadores = {};
  var DATOS = [];

  var tipoSel = new Set();
  var solo24 = false;

  var modoEdicion = false;   // true cuando hay sesión admin: marcadores arrastrables
  var alMover = null;        // callback(id, latlng) al soltar un marcador arrastrado

  var COLOR_TIPO = {
    circulo: "#F97316",
    cuadrado: "#2563EB",
    triangulo: "#DC2626",
    estrella: "#9333EA",
    rombo: "#0D9488"
  };
  var ICONO_POR_FORMA = {
    circulo: "icons/comisaria.svg",
    cuadrado: "icons/salud.svg",
    triangulo: "icons/justicia.svg",
    estrella: "icons/diferencial.svg",
    rombo: "icons/defensoria.svg"
  };
  // Emoji amigable por categoría (se muestra en popup, lista y leyenda).
  var EMOJI_POR_FORMA = {
    circulo: "🚔",
    cuadrado: "🏥",
    triangulo: "⚖️",
    estrella: "🕊️",
    rombo: "🛡️"
  };
  var COLOR_POR_TIPO_VIOLENCIA = {
    "Violencia intrafamiliar": COLOR_TIPO.circulo,
    "Violencia sexual": COLOR_TIPO.cuadrado,
    "Maltrato infantil": COLOR_TIPO.estrella,
    "Violencia de género": COLOR_TIPO.triangulo,
    "Víctimas del conflicto": COLOR_TIPO.estrella,
    "Orientación legal": COLOR_TIPO.rombo
  };
  var FA_POR_TIPO_VIOLENCIA = {
    "Violencia intrafamiliar": "fa-house",
    "Violencia sexual": "fa-hand-holding-medical",
    "Maltrato infantil": "fa-children",
    "Violencia de género": "fa-venus",
    "Víctimas del conflicto": "fa-hands-holding-child",
    "Orientación legal": "fa-scale-balanced"
  };

  function colorDe(ins) { return ins.color || COLOR_TIPO[ins.forma] || COLOR_TIPO.circulo; }
  function cubreTodas(ins) {
    return ins.comunas === "todas" || (Array.isArray(ins.comunas) && ins.comunas.indexOf("todas") !== -1);
  }
  function necesitaVerificacion(ins) { return ins.verificado !== "verificado"; }
  function textoComunas(ins) {
    if (cubreTodas(ins)) return "Todas las comunas (cobertura urbana)";
    return (ins.comunas || []).map(function (c) { return "Comuna " + c; }).join(", ");
  }

  function crearIcono(ins) {
    var cls = "pin";
    if (ins.es24h) cls += " es24h";
    var contenido;
    if (ins.sinDireccion) {
      cls += " sin-dir";
      contenido = "!";
    } else {
      contenido = '<img src="' + ICONO_POR_FORMA[ins.forma] + '" alt="">';
    }
    var reloj = ins.es24h
      ? '<span class="reloj" aria-hidden="true"><img src="icons/reloj.svg" alt=""></span>'
      : "";
    var html = '<div class="pin-wrap" aria-hidden="true"><div class="' + cls + '" style="--tc:' + colorDe(ins) + ';">' + contenido + "</div>" + reloj + "</div>";
    return L.divIcon({
      html: html,
      className: "",
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16]
    });
  }

  function filaPopup(ins, etiqueta, valor) {
    if (!valor || valor === "—") return "";
    return '<div class="popup-fila"><b>' + etiqueta + ":</b> " + valor + "</div>";
  }

  function logoPopup(ins) {
    if (ins.logo) {
      return '<img src="' + ins.logo + '" alt="">';
    }
    var letra = (ins.nombre || "?").trim().charAt(0).toUpperCase();
    return '<span class="logo-letra">' + letra + "</span>";
  }

  function contenidoPopup(ins) {
    var pills = (ins.tipos || []).map(function (t) { return '<span class="pill">' + t + "</span>"; }).join("");
    var horario = ins.es24h && ins.horario
      ? '<span class="horario-24h">24 horas</span> ' + ins.horario.replace(/24 horas,? ?/i, "")
      : (ins.horario || "");
    var badge = necesitaVerificacion(ins)
      ? '<div class="popup-badge">Dato por verificar — ' + ins.verificado + "</div>"
      : "";
    var aprox = ins.ubicacionAprox
      ? '<div class="popup-fila" style="font-size:0.76rem;color:#7A5600;">Ubicación aproximada al barrio/municipio sede (la dirección exacta geocodifica de forma parcial en OSM).</div>'
      : "";
    return (
      '<div class="popup-titulo" style="--tc:' + colorDe(ins) + ';">' + logoPopup(ins) + "<h3><span class=\"emoji-cat\">" + (EMOJI_POR_FORMA[ins.forma] || "") + "</span> " + ins.nombre + "</h3></div>" +
      '<div class="pills">' + pills + "</div>" +
      filaPopup(ins, "Qué atiende", ins.tiposDetalle) +
      filaPopup(ins, "Dirección", ins.direccion) +
      filaPopup(ins, "Horario", horario) +
      filaPopup(ins, "Teléfono / correo", ins.telefono) +
      filaPopup(ins, "Comunas que cubre", textoComunas(ins)) +
      filaPopup(ins, "Sede en comuna", ins.comunaSede === "por verificar" ? "" : ins.comunaSede) +
      filaPopup(ins, "Zona rural que cubre", ins.rural) +
      filaPopup(ins, "Nivel", ins.nivel) +
      aprox + badge
    );
  }

  function centroideFeature(feature) {
    var geom = feature.geometry;
    var rings = geom.type === "Polygon" ? [geom.coordinates[0]] : geom.coordinates.map(function (p) { return p[0]; });
    var mayor = rings.reduce(function (a, r) { return r.length > a.length ? r : a; }, rings[0]);
    var sx = 0, sy = 0;
    mayor.forEach(function (p) { sx += p[0]; sy += p[1]; });
    return [sy / mayor.length, sx / mayor.length];
  }

  // ¿Está el punto [lng, lat] dentro del anillo (ray casting)?
  function puntoEnAnillo(pt, anillo) {
    var dentro = false;
    for (var i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      var xi = anillo[i][0], yi = anillo[i][1];
      var xj = anillo[j][0], yj = anillo[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) &&
          (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) {
        dentro = !dentro;
      }
    }
    return dentro;
  }

  // Número de comuna ("1".."10") que contiene la coordenada, o "" si no cae en ninguna.
  function comunaDeCoordenada(lat, lng) {
    var pt = [lng, lat];
    var encontrada = "";
    COMUNAS_GEOJSON.features.some(function (f) {
      var g = f.geometry;
      var poligonos = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      var dentro = false;
      poligonos.forEach(function (anillos) {
        if (puntoEnAnillo(pt, anillos[0])) {
          dentro = true;
          // agujeros (islas dentro de la comuna)
          for (var k = 1; k < anillos.length; k++) {
            if (puntoEnAnillo(pt, anillos[k])) dentro = false;
          }
        }
      });
      if (dentro) {
        encontrada = String(f.properties.Comuna).replace("Comuna ", "");
        return true;
      }
      return false;
    });
    return encontrada;
  }

  function construirMapa() {
    // La vista se mantiene en Villavicencio: no se puede alejar más allá de estas
    // fronteras ni hacer zoom out más allá de minZoom.
    var limiteVista = L.latLngBounds([4.00, -73.80], [4.30, -73.45]);
    mapa = L.map("map", {
      center: centro,
      zoom: 13,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: limiteVista,
      maxBoundsViscosity: 1.0,
      zoomControl: true
    });

    var capaClara = L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 18, maxNativeZoom: 16, attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors, GIS User Community" }
    );
    var capaCalle = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "&copy; Esri, Maxar, Earthstar Geographics, OpenStreetMap contributors" }
    );
    var capaSatelital = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "&copy; Esri, Maxar, Earthstar Geographics, USGS, USDA, AeroGRID, IGN and the GIS User Community" }
    );
    var capaTopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      subdomains: "abc",
      maxZoom: 18,
      maxNativeZoom: 17,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contribuidores, SRTM | Estilo &copy; <a href="https://www.opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
    });

    capaClara.addTo(mapa);
    L.control.layers(
      {
        "Clara (Esri · por defecto)": capaClara,
        "Calles (Esri)": capaCalle,
        "Satelital (Esri)": capaSatelital,
        "Topográfica (OpenTopoMap)": capaTopo
      },
      {},
      { collapsed: window.innerWidth <= 960 }
    ).addTo(mapa);

    L.geoJSON(COMUNAS_GEOJSON, {
      style: function () {
        return { color: "#2E5E43", weight: 1.6, opacity: 0.9, fillColor: "#00843D", fillOpacity: 0.06 };
      },
      onEachFeature: function (feature, layer) {
        var n = feature.properties.Comuna.replace("Comuna ", "");
        var info = COMUNAS_INFO[n];
        var responsable = info ? info.comisaria : "";
        layer.bindTooltip("<strong>" + feature.properties.Comuna + "</strong><br>Comisaría responsable: " + responsable, { sticky: true });
      }
    }).addTo(mapa);

    var etiquetas = L.layerGroup();
    COMUNAS_GEOJSON.features.forEach(function (f) {
      var n = f.properties.Comuna.replace("Comuna ", "");
      etiquetas.addLayer(L.marker(centroideFeature(f), {
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: '<div class="etiqueta-comuna">' + n + "</div>",
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }));
    });
    etiquetas.addTo(mapa);

    capaMarcadores = L.layerGroup().addTo(mapa);
  }

  function construirFiltros() {
    var contTipos = document.getElementById("filtros-tipos");

    function crearFilaTipo(cont, etiqueta, valor, icono, color, cuenta) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "f-tipo";
      b.dataset.valor = valor;
      b.setAttribute("aria-pressed", "false");
      b.innerHTML =
        '<span class="ft-ico" style="--tc:' + color + '"><i class="fa-solid ' + icono + '"></i></span>' +
        '<span class="ft-label">' + etiqueta + "</span>" +
        '<span class="ft-count">' + cuenta + "</span>";
      cont.appendChild(b);
      return b;
    }

    crearFilaTipo(contTipos, "Todas", "*todas", "fa-list-check", "#5A6B61", 0)
      .setAttribute("aria-pressed", "true");
    TIPOS_VIOLENCIA.forEach(function (t) {
      crearFilaTipo(contTipos, t, t, FA_POR_TIPO_VIOLENCIA[t], COLOR_POR_TIPO_VIOLENCIA[t], 0);
    });

    contTipos.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-valor]");
      if (!b) return;
      var valor = b.dataset.valor;
      var activo = b.getAttribute("aria-pressed") === "true";
      var botones = contTipos.querySelectorAll("button[data-valor]");
      if (valor === "*todas") {
        tipoSel.clear();
        botones.forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
      } else {
        contTipos.children[0].setAttribute("aria-pressed", "false");
        if (activo) {
          tipoSel.delete(valor);
          b.setAttribute("aria-pressed", "false");
        } else {
          tipoSel.add(valor);
          b.setAttribute("aria-pressed", "true");
        }
      }
      aplicarFiltros();
    });

    document.getElementById("chip-24h").addEventListener("click", function () {
      solo24 = !solo24;
      this.setAttribute("aria-pressed", solo24 ? "true" : "false");
      aplicarFiltros();
    });

    document.getElementById("chip-limpiar").addEventListener("click", function () {
      tipoSel.clear();
      solo24 = false;
      document.getElementById("chip-24h").setAttribute("aria-pressed", "false");
      contTipos.querySelectorAll(".f-tipo").forEach(function (x, i) { x.setAttribute("aria-pressed", i === 0 ? "true" : "false"); });
      aplicarFiltros();
    });
  }

  function pasaTipo(ins) {
    if (tipoSel.size === 0 || tipoSel.has("*todas")) return true;
    for (var i = 0; i < (ins.tipos || []).length; i++) {
      if (tipoSel.has(ins.tipos[i])) return true;
    }
    return false;
  }
  function pasa24(ins) {
    return !solo24 || ins.es24h;
  }

  function aplicarFiltros() {
    if (!capaMarcadores) return;
    capaMarcadores.clearLayers();
    DATOS.forEach(function (ins) {
      if (!(pasaTipo(ins) && pasa24(ins))) return;
      var m = marcadores[ins.id];
      if (m) capaMarcadores.addLayer(m);
    });
  }

  function actualizarStats() {
    document.getElementById("stat-total").textContent = DATOS.length;
    document.getElementById("stat-24h").textContent = DATOS.filter(function (i) { return i.es24h; }).length;
    // contadores por tipo en los filtros
    var contTipos = document.getElementById("filtros-tipos");
    Array.prototype.forEach.call(contTipos.querySelectorAll(".f-tipo"), function (b) {
      var valor = b.dataset.valor;
      var cuenta = valor === "*todas"
        ? DATOS.length
        : DATOS.filter(function (i) { return (i.tipos || []).indexOf(valor) !== -1; }).length;
      var span = b.querySelector(".ft-count");
      if (span) span.textContent = cuenta;
    });
  }

  function pintarLineasYLeyenda() {
    var lineas = document.getElementById("lineas-24h");
    lineas.innerHTML = "";
    LINEAS_24H.forEach(function (l) {
      var d = document.createElement("div");
      d.className = "linea-item";
      d.innerHTML = "<strong>" + l.linea + "</strong><span>" + l.servicio + " · " + l.horario + " · " + l.costo + "</span>";
      lineas.appendChild(d);
    });
  }

  function iniciar() {
    return new Promise(function (resolver) {
      construirMapa();
      construirFiltros();
      pintarLineasYLeyenda();

      var btnPanel = document.getElementById("btn-panel");
      var panel = document.getElementById("panel");
      btnPanel.addEventListener("click", function () {
        var colapsado = panel.classList.toggle("colapsado");
        btnPanel.setAttribute("aria-expanded", colapsado ? "false" : "true");
        setTimeout(function () { mapa.invalidateSize(); }, 250);
      });
      if (window.innerWidth <= 960) {
        panel.classList.add("colapsado");
        btnPanel.setAttribute("aria-expanded", "false");
      }
      setTimeout(function () { mapa.invalidateSize(); }, 200);
      resolver();
    });
  }

  function setDatos(lista) {
    DATOS = lista || [];
    capaMarcadores.clearLayers();
    marcadores = {};
    DATOS.forEach(function (ins) {
      var marker = L.marker([ins.lat, ins.lng], {
        icon: crearIcono(ins),
        title: ins.nombre,
        alt: ins.nombre,
        draggable: modoEdicion
      });
      marker.on("dragend", function (e) {
        if (alMover) alMover(ins.id, e.target.getLatLng());
      });
      marker.bindPopup(contenidoPopup(ins), { maxWidth: 340 });
      marcadores[ins.id] = marker;
    });
    if (DATOS.length) {
      var bounds = L.latLngBounds(DATOS.map(function (i) { return [i.lat, i.lng]; }));
      mapa.fitBounds(bounds.pad(0.15));
    } else {
      mapa.setView(centro, 13);
    }
    actualizarStats();
    aplicarFiltros();
  }

  // Activa/desactiva el arrastre de marcadores (solo sesión admin).
  function setModoEdicion(activo) {
    modoEdicion = !!activo;
    Object.keys(marcadores).forEach(function (id) {
      var m = marcadores[id];
      m.options.draggable = modoEdicion;
      if (m.dragging) {
        if (modoEdicion) m.dragging.enable();
        else m.dragging.disable();
      }
    });
  }

  function setAlMover(fn) { alMover = fn; }

  return {
    iniciar: iniciar,
    setDatos: setDatos,
    aplicarFiltros: aplicarFiltros,
    setModoEdicion: setModoEdicion,
    setAlMover: setAlMover,
    comunaDeCoordenada: comunaDeCoordenada,
    getMapa: function () { return mapa; },
    getDatos: function () { return DATOS; },
    getIconoPorForma: function () { return ICONO_POR_FORMA; },
    getColorPorForma: function () { return COLOR_TIPO; },
    getEmojiPorForma: function () { return EMOJI_POR_FORMA; },
    textoComunas: textoComunas
  };
})();
