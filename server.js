// =====================================================================
// SERVER.JS — Backend de RUTA SIMPLE
// Node.js + Express + SQL Server (mssql) + bcrypt + JWT + cors
// Todo el backend vive en este único archivo: configuración, conexión
// a la base de datos, funciones de negocio (geocodificación y cálculo
// de cercanía) y las rutas/controladores de la API.
// =====================================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;

// Catálogo de tipos de movimiento por parada (debe coincidir con TIPOS_MOVIMIENTO en la base)
const TIPOS_MOVIMIENTO_ID = { BUSCAR: 0, ENTREGAR: 1 };
const TIPOS_MOVIMIENTO_VALIDOS = Object.keys(TIPOS_MOVIMIENTO_ID);

// Estados válidos para la HOJA completa: 0 Pendiente, 1 En viaje, 2 Completado
const ESTADOS_HOJA_VALIDOS = [0, 1, 2];

// Estados válidos para una PARADA individual: Pendiente, Completado o Cancelado
// ("En viaje" no aplica a un punto puntual, solo a la hoja completa)
const ESTADOS_PARADA_VALIDOS = [0, 2, 3];

// =====================================================================
// 1. CONEXIÓN A LA BASE DE DATOS (SQL Server)
// =====================================================================

const dbConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 1433,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true'
    }
};

// Pool único reutilizado en toda la app (evita abrir una conexión por cada request)
const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('Conectado a SQL Server (RUTA_SIMPLE_DB)');
        return pool;
    })
    .catch(err => {
        console.error('Error al conectar a la base de datos:', err);
        process.exit(1);
    });

// =====================================================================
// 2. OPERACIONES DE NEGOCIO
// =====================================================================

