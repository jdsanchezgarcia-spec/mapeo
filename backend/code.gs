/*************************************************************************
 * Mapeo de instituciones de atención a víctimas — Villavicencio (Meta)
 * Backend en Google Apps Script + Google Sheets.
 *
 * HOJAS DEL LIBRO (se crean con setup()):
 *   - Usuarios:       usuario | hash | salt | rol | activo | debeCambiar
 *   - Instituciones:  una fila por punto del mapa (ver COLUMNAS abajo)
 *
 * DESPLIEGUE:
 *   1) En el editor de Apps Script, ejecutar setup() una sola vez
 *      (crea las hojas, el usuario admin inicial y los 15 puntos de ejemplo).
 *   2) Implementar > Nueva implementacion > Aplicacion web:
 *      ejecutar como "Yo" y acceso "Cualquier persona".
 *   3) Copiar la URL /exec en renderer/js/config.js (API_URL) de la app.
 *
 * SEGURIDAD:
 *   - Las contrasenas NUNCA se guardan en claro: SHA-256 con salt.
 *   - Las acciones de escritura exigen un token de sesion (8 h, CacheService).
 *   - La lectura de instituciones es publica (el mapa es de consulta abierta).
 *************************************************************************/

var SHEET_USUARIOS = "Usuarios";
var SHEET_INSTITUCIONES = "Instituciones";
var TOKEN_TTL_SEGUNDOS = 8 * 3600;
var CLAVE_ADMIN_INICIAL = "admin123";

var COLUMNAS = [
  "id", "nombre", "forma", "color", "logo",
  "comunas", "comunaSede", "rural", "direccion", "horario", "telefono",
  "tipos", "tiposDetalle", "nivel", "es24h", "verificado",
  "lat", "lng", "ubicacionAprox", "sinDireccion",
  "creadoPor", "fecha"
];

var COLOR_POR_FORMA = {
  circulo: "#F97316",
  cuadrado: "#2563EB",
  triangulo: "#DC2626",
  estrella: "#9333EA",
  rombo: "#0D9488"
};

/*************************************************************************
 * SETUP — ejecutar UNA VEZ desde el editor de Apps Script
 *************************************************************************/
function setup() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();

  var hojaUsuarios = libro.getSheetByName(SHEET_USUARIOS);
  if (!hojaUsuarios) {
    hojaUsuarios = libro.insertSheet(SHEET_USUARIOS);
    hojaUsuarios.appendRow(["usuario", "hash", "salt", "rol", "activo", "debeCambiar"]);
  }
  if (hojaUsuarios.getLastRow() < 2) {
    var salt = nuevoSalt_();
    hojaUsuarios.appendRow(["admin", hashClave_(CLAVE_ADMIN_INICIAL, salt), salt, "admin", "SI", "SI"]);
  }

  var hojaInst = libro.getSheetByName(SHEET_INSTITUCIONES);
  if (!hojaInst) {
    hojaInst = libro.insertSheet(SHEET_INSTITUCIONES);
    hojaInst.appendRow(COLUMNAS);
  }
  if (hojaInst.getLastRow() < 2) {
    seed_(hojaInst);
  }
}

// Datos iniciales: las 15 instituciones con las que nacio el proyecto.
function seed_(hoja) {
  var filas = SEED_INSTITUCIONES.map(function (i) {
    return [
      i.id, i.nombre, i.forma, COLOR_POR_FORMA[i.forma] || "", "",
      (i.comunas || []).join(";"), i.comunaSede || "", i.rural || "—",
      i.direccion || "—", i.horario || "—", i.telefono || "—",
      (i.tipos || []).join(";"), i.tiposDetalle || "—", i.nivel || "—",
      i.es24h ? "TRUE" : "FALSE", i.verificado || "por verificar",
      i.lat, i.lng, i.ubicacionAprox ? "TRUE" : "FALSE",
      i.sinDireccion ? "TRUE" : "FALSE",
      "seed", new Date().toISOString()
    ];
  });
  if (filas.length) {
    hoja.getRange(2, 1, filas.length, COLUMNAS.length).setValues(filas);
  }
}

