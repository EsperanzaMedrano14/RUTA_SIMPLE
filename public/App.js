// =====================================================================
// APP.JS — Lógica de conexión entre el frontend (HTML) y el backend (API)
// Este archivo se carga en todas las páginas; cada función de "página"
// solo se ejecuta si encuentra el elemento correspondiente en el DOM.
// =====================================================================

// ---------------------------------------------------------------------
// Utilidades comunes de sesión
// ---------------------------------------------------------------------

function obtenerToken() {
    return localStorage.getItem('token');
}

// Para páginas protegidas: si no hay token, manda al login y devuelve null
function requiereSesion() {
    const token = obtenerToken();
    if (!token) {
        window.location.href = 'index1.html';
        return null;
    }
    return token;
}

// Si el backend responde 401/403, el token venció o es inválido: se limpia y se reloguea
function manejarSesionInvalida(respuesta) {
    if (respuesta.status === 401 || respuesta.status === 403) {
        localStorage.removeItem('token');
        window.location.href = 'index1.html';
        return true;
    }
    return false;
}

function mostrarError(elemento, texto) {
    elemento.textContent = texto;
    elemento.style.display = 'block';
}

function ocultarError(elemento) {
    elemento.style.display = 'none';
}

// ---------------------------------------------------------------------
// index1.html — Login
// ---------------------------------------------------------------------

function inicializarLogin() {
    const formLogin = document.getElementById('formLogin');
    const mensajeError = document.getElementById('mensajeError');

    formLogin.addEventListener('submit', async (evento) => {
        evento.preventDefault();

        const email_usuario = document.getElementById('email_usuario').value;
        const contrasena = document.getElementById('contrasena').value;

        ocultarError(mensajeError);

        try {
            const respuesta = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email_usuario, contrasena })
            });

            const datos = await respuesta.json();

            if (!respuesta.ok) {
                mostrarError(mensajeError, datos.error || 'No se pudo iniciar sesión');
                return;
            }

            localStorage.setItem('token', datos.token);
            localStorage.setItem('usuario', JSON.stringify(datos.usuario));

            window.location.href = 'index2.html';

        } catch (error) {
            console.error('Error al iniciar sesión:', error);
            mostrarError(mensajeError, 'No se pudo conectar con el servidor. Intentá de nuevo.');
        }
    });
}

// ---------------------------------------------------------------------
// index2.html — Datos de viaje (formulario dinámico de paradas)
// ---------------------------------------------------------------------

function inicializarDatosViaje() {
    const token = requiereSesion();
    if (!token) return;

    const listaParadas = document.getElementById('listaParadas');
    const botonAgregarParada = document.getElementById('botonAgregarParada');
    const formRuta = document.getElementById('formRuta');
    const mensajeError = document.getElementById('mensajeError');
    const botonOptimizar = document.getElementById('botonOptimizar');

    function agregarFilaParada() {
        const fila = document.createElement('div');
        fila.className = 'filaParada';
        fila.innerHTML = `
            <input class="datos" type="text" placeholder="Dirección de la parada">
            <select class="tipoMovimiento">
                <option value="ENTREGAR">Entregar paquete</option>
                <option value="BUSCAR">Buscar paquete</option>
            </select>
            <button type="button" class="botonQuitar">Quitar</button>
        `;
        fila.querySelector('.botonQuitar').addEventListener('click', () => fila.remove());
        listaParadas.appendChild(fila);
    }

    botonAgregarParada.addEventListener('click', agregarFilaParada);

    formRuta.addEventListener('submit', async (evento) => {
        evento.preventDefault();

        const origen_direccion = document.getElementById('origen').value;
        const destino_direccion = document.getElementById('destino').value;
        const tipo_destino = document.getElementById('tipo_destino').value;

        // Recorremos todas las filas de paradas que el usuario haya agregado (cantidad variable)
        const paradas = Array.from(listaParadas.querySelectorAll('.filaParada'))
            .map(fila => ({
                destino_direccion: fila.querySelector('.datos').value.trim(),
                tipo: fila.querySelector('.tipoMovimiento').value
            }))
            .filter(parada => parada.destino_direccion.length > 0);

        // El destino final también es un punto a visitar más
        const destinos = [...paradas, { destino_direccion, tipo: tipo_destino }];

        // La fecha del viaje es la de hoy (no se le pide al usuario en este formulario)
        const fecha = new Date().toISOString().slice(0, 10);

        ocultarError(mensajeError);
        botonOptimizar.disabled = true;
        botonOptimizar.textContent = 'Optimizando...';

        try {
            const respuesta = await fetch('/api/rutas', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ fecha, origen_direccion, destinos })
            });

            if (manejarSesionInvalida(respuesta)) return;

            const datos = await respuesta.json();

            if (!respuesta.ok) {
                mostrarError(mensajeError, datos.error || 'No se pudo optimizar la ruta');
                return;
            }

            window.location.href = `index4.html?id=${datos.hoja_ruta_id}`;

        } catch (error) {
            console.error('Error al crear la ruta:', error);
            mostrarError(mensajeError, 'No se pudo conectar con el servidor. Intentá de nuevo.');
        } finally {
            botonOptimizar.disabled = false;
            botonOptimizar.textContent = 'Optimizar Ruta';
        }
    });

    // Arrancamos con una fila de parada vacía para no dejar el formulario vacío del todo
    agregarFilaParada();
}

