// Servidor estático mínimo para pruebas locales
//   node tools/serve.js [puerto] [carpeta]
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, "..", "renderer");
const PUERTO = Number(process.argv[2]) || 8391;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

http.createServer(function (req, res) {
  var ruta = decodeURIComponent(req.url.split("?")[0]);
  if (ruta === "/") ruta = "/index.html";
  var archivo = path.normalize(path.join(ROOT, ruta));
  if (!archivo.startsWith(ROOT)) { res.writeHead(403); return res.end("403"); }
  fs.readFile(archivo, function (err, data) {
    if (err) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(archivo)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PUERTO, "127.0.0.1", function () {
  console.log("Sirviendo " + ROOT + " en http://127.0.0.1:" + PUERTO + "/");
});
