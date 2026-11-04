const { app, BrowserWindow, Menu, dialog, session } = require("electron");
const path = require("path");

function crearVentana() {
  const ventana = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Mapa de atención a víctimas de violencia — Villavicencio (Meta)",
    backgroundColor: "#F4F7F5",
    icon: path.join(__dirname, "renderer", "logogeo.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  Menu.setApplicationMenu(null);
  ventana.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  // Preguntar dónde guardar cuando la página descarga un archivo (XLSX).
  session.defaultSession.on("will-download", (event, item) => {
    const nombre = item.getFilename();
    const ext = path.extname(nombre).slice(1).toLowerCase();
    const opciones = {
      title: "Guardar archivo",
      defaultPath: path.join(app.getPath("downloads"), nombre)
    };
    if (ext) opciones.filters = [{ name: ext.toUpperCase(), extensions: [ext] }];
    dialog.showSaveDialog(opciones)
      .then(({ canceled, filePath }) => {
        if (canceled || !filePath) {
          event.preventDefault();
          return;
        }
        item.setSavePath(filePath);
      })
      .catch(() => { /* sin diálogo: se guarda en Descargas */ });
  });

  crearVentana();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