// --- 2.1 Geocodificación: convierte una dirección de texto en lat/long ---
// Usa Nominatim (OpenStreetMap), que es gratuito.
async function geocodificarDireccion(direccion) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(direccion)}`;

    const respuesta = await fetch(url, {
        headers: { 'User-Agent': 'RutaSimpleApp/1.0 (contacto@rutasimple.com)' }
    });

    if (!respuesta.ok) {
        throw new Error('No se pudo contactar al servicio de geocodificación');
    }

    const resultados = await respuesta.json();

    if (!resultados.length) {
        return { encontrado: false, latitud: null, longitud: null };
    }

    return {
        encontrado: true,
        latitud: parseFloat(resultados[0].lat),
        longitud: parseFloat(resultados[0].lon)
    };
}

// --- 2.2 Cálculo de cercanía: distancia entre dos puntos (fórmula de Haversine) ---
function distanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- 2.3 Algoritmo del vecino más cercano ---
// Parte del origen y en cada paso visita el destino no visitado más cercano
// al punto actual. destinos: [{ destino_id, latitud, longitud }, ...]
function ordenarPorCercania(origen, destinos) {
    const pendientes = [...destinos];
    const ordenados = [];
    let actual = { latitud: origen.latitud, longitud: origen.longitud };

    while (pendientes.length) {
        let indiceMasCercano = 0;
        let distanciaMinima = Infinity;

        pendientes.forEach((destino, indice) => {
            const distancia = distanciaKm(actual.latitud, actual.longitud, destino.latitud, destino.longitud);
            if (distancia < distanciaMinima) {
                distanciaMinima = distancia;
                indiceMasCercano = indice;
            }
        });

        const [siguiente] = pendientes.splice(indiceMasCercano, 1);
        ordenados.push(siguiente);
        actual = { latitud: siguiente.latitud, longitud: siguiente.longitud };
    }

    return ordenados;
}

// =====================================================================
// 3. MIDDLEWARE DE AUTENTICACIÓN (verificación de JWT)
// =====================================================================

function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // formato "Bearer <token>"

    if (!token) {
        return res.status(401).json({ error: 'No se proporcionó token de autenticación' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido o expirado' });
        }
        req.usuario = payload; // { usuario_id, email_usuario }
        next();
    });
}

// =====================================================================
// 4. CONTROLADORES — AUTENTICACIÓN (registro / login)
// =====================================================================

async function registrarUsuario(req, res) {
    try {
        const { nombre_usuario, email_usuario, contrasena } = req.body;

        if (!nombre_usuario || !email_usuario || !contrasena) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        const pool = await poolPromise;

        const existente = await pool.request()
            .input('email', sql.VarChar(100), email_usuario)
            .query('SELECT usuario_id FROM USUARIOS WHERE email_usuario = @email');

        if (existente.recordset.length > 0) {
            return res.status(409).json({ error: 'Ya existe una cuenta con ese correo electrónico' });
        }

        const hashTexto = await bcrypt.hash(contrasena, SALT_ROUNDS);
        const hashBuffer = Buffer.from(hashTexto, 'utf8'); // contrasena_hash es VARBINARY

        const resultado = await pool.request()
            .input('nombre', sql.VarChar(100), nombre_usuario)
            .input('email', sql.VarChar(100), email_usuario)
            .input('hash', sql.VarBinary(256), hashBuffer)
            .query(`
                INSERT INTO USUARIOS (nombre_usuario, email_usuario, contrasena_hash)
                OUTPUT INSERTED.usuario_id
                VALUES (@nombre, @email, @hash)
            `);

        res.status(201).json({ mensaje: 'Usuario registrado con éxito', usuario_id: resultado.recordset[0].usuario_id });

    } catch (error) {
        console.error('Error en registrarUsuario:', error);
        res.status(500).json({ error: 'Error interno al registrar el usuario' });
    }
}

async function iniciarSesion(req, res) {
    try {
        const { email_usuario, contrasena } = req.body;

        if (!email_usuario || !contrasena) {
            return res.status(400).json({ error: 'Faltan datos obligatorios' });
        }

        const pool = await poolPromise;

        const resultado = await pool.request()
            .input('email', sql.VarChar(100), email_usuario)
            .query(`
                SELECT usuario_id, nombre_usuario, email_usuario, contrasena_hash
                FROM USUARIOS
                WHERE email_usuario = @email
            `);

        if (resultado.recordset.length === 0) {
            return res.status(401).json({ error: 'Correo electrónico o contraseña incorrectos' });
        }

        const usuario = resultado.recordset[0];
        const hashGuardado = usuario.contrasena_hash.toString('utf8');
        const coincide = await bcrypt.compare(contrasena, hashGuardado);

        if (!coincide) {
            return res.status(401).json({ error: 'Correo electrónico o contraseña incorrectos' });
        }

        const token = jwt.sign(
            { usuario_id: usuario.usuario_id, email_usuario: usuario.email_usuario },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        res.json({
            mensaje: 'Inicio de sesión exitoso',
            token,
            usuario: { usuario_id: usuario.usuario_id, nombre_usuario: usuario.nombre_usuario }
        });

    } catch (error) {
        console.error('Error en iniciarSesion:', error);
        res.status(500).json({ error: 'Error interno al iniciar sesión' });
    }
}

// =====================================================================
// 5. CONTROLADORES — HOJAS DE RUTA
// =====================================================================

// Crea una hoja de ruta: geocodifica origen y destinos, calcula el orden
// óptimo por cercanía y guarda todo en una transacción.
async function crearHojaDeRuta(req, res) {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        const { fecha, origen_direccion, destinos } = req.body;
        const usuario_id = req.usuario.usuario_id;

        if (!fecha || !origen_direccion || !Array.isArray(destinos) || destinos.length === 0) {
            return res.status(400).json({ error: 'Faltan datos: fecha, origen_direccion y al menos un destino' });
        }

        // Validar el tipo de movimiento de cada destino (Buscar / Entregar)
        for (const d of destinos) {
            if (!TIPOS_MOVIMIENTO_VALIDOS.includes(d.tipo)) {
                return res.status(400).json({ error: `Tipo de movimiento inválido para "${d.destino_direccion}" (usar BUSCAR o ENTREGAR)` });
            }
        }

        // Geocodificar origen
        const geoOrigen = await geocodificarDireccion(origen_direccion);
        if (!geoOrigen.encontrado) {
            return res.status(422).json({ error: `No se pudo ubicar la dirección de origen: "${origen_direccion}"` });
        }

        // Geocodificar cada destino (secuencial para no saturar Nominatim)
        const destinosGeocodificados = [];
        for (const d of destinos) {
            const geo = await geocodificarDireccion(d.destino_direccion);
            if (!geo.encontrado) {
                return res.status(422).json({ error: `No se pudo ubicar la dirección: "${d.destino_direccion}"` });
            }
            destinosGeocodificados.push({
                destino_direccion: d.destino_direccion,
                tipo_movimiento_id: TIPOS_MOVIMIENTO_ID[d.tipo],
                latitud: geo.latitud,
                longitud: geo.longitud
            });
        }

        await transaction.begin();

        // Insertar la hoja de ruta (estado 0 = PENDIENTE)
        const resultadoHoja = await new sql.Request(transaction)
            .input('usuario_id', sql.Int, usuario_id)
            .input('estado_id', sql.TinyInt, 0)
            .input('fecha', sql.Date, fecha)
            .input('origen_direccion', sql.VarChar(300), origen_direccion)
            .input('origen_latitud', sql.Decimal(9, 6), geoOrigen.latitud)
            .input('origen_longitud', sql.Decimal(9, 6), geoOrigen.longitud)
            .query(`
                INSERT INTO HOJAS_RUTAS
                    (usuario_id, estado_id, fecha, origen_direccion, origen_latitud, origen_longitud, origen_geocodificado)
                OUTPUT INSERTED.hoja_ruta_id
                VALUES (@usuario_id, @estado_id, @fecha, @origen_direccion, @origen_latitud, @origen_longitud, 1)
            `);

        const hoja_ruta_id = resultadoHoja.recordset[0].hoja_ruta_id;

        // Insertar cada destino (con su tipo de movimiento) y guardar su id real de la base
        const destinosConId = [];
        for (const d of destinosGeocodificados) {
            const resultadoDestino = await new sql.Request(transaction)
                .input('hoja_ruta_id', sql.Int, hoja_ruta_id)
                .input('destino_direccion', sql.VarChar(300), d.destino_direccion)
                .input('destino_latitud', sql.Decimal(9, 6), d.latitud)
                .input('destino_longitud', sql.Decimal(9, 6), d.longitud)
                .input('tipo_movimiento_id', sql.TinyInt, d.tipo_movimiento_id)
                .query(`
                    INSERT INTO DESTINOS
                        (hoja_ruta_id, destino_direccion, destino_latitud, destino_longitud, destino_geocodificado, tipo_movimiento_id)
                    OUTPUT INSERTED.destino_id
                    VALUES (@hoja_ruta_id, @destino_direccion, @destino_latitud, @destino_longitud, 1, @tipo_movimiento_id)
                `);

            destinosConId.push({
                destino_id: resultadoDestino.recordset[0].destino_id,
                latitud: d.latitud,
                longitud: d.longitud
            });
        }

        // Calcular el orden óptimo de visita por cercanía
        const destinosOrdenados = ordenarPorCercania(
            { latitud: geoOrigen.latitud, longitud: geoOrigen.longitud },
            destinosConId
        );

        // Guardar el detalle de la ruta con el orden calculado
        for (let i = 0; i < destinosOrdenados.length; i++) {
            await new sql.Request(transaction)
                .input('hoja_ruta_id', sql.Int, hoja_ruta_id)
                .input('destino_id', sql.Int, destinosOrdenados[i].destino_id)
                .input('orden_visita', sql.Int, i + 1)
                .input('estado_punto', sql.TinyInt, 0)
                .query(`
                    INSERT INTO DETALLES_RUTAS (hoja_ruta_id, destino_id, orden_visita, estado_punto)
                    VALUES (@hoja_ruta_id, @destino_id, @orden_visita, @estado_punto)
                `);
        }

        await transaction.commit();

        res.status(201).json({
            mensaje: 'Ruta optimizada y guardada con éxito',
            hoja_ruta_id,
            orden_visita: destinosOrdenados.map((d, i) => ({ orden: i + 1, destino_id: d.destino_id }))
        });

    } catch (error) {
        console.error('Error en crearHojaDeRuta:', error);
        try { await transaction.rollback(); } catch (_) {}
        res.status(500).json({ error: 'Error interno al crear la ruta' });
    }
}

// Historial de hojas de ruta del usuario logueado
async function listarHojasDeRuta(req, res) {
    try {
        const pool = await poolPromise;
        const usuario_id = req.usuario.usuario_id;

        const resultado = await pool.request()
            .input('usuario_id', sql.Int, usuario_id)
            .query(`
                SELECT hr.hoja_ruta_id, hr.fecha, hr.origen_direccion, e.nombre_estado
                FROM HOJAS_RUTAS hr
                JOIN ESTADOS e ON e.estado_id = hr.estado_id
                WHERE hr.usuario_id = @usuario_id
                ORDER BY hr.fecha DESC
            `);

        res.json(resultado.recordset);

    } catch (error) {
        console.error('Error en listarHojasDeRuta:', error);
        res.status(500).json({ error: 'Error interno al obtener el historial' });
    }
}

// Detalle completo de una hoja de ruta con sus paradas en orden (incluye tipo de movimiento)
async function obtenerHojaDeRuta(req, res) {
    try {
        const pool = await poolPromise;
        const usuario_id = req.usuario.usuario_id;
        const hoja_ruta_id = Number(req.params.id);

        const hoja = await pool.request()
            .input('hoja_ruta_id', sql.Int, hoja_ruta_id)
            .input('usuario_id', sql.Int, usuario_id)
            .query(`
                SELECT hr.*, e.nombre_estado
                FROM HOJAS_RUTAS hr
                JOIN ESTADOS e ON e.estado_id = hr.estado_id
                WHERE hr.hoja_ruta_id = @hoja_ruta_id AND hr.usuario_id = @usuario_id
            `);

        if (hoja.recordset.length === 0) {
            return res.status(404).json({ error: 'Hoja de ruta no encontrada' });
        }

        const paradas = await pool.request()
            .input('hoja_ruta_id', sql.Int, hoja_ruta_id)
            .query(`
                SELECT d.destino_id, d.destino_direccion, d.destino_latitud, d.destino_longitud,
                       det.orden_visita, det.estado_punto, ep.nombre_estado AS estado_parada,
                       tm.nombre_tipo AS tipo_movimiento
                FROM DETALLES_RUTAS det
                JOIN DESTINOS d ON d.destino_id = det.destino_id
                JOIN ESTADOS ep ON ep.estado_id = det.estado_punto
                JOIN TIPOS_MOVIMIENTO tm ON tm.tipo_movimiento_id = d.tipo_movimiento_id
                WHERE det.hoja_ruta_id = @hoja_ruta_id
                ORDER BY det.orden_visita ASC
            `);

        res.json({ ...hoja.recordset[0], paradas: paradas.recordset });

    } catch (error) {
        console.error('Error en obtenerHojaDeRuta:', error);
        res.status(500).json({ error: 'Error interno al obtener la ruta' });
    }
}

// Actualiza el estado general de la hoja (Pendiente / En viaje / Completado)
async function actualizarEstadoHojaDeRuta(req, res) {
    try {
        const pool = await poolPromise;
        const usuario_id = req.usuario.usuario_id;
        const hoja_ruta_id = Number(req.params.id);
        const { estado_id } = req.body;

        if (!ESTADOS_HOJA_VALIDOS.includes(estado_id)) {
            return res.status(400).json({ error: 'estado_id inválido (usar 0, 1 o 2)' });
        }

        const resultado = await pool.request()
            .input('hoja_ruta_id', sql.Int, hoja_ruta_id)
            .input('usuario_id', sql.Int, usuario_id)
            .input('estado_id', sql.TinyInt, estado_id)
            .query(`
                UPDATE HOJAS_RUTAS
                SET estado_id = @estado_id
                WHERE hoja_ruta_id = @hoja_ruta_id AND usuario_id = @usuario_id
            `);

        if (resultado.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Hoja de ruta no encontrada' });
        }

        res.json({ mensaje: 'Estado actualizado con éxito' });

    } catch (error) {
        console.error('Error en actualizarEstadoHojaDeRuta:', error);
        res.status(500).json({ error: 'Error interno al actualizar el estado' });
    }
}

// Actualiza el estado de UNA parada puntual (Pendiente / Completado / Cancelado)
async function actualizarEstadoParada(req, res) {
    try {
        const pool = await poolPromise;
        const usuario_id = req.usuario.usuario_id;
        const hoja_ruta_id = Number(req.params.id);
        const destino_id = Number(req.params.destino_id);
        const { estado_id } = req.body;

        if (!ESTADOS_PARADA_VALIDOS.includes(estado_id)) {
            return res.status(400).json({ error: 'estado_id inválido para una parada (usar 0 Pendiente, 2 Completado o 3 Cancelado)' });
        }

        // Verificamos que la hoja sea del usuario logueado antes de tocar nada
        const hoja = await pool.request()
            .input('hoja_ruta_id', sql.Int, hoja_ruta_id)
            .input('usuario_id', sql.Int, usuario_id)
            .query('SELECT hoja_ruta_id FROM HOJAS_RUTAS WHERE hoja_ruta_id = @hoja_ruta_id AND usuario_id = @usuario_id');

        if (hoja.recordset.length === 0) {
            return res.status(404).json({ error: 'Hoja de ruta no encontrada' });
        }

        // El UPDATE ya filtra por hoja_ruta_id Y destino_id juntos, así que solo
        // afecta si esa parada realmente pertenece a esa hoja.
        const resultado = await pool.request()
            .input('hoja_ruta_id', sql.Int, hoja_ruta_id)
            .input('destino_id', sql.Int, destino_id)
            .input('estado_punto', sql.TinyInt, estado_id)
            .query(`
                UPDATE DETALLES_RUTAS
                SET estado_punto = @estado_punto
                WHERE hoja_ruta_id = @hoja_ruta_id AND destino_id = @destino_id
            `);

        if (resultado.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Parada no encontrada en esta hoja de ruta' });
        }

        res.json({ mensaje: 'Estado de la parada actualizado con éxito' });

    } catch (error) {
        console.error('Error en actualizarEstadoParada:', error);
        res.status(500).json({ error: 'Error interno al actualizar el estado de la parada' });
    }
}

// =====================================================================
// 6. CONFIGURACIÓN DEL SERVIDOR EXPRESS
// =====================================================================

const app = express();

app.use(cors());
app.use(express.json());

// Sirve el frontend (carpeta public) directamente desde este mismo servidor
app.use(express.static(path.join(__dirname, 'public')));

// --- Rutas de autenticación ---
app.post('/api/auth/registro', registrarUsuario);
app.post('/api/auth/login', iniciarSesion);

// --- Rutas de hojas de ruta (todas requieren estar logueado) ---
app.post('/api/rutas', verificarToken, crearHojaDeRuta);
app.get('/api/rutas', verificarToken, listarHojasDeRuta);
app.get('/api/rutas/:id', verificarToken, obtenerHojaDeRuta);
app.patch('/api/rutas/:id/estado', verificarToken, actualizarEstadoHojaDeRuta);
app.patch('/api/rutas/:id/destinos/:destino_id/estado', verificarToken, actualizarEstadoParada);

// Manejo básico de errores no capturados
app.use((err, req, res, next) => {
    console.error('Error no controlado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// =====================================================================
// 7. INICIO DEL SERVIDOR
// =====================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`RUTA SIMPLE backend corriendo en http://localhost:${PORT}`);
});
