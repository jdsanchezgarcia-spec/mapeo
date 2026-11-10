# Mapeo de instituciones de atención a víctimas — Villavicencio (Meta)

App de escritorio (Electron) con mapa interactivo de instituciones que atienden
violencias en Villavicencio. El mapa es de **consulta pública**; solo el usuario
**administrador** (con usuario y contraseña) puede crear, editar y eliminar puntos.
Los datos y los usuarios viven en **Google Sheets**, servidos por un **Google Apps Script** (`backend/code.gs`).

## Estructura

```
mapeo/
├── main.js / preload.js / package.json   # app Electron (npm start)
├── backend/
│   └── code.gs                           # backend: usuarios, login, CRUD (subir a Apps Script)
├── renderer/                             # interfaz del mapa
│   ├── index.html
│   ├── css/styles.css
│   ├── js/config.js                      # ← aquí se pega la URL del backend (API_URL)
│   ├── js/api.js                         # cliente del backend (modo demo si API_URL vacío)
│   ├── js/app.js                         # mapa, filtros, listado, leyenda
│   ├── js/exportar.js                    # exporta todas las entidades a un .xlsx
│   ├── js/admin.js                       # login admin, formulario de puntos, clic-en-mapa
│   ├── comunas.js / datos.js             # geojson de comunas + datos del modo demo
│   ├── vendor/leaflet/                   # Leaflet local (offline)
│   └── icons/ / logos/                   # íconos de categoría y logos institucionales
├── tools/                                # scripts de apoyo (Node)
│   ├── importar-mapeo.js                 # importa el XLSX institucional a datos.js
│   ├── test-xlsx.js                      # genera un .xlsx de prueba
│   └── serve.js / stop-serve.ps1         # servidor estático para pruebas
└── README.md
```

## 1. Instalar y probar la app (modo demo)