/*************************************************************************
 * PUNTO DE ENTRADA WEB
 *************************************************************************/
function doGet(e) {
  var accion = (e && e.parameter && e.parameter.action) || "";
  if (accion === "instituciones") {
    return respuesta_({ ok: true, instituciones: listarInstituciones_() });
  }
  return respuesta_({ ok: false, error: "Accion GET no reconocida. Use ?action=instituciones" });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respuesta_({ ok: false, error: "Cuerpo JSON invalido." });
  }
  try {
    switch (body.action) {
      case "login":
        return respuesta_(login_(body.usuario, body.clave));
      case "cambiarClave":
        return respuesta_(cambiarClave_(body.token, body.nuevaClave));
      case "crear":
        return respuesta_(crear_(body.token, body.punto));
      case "editar":
        return respuesta_(editar_(body.token, body.punto));
      case "eliminar":
        return respuesta_(eliminar_(body.token, body.id));
      default:
        return respuesta_({ ok: false, error: "Accion no reconocida." });
    }
  } catch (err) {
    return respuesta_({ ok: false, error: "Error del servidor: " + err.message });
  }
}

/*************************************************************************
 * AUTENTICACION
 *************************************************************************/
function login_(usuario, clave) {
  if (!usuario || !clave) return { ok: false, error: "Usuario y contrasena requeridos." };

  var hoja = hoja_(SHEET_USUARIOS);
  var datos = hoja.getDataRange().getValues();
  for (var f = 1; f < datos.length; f++) {
    var fila = datos[f];
    if (String(fila[0]) !== String(usuario)) continue;
    if (String(fila[4]) !== "SI") return { ok: false, error: "Usuario inactivo." };

    var esperado = String(fila[1]);
    var salt = String(fila[2]);
    if (hashClave_(clave, salt) !== esperado) {
      return { ok: false, error: "Usuario o contrasena incorrectos." };
    }

    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(claveToken_(token), String(usuario), TOKEN_TTL_SEGUNDOS);
    return {
      ok: true,
      token: token,
      usuario: String(usuario),
      rol: String(fila[3]),
      debeCambiarClave: String(fila[5]) === "SI"
    };
  }
  return { ok: false, error: "Usuario o contrasena incorrectos." };
}

function cambiarClave_(token, nuevaClave) {
  var usuario = validarToken_(token);
  if (!usuario) return { ok: false, error: "Sesion invalida o vencida." };
  if (!nuevaClave || String(nuevaClave).length < 6) {
    return { ok: false, error: "La nueva contrasena debe tener al menos 6 caracteres." };
  }

  var hoja = hoja_(SHEET_USUARIOS);
  var datos = hoja.getDataRange().getValues();
  for (var f = 1; f < datos.length; f++) {
    if (String(datos[f][0]) === usuario) {
      var salt = nuevoSalt_();
      hoja.getRange(f + 1, 2, 1, 3).setValues([[hashClave_(nuevaClave, salt), salt, "NO"]]);
      return { ok: true };
    }
  }
  return { ok: false, error: "Usuario no encontrado." };
}

function validarToken_(token) {
  if (!token) return null;
  var usuario = CacheService.getScriptCache().get(claveToken_(token));
  return usuario || null;
}

function claveToken_(token) { return "tk_" + token; }

function hashClave_(clave, salt) {
  var crudo = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + "|" + clave,
    Utilities.Charset.UTF_8
  );
  return crudo.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function nuevoSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

/*************************************************************************
 * CRUD DE INSTITUCIONES
 *************************************************************************/
function listarInstituciones_() {
  var hoja = hoja_(SHEET_INSTITUCIONES);
  var valores = hoja.getDataRange().getValues();
  var lista = [];
  for (var f = 1; f < valores.length; f++) {
    if (!valores[f][0]) continue;
    lista.push(filaAObjeto_(valores[f]));
  }
  return lista;
}

