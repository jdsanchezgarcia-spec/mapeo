# PROMPT PARA OPENCODE — Mapa de Instituciones de Atención a Violencias de Villavicencio

## Objetivo
Construir una aplicación web (un único `index.html` autocontenido, sin backend) que muestre un **mapa interactivo de las instituciones de Villavicencio (Meta, Colombia) que atienden situaciones de violencia**, diferenciado **por comunas y por colores**, con la identidad visual de la **Alcaldía de Villavicencio** (referencia: https://villavicencio.gov.co — extrae de ahí el verde institucional dominante del sitio; si no puedes acceder, usa `#00843D` como verde primario y `#F2B705` como acento amarillo).

## Stack
- Leaflet 1.9.x (CDN) + capa base OpenStreetMap.
- Leaflet.markercluster para agrupar marcadores.
- HTML + CSS + JS vanilla; un solo archivo `index.html` con los datos embebidos en un arreglo JS `const INSTITUCIONES = [...]`.
- Sin dependencias de build. Debe abrirse con doble clic en el navegador.

## Datos a embeber (cópialos tal cual, corrige las direcciones marcadas como "VERIFICAR" si las tienes; si no, deja el aviso)

[
  {id:1, nombre:"Comisaría de Familia Primera", tipos:["Violencia intrafamiliar","Maltrato infantil","Violencia contra la mujer","Restablecimiento de derechos"], comunas:["5","6"], comunaSede:"por verificar", rural:"Corregimiento 2 (14 veredas)", direccion:"Barrio Teusaca, Calle 23 No. 37 L-14 (VERIFICAR sede actual)", horario:"Lunes a viernes, jornada de oficina", telefono:"(608) 6719462", nivel:"Municipal", 24h:false},
  {id:2, nombre:"Comisaría de Familia Segunda", tipos:["Violencia intrafamiliar","Maltrato infantil","Violencia contra la mujer","Restablecimiento de derechos"], comunas:["8","9"], comunaSede:"por verificar", rural:"Corregimiento 1 (10 veredas)", direccion:"Calle 54 Sur No. 39-59, Ciudad Porfia (Casa de Justicia)", horario:"Lunes a viernes 8:00 a.m. - 5:00 p.m.", telefono:"(608) 6707160", nivel:"Municipal", 24h:false},
  {id:3, nombre:"Comisaría de Familia Tercera", tipos:["Violencia intrafamiliar","Maltrato infantil","Violencia contra la mujer","Restablecimiento de derechos"], comunas:["1","2","3","7"], comunaSede:"por verificar", rural:"Corregimientos 3 y 4 (14 veredas)", direccion:"Calle 34 No. 40-07, Barzal Alto (VERIFICAR sede actual)", horario:"Lunes a viernes, jornada de oficina", telefono:"(608) 6730674", nivel:"Municipal", 24h:false},
  {id:4, nombre:"Comisaría de Familia Cuarta (24 horas)", tipos:["Violencia intrafamiliar","Maltrato infantil","Violencia contra la mujer","Violencia sexual (protección)","Restablecimiento de derechos"], comunas:["4","10"], comunaSede:"por verificar (La Grama)", rural:"Corregimientos 5, 6 y 7 (26 veredas)", direccion:"Carrera 30 No. 41-49, Barrio La Grama", horario:"24 horas, todos los días", telefono:"comisariadefamilia4@villavicencio.gov.co", nivel:"Municipal", 24h:true},
  {id:5, nombre:"Comisaría de Familia Quinta (nueva)", tipos:["Violencia intrafamiliar","Maltrato infantil","Violencia contra la mujer"], comunas:["7"], comunaSede:"7", rural:"—", direccion:"Comuna 7, dirección por confirmar (Acuerdo 037 de 2025, operando desde oct. 2025)", horario:"Por definir", telefono:"—", nivel:"Municipal", 24h:false},
  {id:6, nombre:"Casa de Justicia de Villavicencio", tipos:["Orientación legal VIF y VBG","Conciliación","Justicia restaurativa","Atención interinstitucional (Fiscalía, ICBF, Comisaría)"], comunas:["todas"], comunaSede:"sur (Ciudad Porfia)", rural:"—", direccion:"Calle 54 Sur No. 39-59, Ciudad Porfia", horario:"Lunes a viernes 8:00 a.m. - 5:00 p.m. (jornada continua)", telefono:"(608) 6704931", nivel:"Municipal/Nacional", 24h:false},
  {id:7, nombre:"ICBF Centro Zonal Villavicencio Dos (Protección)", tipos:["Maltrato infantil","Vulneración de derechos de NNA"], comunas:["todas"], comunaSede:"centro (Doña Luz)", rural:"Sí", direccion:"Carrera 22 No. 10-73/89, Barrio Doña Luz", horario:"Lunes a viernes 8:00 a.m. - 5:00 p.m. (jornada continua)", telefono:"Línea 141 / (601) 4377630 ext. 850034", nivel:"Nacional", 24h:false},
  {id:8, nombre:"Dirección de Atención Integral a Víctimas - Alcaldía", tipos:["Víctimas del conflicto armado (Ley 1448 de 2011)","Reparación integral","Articulación de rutas"], comunas:["todas"], comunaSede:"centro", rural:"Sí (7 corregimientos)", direccion:"Calle 40 No. 33-64, Centro (Edificio Alcaldía)", horario:"Lunes a viernes desde 7:45 a.m.", telefono:"—", nivel:"Municipal", 24h:false},
  {id:9, nombre:"Centro Regional de Atención a Víctimas (CRAV) - Unidad para las Víctimas", tipos:["Víctimas del conflicto armado","Registro RUV","Ayudas humanitarias"], comunas:["todas"], comunaSede:"centro", rural:"Sí", direccion:"Carrera 13, centro de Villavicencio", horario:"Jornadas de atención (4.º miércoles de cada mes, 7:00 a.m. - 1:00 p.m.); línea nacional L-V 8:00 a.m. - 6:00 p.m.", telefono:"01 8000 12 25 20", nivel:"Nacional", 24h:false},
  {id:10, nombre:"Hospital Departamental de Villavicencio E.S.E.", tipos:["Violencia sexual (urgencia 24h, kit de evidencia, IVE)","Violencia física","Violencia intrafamiliar (atención en salud)"], comunas:["todas"], comunaSede:"centro (Barzal Alto)", rural:"Sí", direccion:"Calle 37A No. 28-53, Barrio Barzal Alto", horario:"Urgencias 24 horas (violencia sexual = urgencia prioritaria y gratuita)", telefono:"(608) 6817901 / 1800 0930606", nivel:"Departamental", 24h:true},
  {id:11, nombre:"Fiscalía General de la Nación - URI Villavicencio", tipos:["Violencia sexual","Violencia de género e intrafamiliar (delitos)","Feminicidio"], comunas:["todas"], comunaSede:"centro", rural:"Sí", direccion:"Unidad de Reacción Inmediata (URI), sede centro (confirmar)", horario:"URI: 24 horas, 7 días", telefono:"Línea 122 / ADenunciar virtual", nivel:"Nacional", 24h:true},
  {id:12, nombre:"Policía Nacional - Estaciones y CAI", tipos:["Denuncia inmediata VIF y violencia sexual","Protección"], comunas:["todas"], comunaSede:"varias", rural:"Sí", direccion:"Estaciones y CAI por comuna", horario:"24 horas", telefono:"Línea 123", nivel:"Nacional", 24h:true},
  {id:13, nombre:"Medicina Legal - Seccional Meta", tipos:["Peritajes violencia sexual","Peritajes VIF y lesiones personales"], comunas:["todas"], comunaSede:"centro", rural:"Parcial", direccion:"Centro, Villavicencio (confirmar)", horario:"Lunes a viernes, jornada continua", telefono:"confirmar", nivel:"Nacional", 24h:false},
  {id:14, nombre:"Personería Municipal de Villavicencio", tipos:["Defensa de derechos humanos","Acompañamiento a víctimas"], comunas:["todas"], comunaSede:"centro", rural:"Sí", direccion:"Centro administrativo municipal (confirmar)", horario:"Lunes a viernes, jornada de oficina", telefono:"confirmar", nivel:"Municipal", 24h:false},
  {id:15, nombre:"Defensoría del Pueblo - Delegada Meta", tipos:["Defensa de derechos humanos","Orientación jurídica gratuita"], comunas:["todas"], comunaSede:"centro", rural:"Sí", direccion:"Centro, Villavicencio (confirmar)", horario:"Lunes a viernes, jornada de oficina", telefono:"01 8000 914 814", nivel:"Nacional", 24h:false}
]

NOTAS DE GEOREFERENCIACIÓN: las coordenadas aproximadas de partida son lat 4.1420, lng -73.6266 (centro de Villavicencio). Geocodifica cada dirección con Nominatim (https://nominatim.openstreetmap.org/search?format=json&q=...) y guarda lat/lng en el objeto; si una dirección no geocodifica, coloca el marcador en el centro y muéstralo con ícono de "ubicación por verificar". Verifica aproximadamente: Barzal Alto y Ciudad Porfia al sur, La Grama al norte, Barrio Doña Luz al oeste/centro.

## Paleta de colores (identidad Alcaldía de Villavicencio)
- Primario (encabezado, bordes, marcadores "todas las comunas"): verde `#00843D` (tomarlo del CSS de villavicencio.gov.co si es posible).
- Acento: amarillo `#F2B705`; texto oscuro `#1F2A24`; fondo `#FFFFFF` / gris suave `#F4F7F5`.
- **Color por comuna** (cobertura de la comisaría responsable — asigna el color del marcador según la comuna que cubre la institución; si cubre varias o todas, usa verde institucional):
  - Comuna 1 `#1F77B4` (azul)
  - Comuna 2 `#17BECF` (cian)
  - Comuna 3 `#2CA02C` (verde)
  - Comuna 4 `#D62728` (rojo — Comisaría Cuarta 24h: usar borde dorado y símbolo de reloj)
  - Comuna 5 `#9467BD` (morado)
  - Comuna 6 `#8C564B` (marrón)
  - Comuna 7 `#E377C2` (rosa)
  - Comuna 8 `#7F7F7F` (gris)
  - Comuna 9 `#BCBD22` (oliva)
  - Comuna 10 `#FF7F0E` (naranja)
- Tipo de marcador por naturaleza del servicio (forma del ícono): círculo = comisarías; cuadrado = salud (hospital); triángulo = justicia penal (Fiscalía/URI/Policía); estrella = enfoque diferencial (ICBF, CRAV, DAIV); rombo = defensorías (Personería/Defensoría/Medicina Legal).

## Funcionalidades obligatorias
1. **Leyenda** con: (a) los 10 colores de comunas con su comisaría responsable (ej. "Comuna 4 → Comisaría Cuarta 24h"), y (b) las formas de marcador por tipo de servicio.
2. **Filtros** (chips o panel lateral): por comuna, por tipo de violencia (VIF, violencia sexual, maltrato infantil, violencia de género, víctimas del conflicto, orientación legal), y por "atención 24 horas". Los filtros combinan entre sí.
3. **Popup de cada marcador**: nombre, TIPOS de violencia que atiende (como etiquetas/pills), DIRECCIÓN, HORARIO de atención, teléfono/correo, comunas que cubre, zona rural que cubre, y nivel (municipal/departamental/nacional). Si horario incluye "24 horas", resaltarlo en verde institucional.
4. **Panel "Líneas 24 horas"** visible siempre (sidebar o footer fijo): 155 (mujeres), 141 (ICBF), 123 (Policía), 122 (Fiscalía), 01 8000 112 400 (VIF), 01 8000 12 25 20 (Unidad Víctimas), ADenunciar.
5. **Listado lateral** de instituciones sincronizado con el mapa: al filtrar, se filtra la lista; al hacer clic en un elemento, se centra el mapa y abre el popup.
6. **Aviso de verificación**: las instituciones cuya dirección contenga "VERIFICAR" o "confirmar" deben mostrar un badge ámbar "Dato por verificar" en popup y lista.
7. **Encabezado** con título "Mapa de atención a víctimas de violencia — Villavicencio (Meta)", subtítulo "Ruta institucional diferenciada por comunas" y la paleta institucional. Pie de página: "Fuente: Alcaldía de Villavicencio — Secretaría de Gobierno y Posconflicto / ICBF / Fiscalía / Unidad para las Víctimas. Actualizado octubre de 2026".
8. Responsive (móvil: mapa arriba, lista colapsable abajo) y accesible (contraste AA, texto alternativo, navegación por teclado en la lista).

## Entregables
- `index.html` autocontenido.
- `datos.js` separado con el arreglo INSTITUCIONES (index.html lo importa con <script src>) para que sea fácil actualizar datos sin tocar el mapa.
- Ambos archivos deben funcionar abriéndolos directamente desde el disco (file://), sin servidor.

## Criterios de aceptación
- Abrir index.html muestra el mapa centrado en Villavicencio con los 15 marcadores.
- Filtrar por "Comuna 4" deja solo las instituciones que cubren la Comuna 4 (Comisaría Cuarta 24h + instituciones de cobertura total).
- Filtrar por "Violencia sexual" resalta Hospital Departamental y Fiscalía/URI entre otros, y el popup del hospital muestra horario 24h resaltado.
- La leyenda explica colores por comuna y formas por tipo de servicio.
- Sin errores en la consola del navegador.
