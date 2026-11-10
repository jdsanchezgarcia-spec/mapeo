// Importa las instituciones de un archivo TSV (exportado del XLSX de mapeo)
// a renderer/datos.js (modo demo), geocodificando cada dirección con
// Nominatim/OpenStreetMap y usando el centroide de la comuna como respaldo.
//
// Uso: node tools/importar-mapeo.js [ruta.tsv] [--dry]
//   (por defecto lee el TSV extraído del XLSX de mapeo institucional;
//    --dry geocodifica y muestra el informe sin modificar datos.js)
//
// Reglas:
//   - Omite las instituciones que ya existen en datos.js (se compara por nombre).
//   - No toca el Google Sheet ni el backend: solo renderer/datos.js.
//   - Ids nuevos a partir del máximo existente + 1.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
const DATOS_JS = path.join(RAIZ, "renderer", "datos.js");
const COMUNAS_JS = path.join(RAIZ, "renderer", "comunas.js");
const CACHE_JS = path.join(__dirname, "geocache.json");
const TSV_DEFECTO = path.join(
  process.env.TEMP || process.env.TMP || ".",
  "opencode", "lectura_xlsx", "hoja1_Mapeo_Institucional.tsv"
);

const UA = "mapeo-villavicencio/1.0 (importación de datos institucionales)";
const BBOX = { latMin: 4.0, latMax: 4.3, lngMin: -73.8, lngMax: -73.45 };
const CENTRO_CIUDAD = { lat: 4.142, lng: -73.6266 }; // centro de Villavicencio (app.js)

// Instituciones que ya están en datos.js: no se vuelven a agregar.
const YA_EXISTEN = [
  "comisaria de familia no. 3",
  "comisaria de familia no. 4",
  "comisaria de familia no. 5",
  "hospital departamental de villavicencio"
];

const TIPOS_VALIDOS = [
  "Violencia intrafamiliar", "Violencia sexual", "Maltrato infantil",
  "Violencia de género", "Víctimas del conflicto", "Orientación legal"
];

// ---------- utilidades ----------

function normalizar(txt) {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function leerTSV(ruta) {
  const bruto = fs.readFileSync(ruta, "utf8").replace(/^\uFEFF/, "");
  const lineas = bruto.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
  const cabecera = lineas[0].split("\t").map(normalizar);
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const celdas = lineas[i].split("\t");
    const obj = {};
    cabecera.forEach(function (c, j) { obj[c] = (celdas[j] || "").trim(); });
    filas.push(obj);
  }
  return { cabecera: cabecera, filas: filas };
}

function cargarJs(ruta, variable) {
  const src = fs.readFileSync(ruta, "utf8");
  const sb = {};
  vm.createContext(sb);
  return vm.runInContext(src + "\n;" + variable, sb);
}

function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Un fallo puntual de red no debe abortar toda la importación.
process.on("unhandledRejection", function (e) {
  console.warn("  ! rechazo no manejado: " + (e && e.message ? e.message : e));
});

function dentroDeBbox(lat, lng) {
  return lat >= BBOX.latMin && lat <= BBOX.latMax && lng >= BBOX.lngMin && lng <= BBOX.lngMax;
}

// Centroide del anillo mayor de una feature (mismo criterio que app.js).
function centroideFeature(feature) {
  const geom = feature.geometry;
  const anillos = geom.type === "Polygon"
    ? [geom.coordinates[0]]
    : geom.coordinates.map(function (p) { return p[0]; });
  const mayor = anillos.reduce(function (a, r) { return r.length > a.length ? r : a; }, anillos[0]);
  let sx = 0, sy = 0;
  mayor.forEach(function (p) { sx += p[0]; sy += p[1]; });
  return { lat: sy / mayor.length, lng: sx / mayor.length };
}

// ---------- mapeo de columnas → modelo del mapa ----------

