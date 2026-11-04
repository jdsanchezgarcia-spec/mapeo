// Prueba del generador de XLSX: arma el archivo con los datos de renderer/datos.js
// y lo escribe en la carpeta temporal. Uso: node tools/test-xlsx.js [salida.xlsx]
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const sandbox = { TextEncoder, console, Date, Math, JSON, String, Number, Array, Object, isFinite, isNaN, parseInt, parseFloat };
vm.createContext(sandbox);

// exportar.js declara `const ExportXLSX`; datos.js declara `const INSTITUCIONES`.
const exportarSrc = fs.readFileSync(path.join(raiz, "renderer", "js", "exportar.js"), "utf8");
const ExportXLSX = vm.runInContext(exportarSrc + "\n;ExportXLSX;", sandbox);

const datosSrc = fs.readFileSync(path.join(raiz, "renderer", "datos.js"), "utf8");
const INSTITUCIONES = vm.runInContext(datosSrc + "\n;INSTITUCIONES;", sandbox);

const columnas = ExportXLSX.COLUMNAS;
const filas = ExportXLSX.filasDesdeInstituciones(INSTITUCIONES);
const bytes = ExportXLSX.construir(columnas, filas, "Instituciones");

const salida = process.argv[2] || path.join(os.tmpdir(), "prueba_entidades.xlsx");
fs.writeFileSync(salida, bytes);

console.log("Archivo: " + salida);
console.log("Entidades: " + INSTITUCIONES.length + " | Filas de datos: " + filas.length + " | Columnas: " + columnas.length);
console.log("Tamaño: " + bytes.length + " bytes");
console.log("Primera fila: " + JSON.stringify(filas[0]));