Requiere [Node.js](https://nodejs.org) instalado.

```bash
npm install
npm start
```

La app abre el mapa con las 51 instituciones de `renderer/datos.js`
(modo demo, sin backend).
El botón **Admin** muestra un aviso de que falta configurar el backend.

## 2. Desplegar el backend (Google Apps Script + Sheets)

1. Cree un libro nuevo en [sheets.google.com](https://sheets.google.com).
2. En el libro: **Extensiones → Apps Script**. Borre el contenido y pegue todo el archivo `backend/code.gs`.
3. Guarde el proyecto y ejecute la función **`setup`** una sola vez
   (crea las hojas *Usuarios* e *Instituciones*, el usuario `admin` y carga las 15 instituciones iniciales).
   La primera ejecución pide autorizar permisos: acepte.
4. **Implementar → Nueva implementación → Tipo: Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
5. Copie la URL que termina en **`/exec`**.
6. Péguela en `renderer/js/config.js`:

```js
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfyc.../exec",
  ...
};
```

7. Reinicie la app (`npm start`).

### Primer acceso

- Usuario: `admin` — Contraseña: `admin123` (clave inicial, **cámbiela** con el botón
  de llave en el panel de administración).

### Crear más usuarios administradores

En el editor de Apps Script, ejecute manualmente (una vez, con los valores que quiera):

```js
agregarUsuario("operador1", "claveSegura123", "admin");
```

## 3. Uso del panel de administración

1. Pulse **Admin** (esquina superior derecha) e inicie sesión.
2. **Añadir punto** → el cursor cambia a modo captura: **haga clic en el mapa** para fijar
   latitud/longitud (también puede escribirlas a mano).
3. Complete: nombre, categoría institucional (Protección, Salud, Justicia, CAI y
   Policía, ONG / Fundaciones, Defensorías, Enfoque diferencial),
   logo opcional (PNG/JPG máx. 30 KB), comunas que cubre, **tipos de violencia que atiende**,
   dirección, teléfono, horario, nivel, atención 24 h.
4. **Guardar punto** → el punto aparece en el mapa, el listado y los filtros.
5. En la lista del panel puede **editar** (ícono de lápiz) o **eliminar** (papelera) cada punto.

Los cambios se guardan en el Google Sheet: cualquier otra persona con la app
configurada con la misma `API_URL` verá los mismos puntos.

## 4. Descargar las entidades en Excel (XLSX)

En el panel izquierdo, el botón **Descargar datos (XLSX)** genera un archivo
`entidades_villavicencio_AAAA-MM-DD.xlsx` con **todas** las entidades y todos sus
datos (siempre exporta todo, sin importar los filtros activos del mapa):

- 18 columnas: ID, institución, categoría, tipos de violencia, qué atiende,
  comunas que cubre, sede en comuna, zona rural, dirección, horario,
  teléfono/correo, nivel, atención 24 h, estado de verificación, ubicación
  aproximada, dirección sin definir, latitud y longitud.
- Encabezado con fondo verde, fila congelada, autofiltro y anchos de columna.
- Latitud y longitud quedan como números (se pueden ordenar y filtrar).

No usa librerías: `renderer/js/exportar.js` escribe el libro OOXML directamente,
así que funciona también sin internet. En la app de escritorio se abre el
diálogo **Guardar archivo** para elegir la carpeta.

Para regenerar una prueba del archivo fuera de la app: `node tools/test-xlsx.js`
(escribe un `.xlsx` en la carpeta temporal y lo puede abrir con Excel).

## 5. Importar el mapeo institucional (modo demo)

`tools/importar-mapeo.js` agrega a `renderer/datos.js` las instituciones de un
archivos TSV exportado del XLSX institucional (Comuna, Tipo, Institución,
Dirección, Teléfono, Email, Servicios):

```bash
node tools/importar-mapeo.js [ruta.tsv] [--dry]   # --dry: no escribe nada
```

Cómo mapea cada fila:

- **Destino**: solo `renderer/datos.js` (modo demo). **No toca el Google Sheet
  ni el backend**: el mapa en vivo sigue leyendo del Sheet.
- **Omite** las instituciones que ya existen (se comparan los nombres), así que
  se puede ejecutar varias veces sin duplicar nada.
- **Coordenadas**: geocodifica la dirección con Nominatim/OpenStreetMap y
  descarta el resultado si cae fuera del perímetro urbano o en una comuna
  distinta de la que declara la fila. Si no hay dirección o no hay resultado
  válido, usa el centroide de la comuna (con una separación mínima para que no
  se apilen) o el centro de la ciudad cuando la cobertura es «todas».
- **Categoría institucional (`categoria`)**: Protección (comisarías y Línea
  Violeta), Salud, Justicia (Fiscalía), CAI y Policía (CAI, Inspecciones,
  Departamento de Policía), ONG / Fundaciones, Defensorías (Casa de Justicia,
  Medicina Legal, Personería, Defensoría del Pueblo) y Enfoque diferencial
  (ICBF, CRAV, DAIV). Es la columna **Categoría** del XLSX y alimenta los
  filtros, la leyenda y los colores del mapa. El campo legado `forma` sigue
  guardándose para los datos antiguos y del Sheet en vivo.
- **Tipos de violencia**: por palabras clave en Institución + Servicios, con
  respaldo según la columna Tipo.
- **24 horas**: detecta «24 horas», «24/7» o «24 h» en el nombre, servicios o teléfono.
- **`tiposDetalle`** = Servicios; **`telefono`** = Teléfono + correo;
  la columna Responsable se descarta.
- **`verificado`**: «por verificar» si no hay dirección, «parcialmente
  verificado» si la hubo (la geocodificación es aproximada: todas las filas
  nuevas quedan con `ubicacionAprox: true`).
- Los resultados de Nominatim se guardan en `tools/geocache.json` para no
  repetir consultas (Nominatim permite máximo 1 consulta por segundo).

## Seguridad (qué sí y qué no)

- Las contraseñas se guardan **hasheadas** (SHA-256 con salt) en la hoja *Usuarios*.
- Las acciones de escritura exigen un **token de sesión** (válido 8 horas) que solo se
  obtiene al iniciar sesión.
- La lectura de las instituciones es **pública** a propósito: el mapa es de consulta abierta.
  Cualquiera con la URL del Apps Script puede *ver* los datos, pero no modificarlos sin login.

## Notas

- Requiere internet para: los tiles del mapa (Esri/OpenTopoMap), los íconos Font Awesome
  y el backend de Google.
- Si Google Sheets no está disponible, la app sigue mostrando el mapa en modo demo
  con los datos locales de `renderer/datos.js`.