function formaDe(tipo) {
  const t = normalizar(tipo);
  if (t.indexOf("comisaria") !== -1) return "circulo";
  if (t.indexOf("policia") !== -1 || t.indexOf("inspeccion") !== -1) return "triangulo";
  if (t.indexOf("salud") !== -1) return "cuadrado";
  if (t.indexOf("organizacion") !== -1 || t.indexOf("centro integrado") !== -1) return "estrella";
  return "circulo";
}

function nivelDe(tipo) {
  const t = normalizar(tipo);
  if (t.indexOf("comisaria") !== -1) return "Municipal";
  if (t === "policia" || t.indexOf("cai") !== -1) return "Nacional";
  if (t.indexOf("inspeccion") !== -1) return "Municipal";
  if (t.indexOf("salud publica") !== -1) return "Municipal";
  if (t.indexOf("salud privada") !== -1 || t.indexOf("salud mental") !== -1) return "Privado";
  if (t.indexOf("organizacion") !== -1) return "Privado";
  if (t.indexOf("centro integrado") !== -1) return "Municipal";
  return "Municipal";
}

// Tipos de violencia: palabras clave en Institución + Servicios, con
// respaldo por la columna Tipo. Siempre queda al menos un tipo.
function tiposDe(fila) {
  const texto = normalizar(fila["institucion"] + " " + fila["servicios"]);
  const out = [];
  function add(etiqueta) {
    if (out.indexOf(etiqueta) === -1) out.push(etiqueta);
  }
  if (/intrafamiliar|\bvif\b|violencia familiar/.test(texto)) add("Violencia intrafamiliar");
  if (/sexual/.test(texto)) add("Violencia sexual");
  if (/maltrato|ninez|ninos|ninas|infantil|adolescentes|menores|proteccion de derechos/.test(texto)) add("Maltrato infantil");
  if (/genero|mujer|mujeres|femenin|\bvbg\b/.test(texto)) add("Violencia de género");
  if (/conflicto armado|desplazad|victim[aa]s del conflicto|ley 1448/.test(texto)) add("Víctimas del conflicto");
  if (/orientacion|inspeccion|\blegal\b|denuncia/.test(texto)) add("Orientación legal");

  if (!out.length) {
    const t = normalizar(fila["tipo"]);
    const respaldo = {
      "comisaria de familia": ["Violencia intrafamiliar", "Maltrato infantil", "Violencia de género"],
      "policia (cai)": ["Violencia intrafamiliar", "Violencia sexual", "Violencia de género"],
      "policia": ["Violencia intrafamiliar", "Violencia sexual", "Violencia de género"],
      "inspeccion de policia": ["Orientación legal", "Violencia intrafamiliar"],
      "salud publica": ["Violencia sexual", "Violencia intrafamiliar"],
      "salud privada": ["Violencia sexual", "Violencia intrafamiliar"],
      "salud mental": ["Violencia intrafamiliar", "Violencia de género"],
      "organizacion social": ["Violencia de género", "Violencia intrafamiliar"],
      "centro integrado": ["Violencia de género", "Violencia intrafamiliar", "Violencia sexual"]
    };
    (respaldo[t] || ["Violencia intrafamiliar"]).forEach(add);
  }
  return out.filter(function (t) { return TIPOS_VALIDOS.indexOf(t) !== -1; });
}

function es24h(fila) {
  const texto = [fila["institucion"], fila["servicios"], fila["telefono"], fila["email"]].join(" ");
  return /24\s*horas|24\s*\/\s*7|24\s*h\b/i.test(texto);
}

function comunasDe(fila) {
  const c = normalizar(fila["comuna"]);
  if (c === "general") return { comunas: ["todas"], rural: "—", sede: "por verificar" };
  if (c.indexOf("corregimiento") === 0) {
    // Corregimiento 5 (cobertura: comunas 4 y 10, igual que la Comisaría Cuarta).
    return { comunas: ["4", "10"], rural: "Corregimiento 5", sede: "por verificar" };
  }
  const m = c.match(/comuna\s*(\d+)/);
  if (m) return { comunas: [m[1]], rural: "—", sede: m[1] };
  return { comunas: ["todas"], rural: "—", sede: "por verificar" };
}