function crear_(token, punto) {
  var usuario = validarToken_(token);
  if (!usuario) return { ok: false, error: "Sesion invalida o vencida. Vuelva a iniciar sesion." };

  var validado = validarPunto_(punto);
  if (validado.error) return { ok: false, error: validado.error };
  punto = validado.punto;

  var hoja = hoja_(SHEET_INSTITUCIONES);
  var id = siguienteId_(hoja);
  punto.id = id;

  hoja.appendRow(objetoAFila_(punto, usuario));
  return { ok: true, id: id };
}

function editar_(token, punto) {
  var usuario = validarToken_(token);
  if (!usuario) return { ok: false, error: "Sesion invalida o vencida. Vuelva a iniciar sesion." };
  if (!punto || !punto.id) return { ok: false, error: "Falta el id del punto a editar." };

  var validado = validarPunto_(punto);
  if (validado.error) return { ok: false, error: validado.error };
  punto = validado.punto;

  var hoja = hoja_(SHEET_INSTITUCIONES);
  var valores = hoja.getDataRange().getValues();
  for (var f = 1; f < valores.length; f++) {
    if (String(valores[f][0]) === String(punto.id)) {
      var filaExistente = filaAObjeto_(valores[f]);
      punto.logo = punto.logo || filaExistente.logo || ""; // no borrar logo si va vacio
      punto.sinDireccion = punto.sinDireccion || filaExistente.sinDireccion; // el form no lo envia
      hoja.getRange(f + 1, 1, 1, COLUMNAS.length).setValues([objetoAFila_(punto, filaExistente.creadoPor || usuario)]);
      return { ok: true, id: punto.id };
    }
  }
  return { ok: false, error: "No existe un punto con id " + punto.id + "." };
}

