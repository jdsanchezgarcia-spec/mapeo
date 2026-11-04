// Exportación de las entidades del mapa a un archivo Excel (.xlsx) real, sin
// librerías externas. Genera un libro OOXML empaquetado en un ZIP "store" (sin
// compresión), formato que Excel, LibreOffice y Google Sheets abren sin avisos.
const ExportXLSX = (function () {
  "use strict";

  var MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  // Nombre visible de cada categoría de marcador (mismo criterio de la leyenda).
  var CATEGORIAS = {
    circulo: "Comisaría de Familia",
    cuadrado: "Salud — IPS / Hospital",
    triangulo: "Justicia penal (Fiscalía, Policía)",
    estrella: "Enfoque diferencial (ICBF, CRAV, DAIV)",
    rombo: "Defensorías (Personería, Medicina Legal, Casa de Justicia)"
  };

  // Columnas del archivo: título (t) y ancho en caracteres (w).
  var COLUMNAS = [
    { t: "ID", w: 6 },
    { t: "Institución", w: 40 },
    { t: "Categoría", w: 30 },
    { t: "Tipos de violencia", w: 32 },
    { t: "Qué atiende", w: 55 },
    { t: "Comunas que cubre", w: 30 },
    { t: "Sede en comuna", w: 16 },
    { t: "Zona rural que cubre", w: 26 },
    { t: "Dirección", w: 45 },
    { t: "Horario de atención", w: 38 },
    { t: "Teléfono / correo", w: 26 },
    { t: "Nivel", w: 18 },
    { t: "Atención 24 horas", w: 14 },
    { t: "Estado de verificación", w: 22 },
    { t: "Ubicación aproximada", w: 16 },
    { t: "Dirección sin definir", w: 16 },
    { t: "Latitud", w: 11 },
    { t: "Longitud", w: 11 }
  ];

  // ---------- utilidades de texto ----------

  function esc(txt) {
    return String(txt === null || txt === undefined ? "" : txt)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function letraColumna(n) {
    var s = "";
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function siNo(v) { return v ? "Sí" : "No"; }

  function comunasTexto(ins) {
    if (typeof AppMapa !== "undefined" && AppMapa && typeof AppMapa.textoComunas === "function") {
      return AppMapa.textoComunas(ins);
    }
    if (ins.comunas === "todas" || (Array.isArray(ins.comunas) && ins.comunas.indexOf("todas") !== -1)) {
      return "Todas las comunas (cobertura urbana)";
    }
    return (ins.comunas || []).map(function (c) { return "Comuna " + c; }).join(", ");
  }

  function numero(v) {
    if (typeof v === "number") return isFinite(v) ? v : "";
    if (v === null || v === undefined || String(v).trim() === "") return "";
    var n = Number(String(v).replace(",", "."));
    return isFinite(n) ? n : "";
  }

  // Fila de datos (valores planos: string → celda de texto, number → numérica).
  function filaDe(ins) {
    return [
      typeof ins.id === "number" ? ins.id : (ins.id ? String(ins.id) : ""),
      String(ins.nombre || ""),
      CATEGORIAS[ins.forma] || "",
      (ins.tipos || []).join(", "),
      String(ins.tiposDetalle || ""),
      comunasTexto(ins),
      String(ins.comunaSede || ""),
      String(ins.rural || ""),
      String(ins.direccion || ""),
      String(ins.horario || ""),
      String(ins.telefono || ""),
      String(ins.nivel || ""),
      siNo(ins.es24h),
      String(ins.verificado || ""),
      siNo(ins.ubicacionAprox),
      siNo(ins.sinDireccion),
      numero(ins.lat),
      numero(ins.lng)
    ];
  }

  function filasDesdeInstituciones(lista) {
    return (lista || []).map(filaDe);
  }

  // ---------- CRC32 y ZIP (método "store", sin compresión) ----------

  var TABLA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(txt) { return new TextEncoder().encode(txt); }

  function concat(lista) {
    var total = 0;
    lista.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total);
    var off = 0;
    lista.forEach(function (p) { out.set(p, off); off += p.length; });
    return out;
  }

  function fechaDos(f) {
    var anio = Math.max(f.getFullYear(), 1980);
    return {
      fecha: ((anio - 1980) << 9) | ((f.getMonth() + 1) << 5) | f.getDate(),
      hora: (f.getHours() << 11) | (f.getMinutes() << 5) | Math.floor(f.getSeconds() / 2)
    };
  }

  // Empaqueta [{ nombre, bytes }] en un archivo ZIP válido.
  function zipStore(archivos) {
    var ahora = fechaDos(new Date());
    var partes = [];
    var centrales = [];
    var desplazamiento = 0;

    archivos.forEach(function (a) {
      var nombreBytes = utf8(a.nombre);
      var datos = a.bytes;
      var crc = crc32(datos);

      var cab = new Uint8Array(30 + nombreBytes.length);
      var dv = new DataView(cab.buffer);
      dv.setUint32(0, 0x04034b50, true);   // firma local
      dv.setUint16(4, 20, true);           // versión requerida
      dv.setUint16(6, 0, true);            // flags
      dv.setUint16(8, 0, true);            // método: store
      dv.setUint16(10, ahora.hora, true);
      dv.setUint16(12, ahora.fecha, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, datos.length, true);
      dv.setUint32(22, datos.length, true);
      dv.setUint16(26, nombreBytes.length, true);
      dv.setUint16(28, 0, true);           // extra
      cab.set(nombreBytes, 30);
      partes.push(cab, datos);

      var cen = new Uint8Array(46 + nombreBytes.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);   // firma central
      cv.setUint16(4, 20, true);           // creado por
      cv.setUint16(6, 20, true);           // requerido
      cv.setUint16(8, 0, true);            // flags
      cv.setUint16(10, 0, true);           // método
      cv.setUint16(12, ahora.hora, true);
      cv.setUint16(14, ahora.fecha, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, datos.length, true);
      cv.setUint32(24, datos.length, true);
      cv.setUint16(28, nombreBytes.length, true);
      cv.setUint16(30, 0, true);           // extra
      cv.setUint16(32, 0, true);           // comentario
      cv.setUint16(34, 0, true);           // disco
      cv.setUint16(36, 0, true);           // atributos internos
      cv.setUint32(38, 0, true);           // atributos externos
      cv.setUint32(42, desplazamiento, true); // offset de la cabecera local
      cen.set(nombreBytes, 46);
      centrales.push(cen);

      desplazamiento += cab.length + datos.length;
    });

    var tamCentral = 0;
    centrales.forEach(function (c) { tamCentral += c.length; });

    var fin = new Uint8Array(22);
    var fv = new DataView(fin.buffer);
    fv.setUint32(0, 0x06054b50, true);     // fin del directorio central
    fv.setUint16(4, 0, true);
    fv.setUint16(6, 0, true);
    fv.setUint16(8, archivos.length, true);
    fv.setUint16(10, archivos.length, true);
    fv.setUint32(12, tamCentral, true);
    fv.setUint32(16, desplazamiento, true);
    fv.setUint16(20, 0, true);             // comentario

    return concat(partes.concat(centrales, [fin]));
  }

  // ---------- piezas del libro OOXML ----------

  var CABECERA_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  var CONTENT_TYPES =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  var RELS_RAIZ =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  function workbookXml(nombreHoja) {
    return (
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + esc(nombreHoja) + '" sheetId="1" r:id="rId1"/></sheets>' +
      "</workbook>"
    );
  }

  var WORKBOOK_RELS =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  // Estilos: 0 = normal, 1 = encabezado (negrita + fondo verde), 2 = ajuste de texto.
  var STYLES =
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>' +
    "</fonts>" +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF00843D"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  function celdaXml(ref, valor, estilo) {
    var estiloAttr = estilo ? ' s="' + estilo + '"' : "";
    if (typeof valor === "number" && isFinite(valor)) {
      return '<c r="' + ref + '"' + estiloAttr + "><v>" + valor + "</v></c>";
    }
    var txt = String(valor === null || valor === undefined ? "" : valor);
    if (txt === "") return "";
    return '<c r="' + ref + '"' + estiloAttr + ' t="inlineStr"><is><t xml:space="preserve">' + esc(txt) + "</t></is></c>";
  }

  function hojaXml(columnas, filas) {
    var cols = "<cols>" + columnas.map(function (c, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 18) + '" customWidth="1"/>';
    }).join("") + "</cols>";

    var filasXml = [];
    filasXml.push(
      '<row r="1" ht="22" customHeight="1">' +
      columnas.map(function (c, i) {
        return '<c r="' + letraColumna(i + 1) + '1" s="1" t="inlineStr"><is><t>' + esc(c.t) + "</t></is></c>";
      }).join("") +
      "</row>"
    );

    filas.forEach(function (fila, f) {
      var n = f + 2;
      var celdas = fila.map(function (v, i) {
        var ref = letraColumna(i + 1) + n;
        var estilo = (typeof v === "string" && v.length > 60) ? 2 : 0;
        return celdaXml(ref, v, estilo);
      }).join("");
      filasXml.push('<row r="' + n + '">' + celdas + "</row>");
    });

    var ultimaCelda = letraColumna(columnas.length) + (filas.length + 1);
    return (
      CABECERA_XML +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      "</sheetView></sheetViews>" +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      "<sheetData>" + filasXml.join("") + "</sheetData>" +
      '<autoFilter ref="A1:' + ultimaCelda + '"/>' +
      "</worksheet>"
    );
  }

  // Construye el archivo .xlsx completo a partir de columnas y filas.
  function construir(columnas, filas, nombreHoja) {
    var piezas = [
      { nombre: "[Content_Types].xml", texto: CABECERA_XML + CONTENT_TYPES },
      { nombre: "_rels/.rels", texto: CABECERA_XML + RELS_RAIZ },
      { nombre: "xl/workbook.xml", texto: CABECERA_XML + workbookXml(nombreHoja || "Instituciones") },
      { nombre: "xl/_rels/workbook.xml.rels", texto: CABECERA_XML + WORKBOOK_RELS },
      { nombre: "xl/styles.xml", texto: CABECERA_XML + STYLES },
      { nombre: "xl/worksheets/sheet1.xml", texto: hojaXml(columnas, filas) }
    ];
    return zipStore(piezas.map(function (p) {
      return { nombre: p.nombre, bytes: utf8(p.texto) };
    }));
  }

  // ---------- descarga ----------

  function avisar(mensaje, tipo) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = mensaje;
    t.className = "toast" + (tipo ? " " + tipo : "");
    t.hidden = false;
    clearTimeout(avisar._t);
    avisar._t = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function nombreArchivo() {
    var f = new Date();
    var mes = String(f.getMonth() + 1).padStart(2, "0");
    var dia = String(f.getDate()).padStart(2, "0");
    return "entidades_villavicencio_" + f.getFullYear() + "-" + mes + "-" + dia + ".xlsx";
  }

  function dispararDescarga(nombre, bytes) {
    var blob = new Blob([bytes], { type: MIME_XLSX });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 5000);
  }

  // Genera y descarga el XLSX con TODAS las entidades (ignora los filtros del mapa).
  function descargarInstituciones(lista) {
    if (!lista || !lista.length) {
      avisar("No hay entidades para exportar.", "error");
      return false;
    }
    try {
      var bytes = construir(COLUMNAS, filasDesdeInstituciones(lista), "Instituciones");
      var nombre = nombreArchivo();
      dispararDescarga(nombre, bytes);
      avisar("Descargando " + nombre + " (" + lista.length + " entidades).", "ok");
      return true;
    } catch (e) {
      avisar("No se pudo generar el archivo: " + (e && e.message ? e.message : e), "error");
      return false;
    }
  }

  return {
    COLUMNAS: COLUMNAS,
    CATEGORIAS: CATEGORIAS,
    filaDe: filaDe,
    filasDesdeInstituciones: filasDesdeInstituciones,
    construir: construir,
    nombreArchivo: nombreArchivo,
    descargarInstituciones: descargarInstituciones
  };
})();