function telefonoDe(fila) {
  const partes = [fila["telefono"], fila["email"]].filter(function (p) { return p; });
  return partes.length ? partes.join(" · ") : "—";
}

// ¿Está el punto dentro del anillo (ray casting)? Coordenadas [lng, lat].
function puntoEnAnillo(pt, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const xi = anillo[i][0], yi = anillo[i][1];
    const xj = anillo[j][0], yj = anillo[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) {
      dentro = !dentro;
    }
  }
  return dentro;
}

// Número de comuna ("1".."10") que contiene el punto, o "" si está fuera
// del perímetro urbano (mismo criterio que app.js).
function comunaDePunto(geojson, lat, lng) {
  const pt = [lng, lat];
  let encontrada = "";
  geojson.features.some(function (f) {
    const geom = f.geometry;
    const poligonos = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    const dentro = poligonos.some(function (anillos) {
      return anillos.some(function (anillo) { return puntoEnAnillo(pt, anillo); });
    });
    if (dentro) {
      const m = String((f.properties || {}).Comuna || "").match(/(\d+)/);
      encontrada = m ? m[1] : "";
      return true;
    }
    return false;
  });
  return encontrada;
}

// ---------- geocodificación ----------

function crearGeocodificador() {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_JS, "utf8")); } catch (e) { cache = {}; }
  let consultas = 0;

  // Un resultado "Villavicencio, Meta, Colombia" o de tipo ciudad/municipio no
  // sirve: es el punto genérico de la ciudad, no la dirección pedida.
  function esGenerico(res) {
    const dn = String(res.display_name || "");
    if (/^(Villavicencio|Meta|Colombia|RAP\b)/i.test(dn)) return true;
    const t = String(res.addresstype || res.type || "").toLowerCase();
    return ["city", "town", "municipality", "state", "country", "region",
      "county", "province", "district", "administrative"].indexOf(t) !== -1;
  }

  // Consultas a intentar, de más específica a más genérica.
  function construirIntentos(direccion) {
    const limpio = String(direccion).trim();
    const intentos = [
      { clave: "S|" + limpio, params: { street: limpio, city: "Villavicencio", state: "Meta", country: "Colombia" } },
      { clave: limpio + ", Villavicencio, Meta, Colombia", params: { q: limpio + ", Villavicencio, Meta, Colombia" } },
      { clave: limpio + ", Villavicencio, Colombia", params: { q: limpio + ", Villavicencio, Colombia" } }
    ];

    // Nombre del barrio/vereda/lugar: "…, Barrio La Esperanza" → "La Esperanza".
    const lugares = [];
    const mb = limpio.match(/barrio\s+([^,/]+)/i);
    if (mb) lugares.push(mb[1]);
    const segmentos = limpio.split(",");
    if (segmentos.length > 1) {
      lugares.push(segmentos[segmentos.length - 1]
        .replace(/^\s*(barrio|vereda|sector|urb\.?|km\s*\d+)\s+/i, "")
        .trim());
    }
    lugares.forEach(function (lugar) {
      if (!lugar || lugar.length < 3 || /^c(l|alle|ra|arrera)\b/i.test(lugar)) return;
      const clave = lugar + " (lugar), Villavicencio, Meta, Colombia";
      if (intentos.some(function (i) { return i.clave === clave; })) return;
      intentos.push({ clave: clave, params: { q: lugar + ", Villavicencio, Meta, Colombia" } });
    });
    return intentos;
  }

  async function consultar(params) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "co");
    url.searchParams.set("bounded", "1");
    url.searchParams.set("viewbox", BBOX.lngMin + "," + BBOX.latMax + "," + BBOX.lngMax + "," + BBOX.latMin);
    Object.keys(params).forEach(function (k) { url.searchParams.set(k, params[k]); });
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const json = await r.json();
    consultas++;
    return json[0] || null;
  }

  function guardarCache() {
    try { fs.writeFileSync(CACHE_JS, JSON.stringify(cache, null, 1)); } catch (e) { /* caché opcional */ }
  }

  async function geocodificar(direccion, validar) {
    const limpio = String(direccion || "").trim();
    if (!limpio) return null;
    const acepta = typeof validar === "function" ? validar : function () { return true; };

    const intentos = construirIntentos(limpio);
    for (const intento of intentos) {
      let cand = null;
      if (Object.prototype.hasOwnProperty.call(cache, intento.clave)) {
        cand = cache[intento.clave];
      } else {
        let res = null;
        let ok = false;
        for (let reintento = 0; reintento < 2 && !ok; reintento++) {
          try {
            res = await consultar(intento.params);
            ok = true;
          } catch (e) {
            console.warn("  ! Nominatim falló (" + e.message + ") para: " + intento.clave +
              (reintento === 0 ? " — reintento" : ""));
            if (reintento === 0) await dormir(3000);
          }
        }
        await dormir(1100); // política de uso: máximo 1 consulta por segundo

        if (!ok) continue; // error de red: no se cachea, se reintenta en la próxima corrida
        cand = res && dentroDeBbox(Number(res.lat), Number(res.lon)) && !esGenerico(res)
          ? { lat: Number(res.lat), lng: Number(res.lon), detalle: res.display_name }
          : null; // sin resultado o inútil: no repetir la misma consulta
        cache[intento.clave] = cand;
        guardarCache();
      }
      // Se devuelve el primer candidato que además pasa la validación del
      // llamador (p. ej.: cae dentro de la comuna que declara la fila).
      if (cand && acepta(cand)) {
        return { lat: cand.lat, lng: cand.lng, fuente: "geocodificado", detalle: cand.detalle };
      }
    }
    return null;
  }

  return { geocodificar: geocodificar, consultas: function () { return consultas; } };
}

