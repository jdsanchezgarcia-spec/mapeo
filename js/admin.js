// Panel de administración: login, captura de ubicación por clic en el mapa,
// formulario de punto (crear/editar), lista de puntos con eliminar.
const AppAdmin = (function () {
  var sesion = null;           // { token, usuario }
  var modoCaptura = false;
  var marcadorCaptura = null;
  var logoDataUrl = "";        // logo pendiente de guardar (base64)
  var formaSeleccionada = "circulo";
  var textoBusqueda = "";      // filtro del buscador del panel admin

  var FORMAS = [
    { forma: "circulo", etiqueta: "Comisaría" },
    { forma: "cuadrado", etiqueta: "Salud" },
    { forma: "triangulo", etiqueta: "Justicia" },
    { forma: "estrella", etiqueta: "Diferencial" },
    { forma: "rombo", etiqueta: "Defensoría" }
  ];

  // ---------- utilidades ----------

  function $(id) { return document.getElementById(id); }

  function mostrarToast(mensaje, tipo) {
    var toast = $("toast");
    toast.textContent = mensaje;
    toast.className = "toast" + (tipo ? " " + tipo : "");
    toast.hidden = false;
    clearTimeout(mostrarToast._t);
    mostrarToast._t = setTimeout(function () { toast.hidden = true; }, 3500);
  }

  function errorFormulario(msg) {
    var el = $("form-error");
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  function infoFormulario(msg) {
    var el = $("form-info");
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  // ---------- sesión ----------

  function guardarSesion(s) {
    sesion = s;
    try {
      sessionStorage.setItem(CONFIG.TOKEN_KEY, s.token);
      sessionStorage.setItem(CONFIG.USUARIO_KEY, s.usuario);
    } catch (e) { /* almacenamiento no disponible */ }
  }

  function recuperarSesion() {
    try {
      var token = sessionStorage.getItem(CONFIG.TOKEN_KEY);
      var usuario = sessionStorage.getItem(CONFIG.USUARIO_KEY);
      if (token && usuario) sesion = { token: token, usuario: usuario };
    } catch (e) { /* ignorar */ }
  }

  function cerrarSesion() {
    sesion = null;
    AppMapa.setModoEdicion(false);
    try {
      sessionStorage.removeItem(CONFIG.TOKEN_KEY);
      sessionStorage.removeItem(CONFIG.USUARIO_KEY);
    } catch (e) { /* ignorar */ }
    $("panel-admin").hidden = true;
    $("btn-admin").classList.remove("activo");
    $("btn-admin").innerHTML = '<i class="fa-solid fa-lock"></i> Admin';
    cancelarCaptura();
    ocultarFormulario();
    mostrarToast("Sesión cerrada.");
  }

  // ---------- login ----------

  function abrirLogin() {
    if (sesion) {
      // ya hay sesión: mostrar/ocultar panel admin
      var panel = $("panel-admin");
      panel.hidden = !panel.hidden;
      $("btn-admin").classList.toggle("activo", !panel.hidden);
      if (!panel.hidden) renderListaAdmin();
      return;
    }
    $("login-demo-aviso").hidden = !API.modoDemo();
    $("login-error").hidden = true;
    $("form-login").reset();
    $("modal-login").hidden = false;
    setTimeout(function () { $("login-usuario").focus(); }, 50);
  }

  function cerrarLogin() {
    $("modal-login").hidden = true;
  }

  function enviarLogin(e) {
    e.preventDefault();
    var usuario = $("login-usuario").value.trim();
    var clave = $("login-clave").value;
    var err = $("login-error");
    err.hidden = true;

    if (API.modoDemo()) {
      err.textContent = "Backend no configurado. Configure API_URL en renderer/js/config.js (ver README.md).";
      err.hidden = false;
      return;
    }

    var boton = $("btn-login-submit");
    boton.disabled = true;
    boton.textContent = "Verificando…";

    API.login(usuario, clave).then(function (res) {
      boton.disabled = false;
      boton.textContent = "Ingresar";
      if (!res.ok) {
        err.textContent = res.error || "No se pudo iniciar sesión.";
        err.hidden = false;
        return;
      }
      guardarSesion({ token: res.token, usuario: res.usuario });
      cerrarLogin();
      AppMapa.setModoEdicion(true);
      $("btn-admin").classList.add("activo");
      $("btn-admin").innerHTML = '<i class="fa-solid fa-unlock"></i> ' + res.usuario;
      $("admin-usuario-actual").textContent = res.usuario;
      $("panel-admin").hidden = false;
      renderListaAdmin();
      mostrarToast("Sesión iniciada como " + res.usuario, "ok");
      if (res.debeCambiarClave) {
        mostrarToast("Está usando la clave inicial. Cámbiela con el botón de llave.", "ok");
      }
    }).catch(function () {
      boton.disabled = false;
      boton.textContent = "Ingresar";
      err.textContent = "Error de conexión con el servidor.";
      err.hidden = false;
    });
  }

  function cambiarClave() {
    var form = $("form-clave");
    form.reset();
    $("clave-error").hidden = true;
    form.hidden = false;
    $("f-clave-nueva").focus();
  }

  function guardarClave(e) {
    e.preventDefault();
    if (!sesion) return;
    var error = $("clave-error");
    error.hidden = true;
    var nueva = $("f-clave-nueva").value;
    var confirmar = $("f-clave-confirmar").value;

    if (nueva.length < 6) {
      error.textContent = "La contraseña debe tener al menos 6 caracteres.";
      error.hidden = false;
      return;
    }
    if (nueva !== confirmar) {
      error.textContent = "Las contraseñas no coinciden.";
      error.hidden = false;
      return;
    }

    var boton = e.target.querySelector("button[type='submit']");
    boton.disabled = true;
    API.cambiarClave(sesion.token, nueva).then(function (res) {
      boton.disabled = false;
      if (!res.ok) {
        error.textContent = res.error || "No se pudo cambiar la contraseña.";
        error.hidden = false;
        return;
      }
      $("form-clave").hidden = true;
      mostrarToast("Contraseña actualizada.", "ok");
    }).catch(function () {
      boton.disabled = false;
      error.textContent = "Error de conexión con el servidor.";
      error.hidden = false;
    });
  }

  // ---------- captura de ubicación ----------

  function activarCaptura() {
    if (!sesion) return;
    modoCaptura = true;
    $("aviso-captura").hidden = false;
    $("form-punto").hidden = false;
    $("titulo-form-punto").textContent = $("f-id").value ? "Editar punto" : "Nuevo punto";
    AppMapa.getMapa().getContainer().classList.add("captura-activa");
  }

  function cancelarCaptura() {
    modoCaptura = false;
    $("aviso-captura").hidden = true;
    AppMapa.getMapa().getContainer().classList.remove("captura-activa");
    if (marcadorCaptura) {
      AppMapa.getMapa().removeLayer(marcadorCaptura);
      marcadorCaptura = null;
    }
  }

  function alClicMapa(e) {
    if (!modoCaptura) return;
    $("f-lat").value = e.latlng.lat.toFixed(6);
    $("f-lng").value = e.latlng.lng.toFixed(6);
    if (marcadorCaptura) marcadorCaptura.setLatLng(e.latlng);
    else {
      marcadorCaptura = L.marker(e.latlng, {
        icon: L.divIcon({
          className: "",
          html: '<div class="pin" style="--tc:#00843D;background:#E8F3EC;"><i class="fa-solid fa-location-dot" style="color:#00843D"></i></div>',
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        })
      }).addTo(AppMapa.getMapa());
    }
    cancelarCaptura();
    mostrarToast("Ubicación fijada: " + e.latlng.lat.toFixed(5) + ", " + e.latlng.lng.toFixed(5), "ok");
  }

  // ---------- formulario ----------

  function construirSelectorForma() {
    var cont = $("selector-forma");
    cont.innerHTML = "";
    var iconos = AppMapa.getIconoPorForma();
    var colores = AppMapa.getColorPorForma();
    FORMAS.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "opcion-forma";
      b.dataset.forma = f.forma;
      b.style.setProperty("--tc", colores[f.forma]);
      b.setAttribute("aria-pressed", f.forma === formaSeleccionada ? "true" : "false");
      b.innerHTML = '<img src="' + iconos[f.forma] + '" alt=""><span>' + f.etiqueta + "</span>";
      b.addEventListener("click", function () {
        formaSeleccionada = f.forma;
        cont.querySelectorAll(".opcion-forma").forEach(function (x) {
          x.setAttribute("aria-pressed", x.dataset.forma === formaSeleccionada ? "true" : "false");
        });
      });
      cont.appendChild(b);
    });
  }

  function construirChipsComunas() {
    var cont = $("f-comunas");
    cont.innerHTML = "";
    var todas = document.createElement("button");
    todas.type = "button";
    todas.className = "chip";
    todas.dataset.valor = "todas";
    todas.textContent = "Todas";
    todas.setAttribute("aria-pressed", "false");
    cont.appendChild(todas);
    Object.keys(COMUNAS_INFO).forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.valor = c;
      b.textContent = "Comuna " + c;
      b.setAttribute("aria-pressed", "false");
      cont.appendChild(b);
    });
    cont.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-valor]");
      if (!b) return;
      if (b.dataset.valor === "todas") {
        cont.querySelectorAll(".chip").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
      } else {
        cont.querySelector('.chip[data-valor="todas"]').setAttribute("aria-pressed", "false");
        b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
      }
    });
  }

  function comunasSeleccionadas() {
    var activos = document.querySelectorAll("#f-comunas .chip[aria-pressed='true']");
    var vals = Array.prototype.map.call(activos, function (b) { return b.dataset.valor; });
    if (vals.indexOf("todas") !== -1) return ["todas"];
    return vals;
  }

  function marcarComunas(comunas) {
    var vals = (Array.isArray(comunas) ? comunas : [comunas]).map(String);
    document.querySelectorAll("#f-comunas .chip").forEach(function (b) {
      b.setAttribute("aria-pressed", vals.indexOf(b.dataset.valor) !== -1 ? "true" : "false");
    });
  }

  function construirChecksTipos() {
    var cont = $("f-tipos");
    cont.innerHTML = "";
    TIPOS_VIOLENCIA.forEach(function (t) {
      var id = "chk-" + t.replace(/[^a-záéíóúñ]/gi, "-");
      var label = document.createElement("label");
      label.innerHTML = '<input type="checkbox" value="' + t + '" id="' + id + '"> <span>' + t + "</span>";
      cont.appendChild(label);
    });
  }

  function tiposSeleccionados() {
    return Array.prototype.map.call(
      document.querySelectorAll("#f-tipos input:checked"),
      function (c) { return c.value; }
    );
  }

  function marcarTipos(tipos) {
    document.querySelectorAll("#f-tipos input").forEach(function (c) {
      c.checked = (tipos || []).indexOf(c.value) !== -1;
    });
  }

  function seleccionarForma(forma) {
    formaSeleccionada = FORMAS.some(function (f) { return f.forma === forma; }) ? forma : "circulo";
    document.querySelectorAll("#selector-forma .opcion-forma").forEach(function (x) {
      x.setAttribute("aria-pressed", x.dataset.forma === formaSeleccionada ? "true" : "false");
    });
  }

  function cargarLogo(file) {
    if (!file) return;
    if (file.size > CONFIG.MAX_LOGO_BYTES) {
      mostrarToast("El logo supera 30 KB. Use una imagen más pequeña.", "error");
      $("f-logo").value = "";
      return;
    }
    var lector = new FileReader();
    lector.onload = function () {
      logoDataUrl = lector.result;
      $("logo-preview").src = logoDataUrl;
      $("logo-preview-wrap").hidden = false;
    };
    lector.readAsDataURL(file);
  }

  function quitarLogo() {
    logoDataUrl = "";
    $("f-logo").value = "";
    $("logo-preview-wrap").hidden = true;
  }

  function mostrarFormulario() {
    $("form-punto").hidden = false;
    errorFormulario("");
    infoFormulario("");
  }

  function ocultarFormulario() {
    $("form-punto").hidden = true;
  }

  function nuevoPunto() {
    if (!sesion) return;
    $("form-punto").reset();
    $("f-id").value = "";
    quitarLogo();
    seleccionarForma("circulo");
    marcarComunas(["todas"]);
    marcarTipos([]);
    $("titulo-form-punto").textContent = "Nuevo punto";
    mostrarFormulario();
    activarCaptura();
  }

  function editarPunto(id) {
    if (!sesion) return;
    var ins = AppMapa.getDatos().find(function (i) { return String(i.id) === String(id); });
    if (!ins) return;
    $("f-id").value = ins.id;
    $("f-nombre").value = ins.nombre || "";
    seleccionarForma(ins.forma);
    logoDataUrl = ins.logo || "";
    if (logoDataUrl) {
      $("logo-preview").src = logoDataUrl;
      $("logo-preview-wrap").hidden = false;
    } else {
      quitarLogo();
    }
    marcarComunas(ins.comunas);
    marcarTipos(ins.tipos);
    $("f-tipos-detalle").value = ins.tiposDetalle || "";
    $("f-direccion").value = ins.direccion || "";
    $("f-telefono").value = ins.telefono || "";
    $("f-horario").value = ins.horario || "";
    $("f-lat").value = ins.lat;
    $("f-lng").value = ins.lng;
    $("f-nivel").value = ins.nivel || "Municipal";
    $("f-verificado").value = ins.verificado || "por verificar";
    $("f-comuna-sede").value = ins.comunaSede === "por verificar" ? "" : (ins.comunaSede || "");
    $("f-rural").value = ins.rural === "—" ? "" : (ins.rural || "");
    $("f-es24h").checked = !!ins.es24h;
    $("f-ubicacion-aprox").checked = !!ins.ubicacionAprox;
    $("titulo-form-punto").textContent = "Editar punto — " + ins.nombre;
    mostrarFormulario();
    cancelarCaptura();
  }

  function leerFormulario() {
    var nombre = $("f-nombre").value.trim();
    var lat = parseFloat($("f-lat").value);
    var lng = parseFloat($("f-lng").value);
    var comunas = comunasSeleccionadas();
    var tipos = tiposSeleccionados();

    if (!nombre) throw new Error("El nombre de la institución es obligatorio.");
    if (!comunas.length) throw new Error("Seleccione al menos una comuna (o «Todas»).");
    if (!tipos.length) throw new Error("Seleccione al menos un tipo de violencia que atiende.");
    if (isNaN(lat) || isNaN(lng)) throw new Error("Defina la ubicación: active «Añadir punto» y haga clic en el mapa, o escriba latitud y longitud.");
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error("Las coordenadas están fuera de rango.");

    return {
      id: $("f-id").value ? Number($("f-id").value) : null,
      nombre: nombre,
      forma: formaSeleccionada,
      logo: logoDataUrl,
      comunas: comunas,
      comunaSede: $("f-comuna-sede").value.trim() || "por verificar",
      rural: $("f-rural").value.trim() || "—",
      direccion: $("f-direccion").value.trim() || "—",
      horario: $("f-horario").value.trim() || "—",
      telefono: $("f-telefono").value.trim() || "—",
      tipos: tipos,
      tiposDetalle: $("f-tipos-detalle").value.trim() || "—",
      nivel: $("f-nivel").value,
      es24h: $("f-es24h").checked,
      verificado: $("f-verificado").value,
      lat: lat,
      lng: lng,
      ubicacionAprox: $("f-ubicacion-aprox").checked
    };
  }

  function guardarPunto(e) {
    e.preventDefault();
    if (!sesion) return;
    errorFormulario("");
    var punto;
    try {
      punto = leerFormulario();
    } catch (err) {
      errorFormulario(err.message);
      return;
    }
    var esEdicion = punto.id !== null;
    var boton = $("btn-guardar-punto");
    boton.disabled = true;
    boton.textContent = "Guardando…";
    infoFormulario("Guardando en el servidor…");

    var peticion = esEdicion ? API.editar(sesion.token, punto) : API.crear(sesion.token, punto);
    peticion.then(function (res) {
      boton.disabled = false;
      boton.textContent = "Guardar punto";
      infoFormulario("");
      if (!res.ok) {
        errorFormulario(res.error || "No se pudo guardar el punto.");
        return;
      }
      mostrarToast(esEdicion ? "Punto actualizado." : "Punto creado.", "ok");
      ocultarFormulario();
      cancelarCaptura();
      return cargarDatos();
    }).then(function () {
      renderListaAdmin();
    }).catch(function () {
      boton.disabled = false;
      boton.textContent = "Guardar punto";
      infoFormulario("");
      errorFormulario("Error de conexión con el servidor.");
    });
  }

  function eliminarPunto(id, nombre) {
    if (!sesion) return;
    if (!window.confirm('¿Eliminar el punto "' + nombre + '"? Esta acción no se puede deshacer.')) return;
    API.eliminar(sesion.token, id).then(function (res) {
      if (!res.ok) { mostrarToast(res.error || "No se pudo eliminar.", "error"); return; }
      mostrarToast("Punto eliminado.", "ok");
      return cargarDatos();
    }).then(function () {
      renderListaAdmin();
    }).catch(function () { mostrarToast("Error de conexión.", "error"); });
  }

  // ---------- arrastre de marcadores (solo admin) ----------

  // El mapa avisa cuando el admin suelta un punto arrastrado con el mouse.
  function alMoverMarcador(id, latlng) {
    if (!sesion) return;
    var ins = AppMapa.getDatos().find(function (i) { return String(i.id) === String(id); });
    if (!ins) return;

    var lat = Number(latlng.lat.toFixed(6));
    var lng = Number(latlng.lng.toFixed(6));

    // Si el formulario de edición de ESTE punto está abierto: solo actualizar coordenadas.
    if (!$("form-punto").hidden && String($("f-id").value) === String(id)) {
      $("f-lat").value = lat;
      $("f-lng").value = lng;
      var comunaForm = AppMapa.comunaDeCoordenada(lat, lng);
      mostrarToast(
        comunaForm
          ? "Ubicación actualizada (Comuna " + comunaForm + "). Pulse «Guardar punto»."
          : "Ubicación actualizada en el formulario. Pulse «Guardar punto».",
        "ok"
      );
      return;
    }

    // Si no: guardar el cambio directamente en el servidor.
    var punto = Object.assign({}, ins, { lat: lat, lng: lng });
    API.editar(sesion.token, punto).then(function (res) {
      if (!res.ok) {
        mostrarToast(res.error || "No se pudo mover el punto.", "error");
        cargarDatos(); // revertir posición visual
        return;
      }
      ins.lat = lat;
      ins.lng = lng;
      renderListaAdmin();

      // ¿En qué comuna cayó el punto?
      var comunaAhora = AppMapa.comunaDeCoordenada(lat, lng);
      if (comunaAhora) {
        mostrarToast("«" + ins.nombre + "» movida — ahora está en Comuna " + comunaAhora + ".", "ok");
      } else {
        mostrarToast("«" + ins.nombre + "» movida a " + lat.toFixed(5) + ", " + lng.toFixed(5) + ".", "ok");
      }

      // Si la nueva comuna no está entre las que cubre, ofrecer agregarla.
      var cubre = (ins.comunas || []);
      var yaLaCubre = cubre.indexOf("todas") !== -1 || cubre.indexOf(comunaAhora) !== -1;
      if (comunaAhora && !yaLaCubre) {
        var incluir = window.confirm(
          "«" + ins.nombre + "» cayó en la Comuna " + comunaAhora +
          ", que no está entre sus comunas cubiertas.\n\n" +
          "¿Agregar la Comuna " + comunaAhora + " a las comunas que cubre?"
        );
        if (incluir) {
          var nuevasComunas = cubre.concat([comunaAhora]);
          API.editar(sesion.token, Object.assign({}, ins, { comunas: nuevasComunas })).then(function (r2) {
            if (r2.ok) {
              ins.comunas = nuevasComunas;
              renderListaAdmin();
              mostrarToast("Comuna " + comunaAhora + " agregada a las comunas cubiertas.", "ok");
            } else {
              mostrarToast(r2.error || "No se pudo actualizar la cobertura.", "error");
            }
          }).catch(function () { mostrarToast("Error de conexión.", "error"); });
        }
      }
    }).catch(function () {
      mostrarToast("Error de conexión. No se guardó el movimiento.", "error");
      cargarDatos(); // revertir posición visual
    });
  }

  // ---------- búsqueda en la lista admin ----------

  function normalizar(txt) {
    return String(txt || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  // Puntaje de coincidencia: 3 = empieza por el texto, 2 = lo contiene, 0 = no coincide.
  function puntajeBusqueda(ins, q) {
    if (!q) return 1;
    var nombre = normalizar(ins.nombre);
    if (nombre === q) return 4;
    if (nombre.indexOf(q) === 0) return 3;
    if (nombre.indexOf(q) !== -1) return 2;
    var otros = normalizar([
      ins.direccion, ins.telefono, ins.horario, ins.tiposDetalle, ins.nivel,
      (ins.tipos || []).join(" "),
      AppMapa.textoComunas(ins)
    ].join(" "));
    return otros.indexOf(q) !== -1 ? 1 : 0;
  }

  function renderBusqueda() {
    var info = $("admin-busqueda-info");
    var btnLimpiar = $("btn-limpiar-busqueda");
    btnLimpiar.hidden = !textoBusqueda;
    if (!textoBusqueda) { info.hidden = true; return; }
    var q = normalizar(textoBusqueda.trim());
    var datos = AppMapa.getDatos();
    var encontrados = datos.filter(function (i) { return puntajeBusqueda(i, q) > 0; });
    info.hidden = false;
    info.textContent = encontrados.length
      ? encontrados.length + (encontrados.length === 1 ? " coincidencia" : " coincidencias") + " para «" + textoBusqueda.trim() + "»"
      : "Sin coincidencias para «" + textoBusqueda.trim() + "»";
  }

  // ---------- lista admin ----------

  function renderListaAdmin() {
    var lista = $("admin-lista");
    var datos = AppMapa.getDatos();
    $("admin-contador").textContent = datos.length;
    lista.innerHTML = "";

    var q = normalizar(textoBusqueda.trim());
    var ordenados = datos.slice();
    if (q) {
      // Lo que busca aparece PRIMERO (mejor coincidencia primero); el resto al final.
      ordenados.sort(function (a, b) {
        var d = puntajeBusqueda(b, q) - puntajeBusqueda(a, q);
        return d !== 0 ? d : a.nombre.localeCompare(b.nombre, "es");
      });
    } else {
      ordenados.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
    }

    var vistoPrimero = false;
    var separadorAgregado = false;
    ordenados.forEach(function (ins) {
      var puntaje = puntajeBusqueda(ins, q);
      if (q && puntaje > 0) {
        vistoPrimero = true;
      } else if (q && vistoPrimero && !separadorAgregado) {
        // Primera fila que ya no coincide: separador y luego el resto atenuado.
        separadorAgregado = true;
        var sep = document.createElement("li");
        sep.className = "al-separador";
        sep.textContent = "— Sin coincidencias —";
        lista.appendChild(sep);
      }

      var li = document.createElement("li");
      if (q && puntaje === 0) li.className = "al-tenue";
      else if (q) li.className = "al-coincide";
      var nombre = document.createElement("span");
      nombre.className = "al-nombre";
      var emoji = (AppMapa.getEmojiPorForma()[ins.forma] || "");
      nombre.innerHTML = '<span class="emoji-cat">' + emoji + "</span> " + ins.nombre + "<small>" + AppMapa.textoComunas(ins) + " · " + (ins.tipos || []).join(", ") + "</small>";
      var btnEditar = document.createElement("button");
      btnEditar.className = "al-editar";
      btnEditar.title = "Editar";
      btnEditar.innerHTML = '<i class="fa-solid fa-pen"></i>';
      btnEditar.addEventListener("click", function () { editarPunto(ins.id); });
      var btnEliminar = document.createElement("button");
      btnEliminar.className = "al-eliminar";
      btnEliminar.title = "Eliminar";
      btnEliminar.innerHTML = '<i class="fa-solid fa-trash"></i>';
      btnEliminar.addEventListener("click", function () { eliminarPunto(ins.id, ins.nombre); });
      li.appendChild(nombre);
      li.appendChild(btnEditar);
      li.appendChild(btnEliminar);
      lista.appendChild(li);
    });

    renderBusqueda();
  }

  // ---------- datos ----------

  function cargarDatos() {
    return API.cargarInstituciones().then(function (lista) {
      AppMapa.setDatos(lista);
      return lista;
    }).catch(function (err) {
      mostrarToast(err.message || "Error cargando los datos.", "error");
    });
  }

  // ---------- arranque ----------

  function iniciar() {
    recuperarSesion();

    AppMapa.setAlMover(alMoverMarcador);
    AppMapa.setModoEdicion(!!sesion);

    $("btn-admin").addEventListener("click", abrirLogin);
    document.querySelectorAll("[data-cerrar-login]").forEach(function (b) {
      b.addEventListener("click", cerrarLogin);
    });
    $("modal-login").addEventListener("click", function (e) {
      if (e.target === this) cerrarLogin();
    });
    $("form-login").addEventListener("submit", enviarLogin);

    $("btn-cerrar-sesion").addEventListener("click", cerrarSesion);
    $("btn-cerrar-panel").addEventListener("click", function () {
      $("panel-admin").hidden = true;
      $("btn-admin").classList.remove("activo");
      cancelarCaptura();
      ocultarFormulario();
      $("form-clave").hidden = true;
    });
    $("btn-cambiar-clave").addEventListener("click", cambiarClave);
    $("form-clave").addEventListener("submit", guardarClave);
    $("btn-cancelar-clave").addEventListener("click", function () {
      $("form-clave").hidden = true;
    });
    $("btn-nuevo-punto").addEventListener("click", nuevoPunto);
    $("btn-recargar").addEventListener("click", function () {
      cargarDatos().then(function () {
        renderListaAdmin();
        mostrarToast("Datos recargados.", "ok");
      });
    });
    $("btn-cancelar-form").addEventListener("click", function () {
      ocultarFormulario();
      cancelarCaptura();
    });
    $("form-punto").addEventListener("submit", guardarPunto);
    $("f-logo").addEventListener("change", function (e) { cargarLogo(e.target.files[0]); });
    $("btn-quitar-logo").addEventListener("click", quitarLogo);
    $("btn-cancelar-captura").addEventListener("click", cancelarCaptura);

    // Buscador del panel admin: filtra/reordena la lista mientras se escribe.
    $("admin-buscar").addEventListener("input", function () {
      textoBusqueda = this.value;
      renderListaAdmin();
    });
    $("btn-limpiar-busqueda").addEventListener("click", function () {
      textoBusqueda = "";
      $("admin-buscar").value = "";
      renderListaAdmin();
      $("admin-buscar").focus();
    });
    $("admin-buscar").addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        textoBusqueda = "";
        this.value = "";
        renderListaAdmin();
      }
    });

    construirSelectorForma();
    construirChipsComunas();
    construirChecksTipos();

    AppMapa.getMapa().on("click", alClicMapa);

    if (sesion) {
      $("btn-admin").classList.add("activo");
      $("btn-admin").innerHTML = '<i class="fa-solid fa-unlock"></i> ' + sesion.usuario;
      $("admin-usuario-actual").textContent = sesion.usuario;
    }
  }

  return {
    iniciar: iniciar,
    cargarDatos: cargarDatos,
    renderListaAdmin: function () { if (sesion) renderListaAdmin(); }
  };
})();
