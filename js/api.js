// Cliente del backend (Google Apps Script publicado como app web).
// En modo demo (API_URL vacío) lee los datos locales de datos.js.
const API = (function () {

  function modoDemo() {
    return !CONFIG.API_URL;
  }

  // Datos locales: copia las 15 instituciones de datos.js y les adjunta el logo
  function datosDemo() {
    return INSTITUCIONES.map(function (ins) {
      var copia = Object.assign({}, ins);
      copia.logo = LOGOS[ins.id] || "";
      return copia;
    });
  }

  function cargarInstituciones() {
    if (modoDemo()) {
      return Promise.resolve(datosDemo());
    }
    return fetch(CONFIG.API_URL + "?action=instituciones")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "No se pudieron cargar las instituciones.");
        return data.instituciones;
      });
  }

  // POST con text/plain para evitar el preflight CORS de Apps Script
  function post(accion, payload) {
    if (modoDemo()) {
      return Promise.resolve({ ok: false, error: "Backend no configurado (API_URL vacío)." });
    }
    var cuerpo = JSON.stringify(Object.assign({ action: accion }, payload || {}));
    return fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: cuerpo
    }).then(function (r) { return r.json(); });
  }

  return {
    modoDemo: modoDemo,
    cargarInstituciones: cargarInstituciones,
    login: function (usuario, clave) { return post("login", { usuario: usuario, clave: clave }); },
    cambiarClave: function (token, nuevaClave) { return post("cambiarClave", { token: token, nuevaClave: nuevaClave }); },
    crear: function (token, punto) { return post("crear", { token: token, punto: punto }); },
    editar: function (token, punto) { return post("editar", { token: token, punto: punto }); },
    eliminar: function (token, id) { return post("eliminar", { token: token, id: id }); }
  };
})();
