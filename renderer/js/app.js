// Lógica del mapa público: capas, comunas, marcadores, filtros, listado y leyenda.
// Los datos llegan con setDatos() (desde la API o del modo demo).
const AppMapa = (function () {
  var centro = [4.1420, -73.6266];
  var mapa = null;
  var capaMarcadores = null;
  var marcadores = {};
  var DATOS = [];

  var catSel = new Set();
  var solo24 = false;

  var modoEdicion = false;   // true cuando hay sesión admin: marcadores arrastrables
  var alMover = null;        // callback(id, latlng) al soltar un marcador arrastrado

  // Categorías institucionales: definen los filtros del panel, la leyenda,
  // el color del marcador, su ícono y el emoji del popup.
  var CATEGORIAS = {
    proteccion:  { etiqueta: "Protección",           color: "#F97316", icono: "icons/comisaria.svg",   emoji: "🚔", forma: "circulo" },
    salud:       { etiqueta: "Salud",                color: "#2563EB", icono: "icons/salud.svg",       emoji: "🏥", forma: "cuadrado" },
    justicia:    { etiqueta: "Justicia",             color: "#DC2626", icono: "icons/justicia.svg",    emoji: "⚖️", forma: "triangulo" },
    cai:         { etiqueta: "CAI y Policía",        color: "#0D9488", icono: "icons/policia.svg",     emoji: "👮", forma: "triangulo" },
    ong:         { etiqueta: "ONG / Fundaciones",    color: "#DB2777", icono: "icons/ong.svg",         emoji: "❤️", forma: "estrella" },
    defensoria:  { etiqueta: "Defensorías",          color: "#B45309", icono: "icons/defensoria.svg",  emoji: "🛡️", forma: "rombo" },
    diferencial: { etiqueta: "Enfoque diferencial",  color: "#9333EA", icono: "icons/diferencial.svg", emoji: "🕊️", forma: "estrella" }
  };
  var ORDEN_CATEGORIAS = ["proteccion", "salud", "justicia", "cai", "ong", "defensoria", "diferencial"];
  // Categoría por defecto de cada "forma" legacy (entidades antiguas o del Sheet en vivo).
  var CATEGORIA_POR_FORMA = {
    circulo: "proteccion",
    cuadrado: "salud",
    triangulo: "justicia",
    estrella: "diferencial",
    rombo: "defensoria"
  };

  // Categoría de una entidad: usa el campo `categoria` si existe; si no, la
  // deduce del nombre (datos del Google Sheet en vivo) y, en último caso, de la forma.
  function categoriaDe(ins) {
    if (ins && ins.categoria && CATEGORIAS[ins.categoria]) return ins.categoria;
    var n = ((ins && ins.nombre) || "").toLowerCase();
    if (/comisar[íi]a|línea violeta|linea violeta|centro integrado/.test(n)) return "proteccion";
    if (/casa de justicia|medicina legal|personer[íi]a|defensor[íi]a/.test(n)) return "defensoria";
    if (/\bicbf\b|\bcrav\b|\bdaiv\b|v[íi]ctimas del conflicto|atenci[óo]n integral a v[íi]ctimas/.test(n)) return "diferencial";
    if (/hospital|centro de salud|cl[íi]nica|\bsalud\b|\bips\b|samen|servim[ée]dicos|m[ée]dic/.test(n)) return "salud";
    if (/fiscal[íi]a/.test(n)) return "justicia";
    if (/\bcai\b|\bcaic\b|polic[íi]a|inspecci[óo]n|estaci[óo]n/.test(n)) return "cai";
    if (/fundaci[óo]n|corporaci[óo]n/.test(n)) return "ong";
    return CATEGORIA_POR_FORMA[(ins && ins.forma)] || "proteccion";
  }

  function categoriaInfo(ins) { return CATEGORIAS[categoriaDe(ins)] || CATEGORIAS.proteccion; }
  // El color siempre sale de la categoría (ignora el campo legado `color` del Sheet).
  function colorDe(ins) { return categoriaInfo(ins).color; }
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
      contenido = '<img src="' + categoriaInfo(ins).icono + '" alt="">';
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
      '<div class="popup-titulo" style="--tc:' + colorDe(ins) + ';">' + logoPopup(ins) + "<h3><span class=\"emoji-cat\">" + categoriaInfo(ins).emoji + "</span> " + ins.nombre + "</h3></div>" +
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
    var contCats = document.getElementById("filtros-categorias");

    function crearFila(cont, etiqueta, valor, cat) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "f-tipo";
      b.dataset.valor = valor;
      b.setAttribute("aria-pressed", "false");
      b.innerHTML =
        '<span class="ft-ico" style="--tc:' + (cat ? cat.color : "#5A6B61") + '">' +
        (cat ? '<img src="' + cat.icono + '" alt="">' : '<i class="fa-solid fa-list-check"></i>') +
        "</span>" +
        '<span class="ft-label">' + etiqueta + "</span>" +
        '<span class="ft-count">0</span>';
      cont.appendChild(b);
      return b;
    }

    crearFila(contCats, "Todas", "*todas", null).setAttribute("aria-pressed", "true");
    ORDEN_CATEGORIAS.forEach(function (k) {
      crearFila(contCats, CATEGORIAS[k].etiqueta, k, CATEGORIAS[k]);
    });

    contCats.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-valor]");
      if (!b) return;
      var valor = b.dataset.valor;
      var activo = b.getAttribute("aria-pressed") === "true";
      var botones = contCats.querySelectorAll("button[data-valor]");
      if (valor === "*todas") {
        catSel.clear();
        botones.forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
      } else {
        contCats.children[0].setAttribute("aria-pressed", "false");
        if (activo) {
          catSel.delete(valor);
          b.setAttribute("aria-pressed", "false");
        } else {
          catSel.add(valor);
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
      catSel.clear();
      solo24 = false;
      document.getElementById("chip-24h").setAttribute("aria-pressed", "false");
      contCats.querySelectorAll(".f-tipo").forEach(function (x, i) { x.setAttribute("aria-pressed", i === 0 ? "true" : "false"); });
      aplicarFiltros();
    });
  }

  function pasaCategoria(ins) {
    if (catSel.size === 0 || catSel.has("*todas")) return true;
    return catSel.has(categoriaDe(ins));
  }
  function pasa24(ins) {
    return !solo24 || ins.es24h;
  }

  function aplicarFiltros() {
    if (!capaMarcadores) return;
    capaMarcadores.clearLayers();
    DATOS.forEach(function (ins) {
      if (!(pasaCategoria(ins) && pasa24(ins))) return;
      var m = marcadores[ins.id];
      if (m) capaMarcadores.addLayer(m);
    });
  }

  function actualizarStats() {
    document.getElementById("stat-total").textContent = DATOS.length;
    document.getElementById("stat-24h").textContent = DATOS.filter(function (i) { return i.es24h; }).length;
    // contadores por categoría en los filtros
    var contCats = document.getElementById("filtros-categorias");
    Array.prototype.forEach.call(contCats.querySelectorAll(".f-tipo"), function (b) {
      var valor = b.dataset.valor;
      var cuenta = valor === "*todas"
        ? DATOS.length
        : DATOS.filter(function (i) { return categoriaDe(i) === valor; }).length;
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
    pintarLeyenda();
  }

  // Leyenda: una fila por categoría (desde CATEGORIAS) + avisos fijos de 24 h y dirección.
  function pintarLeyenda() {
    var cont = document.getElementById("leyenda-iconos");
    if (!cont) return;
    var filas = ORDEN_CATEGORIAS.map(function (k) {
      var c = CATEGORIAS[k];
      return "<div><span class=\"lg-ico\" style=\"--tc:" + c.color + "\"><img src=\"" + c.icono + "\" alt=\"\"></span> " +
        c.emoji + " " + c.etiqueta + "</div>";
    });
    filas.push('<div><span class="lg-ico h24" style="--tc:#F97316"><img src="icons/reloj.svg" alt=""></span> ⏰ Borde ámbar = 24 horas</div>');
    filas.push('<div><span class="lg-ico alerta">!</span> ❓ Dirección por verificar</div>');
    cont.innerHTML = filas.join("");
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

      var btnDescargar = document.getElementById("btn-descargar-xlsx");
      if (btnDescargar) {
        btnDescargar.addEventListener("click", function () {
          ExportXLSX.descargarInstituciones(AppMapa.getDatos());
        });
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
    getCategorias: function () { return CATEGORIAS; },
    getOrdenCategorias: function () { return ORDEN_CATEGORIAS; },
    categoriaDe: categoriaDe,
    textoComunas: textoComunas
  };
})();
