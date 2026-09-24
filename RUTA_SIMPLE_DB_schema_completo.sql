-- =====================================================================
-- RUTA SIMPLE — Script de creación de base de datos
-- Contiene el esquema COMPLETO y ACTUAL del sistema (no es un historial
-- de migraciones): basta con correr este único archivo en una instancia
-- de SQL Server para dejar la base lista para usar con el backend.
-- =====================================================================

CREATE DATABASE RUTA_SIMPLE_DB;
GO

USE RUTA_SIMPLE_DB;
GO

-- =====================================================================
-- 1. USUARIOS
-- =====================================================================
CREATE TABLE USUARIOS (
    usuario_id INT IDENTITY(1,1) PRIMARY KEY,
    nombre_usuario VARCHAR(100) NOT NULL,
    email_usuario VARCHAR(100) NOT NULL UNIQUE,
    contrasena_hash VARBINARY(256) NOT NULL,
    fecha_registro DATETIME NOT NULL DEFAULT GETDATE()
);
GO

-- =====================================================================
-- 2. ESTADOS (catálogo, usado tanto por HOJAS_RUTAS como por DETALLES_RUTAS)
-- =====================================================================
CREATE TABLE ESTADOS (
    estado_id TINYINT NOT NULL PRIMARY KEY,
    nombre_estado VARCHAR(20) NOT NULL UNIQUE
);
GO

INSERT INTO ESTADOS (estado_id, nombre_estado)
VALUES
    (0, 'PENDIENTE'),
    (1, 'EN VIAJE'),
    (2, 'COMPLETADO'),
    (3, 'CANCELADO');
GO

-- =====================================================================
-- 3. TIPOS_MOVIMIENTO (catálogo: si en esa parada hay que buscar o entregar un paquete)
-- =====================================================================
CREATE TABLE TIPOS_MOVIMIENTO (
    tipo_movimiento_id TINYINT NOT NULL PRIMARY KEY,
    nombre_tipo VARCHAR(20) NOT NULL UNIQUE
);
GO

INSERT INTO TIPOS_MOVIMIENTO (tipo_movimiento_id, nombre_tipo)
VALUES
    (0, 'BUSCAR'),
    (1, 'ENTREGAR');
GO

-- =====================================================================
-- 4. HOJAS_RUTAS (una jornada/viaje completo de un usuario)
-- =====================================================================
CREATE TABLE HOJAS_RUTAS (
    hoja_ruta_id INT IDENTITY(1,1) PRIMARY KEY,
    usuario_id INT NOT NULL,
    estado_id TINYINT NOT NULL DEFAULT 0,
    fecha DATE NOT NULL,
    origen_direccion VARCHAR(300) NOT NULL,
    origen_latitud DECIMAL(9,6) NOT NULL,
    origen_longitud DECIMAL(9,6) NOT NULL,
    origen_geocodificado BIT NOT NULL DEFAULT 0,

    CONSTRAINT FK_HOJARUTA_USUARIO FOREIGN KEY (usuario_id) REFERENCES USUARIOS (usuario_id),
    CONSTRAINT FK_HOJARUTA_ESTADO FOREIGN KEY (estado_id) REFERENCES ESTADOS (estado_id)
);
GO

-- =====================================================================
-- 5. DESTINOS (cada parada de una hoja de ruta, con su tipo de movimiento)
-- =====================================================================
CREATE TABLE DESTINOS (
    destino_id INT IDENTITY(1,1) PRIMARY KEY,
    hoja_ruta_id INT NOT NULL,
    destino_direccion VARCHAR(300) NOT NULL,
    destino_latitud DECIMAL(9,6) NULL,
    destino_longitud DECIMAL(9,6) NULL,
    destino_geocodificado BIT NOT NULL DEFAULT 0,
    tipo_movimiento_id TINYINT NOT NULL DEFAULT 1,

    CONSTRAINT FK_DESTINO_HOJARUTA FOREIGN KEY (hoja_ruta_id) REFERENCES HOJAS_RUTAS (hoja_ruta_id),
    CONSTRAINT FK_DESTINO_TIPO_MOVIMIENTO FOREIGN KEY (tipo_movimiento_id) REFERENCES TIPOS_MOVIMIENTO (tipo_movimiento_id)
);
GO

-- =====================================================================
-- 6. DETALLES_RUTAS (orden de visita calculado y estado de cada parada)
-- =====================================================================
CREATE TABLE DETALLES_RUTAS (
    detalle_id INT IDENTITY(1,1) PRIMARY KEY,
    hoja_ruta_id INT NOT NULL,
    destino_id INT NOT NULL,
    orden_visita INT NOT NULL,
    estado_punto TINYINT NOT NULL DEFAULT 0,

    CONSTRAINT FK_DETALLE_HOJARUTA FOREIGN KEY (hoja_ruta_id) REFERENCES HOJAS_RUTAS (hoja_ruta_id),
    CONSTRAINT FK_DETALLE_DESTINO FOREIGN KEY (destino_id) REFERENCES DESTINOS (destino_id),
    CONSTRAINT FK_DETALLE_ESTADO FOREIGN KEY (estado_punto) REFERENCES ESTADOS (estado_id),

    CONSTRAINT UQ_ORDEN_POR_HOJA UNIQUE (hoja_ruta_id, orden_visita),
    CONSTRAINT UQ_DESTINO_POR_HOJA UNIQUE (hoja_ruta_id, destino_id)
);
GO

-- =====================================================================
-- 7. ÍNDICES
-- =====================================================================
CREATE INDEX IX_HOJARUTA_USUARIO ON HOJAS_RUTAS (usuario_id, fecha);
CREATE INDEX IX_DESTINOS_HOJARUTA ON DESTINOS (hoja_ruta_id);
CREATE INDEX IX_DETALLE_HOJARUTA ON DETALLES_RUTAS (hoja_ruta_id);
GO

-- =====================================================================
-- 8. USUARIO DE APLICACIÓN (login de SQL Server para que use el backend)
-- Requiere que el servidor tenga habilitado el modo de autenticación mixta
-- (SQL Server and Windows Authentication mode).
-- Cambiá 'TU_CONTRASENA_AQUI' por una contraseña propia antes de ejecutar.
-- =====================================================================
CREATE LOGIN ruta_simple_app WITH PASSWORD = 'TU_CONTRASENA_AQUI';
GO

CREATE USER ruta_simple_app FOR LOGIN ruta_simple_app;
GO

ALTER ROLE db_owner ADD MEMBER ruta_simple_app;
GO