// ---------------------------------------------------------------------
// index3.html — Registro
// ---------------------------------------------------------------------

function inicializarRegistro() {
    const formRegistro = document.getElementById('formRegistro');
    const mensajeError = document.getElementById('mensajeError');

    formRegistro.addEventListener('submit', async (evento) => {
        evento.preventDefault();

        const nombre_usuario = document.getElementById('nombre_usuario').value;
        const email_usuario = document.getElementById('email_usuario').value;
        const contrasena = document.getElementById('contrasena').value;

        ocultarError(mensajeError);

        try {
            const respuesta = await fetch('/api/auth/registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre_usuario, email_usuario, contrasena })
            });

            const datos = await respuesta.json();

            if (!respuesta.ok) {
                mostrarError(mensajeError, datos.error || 'No se pudo completar el registro');
                return;
            }

            window.location.href = 'index1.html';

        } catch (error) {
            console.error('Error al registrarse:', error);
            mostrarError(mensajeError, 'No se pudo conectar con el servidor. Intentá de nuevo.');
        }
    });
}

// ---------------------------------------------------------------------
// index4.html — Mapa (Leaflet)
// ---------------------------------------------------------------------

// Ícono tipo "gota" de color sólido, sin depender de imágenes externas.
// OJO: usa L.divIcon (Leaflet), así que esta función solo se puede LLAMAR
// dentro de inicializarMapa(), nunca a nivel global del archivo — Leaflet
// no está cargado en las demás páginas (index1, index2, index3, index5).
function crearIconoColor(colorHex) {
    return L.divIcon({
        className: 'marcador-color',
        html: `<div style="
            background:${colorHex};
            width:22px; height:22px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 2px solid white;
            box-shadow: 0 0 4px rgba(0,0,0,0.5);
        "></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 22],
        popupAnchor: [0, -22]
    });
}

// Referencia global al token y a la hoja actual, para que la función que
// llaman los botones del popup (fuera del scope de inicializarMapa) pueda usarlos.
let _tokenMapaActual = null;
let _hojaRutaIdActual = null;

// Se llama desde el onclick de los botones dentro del popup de cada parada.
// Queda colgada de window porque el HTML del popup es un string, no puede
// ver las variables normales de una función.
window.marcarEstadoParada = async function (destino_id, estado_id) {
    try {
        const respuesta = await fetch(`/api/rutas/${_hojaRutaIdActual}/destinos/${destino_id}/estado`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${_tokenMapaActual}`
            },
            body: JSON.stringify({ estado_id })
        });

        if (manejarSesionInvalida(respuesta)) return;

        if (!respuesta.ok) {
            const datos = await respuesta.json();
            alert(datos.error || 'No se pudo actualizar el estado de la parada');
            return;
        }

        location.reload(); // recarga el mapa para reflejar el nuevo estado
    } catch (error) {
        console.error('Error al actualizar el estado de la parada:', error);
        alert('No se pudo conectar con el servidor.');
    }
};