function eliminar_(token, id) {
  var usuario = validarToken_(token);
  if (!usuario) return { ok: false, error: "Sesion invalida o vencida. Vuelva a iniciar sesion." };
  if (!id) return { ok: false, error: "Falta el id del punto a eliminar." };

  var hoja = hoja_(SHEET_INSTITUCIONES);
  var valores = hoja.getDataRange().getValues();
  for (var f = 1; f < valores.length; f++) {
    if (String(valores[f][0]) === String(id)) {
      hoja.deleteRow(f + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "No existe un punto con id " + id + "." };
}

/*************************************************************************
 * VALIDACION Y CONVERSION
 *************************************************************************/
function validarPunto_(p) {
  if (!p || typeof p !== "object") return { error: "Datos del punto invalidos." };
  if (!p.nombre || !String(p.nombre).trim()) return { error: "El nombre es obligatorio." };
  if (!COLOR_POR_FORMA[p.forma]) return { error: "La categoria/forma del icono no es valida." };

  var lat = Number(p.lat);
  var lng = Number(p.lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: "Latitud/longitud invalidas." };
  }

  var comunas = Array.isArray(p.comunas) ? p.comunas.map(String) : [];
  if (!comunas.length) return { error: "Debe indicar al menos una comuna (o «todas»)." };
  var tipos = Array.isArray(p.tipos) ? p.tipos.map(String) : [];
  if (!tipos.length) return { error: "Debe indicar al menos un tipo de violencia que atiende." };

  var logo = p.logo ? String(p.logo) : "";
  if (logo.length > 49000) return { error: "El logo es demasiado grande (maximo ~35 KB en base64)." };

  return {
    error: null,
    punto: {
      id: p.id ? Number(p.id) : null,
      nombre: String(p.nombre).trim().substring(0, 200),
      forma: p.forma,
      color: COLOR_POR_FORMA[p.forma],
      logo: logo,
      comunas: comunas,
      comunaSede: p.comunaSede ? String(p.comunaSede) : "por verificar",
      rural: p.rural ? String(p.rural) : "—",
      direccion: p.direccion ? String(p.direccion).substring(0, 500) : "—",
      horario: p.horario ? String(p.horario).substring(0, 300) : "—",
      telefono: p.telefono ? String(p.telefono).substring(0, 200) : "—",
      tipos: tipos,
      tiposDetalle: p.tiposDetalle ? String(p.tiposDetalle).substring(0, 1000) : "—",
      nivel: p.nivel ? String(p.nivel) : "Municipal",
      es24h: !!p.es24h,
      verificado: p.verificado ? String(p.verificado) : "por verificar",
      lat: lat,
      lng: lng,
      ubicacionAprox: !!p.ubicacionAprox,
      sinDireccion: !!p.sinDireccion
    }
  };
}

// Google Sheets devuelve TRUE/FALSE como booleano (true) o como texto ("TRUE"/"SI"):
// se normaliza todo a booleano estricto.
function esVerdadero_(v) {
  if (v === true) return true;
  var s = String(v).toLowerCase().trim();
  return s === "true" || s === "si" || s === "1" || s === "sí";
}

function filaAObjeto_(fila) {
  return {
    id: Number(fila[0]),
    nombre: String(fila[1]),
    forma: String(fila[2]),
    color: String(fila[3] || ""),
    logo: String(fila[4] || ""),
    comunas: String(fila[5] || "").split(";").filter(function (x) { return x !== ""; }),
    comunaSede: String(fila[6] || ""),
    rural: String(fila[7] || ""),
    direccion: String(fila[8] || ""),
    horario: String(fila[9] || ""),
    telefono: String(fila[10] || ""),
    tipos: String(fila[11] || "").split(";").filter(function (x) { return x !== ""; }),
    tiposDetalle: String(fila[12] || ""),
    nivel: String(fila[13] || ""),
    es24h: esVerdadero_(fila[14]),
    verificado: String(fila[15] || ""),
    lat: Number(fila[16]),
    lng: Number(fila[17]),
    ubicacionAprox: esVerdadero_(fila[18]),
    sinDireccion: esVerdadero_(fila[19])
  };
}

// Devuelve UNA FILA (array 1D de 22 columnas), lista para appendRow(...) o setValues([[...]]).
function objetoAFila_(p, creadoPor) {
  return [
    p.id, p.nombre, p.forma, p.color, p.logo,
    p.comunas.join(";"), p.comunaSede, p.rural, p.direccion, p.horario, p.telefono,
    p.tipos.join(";"), p.tiposDetalle, p.nivel, p.es24h ? "TRUE" : "FALSE", p.verificado,
    p.lat, p.lng, p.ubicacionAprox ? "TRUE" : "FALSE", p.sinDireccion ? "TRUE" : "FALSE",
    creadoPor || "", new Date().toISOString()
  ];
}

function siguienteId_(hoja) {
  var valores = hoja.getDataRange().getValues();
  var max = 0;
  for (var f = 1; f < valores.length; f++) {
    var n = Number(valores[f][0]);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/*************************************************************************
 * AYUDAS
 *************************************************************************/
function hoja_(nombre) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!hoja) throw new Error("No existe la hoja '" + nombre + "'. Ejecute setup().");
  return hoja;
}

function respuesta_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Uso manual desde el editor (opcional): crear usuarios adicionales.
// Ejemplo: agregarUsuario("operador1", "miClaveSegura", "admin");
function agregarUsuario(usuario, clave, rol) {
  if (!usuario || !clave || String(clave).length < 6) {
    throw new Error("Usuario requerido y clave de minimo 6 caracteres.");
  }
  var hoja = hoja_(SHEET_USUARIOS);
  var datos = hoja.getDataRange().getValues();
  for (var f = 1; f < datos.length; f++) {
    if (String(datos[f][0]) === String(usuario)) throw new Error("El usuario ya existe.");
  }
  var salt = nuevoSalt_();
  hoja.appendRow([usuario, hashClave_(clave, salt), salt, rol || "admin", "SI", "NO"]);
}

/*************************************************************************
 * DATOS INICIALES (seed) — las 15 instituciones del mapa original
 *************************************************************************/
var SEED_INSTITUCIONES = [
  { id: 1, nombre: "Comisaría de Familia Primera", tipos: ["Violencia intrafamiliar", "Maltrato infantil", "Violencia de género"], tiposDetalle: "Violencia intrafamiliar (VIF); maltrato infantil; violencia contra la mujer; restablecimiento de derechos de NNA y adultos mayores", comunas: ["5", "6"], comunaSede: "por verificar", rural: "Corregimiento 2 (14 veredas)", direccion: "Barrio Teusaca, Calle 23 No. 37 L-14 (sede histórica reportada — VERIFICAR sede actual)", horario: "Lunes a viernes, jornada de oficina (verificar horario exacto en Secretaría de Gobierno)", telefono: "(608) 6719462", nivel: "Municipal", es24h: false, verificado: "por verificar", forma: "circulo", lat: 4.1371, lng: -73.6350, ubicacionAprox: true },
  { id: 2, nombre: "Comisaría de Familia Segunda", tipos: ["Violencia intrafamiliar", "Maltrato infantil", "Violencia de género"], tiposDetalle: "Violencia intrafamiliar (VIF); maltrato infantil; violencia contra la mujer; restablecimiento de derechos", comunas: ["8", "9"], comunaSede: "por verificar", rural: "Corregimiento 1 (10 veredas)", direccion: "Calle 54 Sur No. 39-59, Ciudad Porfía (sede compartida Casa de Justicia)", horario: "Lunes a viernes 8:00 a.m. – 5:00 p.m.", telefono: "(608) 6707160", nivel: "Municipal", es24h: false, verificado: "verificado", forma: "circulo", lat: 4.0787, lng: -73.6720, ubicacionAprox: true },
  { id: 3, nombre: "Comisaría de Familia Tercera", tipos: ["Violencia intrafamiliar", "Maltrato infantil", "Violencia de género"], tiposDetalle: "Violencia intrafamiliar (VIF); maltrato infantil; violencia contra la mujer; restablecimiento de derechos", comunas: ["1", "2", "3", "7"], comunaSede: "por verificar", rural: "Corregimientos 3 y 4 (14 veredas)", direccion: "Calle 34 No. 40-07, Barzal Alto (sede histórica reportada — VERIFICAR sede actual)", horario: "Lunes a viernes, jornada de oficina (verificar horario exacto)", telefono: "(608) 6730674", nivel: "Municipal", es24h: false, verificado: "por verificar", forma: "circulo", lat: 4.1320, lng: -73.6360, ubicacionAprox: true },
  { id: 4, nombre: "Comisaría de Familia Cuarta (única 24 horas)", tipos: ["Violencia intrafamiliar", "Maltrato infantil", "Violencia de género", "Violencia sexual"], tiposDetalle: "Violencia intrafamiliar (VIF); maltrato infantil; violencia contra la mujer; violencia sexual (componente de protección); atención urbana y rural permanente", comunas: ["4", "10"], comunaSede: "La Grama", rural: "Corregimientos 5, 6 y 7 (26 veredas)", direccion: "Carrera 30 No. 41-49, Barrio La Grama", horario: "24 horas, todos los días (incluye fines de semana y festivos)", telefono: "comisariadefamilia4@villavicencio.gov.co", nivel: "Municipal", es24h: true, verificado: "verificado", forma: "circulo", lat: 4.1576, lng: -73.6383, ubicacionAprox: true },
  { id: 5, nombre: "Comisaría de Familia Quinta (nueva)", tipos: ["Violencia intrafamiliar", "Maltrato infantil", "Violencia de género"], tiposDetalle: "Violencia intrafamiliar (VIF); maltrato infantil; violencia contra la mujer; restablecimiento de derechos", comunas: ["7"], comunaSede: "7", rural: "—", direccion: "Comuna 7 — dirección exacta POR CONFIRMAR (creada por Acuerdo 037 de 2025, en operación desde octubre de 2025; refuerza la cobertura y descongestiona la Cuarta)", horario: "Por definir", telefono: "—", nivel: "Municipal", es24h: false, verificado: "en implementación", forma: "circulo", lat: 4.1525, lng: -73.6395, ubicacionAprox: true, sinDireccion: true },
  { id: 6, nombre: "Casa de Justicia de Villavicencio", tipos: ["Orientación legal", "Violencia intrafamiliar", "Violencia de género"], tiposDetalle: "Orientación legal y acceso a la justicia en VIF y VBG; conciliación; justicia restaurativa; atención interinstitucional (Fiscalía, ICBF, Inspecciones, Comisaría de Familia)", comunas: ["todas"], comunaSede: "sur (Ciudad Porfía)", rural: "—", direccion: "Calle 54 Sur No. 39-59, Ciudad Porfía", horario: "Lunes a viernes 8:00 a.m. – 5:00 p.m. (jornada continua)", telefono: "(608) 6704931", nivel: "Municipal/Nacional", es24h: false, verificado: "verificado", forma: "rombo", lat: 4.0782, lng: -73.6705, ubicacionAprox: true },
  { id: 7, nombre: "ICBF Centro Zonal Villavicencio Dos (Especializado en Protección)", tipos: ["Maltrato infantil"], tiposDetalle: "Maltrato infantil y vulneración de derechos de niños, niñas y adolescentes", comunas: ["todas"], comunaSede: "centro (Doña Luz)", rural: "Sí", direccion: "Carrera 22 No. 10-73/89, Barrio Doña Luz", horario: "Lunes a viernes 8:00 a.m. – 5:00 p.m. (jornada continua)", telefono: "Línea 141 / (601) 4377630 ext. 850034", nivel: "Nacional", es24h: false, verificado: "verificado", forma: "estrella", lat: 4.1167, lng: -73.6071, ubicacionAprox: true },
  { id: 8, nombre: "Dirección de Atención Integral a Víctimas — Alcaldía de Villavicencio", tipos: ["Víctimas del conflicto"], tiposDetalle: "Víctimas del conflicto armado: atención, asistencia y reparación integral (Ley 1448 de 2011); articulación de rutas", comunas: ["todas"], comunaSede: "centro", rural: "Sí (7 corregimientos)", direccion: "Calle 40 No. 33-64, Centro (Edificio Alcaldía)", horario: "Lunes a viernes desde 7:45 a.m. (horario institucional de la Alcaldía)", telefono: "—", nivel: "Municipal", es24h: false, verificado: "verificado", forma: "estrella", lat: 4.1525, lng: -73.6398, ubicacionAprox: true },
  { id: 9, nombre: "Centro Regional de Atención a Víctimas (CRAV) — Unidad para las Víctimas", tipos: ["Víctimas del conflicto"], tiposDetalle: "Víctimas del conflicto armado: orientación, registro en el RUV, ayudas humanitarias y reparación", comunas: ["todas"], comunaSede: "centro", rural: "Sí", direccion: "Carrera 13, centro de Villavicencio", horario: "Jornadas de atención institucional (4.º miércoles de cada mes, 7:00 a.m. – 1:00 p.m.); atención telefónica nacional L-V 8:00 a.m. – 6:00 p.m.", telefono: "01 8000 12 25 20", nivel: "Nacional", es24h: false, verificado: "verificado", forma: "estrella", lat: 4.1530, lng: -73.6420, ubicacionAprox: true },
  { id: 10, nombre: "Hospital Departamental de Villavicencio E.S.E.", tipos: ["Violencia sexual", "Violencia intrafamiliar"], tiposDetalle: "Violencia sexual (urgencia médica 24h, kit de evidencia, cadena de custodia, IVE, profilaxis); violencia física y VIF (atención en salud, parte de lesiones)", comunas: ["todas"], comunaSede: "centro (Barzal Alto)", rural: "Sí", direccion: "Calle 37A No. 28-53, Barrio Barzal Alto", horario: "Urgencias 24 horas (la violencia sexual es urgencia prioritaria y gratuita)", telefono: "(608) 6817901 / 1800 0930606", nivel: "Departamental", es24h: true, verificado: "verificado", forma: "cuadrado", lat: 4.1310, lng: -73.6370, ubicacionAprox: true },
  { id: 11, nombre: "Fiscalía General de la Nación — URI Villavicencio", tipos: ["Violencia sexual", "Violencia de género", "Violencia intrafamiliar", "Víctimas del conflicto"], tiposDetalle: "Violencia sexual; violencia de género e intrafamiliar (delitos); feminicidio; delitos contra víctimas del conflicto", comunas: ["todas"], comunaSede: "centro", rural: "Sí", direccion: "Unidad de Reacción Inmediata (URI), sede centro (confirmar dirección exacta)", horario: "URI: 24 horas, 7 días a la semana", telefono: "Línea 122 / ADenunciar virtual 24h", nivel: "Nacional", es24h: true, verificado: "parcialmente verificado", forma: "triangulo", lat: 4.1510, lng: -73.6410, ubicacionAprox: true },
  { id: 12, nombre: "Policía Nacional — Estaciones y CAI", tipos: ["Violencia intrafamiliar", "Violencia sexual", "Violencia de género"], tiposDetalle: "Denuncia inmediata de VIF, violencia sexual y delitos; protección y primeros auxilios jurídicos", comunas: ["todas"], comunaSede: "varias", rural: "Sí", direccion: "Estaciones y CAI distribuidos por toda la ciudad (ubicar el más cercano por comuna)", horario: "24 horas", telefono: "Línea 123", nivel: "Nacional", es24h: true, verificado: "verificado", forma: "triangulo", lat: 4.1520, lng: -73.6380, ubicacionAprox: true, sinDireccion: true },
  { id: 13, nombre: "Instituto de Medicina Legal y Ciencias Forenses — Seccional Meta", tipos: ["Violencia sexual", "Violencia intrafamiliar"], tiposDetalle: "Peritajes médico-legales en violencia sexual, VIF y lesiones personales (evidencia forense)", comunas: ["todas"], comunaSede: "centro", rural: "Parcial", direccion: "Villavicencio, centro (confirmar dirección exacta de la sede)", horario: "Lunes a viernes, jornada continua (guardia para urgencias — confirmar)", telefono: "(608) — confirmar", nivel: "Nacional", es24h: false, verificado: "por verificar", forma: "rombo", lat: 4.1500, lng: -73.6430, ubicacionAprox: true },
  { id: 14, nombre: "Personería Municipal de Villavicencio", tipos: ["Orientación legal"], tiposDetalle: "Defensa y promoción de derechos humanos; control a la administración; acompañamiento a víctimas de violencias", comunas: ["todas"], comunaSede: "centro", rural: "Sí", direccion: "Centro administrativo municipal (confirmar piso/oficina)", horario: "Lunes a viernes, jornada de oficina", telefono: "(608) — confirmar", nivel: "Municipal", es24h: false, verificado: "por verificar", forma: "rombo", lat: 4.1515, lng: -73.6405, ubicacionAprox: true },
  { id: 15, nombre: "Defensoría del Pueblo — Delegada Meta", tipos: ["Orientación legal", "Víctimas del conflicto"], tiposDetalle: "Defensa de derechos humanos y de víctimas de violencias; orientación jurídica gratuita", comunas: ["todas"], comunaSede: "centro", rural: "Sí", direccion: "Villavicencio, centro (confirmar dirección exacta)", horario: "Lunes a viernes, jornada de oficina", telefono: "01 8000 914 814", nivel: "Nacional", es24h: false, verificado: "por verificar", forma: "rombo", lat: 4.1535, lng: -73.6370, ubicacionAprox: true }
];
