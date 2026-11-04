const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mapeoEscritorio", {
  esElectron: true,
  version: "2.0.0"
});