function inicializarMapa() {
    const token = requiereSesion();
    if (!token) return;

    // Estos íconos se crean ACÁ ADENTRO (no a nivel global del archivo)
    // porque dependen de L (Leaflet), que solo existe en esta página.
    const iconoOrigen = crearIconoColor('#6c6c6c');     // gris: punto de partida
    const iconoBuscar = crearIconoColor('#E85D00');     // naranja: buscar paquete
    const iconoEntregar = crearIconoColor('#1565C0');   // azul: entregar paquete

    const parametros = new URLSearchParams(window.location.search);
    const hoja_ruta_id = parametros.get('id');
    const infoRuta = document.getElementById('infoRuta');
    const mensajeError = document.getElementById('mensajeError');

    if (!hoja_ruta_id) {
        mostrarError(mensajeError, 'No se especificó qué hoja de ruta mostrar.');
        return;
    }

    // Guardamos el token y el id de hoja en las variables globales para que
    // marcarEstadoParada() (llamada desde los botones del popup) pueda usarlos.
    _tokenMapaActual = token;
    _hojaRutaIdActual = hoja_ruta_id;

    async function cargarRuta() {
        try {
            const respuesta = await fetch(`/api/rutas/${hoja_ruta_id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (manejarSesionInvalida(respuesta)) return;

            const datos = await respuesta.json();

            if (!respuesta.ok) {
                mostrarError(mensajeError, datos.error || 'No se pudo cargar la ruta');
                return;
            }

            infoRuta.textContent = `Fecha: ${datos.fecha} — Estado: ${datos.nombre_estado}`;

            const mapa = L.map('map').setView([datos.origen_latitud, datos.origen_longitud], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapa);

            const puntos = [[datos.origen_latitud, datos.origen_longitud]];

            L.marker([datos.origen_latitud, datos.origen_longitud], { icon: iconoOrigen })
                .addTo(mapa)
                .bindPopup(`<b>Origen</b><br>${datos.origen_direccion}`);

            datos.paradas.forEach((parada) => {
                puntos.push([parada.destino_latitud, parada.destino_longitud]);

                const esBuscar = parada.tipo_movimiento === 'BUSCAR';
                const icono = esBuscar ? iconoBuscar : iconoEntregar;
                const etiquetaTipo = esBuscar ? 'Buscar paquete' : 'Entregar paquete';

                // Si ya está Completada o Cancelada, no mostramos botones de acción,
                // solo el estado (para no dejar cambiarla de vuelta por error).
                const esFinal = parada.estado_parada === 'COMPLETADO' || parada.estado_parada === 'CANCELADO';
                const botonesAccion = esFinal ? '' : `
                    <br>
                    <button onclick="marcarEstadoParada(${parada.destino_id}, 2)" style="width:auto;padding:6px 10px;margin:4px 4px 0 0;font-size:13px;">Completada</button>
                    <button onclick="marcarEstadoParada(${parada.destino_id}, 3)" style="width:auto;padding:6px 10px;margin:4px 0 0 0;font-size:13px;background:#D24200;">Cancelar</button>
                `;

                L.marker([parada.destino_latitud, parada.destino_longitud], { icon: icono })
                    .addTo(mapa)
                    .bindPopup(`
                        <b>Parada ${parada.orden_visita}</b><br>
                        ${parada.destino_direccion}<br>
                        <b>${etiquetaTipo}</b><br>
                        Estado: ${parada.estado_parada}
                        ${botonesAccion}
                    `);
            });

            L.polyline(puntos, { color: '#E85D00', weight: 4 }).addTo(mapa);
            mapa.fitBounds(puntos);

        } catch (error) {
            console.error('Error al cargar la ruta:', error);
            mostrarError(mensajeError, 'No se pudo conectar con el servidor.');
        }
    }

    async function cambiarEstado(estado_id) {
        try {
            const respuesta = await fetch(`/api/rutas/${hoja_ruta_id}/estado`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ estado_id })
            });

            if (manejarSesionInvalida(respuesta)) return;

            const datos = await respuesta.json();

            if (!respuesta.ok) {
                mostrarError(mensajeError, datos.error || 'No se pudo actualizar el estado');
                return;
            }

            ocultarError(mensajeError);
            location.reload();
        } catch (error) {
            console.error('Error al actualizar el estado:', error);
        }
    }

    document.getElementById('btnEnViaje').addEventListener('click', () => cambiarEstado(1));
    document.getElementById('btnCompletado').addEventListener('click', () => cambiarEstado(2));

    cargarRuta();
}

// ---------------------------------------------------------------------
// index5.html — Historial
// ---------------------------------------------------------------------

function inicializarHistorial() {
    const token = requiereSesion();
    if (!token) return;

    const listaHistorial = document.getElementById('listaHistorial');
    const mensajeError = document.getElementById('mensajeError');

    async function cargarHistorial() {
        try {
            const respuesta = await fetch('/api/rutas', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (manejarSesionInvalida(respuesta)) return;

            const hojas = await respuesta.json();

            if (!respuesta.ok) {
                mostrarError(mensajeError, hojas.error || 'No se pudo cargar el historial');
                return;
            }

            if (hojas.length === 0) {
                listaHistorial.innerHTML = '<p>Todavía no creaste ninguna hoja de ruta.</p>';
                return;
            }

            listaHistorial.innerHTML = hojas.map(hoja => `
                <div class="itemHistorial" onclick="window.location.href='index4.html?id=${hoja.hoja_ruta_id}'">
                    <b>${hoja.fecha}</b> — ${hoja.origen_direccion}
                    <br>Estado: ${hoja.nombre_estado}
                </div>
            `).join('');

        } catch (error) {
            console.error('Error al cargar el historial:', error);
            mostrarError(mensajeError, 'No se pudo conectar con el servidor.');
        }
    }

    cargarHistorial();
}

// ---------------------------------------------------------------------
// Punto de entrada: detecta en qué página estamos y ejecuta su lógica
// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('formLogin')) inicializarLogin();
    if (document.getElementById('formRuta')) inicializarDatosViaje();
    if (document.getElementById('formRegistro')) inicializarRegistro();
    if (document.getElementById('map')) inicializarMapa();
    if (document.getElementById('listaHistorial')) inicializarHistorial();
});