// ---------- construcción de las entidades ----------

function entidadNueva(fila, id, coords, cobertura) {
  const conDireccion = !!fila["direccion"];
  const nueva = {
    id: id,
    nombre: fila["institucion"],
    tipos: tiposDe(fila),
    tiposDetalle: fila["servicios"] || "—",
    comunas: cobertura.comunas,
    comunaSede: cobertura.sede,
    rural: cobertura.rural,
    direccion: conDireccion ? fila["direccion"] : "",
    horario: es24h(fila) ? "24 horas, todos los días (incluye festivos)" : "Por definir",
    telefono: telefonoDe(fila),
    nivel: nivelDe(fila["tipo"]),
    es24h: es24h(fila),
    verificado: conDireccion ? "parcialmente verificado" : "por verificar",
    forma: formaDe(fila["tipo"]),
    lat: coords.lat,
    lng: coords.lng,
    ubicacionAprox: true
  };
  if (!conDireccion) nueva.sinDireccion = true;
  return nueva;
}

function serializar(entidad) {
  const orden = [
    "id", "nombre", "tipos", "tiposDetalle", "comunas", "comunaSede", "rural",
    "direccion", "horario", "telefono", "nivel", "es24h", "verificado", "forma",
    "lat", "lng", "ubicacionAprox", "sinDireccion"
  ];
  const lineas = ["  {"];
  orden.forEach(function (k) {
    if (!(k in entidad)) return;
    const v = entidad[k];
    let txt;
    if (typeof v === "number") txt = String(v);
    else if (typeof v === "boolean") txt = String(v);
    else if (Array.isArray(v)) txt = "[" + v.map(function (s) { return JSON.stringify(s); }).join(", ") + "]";
    else txt = JSON.stringify(v);
    lineas.push("    " + k + ": " + txt + ",");
  });
  // última línea sin coma final
  const ultima = lineas[lineas.length - 1].replace(/,$/, "");
  lineas[lineas.length - 1] = ultima;
  lineas.push("  }");
  return lineas.join("\n");
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const dry = args.indexOf("--dry") !== -1;
  const rutaTsv = args.filter(function (a) { return a.indexOf("--") !== 0; })[0] || TSV_DEFECTO;
  if (!fs.existsSync(rutaTsv)) {
    console.error("No existe el TSV: " + rutaTsv);
    console.error("Genérelo desde el XLSX o pase la ruta como argumento.");
    process.exit(1);
  }

  const { cabecera, filas } = leerTSV(rutaTsv);
  console.log("TSV: " + rutaTsv);
  console.log("Columnas: " + cabecera.join(", "));
  console.log("Filas de datos: " + filas.length);

  const existentes = cargarJs(DATOS_JS, "INSTITUCIONES");
  const nombresExistentes = {};
  existentes.forEach(function (i) { nombresExistentes[normalizar(i.nombre)] = true; });
  let siguienteId = existentes.reduce(function (m, i) { return Math.max(m, Number(i.id) || 0); }, 0) + 1;
  console.log("Entidades actuales en datos.js: " + existentes.length + " | primer id nuevo: " + siguienteId);

  const geojson = cargarJs(COMUNAS_JS, "COMUNAS_GEOJSON");
  const centroides = {};
  geojson.features.forEach(function (f) {
    const props = f.properties || {};
    const etiqueta = String(props.Comuna || props.comuna || props.n || props.numero || "");
    const m = etiqueta.match(/(\d+)/);
    const clave = m ? m[1] : etiqueta.trim();
    if (clave) centroides[clave] = centroideFeature(f);
  });
  if (!Object.keys(centroides).length) {
    // Sin etiquetas reconocibles: indexar por orden de aparición 1..10.
    geojson.features.forEach(function (f, i) { centroides[String(i + 1)] = centroideFeature(f); });
  }

  const geocod = crearGeocodificador();
  const nuevas = [];
  const informe = [];
  const usosPorCentroide = {};

  for (const fila of filas) {
    const nombre = fila["institucion"];
    if (!nombre) continue;
    if (YA_EXISTEN.indexOf(normalizar(nombre)) !== -1 || nombresExistentes[normalizar(nombre)]) {
      informe.push({ nombre: nombre, accion: "omitida (ya existe)" });
      continue;
    }

    const cobertura = comunasDe(fila);
    const esRural = cobertura.rural !== "—";
    let coords = null;
    let fuente = "";
    let nota = "";

    if (fila["direccion"]) {
      // Un candidato solo sirve si cae dentro del perímetro urbano y en la
      // comuna que declara la fila (las filas rurales se aceptan tal cual).
      function sirve(cand) {
        const comuna = comunaDePunto(geojson, cand.lat, cand.lng);
        return esRural || (!!comuna &&
          (cobertura.comunas[0] === "todas" || cobertura.comunas.indexOf(comuna) !== -1));
      }
      coords = await geocod.geocodificar(fila["direccion"], sirve);
      if (coords) {
        const comuna = comunaDePunto(geojson, coords.lat, coords.lng);
        fuente = "geocodificado (comuna " + (comuna || "?") + ")";
      }
    }
    if (!coords) {
      const ref = centroides[cobertura.comunas[0]] || (cobertura.comunas[0] === "todas" ? CENTRO_CIUDAD : null);
      coords = ref || CENTRO_CIUDAD;
      fuente = "centroide comuna " + (cobertura.comunas[0] === "todas" ? "(ciudad)" : cobertura.comunas[0]) + nota;
      // Varias instituciones sin dirección caen en el mismo centroide: se
      // separan en un círculo pequeño (radio ~350 m) para que no se apilen.
      const clave = coords.lat + "," + coords.lng;
      const n = usosPorCentroide[clave] || 0;
      usosPorCentroide[clave] = n + 1;
      if (n > 0) {
        const angulo = n * 2.39996; // ángulo áureo: reparte los puntos parejo
        coords = {
          lat: coords.lat + 0.0032 * Math.sin(angulo),
          lng: coords.lng + 0.0032 * Math.cos(angulo)
        };
      }
    }

    const entidad = entidadNueva(fila, siguienteId++, {
      lat: Math.round(coords.lat * 1e6) / 1e6,
      lng: Math.round(coords.lng * 1e6) / 1e6
    }, cobertura);
    nuevas.push(entidad);
    nombresExistentes[normalizar(nombre)] = true;
    informe.push({ nombre: nombre, accion: "agregada id " + entidad.id, fuente: fuente, lat: entidad.lat, lng: entidad.lng, es24h: entidad.es24h });
  }

  // Insertar antes del "]" que cierra INSTITUCIONES.
  const fuente = fs.readFileSync(DATOS_JS, "utf8");
  const inicio = fuente.indexOf("const INSTITUCIONES = [");
  if (inicio < 0) throw new Error("No se encontró INSTITUCIONES en datos.js");
  const cierre = fuente.indexOf("\n];", inicio);
  if (cierre < 0) throw new Error("No se encontró el cierre de INSTITUCIONES");

  if (dry) {
    console.log("\n[DRY] datos.js NO se modificó.");
  } else {
    const bloque = ",\n" + nuevas.map(serializar).join(",\n") + "\n";
    const salida = fuente.slice(0, cierre) + bloque + fuente.slice(cierre);
    fs.writeFileSync(DATOS_JS, salida, "utf8");
    console.log("\n datos.js actualizado: +" + nuevas.length + " entidades.");
  }

  // Validación: mismo criterio que validarPunto_ del backend + reglas del mapa.
  const total = existentes.concat(nuevas);
  const errores = [];
  const ids = {};
  total.forEach(function (p) {
    const donde = "#" + p.id + " " + p.nombre;
    if (!p.nombre) errores.push(donde + ": sin nombre");
    if (["circulo", "cuadrado", "triangulo", "estrella", "rombo"].indexOf(p.forma) < 0) errores.push(donde + ": forma inválida");
    if (!(typeof p.lat === "number" && typeof p.lng === "number")) errores.push(donde + ": lat/lng no numéricos");
    else if (!dentroDeBbox(p.lat, p.lng)) errores.push(donde + ": fuera del bbox (" + p.lat + ", " + p.lng + ")");
    if (!Array.isArray(p.comunas) || !p.comunas.length) errores.push(donde + ": sin comunas");
    if (!Array.isArray(p.tipos) || !p.tipos.length) errores.push(donde + ": sin tipos");
    if (ids[p.id]) errores.push(donde + ": id duplicado");
    ids[p.id] = true;
  });
  if (errores.length) {
    console.error("\nERRORES DE VALIDACIÓN:");
    errores.forEach(function (e) { console.error("  - " + e); });
    process.exit(2);
  }
  console.log("\nValidación OK: " + total.length + " entidades, sin duplicados y todas dentro del bbox.");

  console.log("\n--- Informe ---");  informe.forEach(function (r) {
    if (r.accion.indexOf("omitida") === 0) {
      console.log("  = " + r.nombre + " → " + r.accion);
    } else {
      console.log("  + " + r.nombre + " → " + r.accion + " | " + r.fuente +
        (r.es24h ? " | 24h" : "") + " | " + r.lat + ", " + r.lng);
    }
  });
  console.log("\nAgregadas: " + nuevas.length + " | omitidas: " +
    informe.filter(function (r) { return r.accion.indexOf("omitida") === 0; }).length +
    " | consultas Nominatim: " + geocod.consultas());
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
