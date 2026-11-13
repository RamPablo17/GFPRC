// Solo se conserva temporalmente para migrar tarjetas antiguas a Firebase.
let tarjetasLocalesPendientesMigracion = (() => {
    try {
        const datos = JSON.parse(localStorage.getItem('finanzas_tarjetas'));
        return Array.isArray(datos) ? datos : [];
    } catch (error) {
        console.error('No se pudieron leer tarjetas antiguas del navegador:', error);
        return [];
    }
})();
let tarjetas = [];
let creditos = [];
let prestamos = [];
let usuarioActual = null;
let personas = [];
let tarjetasActuales = [];
let mesSeleccionado = obtenerMesActual();
let diaSeleccionadoCalendario = '';
let mesUltimaRevision = mesSeleccionado;
let revisionMensualTimer = null;
let creditoMovimientosExpandidoId = '';
const valorOtraPersonaPrestamo = '__otra_persona__';
const correoCuentaSrTono = 'tonito@gmail.com';

// Inicializar autenticación y datos al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('formAcceso').addEventListener('submit', iniciarSesion);
    document.getElementById('botonRegistro').addEventListener('click', registrarUsuario);
    document.getElementById('botonMesAnteriorCalendario').addEventListener('click', () => navegarMesCalendario(-1));
    document.getElementById('botonMesSiguienteCalendario').addEventListener('click', () => navegarMesCalendario(1));
    document.getElementById('limpiarFiltroCalendario').addEventListener('click', () => {
        diaSeleccionadoCalendario = '';
        renderizarCalendario();
    });
    document.getElementById('botonVencimientos').addEventListener('click', abrirModalVencimientos);
    document.getElementById('cerrarModalVencimientos').addEventListener('click', cerrarModalVencimientos);
    document.getElementById('botonCerrarVencimientos').addEventListener('click', cerrarModalVencimientos);
    document.getElementById('modalVencimientos').addEventListener('click', event => {
        if (event.target.id === 'modalVencimientos') cerrarModalVencimientos();
    });
    document.getElementById('editarDetalleTarjeta').addEventListener('click', () => {
        const id = tarjetaDetalleId;
        if (!id || mesSeleccionado !== obtenerMesActual()) return;
        cerrarDetalleTarjeta();
        editarTarjeta(id);
    });
    document.getElementById('eliminarDetalleTarjeta').addEventListener('click', async () => {
        const id = tarjetaDetalleId;
        if (!id) return;
        await eliminarTarjeta(id);
        if (!tarjetas.some(tarjeta => tarjeta.id === id)) cerrarDetalleTarjeta();
    });
    document.getElementById('pagoDetalleTarjeta').addEventListener('click', async () => {
        if (tarjetaDetalleId) await cambiarEstadoPago(tarjetaDetalleId);
    });
    document.getElementById('conceptosDetalleTarjeta').addEventListener('click', () => {
        if (!tarjetaDetalleId) return;
        const id = tarjetaDetalleId;
        cerrarDetalleTarjeta();
        abrirModalConceptos(id);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            cerrarModalVencimientos();
            if (tarjetaDetalleId) cerrarDetalleTarjeta();
            if (obligacionDetalle) cerrarDetalleObligacion();
        }
    });
    auth.onAuthStateChanged(async usuario => {
        usuarioActual = usuario;
        if (!usuario) {
            cerrarDetalleTarjeta();
            cerrarDetalleObligacion();
            if (revisionMensualTimer) {
                clearInterval(revisionMensualTimer);
                revisionMensualTimer = null;
            }
            document.getElementById('pantallaAcceso').classList.remove('hidden');
            document.getElementById('contenidoApp').classList.add('hidden');
            return;
        }

        if (esCuentaSrTono(usuario)) {
            window.location.replace('sr-tono.html');
            return;
        }

        document.getElementById('errorAcceso').classList.add('hidden');
        document.getElementById('correoUsuario').innerText = usuario.email || '';
        let etapaCarga = 'perfil del usuario';
        try {
            await db.collection('usuario').doc(usuario.uid).set({
                correo: usuario.email
            }, { merge: true });
            etapaCarga = 'personas de la colección Usuarios';
            await cargarPersonas();
            etapaCarga = 'tarjetas e historial mensual';
            await cargarTarjetasDeFirebase();
            etapaCarga = 'créditos y préstamos';
            await cargarObligacionesDeFirebase();
            etapaCarga = 'mostrar la aplicación';
            document.getElementById('pantallaAcceso').classList.add('hidden');
            document.getElementById('contenidoApp').classList.remove('hidden');
            renderizarTodo();
            iniciarRevisionMensual();
        } catch (error) {
            console.error(`Error al cargar ${etapaCarga} desde Firebase:`, error);
            document.getElementById('pantallaAcceso').classList.remove('hidden');
            document.getElementById('contenidoApp').classList.add('hidden');
            if (error.code === 'app/no-personas') {
                mostrarErrorAcceso('Iniciaste sesión, pero la colección Usuarios está vacía o no tiene documentos con el campo Usuario (o Usuarios). Agrega al menos una persona en Firestore.');
            } else if (error.code === 'permission-denied' || error.code === 'firestore/permission-denied') {
                mostrarErrorAcceso(`Iniciaste sesión, pero Firestore denegó el acceso a ${etapaCarga}. Publica las reglas de firestore.rules en Firebase Console y vuelve a intentarlo.`);
            } else {
                const codigo = error.code ? ` Código: ${error.code}.` : '';
                const detalle = error.message ? ` Detalle: ${error.message}` : '';
                mostrarErrorAcceso(`Iniciaste sesión, pero falló la etapa "${etapaCarga}".${codigo}${detalle}`);
            }
            try {
                await auth.signOut();
            } catch (signOutError) {
                console.error('No se pudo cerrar la sesión después del error de carga:', signOutError);
            }
        }
    }, error => {
        console.error('Error al verificar la sesión:', error);
        mostrarErrorAcceso('No se pudo verificar la sesión. Recarga la página e inténtalo de nuevo.');
    });
});

async function iniciarSesion(event) {
    event.preventDefault();
    const boton = document.getElementById('botonAcceso');
    const botonRegistro = document.getElementById('botonRegistro');
    boton.disabled = true;
    botonRegistro.disabled = true;
    boton.innerText = 'Iniciando sesión...';
    document.getElementById('errorAcceso').classList.add('hidden');
    try {
        await auth.signInWithEmailAndPassword(
            normalizarCorreoAcceso(document.getElementById('correoAcceso').value),
            document.getElementById('contrasenaAcceso').value
        );
    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        mostrarErrorAcceso(error.code === 'auth/invalid-credential'
            ? 'El correo o la contraseña no son correctos.'
            : 'No se pudo iniciar sesión. Revisa los datos e inténtalo de nuevo.');
    } finally {
        boton.disabled = false;
        botonRegistro.disabled = false;
        boton.innerText = 'Iniciar sesión';
    }
}

async function registrarUsuario() {
    const boton = document.getElementById('botonRegistro');
    const botonAcceso = document.getElementById('botonAcceso');
    const formulario = document.getElementById('formAcceso');
    if (!formulario.reportValidity()) return;

    const contrasena = document.getElementById('contrasenaAcceso').value;
    const correo = normalizarCorreoAcceso(document.getElementById('correoAcceso').value);
    if (correo === correoCuentaSrTono) {
        mostrarErrorAcceso('La cuenta de Toñito se debe crear desde Firebase Console; no está disponible en el registro público.');
        return;
    }
    if (contrasena.length < 6) {
        mostrarErrorAcceso('La contraseña debe tener al menos 6 caracteres.');
        return;
    }

    boton.disabled = true;
    botonAcceso.disabled = true;
    boton.innerText = 'Creando cuenta...';
    document.getElementById('errorAcceso').classList.add('hidden');
    try {
        await auth.createUserWithEmailAndPassword(
            correo,
            contrasena
        );
    } catch (error) {
        console.error('Error al crear la cuenta:', error);
        const mensajes = {
            'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Inicia sesión.',
            'auth/invalid-email': 'Ingresa un correo electrónico válido.',
            'auth/operation-not-allowed': 'Activa el proveedor Correo/contraseña en Firebase Authentication.',
            'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.'
        };
        mostrarErrorAcceso(mensajes[error.code] || 'No se pudo crear la cuenta. Revisa los datos e inténtalo de nuevo.');
    } finally {
        boton.disabled = false;
        botonAcceso.disabled = false;
        boton.innerText = 'Crear cuenta';
    }
}

function normalizarCorreoAcceso(valor) {
    const usuario = valor.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
    return usuario === 'tonito' ? correoCuentaSrTono : valor.trim();
}

function esCuentaSrTono(usuario) {
    return usuario?.email?.toLocaleLowerCase('es') === correoCuentaSrTono;
}

function mostrarErrorAcceso(mensaje) {
    const errorAcceso = document.getElementById('errorAcceso');
    errorAcceso.innerText = mensaje;
    errorAcceso.classList.remove('hidden');
}

async function cerrarSesion() {
    try {
        await auth.signOut();
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        mostrarMensajeEstado('No se pudo cerrar la sesión. Inténtalo de nuevo.', true);
    }
}

async function cargarTarjetasDeFirebase() {
    const referencia = db.collection('users').doc(usuarioActual.uid).collection('tarjetas');
    const resultado = await referencia.get();
    const tarjetasPorId = new Map(
        resultado.docs.map(documento => [documento.id, { ...documento.data(), id: documento.id }])
    );
    const tarjetasMigradas = [];

    tarjetasLocalesPendientesMigracion.forEach(tarjetaLocal => {
        const id = tarjetaLocal.id ? String(tarjetaLocal.id) : referencia.doc().id;
        if (!tarjetasPorId.has(id)) {
            const tarjetaMigrada = { ...tarjetaLocal, id };
            tarjetasPorId.set(id, tarjetaMigrada);
            tarjetasMigradas.push(tarjetaMigrada);
        }
    });

    tarjetas = [...tarjetasPorId.values()];

    const mesActual = obtenerMesActual();
    const documentoMesActual = await referenciaMes(mesActual).get();
    if (!documentoMesActual.exists) {
        tarjetas = await crearMesesFaltantes(tarjetas, mesActual);
    } else {
        const resultadoMesActual = await referenciaMes(mesActual).collection('tarjetas').get();
        const tarjetasMes = new Map(resultadoMesActual.docs.map(documento => [
            documento.id,
            { ...documento.data(), id: documento.id }
        ]));
        if (resultadoMesActual.empty && tarjetasPorId.size > 0) {
            tarjetasPorId.forEach((tarjeta, id) => {
                if (!tarjetasMes.has(id)) tarjetasMes.set(id, tarjeta);
            });
        }
        tarjetasMigradas.forEach(tarjeta => {
            if (!tarjetasMes.has(tarjeta.id)) tarjetasMes.set(tarjeta.id, tarjeta);
        });
        tarjetas = [...tarjetasMes.values()];
    }

    tarjetasActuales = copiarTarjetas(tarjetas);
    mesSeleccionado = mesActual;
    await sincronizarTarjetasEnFirebase(tarjetasActuales);
    await cargarMesesDisponibles();

    tarjetasLocalesPendientesMigracion = [];
    try {
        localStorage.removeItem('finanzas_tarjetas');
    } catch (error) {
        console.error('No se pudo borrar la copia antigua de tarjetas del navegador:', error);
    }
}

async function cargarObligacionesDeFirebase() {
    const usuarioRef = db.collection('users').doc(usuarioActual.uid);
    const [resultadoCreditos, resultadoPrestamos] = await Promise.all([
        usuarioRef.collection('creditos').get(),
        usuarioRef.collection('prestamos').get()
    ]);
    creditos = resultadoCreditos.docs.map(documento => ({ ...documento.data(), id: documento.id }));
    const prestamosOriginales = resultadoPrestamos.docs.map(documento => ({ ...documento.data(), id: documento.id }));
    const idsSrTonoPorNormalizar = new Set(prestamosOriginales
        .filter(prestamo => esPrestamoSrTono(prestamo) && prestamo.prestamistaNombre !== 'Sr. Toño')
        .map(prestamo => prestamo.id));
    prestamos = prestamosOriginales.map(prestamo => idsSrTonoPorNormalizar.has(prestamo.id)
        ? { ...prestamo, prestamistaNombre: 'Sr. Toño' }
        : prestamo);
    const prestamosConNombreNormalizado = prestamos.filter(prestamo => idsSrTonoPorNormalizar.has(prestamo.id));
    if (prestamosConNombreNormalizado.length) {
        const lote = db.batch();
        prestamosConNombreNormalizado.forEach(prestamo => {
            lote.set(usuarioRef.collection('prestamos').doc(prestamo.id), prestamo);
        });
        await lote.commit();
    }
}

async function cargarPersonas() {
    const resultado = await db.collection('Usuarios').get();
    personas = resultado.docs
        .map(documento => {
            const datos = documento.data();
            return {
                id: documento.id,
                nombre: String(datos.Usuario || datos.Usuarios || '').trim()
            };
        })
        .filter(persona => persona.nombre)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    if (personas.length === 0) {
        const error = new Error('La colección Usuarios no contiene documentos con el campo Usuario.');
        error.code = 'app/no-personas';
        throw error;
    }
}

function obtenerMesActual() {
    const ahora = new Date();
    return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
}

function desplazarFechaAlMes(fecha, mesDestino) {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{4}-\d{2}$/.test(mesDestino)) {
        return fecha || '';
    }

    const [anio, mes] = mesDestino.split('-').map(Number);
    const diaOriginal = Number(fecha.slice(-2));
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const dia = Math.min(diaOriginal, ultimoDia);
    return `${mesDestino}-${String(dia).padStart(2, '0')}`;
}

function prepararTarjetasParaMes(listaTarjetas, mesDestino) {
    return copiarTarjetas(listaTarjetas).map(tarjeta => {
        const diaFecha = Number(String(tarjeta.fechaLimite || '').slice(-2));
        const diaLimiteRecurrente = Number(tarjeta.diaLimiteRecurrente) || diaFecha || 0;
        const fechaBase = diaLimiteRecurrente
            ? `${mesDestino}-${String(diaLimiteRecurrente).padStart(2, '0')}`
            : tarjeta.fechaLimite;

        return {
            ...tarjeta,
            fechaLimite: desplazarFechaAlMes(fechaBase, mesDestino),
            diaLimiteRecurrente,
            pagada: false
        };
    });
}

function copiarTarjetas(lista) {
    return JSON.parse(JSON.stringify(lista));
}

function referenciaMes(mes) {
    return db.collection('users').doc(usuarioActual.uid).collection('meses').doc(mes);
}

function siguienteMes(mes) {
    const [anio, numeroMes] = mes.split('-').map(Number);
    return numeroMes === 12
        ? `${anio + 1}-01`
        : `${anio}-${String(numeroMes + 1).padStart(2, '0')}`;
}

async function leerTarjetasDelMes(mes) {
    const resultado = await referenciaMes(mes).collection('tarjetas').get();
    return resultado.docs.map(documento => ({ ...documento.data(), id: documento.id }));
}

async function crearMesesFaltantes(tarjetasBase, mesDestino) {
    const resultadoMeses = await db.collection('users').doc(usuarioActual.uid).collection('meses').get();
    const mesesAnteriores = resultadoMeses.docs
        .map(documento => documento.id)
        .filter(mes => /^\d{4}-\d{2}$/.test(mes) && mes < mesDestino)
        .sort();
    if (mesesAnteriores.length === 0) {
        return prepararTarjetasParaMes(tarjetasBase, mesDestino);
    }

    let mes = mesesAnteriores[0];
    let tarjetasMes = tarjetasBase;
    while (mes <= mesDestino) {
        const documentoMes = await referenciaMes(mes).get();
        if (documentoMes.exists) {
            const tarjetasGuardadas = await leerTarjetasDelMes(mes);
            const cantidadGuardada = documentoMes.data()?.cantidadTarjetas;
            if (tarjetasGuardadas.length > 0 || cantidadGuardada === 0 || mes !== mesesAnteriores[0]) {
                tarjetasMes = tarjetasGuardadas;
            }
        } else {
            tarjetasMes = prepararTarjetasParaMes(tarjetasMes, mes);
            await guardarCopiaMensual(mes, tarjetasMes);
        }
        mes = siguienteMes(mes);
    }
    return tarjetasMes;
}

async function guardarCopiaMensual(mes, listaTarjetas) {
    const documentoMes = referenciaMes(mes);
    await documentoMes.set({
        mes,
        cantidadTarjetas: listaTarjetas.length,
        actualizado: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const referenciaTarjetas = documentoMes.collection('tarjetas');
    const existentes = await referenciaTarjetas.get();
    const idsActuales = new Set(listaTarjetas.map(tarjeta => tarjeta.id));
    const lote = db.batch();

    existentes.docs.forEach(documento => {
        if (!idsActuales.has(documento.id)) lote.delete(documento.ref);
    });
    listaTarjetas.forEach(tarjeta => {
        lote.set(referenciaTarjetas.doc(tarjeta.id), tarjeta);
    });
    if (!existentes.empty || listaTarjetas.length > 0) await lote.commit();
}

async function cargarMesesDisponibles() {
    const resultado = await db.collection('users').doc(usuarioActual.uid).collection('meses').get();
    const meses = new Set([obtenerMesActual()]);
    resultado.docs.forEach(documento => {
        if (/^\d{4}-\d{2}$/.test(documento.id)) meses.add(documento.id);
    });

    const selector = document.getElementById('selectorMes');
    selector.innerHTML = [...meses].sort().reverse().map(mes => {
        const [anio, numeroMes] = mes.split('-').map(Number);
        const etiqueta = new Intl.DateTimeFormat('es-MX', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC'
        }).format(new Date(Date.UTC(anio, numeroMes - 1, 1)));
        return `<option value="${mes}">${etiqueta}</option>`;
    }).join('');
    selector.value = obtenerMesActual();
    mesUltimaRevision = obtenerMesActual();
    actualizarVistaMes();
}

function iniciarRevisionMensual() {
    if (revisionMensualTimer) clearInterval(revisionMensualTimer);
    revisionMensualTimer = setInterval(async () => {
        const mesActual = obtenerMesActual();
        if (!usuarioActual || mesActual === mesUltimaRevision) return;

        const cambiarVista = mesSeleccionado === mesUltimaRevision;
        try {
            const nuevasTarjetas = await crearMesesFaltantes(tarjetasActuales, mesActual);
            await sincronizarTarjetasEnFirebase(nuevasTarjetas);
            tarjetasActuales = copiarTarjetas(nuevasTarjetas);
            mesUltimaRevision = mesActual;
            if (cambiarVista) {
                mesSeleccionado = mesActual;
                tarjetas = copiarTarjetas(nuevasTarjetas);
            }
            await cargarMesesDisponibles();
            document.getElementById('selectorMes').value = mesSeleccionado;
            actualizarVistaMes();
            if (cambiarVista) renderizarTodo();
        } catch (error) {
            console.error('Error al crear el historial del nuevo mes:', error);
            mostrarMensajeEstado('No se pudo crear la copia automática del nuevo mes. Se volverá a intentar.', true);
        }
    }, 60000);
}

async function cambiarMes(mes) {
    mesSeleccionado = mes;
    diaSeleccionadoCalendario = '';
    if (mes === obtenerMesActual()) {
        tarjetas = copiarTarjetas(tarjetasActuales);
    } else {
        try {
            const resultado = await referenciaMes(mes).collection('tarjetas').get();
            tarjetas = resultado.docs.map(documento => ({ ...documento.data(), id: documento.id }));
        } catch (error) {
            console.error('Error al cargar el historial mensual:', error);
            mostrarMensajeEstado('No se pudo cargar el historial de ese mes. Verifica que las reglas de Firestore estén publicadas.', true);
            document.getElementById('selectorMes').value = obtenerMesActual();
            mesSeleccionado = obtenerMesActual();
            tarjetas = copiarTarjetas(tarjetasActuales);
        }
    }

    actualizarVistaMes();
    renderizarTodo();
}

function actualizarVistaMes() {
    const esHistorico = mesSeleccionado !== obtenerMesActual();
    document.getElementById('avisoMesHistorico').classList.toggle('hidden', !esHistorico);
    document.getElementById('botonCrear').classList.toggle('hidden', esHistorico);
    document.getElementById('seccionObligaciones').classList.toggle('hidden', esHistorico);
}

async function sincronizarTarjetasEnFirebase(listaTarjetas = tarjetas) {
    const referencia = db.collection('users').doc(usuarioActual.uid).collection('tarjetas');
    const existentes = await referencia.get();
    const idsActuales = new Set(listaTarjetas.map(tarjeta => tarjeta.id));
    const lote = db.batch();

    existentes.docs.forEach(documento => {
        if (!idsActuales.has(documento.id)) lote.delete(documento.ref);
    });
    listaTarjetas.forEach(tarjeta => {
        lote.set(referencia.doc(tarjeta.id), tarjeta);
    });
    if (!existentes.empty || listaTarjetas.length > 0) await lote.commit();
    await guardarCopiaMensual(obtenerMesActual(), listaTarjetas);
}

// Guardar localmente y sincronizar las tarjetas de la cuenta autenticada
async function guardarEnStorage() {
    if (mesSeleccionado !== obtenerMesActual()) {
        mostrarMensajeEstado('El historial de meses anteriores es de solo lectura.', true);
        return false;
    }

    const datosGuardados = copiarTarjetas(tarjetas);
    if (!usuarioActual) {
        mostrarMensajeEstado('Inicia sesión para guardar los cambios en Firebase.', true);
        tarjetas = copiarTarjetas(tarjetasActuales);
        return false;
    }

    try {
        await sincronizarTarjetasEnFirebase(datosGuardados);
        tarjetasActuales = datosGuardados;
        mostrarMensajeEstado('Cambios guardados en Firebase.');
        return true;
    } catch (error) {
        console.error('Error al guardar tarjetas en Firebase:', error);
        tarjetas = copiarTarjetas(tarjetasActuales);
        mostrarMensajeEstado('No se pudieron guardar los cambios en Firebase. Se restauraron los datos anteriores; verifica las reglas de Firestore e inténtalo de nuevo.', true);
        return false;
    }
}

function mostrarMensajeEstado(mensaje, esError = false) {
    const elemento = document.getElementById('mensajeEstado');
    elemento.innerText = mensaje;
    elemento.classList.remove('hidden', 'border-rose-200', 'bg-rose-50', 'text-rose-700', 'border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
    elemento.classList.add(...(esError
        ? ['border-rose-200', 'bg-rose-50', 'text-rose-700']
        : ['border-emerald-200', 'bg-emerald-50', 'text-emerald-700']));
}

// Renderizar todo el sistema
function renderizarTodo() {
    renderizarDashboard();
    renderizarCalendario();
    renderizarTarjetas();
    renderizarObligaciones(document.getElementById('inputBuscar').value);
}

function obtenerProximosVencimientos(hoy = new Date()) {
    const hoyLocal = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    return tarjetas
        .filter(tarjeta => {
            if (tarjetaPagada(tarjeta) || !tarjeta.fechaLimite) return false;
            const fechaLimite = new Date(`${tarjeta.fechaLimite}T00:00:00`);
            if (Number.isNaN(fechaLimite.getTime())) return false;
            const dias = Math.round((fechaLimite - hoyLocal) / (1000 * 60 * 60 * 24));
            return dias >= 0 && dias <= 5;
        })
        .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite));
}

function abrirModalVencimientos() {
    const modal = document.getElementById('modalVencimientos');
    const lista = document.getElementById('listaVencimientos');
    const sinVencimientos = document.getElementById('sinVencimientos');
    const proximos = obtenerProximosVencimientos();
    lista.innerHTML = proximos.map(tarjeta => {
        const fecha = new Date(`${tarjeta.fechaLimite}T00:00:00`);
        const fechaEtiqueta = new Intl.DateTimeFormat('es-MX', {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        }).format(fecha);
        const mensualidad = obtenerDatosCredito(tarjeta).mensualidad;
        return `
            <li class="flex items-center justify-between gap-4 py-4">
                <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-slate-900">${escaparHTML(tarjeta.nombre || 'Tarjeta')}</p>
                    <p class="mt-1 text-xs capitalize text-slate-500">${escaparHTML(fechaEtiqueta)} · ${escaparHTML(nombrePersona(obtenerTitularId(tarjeta)))}</p>
                </div>
                <div class="shrink-0 text-right">
                    <p class="text-sm font-bold text-slate-900">${formatearMoneda(mensualidad)}</p>
                    <p class="mt-1 text-xs font-medium text-amber-700">Pendiente</p>
                </div>
            </li>
        `;
    }).join('');
    lista.classList.toggle('hidden', proximos.length === 0);
    sinVencimientos.classList.toggle('hidden', proximos.length > 0);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
    document.getElementById('cerrarModalVencimientos').focus();
}

function cerrarModalVencimientos() {
    const modal = document.getElementById('modalVencimientos');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.setAttribute('aria-hidden', 'true');
    if (!tarjetaDetalleId && !obligacionDetalle) document.body.classList.remove('overflow-hidden');
    document.getElementById('botonVencimientos').focus();
}

function escaparHTML(valor) {
    return String(valor).replace(/[&<>"']/g, caracter => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caracter]);
}

function nombrePersona(personaId) {
    const persona = personas.find(item => item.id === personaId);
    return persona ? persona.nombre : personaId || 'Sin titular';
}

function nombrePartePrestamo(prestamo, tipo) {
    const nombreLibre = prestamo[`${tipo}Nombre`];
    if (typeof nombreLibre === 'string' && nombreLibre.trim()) return nombreLibre.trim();
    return nombrePersona(prestamo[`${tipo}Id`]);
}

function esPrestamoSrTono(prestamo) {
    return esNombreSrTono(nombrePartePrestamo(prestamo, 'prestamista'));
}

function esNombreSrTono(valor) {
    const nombre = String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('es')
        .replace(/[^a-z]/g, '');
    return nombre === 'srtono';
}

function nombrePersonaAbono(abono) {
    return typeof abono.personaNombre === 'string' && abono.personaNombre.trim()
        ? abono.personaNombre.trim()
        : nombrePersona(abono.personaId);
}

function obtenerTitularId(tarjeta) {
    if (tarjeta.titularId && personas.some(persona => persona.id === tarjeta.titularId)) {
        return tarjeta.titularId;
    }

    const nombreAnterior = String(tarjeta.titular || '').toLocaleLowerCase('es');
    const personaCoincidente = personas.find(persona => persona.nombre.toLocaleLowerCase('es') === nombreAnterior);
    return personaCoincidente ? personaCoincidente.id : personas[0]?.id || '';
}

function obtenerIDsParticipantes(tarjeta) {
    if (Array.isArray(tarjeta.participantes)) {
        return tarjeta.participantes.filter(personaId => personas.some(persona => persona.id === personaId));
    }

    const asignacion = obtenerAsignacionTarjeta(tarjeta);
    const participantes = personas
        .filter(persona => asignacion[persona.id] > 0)
        .map(persona => persona.id);
    return participantes.length > 0 ? participantes : [obtenerTitularId(tarjeta)].filter(Boolean);
}

function agregarImporteLegacy(asignacion, personaId, importe) {
    if (!personaId) return;
    asignacion[personaId] = (asignacion[personaId] || 0) + (Number(importe) || 0);
}

function obtenerAsignacionTarjeta(tarjeta) {
    const asignacion = Object.fromEntries(personas.map(persona => [persona.id, 0]));
    if (tarjeta.pagosPorUsuario && typeof tarjeta.pagosPorUsuario === 'object') {
        personas.forEach(persona => {
            asignacion[persona.id] = Number(tarjeta.pagosPorUsuario[persona.id]) || 0;
        });
        return asignacion;
    }

    const primeraPersonaId = personas[0]?.id;
    const segundaPersonaId = personas[1]?.id;
    if (tarjeta.pagoPablo !== undefined || tarjeta.pagoPapa !== undefined) {
        const personaPabloId = personas.find(persona => persona.nombre.toLocaleLowerCase('es') === 'pablo')?.id || primeraPersonaId;
        const personaPapaId = personas.find(persona => ['papá', 'papa'].includes(persona.nombre.toLocaleLowerCase('es')))?.id || segundaPersonaId;
        agregarImporteLegacy(asignacion, personaPabloId, tarjeta.pagoPablo);
        agregarImporteLegacy(asignacion, personaPapaId, tarjeta.pagoPapa);
        return asignacion;
    }

    if (tarjeta.conceptos && tarjeta.conceptos.length > 0) {
        tarjeta.conceptos.forEach(concepto => {
            if (concepto.pagosPorUsuario && typeof concepto.pagosPorUsuario === 'object') {
                personas.forEach(persona => agregarImporteLegacy(asignacion, persona.id, concepto.pagosPorUsuario[persona.id]));
            } else {
                const personaPabloId = personas.find(persona => persona.nombre.toLocaleLowerCase('es') === 'pablo')?.id || primeraPersonaId;
                const personaPapaId = personas.find(persona => ['papá', 'papa'].includes(persona.nombre.toLocaleLowerCase('es')))?.id || segundaPersonaId;
                agregarImporteLegacy(asignacion, personaPabloId, concepto.tu);
                agregarImporteLegacy(asignacion, personaPapaId, concepto.papa);
            }
        });
        return asignacion;
    }

    agregarImporteLegacy(asignacion, obtenerTitularId(tarjeta), tarjeta.saldoActual);
    return asignacion;
}

function obtenerDatosCredito(tarjeta) {
    const creditoAprobado = Number(tarjeta.creditoAprobado ?? tarjeta.limite) || 0;
    const creditoDisponible = tarjeta.creditoDisponible !== undefined
        ? Number(tarjeta.creditoDisponible) || 0
        : Math.max(0, creditoAprobado - (Number(tarjeta.saldoActual) || 0));
    const asignacion = obtenerAsignacionTarjeta(tarjeta);
    const mensualidad = tarjeta.mensualidad !== undefined
        ? Number(tarjeta.mensualidad) || 0
        : Object.values(asignacion).reduce((total, importe) => total + importe, 0);

    return { creditoAprobado, creditoDisponible, mensualidad };
}

function creditoLiquidado(tarjeta) {
    const { creditoAprobado, creditoDisponible } = obtenerDatosCredito(tarjeta);
    return creditoAprobado > 0
        && Math.round(creditoAprobado * 100) === Math.round(creditoDisponible * 100);
}

function tarjetaPagada(tarjeta) {
    return Boolean(tarjeta.pagada) || creditoLiquidado(tarjeta);
}

function navegarMesCalendario(desplazamiento) {
    const [anio, mes] = mesSeleccionado.split('-').map(Number);
    const fechaDestino = new Date(anio, mes - 1 + desplazamiento, 1);
    const mesDestino = `${fechaDestino.getFullYear()}-${String(fechaDestino.getMonth() + 1).padStart(2, '0')}`;
    const selector = document.getElementById('selectorMes');
    if ([...selector.options].some(opcion => opcion.value === mesDestino)) {
        selector.value = mesDestino;
        cambiarMes(mesDestino);
    }
}

function renderizarCalendario() {
    const [anio, numeroMes] = mesSeleccionado.split('-').map(Number);
    const primerDia = new Date(anio, numeroMes - 1, 1);
    const diasEnMes = new Date(anio, numeroMes, 0).getDate();
    const espaciosIniciales = (primerDia.getDay() + 6) % 7;
    const etiquetaMes = new Intl.DateTimeFormat('es-MX', {
        month: 'long',
        year: 'numeric'
    }).format(primerDia);
    const tarjetasPorDia = new Map();

    tarjetas.forEach(tarjeta => {
        const fecha = String(tarjeta.fechaLimite || '');
        if (!fecha.startsWith(`${mesSeleccionado}-`)) return;
        const dia = Number(fecha.slice(-2));
        if (!Number.isInteger(dia) || dia < 1 || dia > diasEnMes) return;
        tarjetasPorDia.set(dia, [...(tarjetasPorDia.get(dia) || []), tarjeta]);
    });

    document.getElementById('tituloCalendario').innerText = etiquetaMes;
    const celdasVacias = Array.from({ length: espaciosIniciales }, () =>
        '<span aria-hidden="true" class="h-10"></span>'
    ).join('');
    const celdasDias = Array.from({ length: diasEnMes }, (_, indice) => {
        const dia = indice + 1;
        const fecha = `${mesSeleccionado}-${String(dia).padStart(2, '0')}`;
        const delDia = tarjetasPorDia.get(dia) || [];
        const diaSeleccionado = diaSeleccionadoCalendario === fecha;
        const pendientes = delDia.some(tarjeta => !tarjetaPagada(tarjeta));
        const tooltip = delDia.length
            ? delDia.map(tarjeta => {
                const estado = obtenerEstadoVisualTarjeta(tarjeta, new Date()).texto;
                const monto = obtenerDatosCredito(tarjeta).mensualidad;
                return `${tarjeta.nombre} — ${nombrePersona(obtenerTitularId(tarjeta))} — ${formatearMoneda(monto)} — ${estado}`;
            }).join('\n')
            : 'Sin pagos programados';
        return `
            <button type="button" data-calendario-fecha="${fecha}" aria-label="${dia} de ${escaparHTML(etiquetaMes)}: ${escaparHTML(tooltip)}" title="${escaparHTML(tooltip)}" class="relative flex h-10 flex-col items-center justify-center rounded-lg text-sm transition ${diaSeleccionado ? 'bg-indigo-600 font-bold text-white' : delDia.length ? 'bg-indigo-50 font-semibold text-indigo-700 hover:bg-indigo-100' : 'text-slate-600 hover:bg-slate-100'}">
                <span>${dia}</span>
                ${delDia.length ? `<span class="absolute bottom-1 h-1 w-1 rounded-full ${diaSeleccionado ? 'bg-white' : pendientes ? 'bg-amber-500' : 'bg-emerald-500'}"></span>` : ''}
            </button>
        `;
    }).join('');
    document.getElementById('calendarioDias').innerHTML = celdasVacias + celdasDias;

    const botonesMes = [...document.getElementById('selectorMes').options].map(opcion => opcion.value);
    const [anioPrevio, mesPrevio] = [anio, numeroMes - 2];
    const fechaPrevio = new Date(anioPrevio, mesPrevio, 1);
    const previo = `${fechaPrevio.getFullYear()}-${String(fechaPrevio.getMonth() + 1).padStart(2, '0')}`;
    const fechaSiguiente = new Date(anio, numeroMes, 1);
    const siguiente = `${fechaSiguiente.getFullYear()}-${String(fechaSiguiente.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('botonMesAnteriorCalendario').disabled = !botonesMes.includes(previo);
    document.getElementById('botonMesSiguienteCalendario').disabled = !botonesMes.includes(siguiente);

    const resumen = document.getElementById('resumenDiaCalendario');
    const limpiar = document.getElementById('limpiarFiltroCalendario');
    const eventos = document.getElementById('eventosDiaCalendario');
    if (diaSeleccionadoCalendario) {
        const dia = Number(diaSeleccionadoCalendario.slice(-2));
        const delDia = tarjetasPorDia.get(dia) || [];
        resumen.innerText = delDia.length
            ? `${delDia.length} pago${delDia.length === 1 ? '' : 's'} el ${dia} de ${etiquetaMes}.`
            : `No hay pagos programados el ${dia} de ${etiquetaMes}.`;
        eventos.innerHTML = delDia.map(tarjeta => {
            const estado = obtenerEstadoVisualTarjeta(tarjeta, new Date());
            const mensualidad = obtenerDatosCredito(tarjeta).mensualidad;
            return `
                <li class="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
                    <div class="min-w-0">
                        <p class="truncate text-xs font-semibold text-slate-800">${escaparHTML(tarjeta.nombre)}</p>
                        <p class="mt-0.5 truncate text-[10px] text-slate-500">${escaparHTML(nombrePersona(obtenerTitularId(tarjeta)))}</p>
                    </div>
                    <div class="shrink-0 text-right">
                        <p class="text-xs font-semibold text-slate-800">${formatearMoneda(mensualidad)}</p>
                        <span class="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${estado.clases}">${escaparHTML(estado.texto)}</span>
                    </div>
                </li>
            `;
        }).join('');
        eventos.classList.toggle('hidden', delDia.length === 0);
        limpiar.classList.remove('hidden');
    } else {
        resumen.innerText = tarjetasPorDia.size
            ? `${[...tarjetasPorDia.values()].reduce((total, dia) => total + dia.length, 0)} pagos programados este mes.`
            : 'No hay fechas de pago registradas este mes.';
        eventos.innerHTML = '';
        eventos.classList.add('hidden');
        limpiar.classList.add('hidden');
    }

    document.querySelectorAll('button[data-calendario-fecha]').forEach(boton => {
        boton.addEventListener('click', () => {
            diaSeleccionadoCalendario = diaSeleccionadoCalendario === boton.dataset.calendarioFecha
                ? ''
                : boton.dataset.calendarioFecha;
            renderizarCalendario();
        });
    });
}

// Calcular y actualizar Dashboard
function renderizarDashboard() {
    let mensualidadTotal = 0;
    const totalesPorPersona = Object.fromEntries(personas.map(persona => [persona.id, 0]));
    const hoy = new Date();

    tarjetas.forEach(t => {
        if (tarjetaPagada(t)) return;

        const asignacion = obtenerAsignacionTarjeta(t);
        const datosCredito = obtenerDatosCredito(t);
        mensualidadTotal += datosCredito.mensualidad;
        personas.forEach(persona => {
            totalesPorPersona[persona.id] += asignacion[persona.id] || 0;
        });

    });

    const vencimientosProximos = obtenerProximosVencimientos(hoy).length;
    const esHistorico = mesSeleccionado !== obtenerMesActual();
    if (!esHistorico) {
        creditos.filter(credito => obtenerSaldoPendienteCredito(credito) > 0).forEach(credito => {
            const factorMensual = obtenerFactorMensualCredito(credito);
            const mensualidad = obtenerPagoPorPeriodoCredito(credito) * factorMensual;
            mensualidadTotal += mensualidad;
            personas.forEach(persona => {
                totalesPorPersona[persona.id] += (Number(credito.pagosPorUsuario?.[persona.id]) || 0) * factorMensual;
            });
        });
    }

    // Actualizar etiquetas en el DOM
    document.getElementById('lblDeudaTotal').innerText = `$${mensualidadTotal.toLocaleString('es-MX', {minimumFractionDigits: 2})}`;
    const elementosActivos = tarjetas.filter(t => !tarjetaPagada(t)).length
        + (esHistorico ? 0 : creditos.filter(credito => obtenerSaldoPendienteCredito(credito) > 0).length);
    document.getElementById('lblTotalTarjetas').innerText = elementosActivos;
    document.getElementById('lblVencimientos').innerText = vencimientosProximos;

    const contenedorTotales = document.getElementById('contenedorTotalesUsuarios');
    contenedorTotales.innerHTML = personas.map(persona => {
        const total = totalesPorPersona[persona.id];
        const porcentaje = mensualidadTotal > 0 ? (total / mensualidadTotal) * 100 : 0;
        return `
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col justify-between">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-xs font-semibold uppercase tracking-wider text-indigo-600">Total: ${escaparHTML(persona.nombre)}</p>
                        <h3 class="text-2xl font-bold text-slate-900 mt-1">$${total.toLocaleString('es-MX', {minimumFractionDigits: 2})}</h3>
                    </div>
                    <div class="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                        <i class="fa-solid fa-user text-lg"></i>
                    </div>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
                    <div class="bg-indigo-600 h-2 rounded-full transition-all duration-500" style="width: ${porcentaje}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

let tarjetaDetalleId = null;

function formatearMoneda(importe) {
    return `$${(Number(importe) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function obtenerEstadoVisualTarjeta(tarjeta, hoy = new Date()) {
    if (creditoLiquidado(tarjeta)) {
        return { texto: 'Liquidada', clases: 'bg-emerald-100 text-emerald-700', icono: 'fa-circle-check' };
    }
    if (tarjeta.pagada) {
        return { texto: 'Pagada', clases: 'bg-emerald-100 text-emerald-700', icono: 'fa-circle-check' };
    }
    if (tarjeta.fechaLimite) {
        const fechaLimite = new Date(`${tarjeta.fechaLimite}T00:00:00`);
        const dias = Math.ceil((fechaLimite - hoy) / (1000 * 60 * 60 * 24));
        if (dias < 0) {
            return { texto: `Vencida (${Math.abs(dias)}d)`, clases: 'bg-rose-100 text-rose-700', icono: 'fa-circle-exclamation' };
        }
        return { texto: 'Pendiente', clases: 'bg-amber-100 text-amber-700', icono: 'fa-clock' };
    }
    return { texto: 'Sin fecha límite', clases: 'bg-slate-100 text-slate-600', icono: 'fa-circle-info' };
}

function renderizarTarjetas(filtro = '') {
    const esHistorico = mesSeleccionado !== obtenerMesActual();
    const contenedor = document.getElementById('contenedorTarjetas');
    const termino = filtro.toLocaleLowerCase('es');
    const tarjetasFiltradas = tarjetas
        .filter(t => {
            const coincideBusqueda = String(t.nombre || '').toLocaleLowerCase('es').includes(termino)
                || nombrePersona(obtenerTitularId(t)).toLocaleLowerCase('es').includes(termino);
            return coincideBusqueda;
        })
        .sort((a, b) => {
            const fechaA = a.fechaLimite ? new Date(`${a.fechaLimite}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
            const fechaB = b.fechaLimite ? new Date(`${b.fechaLimite}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
            if (Number.isNaN(fechaA) && Number.isNaN(fechaB)) return String(a.nombre || '').localeCompare(String(b.nombre || ''));
            if (Number.isNaN(fechaA)) return 1;
            if (Number.isNaN(fechaB)) return -1;
            return fechaA - fechaB;
        });

    if (tarjetasFiltradas.length === 0) {
        contenedor.innerHTML = `
            <div class="py-12 text-center">
                <i class="fa-solid fa-folder-open mb-3 text-4xl text-slate-300"></i>
                <p class="font-medium text-slate-500">No se encontraron tarjetas registradas.</p>
            </div>
        `;
        cerrarDetalleTarjeta();
        return;
    }

    const hoy = new Date();
    const filas = tarjetasFiltradas.map(t => {
        const datos = obtenerDatosCredito(t);
        const estado = obtenerEstadoVisualTarjeta(t, hoy);
        const seleccionada = t.id === tarjetaDetalleId;
        const liquidada = creditoLiquidado(t);
        const pagada = tarjetaPagada(t);
        const asignacion = obtenerAsignacionTarjeta(t);
        const participantes = obtenerIDsParticipantes(t);
        const fechaPago = t.fechaLimite
            ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit' }).format(new Date(`${t.fechaLimite}T00:00:00`))
            : 'N/A';
        const reparto = personas.filter(persona => participantes.includes(persona.id)).map(persona => `
            <div class="flex min-w-32 justify-between gap-3 text-xs">
                <span class="text-slate-500">${escaparHTML(persona.nombre)}</span>
                <span class="font-semibold text-slate-800">${formatearMoneda(asignacion[persona.id])}</span>
            </div>
        `).join('');
        return `
            <tr data-tarjeta-id="${escaparHTML(t.id)}" tabindex="0" aria-label="Ver detalle de ${escaparHTML(t.nombre)}" class="cursor-pointer border-t border-slate-100 transition hover:bg-indigo-50/60 ${seleccionada ? 'bg-indigo-50' : ''}">
                <td class="whitespace-nowrap px-5 py-5">
                    <div class="font-semibold text-slate-900">${escaparHTML(t.nombre)}</div>
                    <div class="mt-1 text-xs text-slate-500">Titular: ${escaparHTML(nombrePersona(obtenerTitularId(t)))}</div>
                </td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-medium text-slate-800">${formatearMoneda(datos.creditoAprobado)}</td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-semibold text-rose-700">${formatearMoneda(datos.creditoAprobado - datos.creditoDisponible)}</td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-semibold text-emerald-700">${formatearMoneda(datos.creditoDisponible)}</td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-semibold text-slate-800">${formatearMoneda(datos.mensualidad)}</td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-semibold text-slate-800">${escaparHTML(fechaPago)}</td>
                <td class="px-5 py-5"><div class="space-y-1">${reparto || '<span class="text-xs text-slate-400">Sin participantes</span>'}</div></td>
                <td class="whitespace-nowrap px-5 py-5"><span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${estado.clases}"><i class="fa-solid ${estado.icono}"></i>${estado.texto}</span></td>
                <td class="whitespace-nowrap px-5 py-5 text-right">
                    <div class="inline-flex items-center gap-2">
                        <button type="button" data-marcar-pagada="${escaparHTML(t.id)}" ${esHistorico || liquidada ? 'disabled' : ''} aria-pressed="${pagada}" title="${liquidada ? 'La tarjeta ya está liquidada.' : pagada ? 'Marcar como pendiente' : 'Marcar como pagada'}" class="rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${pagada ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}"><i class="fa-solid ${pagada ? 'fa-circle-check' : 'fa-circle'} mr-1"></i>${liquidada ? 'Liquidada' : pagada ? 'Pagada' : 'Pagado'}</button>
                        <button type="button" data-abrir-detalle="${escaparHTML(t.id)}" class="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100">Ver detalle</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    contenedor.innerHTML = `
        <table class="w-full min-w-[1320px] text-left">
            <thead class="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                    <th class="px-5 py-4">Tarjeta / titular</th>
                    <th class="px-5 py-4">Crédito aprobado</th>
                    <th class="px-5 py-4">Deuda</th>
                    <th class="px-5 py-4">Crédito disponible</th>
                    <th class="px-5 py-4">Mensualidad</th>
                    <th class="px-5 py-4">Fecha de pago</th>
                    <th class="px-5 py-4">Pago por persona</th>
                    <th class="px-5 py-4">Estado</th>
                    <th class="px-5 py-4"></th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;

    contenedor.querySelectorAll('tr[data-tarjeta-id]').forEach(fila => {
        const abrir = () => abrirDetalleTarjeta(fila.dataset.tarjetaId);
        fila.addEventListener('click', abrir);
        fila.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                abrir();
            }
        });
    });
    contenedor.querySelectorAll('button[data-abrir-detalle]').forEach(boton => {
        boton.addEventListener('click', event => {
            event.stopPropagation();
            abrirDetalleTarjeta(boton.dataset.abrirDetalle);
        });
    });
    contenedor.querySelectorAll('button[data-marcar-pagada]').forEach(boton => {
        boton.addEventListener('click', async event => {
            event.stopPropagation();
            await cambiarEstadoPago(boton.dataset.marcarPagada);
        });
    });

    if (tarjetaDetalleId && tarjetasFiltradas.some(t => t.id === tarjetaDetalleId)) {
        actualizarDetalleTarjeta(tarjetaDetalleId, esHistorico);
    } else if (tarjetaDetalleId) {
        cerrarDetalleTarjeta();
    }
}

function abrirDetalleTarjeta(id) {
    if (!tarjetas.some(tarjeta => tarjeta.id === id)) return;
    cerrarDetalleObligacion();
    tarjetaDetalleId = id;
    actualizarDetalleTarjeta(id, mesSeleccionado !== obtenerMesActual());
    const panel = document.getElementById('panelDetalleTarjeta');
    panel.classList.remove('translate-x-full');
    panel.removeAttribute('inert');
    panel.setAttribute('aria-hidden', 'false');
    document.getElementById('fondoDetalleTarjeta').classList.remove('opacity-0', 'pointer-events-none');
    document.getElementById('fondoDetalleTarjeta').classList.add('opacity-100');
    document.body.classList.add('overflow-hidden');
    renderizarTarjetas(document.getElementById('inputBuscar').value);
}

function actualizarDetalleTarjeta(id, esHistorico = mesSeleccionado !== obtenerMesActual()) {
    const tarjeta = tarjetas.find(item => item.id === id);
    if (!tarjeta) return;
    const datos = obtenerDatosCredito(tarjeta);
    const estado = obtenerEstadoVisualTarjeta(tarjeta);
    const asignacion = obtenerAsignacionTarjeta(tarjeta);
    const participantes = obtenerIDsParticipantes(tarjeta);
    const creditoUsado = Math.max(0, datos.creditoAprobado - datos.creditoDisponible);
    const usoPorcentaje = datos.creditoAprobado > 0
        ? Math.min(100, (creditoUsado / datos.creditoAprobado) * 100)
        : 0;
    const titular = nombrePersona(obtenerTitularId(tarjeta));

    document.getElementById('titularDetalleTarjeta').innerText = titular;
    document.getElementById('tituloDetalleTarjeta').innerText = tarjeta.nombre;
    document.getElementById('contenidoDetalleTarjeta').innerHTML = `
        <div class="flex items-center justify-between gap-3">
            <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${estado.clases}">
                <i class="fa-solid ${estado.icono}"></i>${estado.texto}
            </span>
            <span class="text-xs text-slate-500">Corte: día ${escaparHTML(tarjeta.diaCorte || 'N/A')}</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Crédito aprobado</p>
                <p class="mt-1 text-lg font-bold text-slate-900">${formatearMoneda(datos.creditoAprobado)}</p>
            </div>
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Crédito disponible</p>
                <p class="mt-1 text-lg font-bold text-slate-900">${formatearMoneda(datos.creditoDisponible)}</p>
            </div>
            <div class="col-span-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Mensualidad de este mes</p>
                <p class="mt-1 text-2xl font-bold text-slate-900">${formatearMoneda(datos.mensualidad)}</p>
            </div>
        </div>
        <section class="space-y-2">
            <div class="flex justify-between text-xs text-slate-500">
                <span>Utilización de crédito</span>
                <span class="font-semibold text-slate-700">${usoPorcentaje.toFixed(1)}% usado · ${formatearMoneda(creditoUsado)}</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-indigo-600 transition-all" style="width:${usoPorcentaje}%"></div>
            </div>
        </section>
        <section class="space-y-2 rounded-xl border border-slate-100 p-4">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Fechas de pago</h4>
            <div class="flex justify-between text-sm"><span class="text-slate-500">Día de corte</span><span class="font-medium text-slate-800">${escaparHTML(tarjeta.diaCorte || 'N/A')}</span></div>
            <div class="flex justify-between text-sm"><span class="text-slate-500">Fecha límite</span><span class="font-medium text-slate-800">${escaparHTML(tarjeta.fechaLimite || 'N/A')}</span></div>
        </section>
        <section class="space-y-3">
            <div class="flex items-center justify-between">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Reparto de la mensualidad</h4>
                <span class="text-xs font-semibold text-slate-500">${participantes.length} participante${participantes.length === 1 ? '' : 's'}</span>
            </div>
            <div class="divide-y divide-slate-100 rounded-xl border border-slate-100 px-4">
                ${personas.filter(persona => participantes.includes(persona.id)).map(persona => `
                    <div class="flex justify-between gap-3 py-3 text-sm">
                        <span class="text-slate-600">${escaparHTML(persona.nombre)}</span>
                        <span class="font-semibold text-slate-900">${formatearMoneda(asignacion[persona.id])}</span>
                    </div>
                `).join('') || '<p class="py-3 text-sm text-slate-400">No hay participantes registrados.</p>'}
            </div>
        </section>
    `;

    const botonPago = document.getElementById('pagoDetalleTarjeta');
    const liquidada = creditoLiquidado(tarjeta);
    const pagada = tarjetaPagada(tarjeta);
    botonPago.disabled = esHistorico || liquidada;
    botonPago.setAttribute('aria-pressed', String(pagada));
    botonPago.title = liquidada ? 'El crédito disponible es igual al crédito aprobado.' : '';
    botonPago.className = `w-full rounded-xl py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${pagada ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`;
    botonPago.innerHTML = `<i class="fa-solid ${pagada ? 'fa-circle-check' : 'fa-circle'} mr-2"></i>${liquidada ? 'Liquidada automáticamente' : pagada ? 'Pagada · Marcar como pendiente' : 'Marcar como pagada'}`;
    document.getElementById('editarDetalleTarjeta').disabled = esHistorico;
    document.getElementById('eliminarDetalleTarjeta').disabled = esHistorico;
    document.getElementById('conceptosDetalleTarjeta').disabled = false;
    document.getElementById('editarDetalleTarjeta').classList.toggle('opacity-40', esHistorico);
    document.getElementById('eliminarDetalleTarjeta').classList.toggle('opacity-40', esHistorico);
}

function cerrarDetalleTarjeta() {
    tarjetaDetalleId = null;
    const panel = document.getElementById('panelDetalleTarjeta');
    panel.classList.add('translate-x-full');
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
    document.getElementById('fondoDetalleTarjeta').classList.add('opacity-0', 'pointer-events-none');
    document.getElementById('fondoDetalleTarjeta').classList.remove('opacity-100');
    if (!obligacionDetalle) document.body.classList.remove('overflow-hidden');
    const contenedor = document.getElementById('contenedorTarjetas');
    contenedor.querySelectorAll('tr[data-tarjeta-id]').forEach(fila => fila.classList.remove('bg-indigo-50'));
}

let obligacionDetalle = null;

function obtenerFrecuenciaCredito(credito) {
    return ['quincenal', 'semanal'].includes(credito.frecuenciaPago) ? credito.frecuenciaPago : 'mensual';
}

function etiquetaFrecuenciaCredito(credito) {
    const etiquetas = { mensual: 'Mensual', quincenal: 'Quincenal', semanal: 'Semanal' };
    return etiquetas[obtenerFrecuenciaCredito(credito)];
}

function obtenerFactorMensualCredito(credito) {
    const frecuencia = obtenerFrecuenciaCredito(credito);
    if (frecuencia === 'semanal') return 52 / 12;
    return frecuencia === 'quincenal' ? 2 : 1;
}

function obtenerPagoPorPeriodoCredito(credito) {
    return Number(credito.pagoPorPeriodo ?? credito.pagoMensual) || 0;
}

function obtenerSaldoPendienteCredito(credito) {
    if (Number.isFinite(Number(credito.saldoPendiente))) {
        return Math.max(0, Number(credito.saldoPendiente));
    }
    const cuotasPagadas = Math.max(0, Number(credito.cuotasTotales) - Number(credito.cuotasRestantes));
    return Math.max(0, Number(credito.montoTotal) - cuotasPagadas * obtenerPagoPorPeriodoCredito(credito));
}

function proyectarCredito(credito) {
    let saldo = Math.round(obtenerSaldoPendienteCredito(credito) * 100);
    const pago = Math.round(obtenerPagoPorPeriodoCredito(credito) * 100);
    const tasaAnual = Number(credito.tasaInteresAnual) || 0;
    const periodosPorAnio = obtenerFactorMensualCredito(credito) * 12;
    let totalPagado = 0;
    let interesTotal = 0;
    let numeroPagos = 0;

    if (saldo <= 0) return { estado: 'liquidado', totalPagado: 0, interesTotal: 0, numeroPagos: 0 };
    if (pago <= 0 || !Number.isFinite(tasaAnual) || tasaAnual < 0) return { estado: 'invalido' };

    const tasaPeriodo = tasaAnual / 100 / periodosPorAnio;
    while (saldo > 0 && numeroPagos < 2400) {
        const interes = Math.round(saldo * tasaPeriodo);
        if (pago <= interes) return { estado: 'no-amortiza' };
        const pagoReal = Math.min(pago, saldo + interes);
        saldo = Math.max(0, saldo + interes - pagoReal);
        totalPagado += pagoReal;
        interesTotal += interes;
        numeroPagos++;
    }

    if (saldo > 0) return { estado: 'limite' };
    const cuotasPagadas = Math.max(0, Number(credito.cuotasTotales) - Number(credito.cuotasRestantes));
    const movimientos = credito.movimientos || [];
    const pagadoRegistrado = movimientos.reduce(
        (total, movimiento) => total + Math.round((Number(movimiento.monto) || 0) * 100),
        0
    );
    const pagosHistoricosSinMovimiento = Math.max(0, cuotasPagadas - movimientos.length);
    const pagadoHistoricoEstimado = pagadoRegistrado
        + pagosHistoricosSinMovimiento * Math.round(obtenerPagoPorPeriodoCredito(credito) * 100);
    return {
        estado: 'ok',
        totalFuturo: totalPagado / 100,
        totalPlan: (pagadoHistoricoEstimado + totalPagado) / 100,
        interesTotal: interesTotal / 100,
        numeroPagos,
        saldoActual: obtenerSaldoPendienteCredito(credito),
        pagosHistoricosEstimados: pagosHistoricosSinMovimiento > 0
    };
}

function renderizarAnalisisCredito(credito) {
    const proyeccion = proyectarCredito(credito);
    let resultado;
    if (proyeccion.estado === 'liquidado') {
        resultado = '<p class="text-sm text-slate-600">Este crédito ya está liquidado.</p>';
    } else if (proyeccion.estado === 'no-amortiza') {
        resultado = '<p class="text-sm font-medium text-rose-700">Con este pago, el abono no alcanza a cubrir el interés estimado del periodo. Aumenta la cuota para proyectar una fecha de liquidación.</p>';
    } else if (proyeccion.estado !== 'ok') {
        resultado = '<p class="text-sm text-rose-700">No se pudo proyectar el crédito. Revisa el saldo, la tasa y el pago por periodo.</p>';
    } else {
        resultado = `
            <div class="grid grid-cols-2 gap-3">
                <div class="rounded-xl border border-indigo-100 bg-white p-3">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Total al terminar todo el plan</p>
                    <p class="mt-1 text-base font-bold text-slate-900">${formatearMoneda(proyeccion.totalPlan)}</p>
                </div>
                <div class="rounded-xl border border-indigo-100 bg-white p-3">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pagos futuros restantes</p>
                    <p class="mt-1 text-base font-bold text-slate-900">${formatearMoneda(proyeccion.totalFuturo)}</p>
                </div>
                <div class="rounded-xl border border-indigo-100 bg-white p-3">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Interés estimado restante</p>
                    <p class="mt-1 text-base font-bold text-amber-700">${formatearMoneda(proyeccion.interesTotal)}</p>
                </div>
                <div class="rounded-xl border border-indigo-100 bg-white p-3">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pagos restantes estimados</p>
                    <p class="mt-1 text-base font-bold text-slate-900">${proyeccion.numeroPagos} ${etiquetaFrecuenciaCredito(credito).toLocaleLowerCase('es')}</p>
                </div>
                <div class="rounded-xl border border-emerald-100 bg-white p-3">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ahorro estimado si liquidas hoy</p>
                    <p class="mt-1 text-base font-bold text-emerald-700">${formatearMoneda(Math.max(0, proyeccion.totalFuturo - proyeccion.saldoActual))}</p>
                </div>
            </div>
            ${proyeccion.pagosHistoricosEstimados ? '<p class="text-xs text-slate-500">El total del plan incluye una estimación de cuotas anteriores sin movimientos registrados, calculada con el pago actual.</p>' : ''}
        `;
    }

    return `
        <section class="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
            <div>
                <h4 class="text-sm font-bold text-indigo-950"><i class="fa-solid fa-chart-line mr-2 text-indigo-600"></i>Análisis estimado del crédito</h4>
                <p class="mt-1 text-xs text-slate-600">Proyección con la tasa anual dividida entre los periodos de pago y cuotas constantes; asume que cada pago se aplica al saldo, sin cargos adicionales.</p>
            </div>
            ${resultado}
            <p class="text-[10px] leading-relaxed text-slate-500">El ahorro por liquidar hoy compara los pagos proyectados con el saldo pendiente actual. No es una cotización del banco: el saldo de liquidación puede incluir intereses del periodo, comisiones o penalizaciones.</p>
        </section>
    `;
}

function renderizarMovimientosCredito(credito) {
    const movimientos = [...(credito.movimientos || [])]
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    if (!movimientos.length) {
        return '<p class="py-3 text-sm text-slate-400">Todavía no hay pagos registrados.</p>';
    }
    return movimientos.map(movimiento => `
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
            <div>
                <p class="text-sm font-medium text-slate-700">${escaparHTML(movimiento.fecha || 'Sin fecha')}</p>
                <p class="mt-0.5 text-xs text-slate-500">Saldo después del pago: ${formatearMoneda(movimiento.saldoDespues ?? '')}</p>
            </div>
            <span class="text-sm font-semibold text-emerald-700">−${formatearMoneda(movimiento.monto)}</span>
        </div>
    `).join('');
}

function abrirDetalleObligacion(tipo, id) {
    const registros = tipo === 'credito' ? creditos : prestamos;
    if (!registros.some(registro => registro.id === id)) return;
    cerrarDetalleTarjeta();
    obligacionDetalle = { tipo, id };
    actualizarDetalleObligacion();
    const panel = document.getElementById('panelDetalleObligacion');
    panel.classList.remove('translate-x-full');
    panel.removeAttribute('inert');
    panel.setAttribute('aria-hidden', 'false');
    document.getElementById('fondoDetalleObligacion').classList.remove('opacity-0', 'pointer-events-none');
    document.getElementById('fondoDetalleObligacion').classList.add('opacity-100');
    document.body.classList.add('overflow-hidden');
    renderizarObligaciones(document.getElementById('inputBuscar').value);
}

function cerrarDetalleObligacion() {
    obligacionDetalle = null;
    const panel = document.getElementById('panelDetalleObligacion');
    if (!panel) return;
    panel.classList.add('translate-x-full');
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
    document.getElementById('fondoDetalleObligacion').classList.add('opacity-0', 'pointer-events-none');
    document.getElementById('fondoDetalleObligacion').classList.remove('opacity-100');
    if (!tarjetaDetalleId) document.body.classList.remove('overflow-hidden');
    document.getElementById('seccionObligaciones').querySelectorAll('tr[data-obligacion-id]')
        .forEach(fila => fila.classList.remove('bg-indigo-50'));
}

function actualizarDetalleObligacion(esHistorico = mesSeleccionado !== obtenerMesActual()) {
    if (!obligacionDetalle) return;
    const { tipo, id } = obligacionDetalle;
    const esCredito = tipo === 'credito';
    const registro = (esCredito ? creditos : prestamos).find(item => item.id === id);
    if (!registro) {
        cerrarDetalleObligacion();
        return;
    }

    const contenido = document.getElementById('contenidoDetalleObligacion');
    const acciones = document.getElementById('accionesDetalleObligacion');
    document.getElementById('tipoDetalleObligacion').innerText = esCredito
        ? `Crédito bancario · ${nombrePersona(registro.titularId)}`
        : `Préstamo personal · ${nombrePartePrestamo(registro, 'prestamista')} a ${nombrePartePrestamo(registro, 'prestatario')}`;
    document.getElementById('tituloDetalleObligacion').innerText = esCredito ? registro.nombre : registro.descripcion;

    if (esCredito) {
        const saldoPendiente = obtenerSaldoPendienteCredito(registro);
        const activo = saldoPendiente > 0;
        const frecuencia = obtenerFrecuenciaCredito(registro);
        const factorMensual = obtenerFactorMensualCredito(registro);
        const reparto = personas.filter(persona => registro.participantes?.includes(persona.id)).map(persona => `
            <div class="flex justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
                <span class="text-sm text-slate-600">${escaparHTML(persona.nombre)}</span>
                <span class="text-sm font-semibold text-slate-900">${formatearMoneda(registro.pagosPorUsuario?.[persona.id])}</span>
            </div>
        `).join('');
        contenido.innerHTML = `
            <div class="flex items-center justify-between gap-3">
                <span class="rounded-full px-3 py-1.5 text-xs font-semibold ${activo ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${activo ? 'Crédito activo' : 'Crédito liquidado'}</span>
                <span class="text-xs text-slate-500">${Number(registro.cuotasRestantes)} de ${Number(registro.cuotasTotales)} cuotas pendientes</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Monto total</p>
                    <p class="mt-1 text-lg font-bold text-slate-900">${formatearMoneda(registro.montoTotal)}</p>
                </div>
                <div class="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Saldo pendiente</p>
                    <p class="mt-1 text-lg font-bold text-slate-900">${formatearMoneda(saldoPendiente)}</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pago ${frecuencia}</p>
                    <p class="mt-1 text-lg font-bold text-slate-900">${formatearMoneda(obtenerPagoPorPeriodoCredito(registro))}</p>
                    <p class="mt-1 text-xs text-slate-500">${formatearMoneda(obtenerPagoPorPeriodoCredito(registro) * factorMensual)} aprox. al mes</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tasa anual</p>
                    <p class="mt-1 text-lg font-bold text-slate-900">${Number(registro.tasaInteresAnual || 0).toFixed(2)}%</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Próximo pago</p>
                    <p class="mt-1 text-sm font-bold text-slate-900">${escaparHTML(registro.fechaPago || 'Sin fecha')}</p>
                </div>
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cuotas</p>
                    <p class="mt-1 text-sm font-semibold text-slate-800">${Number(registro.cuotasTotales) - Number(registro.cuotasRestantes)} pagadas de ${Number(registro.cuotasTotales)}</p>
                </div>
            </div>
            ${renderizarAnalisisCredito(registro)}
            <section class="space-y-2">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Reparto del pago ${frecuencia}</h4>
                <div class="rounded-xl border border-slate-100 px-4">${reparto || '<p class="py-3 text-sm text-slate-400">Sin participantes registrados.</p>'}</div>
            </section>
            <section class="space-y-2">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Movimientos de pago</h4>
                <div class="rounded-xl border border-slate-100 px-4">${renderizarMovimientosCredito(registro)}</div>
            </section>
        `;
        acciones.innerHTML = `
            <button id="editarObligacionDetalle" type="button" ${esHistorico ? 'disabled' : ''} class="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><i class="fa-solid fa-pen mr-2"></i>Editar crédito</button>
            <button id="accionObligacionDetalle" type="button" ${esHistorico || !activo ? 'disabled' : ''} class="w-full rounded-xl bg-indigo-50 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"><i class="fa-solid fa-circle-check mr-2"></i>Registrar pago ${frecuencia}</button>
            <button id="eliminarObligacionDetalle" type="button" ${esHistorico ? 'disabled' : ''} class="w-full rounded-xl py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"><i class="fa-solid fa-trash mr-2"></i>Eliminar crédito</button>
        `;
        document.getElementById('editarObligacionDetalle').addEventListener('click', () => {
            const creditoId = obligacionDetalle?.id;
            if (!creditoId || esHistorico) return;
            cerrarDetalleObligacion();
            abrirModalCredito(creditoId);
        });
        document.getElementById('accionObligacionDetalle').addEventListener('click', () => {
            if (obligacionDetalle && !esHistorico) abrirModalPagoCredito(obligacionDetalle.id);
        });
        document.getElementById('eliminarObligacionDetalle').addEventListener('click', async () => {
            const creditoId = obligacionDetalle?.id;
            if (creditoId && !esHistorico) await eliminarCredito(creditoId);
        });
        return;
    }

    const saldo = saldoPrestamo(registro);
    const abonos = [...(registro.abonos || [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const historial = abonos.length ? abonos.map(abono => `
        <div class="flex justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
            <div>
                <p class="text-sm font-medium text-slate-700">${escaparHTML(abono.fecha)}</p>
                <p class="mt-0.5 text-xs text-slate-500">Abonó ${escaparHTML(nombrePersonaAbono(abono))}</p>
            </div>
            <span class="text-sm font-semibold text-emerald-700">−${formatearMoneda(abono.monto)}</span>
        </div>
    `).join('') : '<p class="py-3 text-sm text-slate-400">Todavía no hay abonos registrados.</p>';
    contenido.innerHTML = `
        <div class="flex items-center justify-between gap-3">
            <span class="rounded-full px-3 py-1.5 text-xs font-semibold ${saldo > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${saldo > 0 ? 'Saldo pendiente' : 'Préstamo liquidado'}</span>
            <span class="text-xs text-slate-500">Creado: ${escaparHTML(registro.fecha || 'N/A')}</span>
        </div>
        <section class="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div class="flex justify-between gap-3 text-sm"><span class="text-slate-500">Prestamista</span><span class="font-semibold text-slate-800">${escaparHTML(nombrePartePrestamo(registro, 'prestamista'))}</span></div>
            <div class="mt-3 flex justify-between gap-3 text-sm"><span class="text-slate-500">Prestatario</span><span class="font-semibold text-slate-800">${escaparHTML(nombrePartePrestamo(registro, 'prestatario'))}</span></div>
        </section>
        <div class="grid grid-cols-2 gap-3">
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Monto prestado</p>
                <p class="mt-1 text-lg font-bold text-slate-900">${formatearMoneda(registro.monto)}</p>
            </div>
            <div class="rounded-xl border border-amber-100 bg-amber-50 p-4">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Saldo actual</p>
                <p class="mt-1 text-lg font-bold text-slate-900">${formatearMoneda(saldo)}</p>
            </div>
        </div>
        <section class="space-y-2">
            <div class="flex items-center justify-between">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Historial de abonos</h4>
                <span class="text-xs text-slate-500">${abonos.length} abono${abonos.length === 1 ? '' : 's'}</span>
            </div>
            <div class="rounded-xl border border-slate-100 px-4">${historial}</div>
        </section>
    `;
    acciones.innerHTML = `
        <button id="editarObligacionDetalle" type="button" ${esHistorico ? 'disabled' : ''} class="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><i class="fa-solid fa-pen mr-2"></i>Editar préstamo</button>
        <button id="accionObligacionDetalle" type="button" ${esHistorico || saldo <= 0 ? 'disabled' : ''} class="w-full rounded-xl bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"><i class="fa-solid fa-plus mr-2"></i>Registrar abono</button>
        <button id="eliminarObligacionDetalle" type="button" ${esHistorico ? 'disabled' : ''} class="w-full rounded-xl py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"><i class="fa-solid fa-trash mr-2"></i>Eliminar préstamo</button>
    `;
    document.getElementById('editarObligacionDetalle').addEventListener('click', () => {
        const prestamoId = obligacionDetalle?.id;
        if (!prestamoId || esHistorico) return;
        cerrarDetalleObligacion();
        abrirModalPrestamo(prestamoId);
    });
    document.getElementById('accionObligacionDetalle').addEventListener('click', () => {
        const prestamoId = obligacionDetalle?.id;
        if (!prestamoId || esHistorico) return;
        cerrarDetalleObligacion();
        abrirModalAbono(prestamoId);
    });
    document.getElementById('eliminarObligacionDetalle').addEventListener('click', async () => {
        const prestamoId = obligacionDetalle?.id;
        if (prestamoId && !esHistorico) await eliminarPrestamo(prestamoId);
    });
}

function filtrarTarjetas() {
    const query = document.getElementById('inputBuscar').value;
    renderizarTarjetas(query);
    renderizarObligaciones(query);
}

// --- MODAL TARJETA (CRUD) ---
function abrirModalTarjeta(id = null) {
    if (mesSeleccionado !== obtenerMesActual()) return;
    document.getElementById('modalTarjeta').classList.remove('hidden');
    document.getElementById('formTarjeta').reset();
    document.getElementById('tarjetaId').value = '';
    renderizarCamposPersonasTarjeta();

    if (id) {
        document.getElementById('modalTarjetaTitulo').innerText = 'Editar Tarjeta';
        const tarjeta = tarjetas.find(t => t.id === id);
        if (tarjeta) {
            const asignacion = obtenerAsignacionTarjeta(tarjeta);
            document.getElementById('tarjetaId').value = tarjeta.id;
            document.getElementById('nombreTarjeta').value = tarjeta.nombre;
            const titularId = obtenerTitularId(tarjeta);
            document.getElementById('titularTarjeta').value = titularId;
            const datosCredito = obtenerDatosCredito(tarjeta);
            document.getElementById('creditoAprobadoTarjeta').value = datosCredito.creditoAprobado.toFixed(2);
            document.getElementById('creditoDisponibleTarjeta').value = datosCredito.creditoDisponible.toFixed(2);
            document.getElementById('mensualidadTarjeta').value = datosCredito.mensualidad.toFixed(2);
            asignacion.participantes = obtenerIDsParticipantes(tarjeta);
            renderizarCamposPersonasTarjeta(titularId, asignacion);
            document.getElementById('diaCorteTarjeta').value = tarjeta.diaCorte;
            document.getElementById('fechaLimiteTarjeta').value = tarjeta.fechaLimite;
        }
    } else {
        document.getElementById('modalTarjetaTitulo').innerText = 'Nueva Tarjeta';
    }
}

function renderizarCamposPersonasTarjeta(titularId = personas[0]?.id || '', asignacion = {}) {
    const selectorTitular = document.getElementById('titularTarjeta');
    selectorTitular.innerHTML = personas.map(persona =>
        `<option value="${escaparHTML(persona.id)}">${escaparHTML(persona.nombre)}</option>`
    ).join('');
    selectorTitular.value = titularId;

    const tieneParticipantesGuardados = Array.isArray(asignacion.participantes);
    const participantes = tieneParticipantesGuardados
        ? asignacion.participantes
        : Object.entries(asignacion)
            .filter(([personaId, importe]) => personaId !== 'participantes' && Number(importe) > 0)
            .map(([personaId]) => personaId);
    if (!tieneParticipantesGuardados && participantes.length === 0 && titularId) participantes.push(titularId);

    document.getElementById('contenedorPagosTarjeta').innerHTML = personas.map(persona => {
        const inputId = `pagoPersona_${encodeURIComponent(persona.id)}`;
        const participa = participantes.includes(persona.id);
        return `
            <div class="rounded-lg border border-slate-200 p-2">
                <label class="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input type="checkbox" id="participa_${encodeURIComponent(persona.id)}" data-persona-id="${escaparHTML(persona.id)}" ${participa ? 'checked' : ''} onchange="cambiarParticipacionPersona(this)" class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500">
                    ${escaparHTML(persona.nombre)}
                </label>
                <input type="number" min="0" step="0.01" id="${inputId}" ${participa ? 'required' : 'disabled'} value="${Number(asignacion[persona.id] || 0).toFixed(2)}" aria-label="Importe que paga ${escaparHTML(persona.nombre)}" class="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400">
            </div>
        `;
    }).join('');
}

function cambiarParticipacionPersona(checkbox) {
    const personaId = checkbox.dataset.personaId;
    const input = document.getElementById(`pagoPersona_${encodeURIComponent(personaId)}`);
    input.disabled = !checkbox.checked;
    input.required = checkbox.checked;
    if (!checkbox.checked) input.value = '0.00';
}

function mostrarFormularioNuevaPersona() {
    const formulario = document.getElementById('formNuevaPersona');
    formulario.classList.toggle('hidden');
    if (!formulario.classList.contains('hidden')) {
        document.getElementById('nombreNuevaPersona').focus();
    }
}

async function agregarPersonaDesdeTarjeta() {
    const inputNombre = document.getElementById('nombreNuevaPersona');
    const boton = document.getElementById('botonAgregarPersona');
    const error = document.getElementById('errorNuevaPersona');
    const nombre = inputNombre.value.trim();
    error.classList.add('hidden');

    if (!nombre) {
        error.innerText = 'Escribe el nombre de la persona.';
        error.classList.remove('hidden');
        inputNombre.focus();
        return;
    }
    if (personas.some(persona => persona.nombre.toLocaleLowerCase('es') === nombre.toLocaleLowerCase('es'))) {
        error.innerText = 'Ya existe una persona con ese nombre.';
        error.classList.remove('hidden');
        inputNombre.focus();
        return;
    }

    const titularId = document.getElementById('titularTarjeta').value;
    const asignacion = {};
    const participantes = [];
    for (const persona of personas) {
        const input = document.getElementById(`pagoPersona_${encodeURIComponent(persona.id)}`);
        const checkbox = document.getElementById(`participa_${encodeURIComponent(persona.id)}`);
        asignacion[persona.id] = Number(input.value) || 0;
        if (checkbox.checked) participantes.push(persona.id);
    }
    asignacion.participantes = participantes;

    boton.disabled = true;
    boton.innerText = 'Guardando...';
    try {
        const documento = await db.collection('Usuarios').add({ Usuario: nombre });
        personas.push({ id: documento.id, nombre });
        personas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        asignacion[documento.id] = 0;
        renderizarCamposPersonasTarjeta(titularId, asignacion);
        document.getElementById('formNuevaPersona').classList.add('hidden');
        inputNombre.value = '';
    } catch (errorAgregarPersona) {
        console.error('Error al agregar persona a Usuarios:', errorAgregarPersona);
        error.innerText = 'No se pudo agregar. Verifica las reglas publicadas de Firestore e inténtalo de nuevo.';
        error.classList.remove('hidden');
    } finally {
        boton.disabled = false;
        boton.innerText = 'Agregar';
    }
}

function cerrarModalTarjeta() {
    document.getElementById('modalTarjeta').classList.add('hidden');
}

async function guardarTarjeta(event) {
    event.preventDefault();
    if (mesSeleccionado !== obtenerMesActual()) return;
    const id = document.getElementById('tarjetaId').value;
    const nombre = document.getElementById('nombreTarjeta').value;
    const titularId = document.getElementById('titularTarjeta').value;
    const creditoAprobado = Number(document.getElementById('creditoAprobadoTarjeta').value);
    const creditoDisponible = Number(document.getElementById('creditoDisponibleTarjeta').value);
    const mensualidad = Number(document.getElementById('mensualidadTarjeta').value);
    const pagosPorUsuario = {};
    const participantes = [];
    let sumaAsignada = 0;
    personas.forEach(persona => {
        const input = document.getElementById(`pagoPersona_${encodeURIComponent(persona.id)}`);
        const checkbox = document.getElementById(`participa_${encodeURIComponent(persona.id)}`);
        const importe = checkbox.checked ? Number(input.value) : 0;
        pagosPorUsuario[persona.id] = importe;
        if (checkbox.checked) participantes.push(persona.id);
        sumaAsignada += Math.round(importe * 100);
    });
    const diaCorte = Number(document.getElementById('diaCorteTarjeta').value);
    const fechaLimite = document.getElementById('fechaLimiteTarjeta').value;
    const diaLimiteRecurrente = fechaLimite ? Number(fechaLimite.slice(-2)) : 0;

    const mensualidadEnCentavos = Math.round(mensualidad * 100);
    if (participantes.length === 0) {
        mostrarMensajeEstado('Selecciona al menos una persona que participe en el pago.', true);
        return;
    }
    if (creditoAprobado < 0 || creditoDisponible < 0 || creditoDisponible > creditoAprobado
        || mensualidad < 0 || Object.values(pagosPorUsuario).some(importe => !Number.isFinite(importe) || importe < 0)) {
        mostrarMensajeEstado('Revisa los importes: no pueden ser negativos y el crédito disponible no puede superar el crédito aprobado.', true);
        return;
    }
    if (sumaAsignada !== mensualidadEnCentavos) {
        mostrarMensajeEstado('La suma asignada a las personas debe ser igual a la mensualidad.', true);
        return;
    }

    if (id) {
        // Editar existente
        const index = tarjetas.findIndex(t => t.id === id);
        if (index !== -1) {
            tarjetas[index] = { ...tarjetas[index], nombre, titularId, creditoAprobado, creditoDisponible, mensualidad, pagosPorUsuario, participantes, diaCorte, fechaLimite, diaLimiteRecurrente };
        }
    } else {
        // Crear nueva
        const nueva = {
            id: Date.now().toString(),
            nombre,
            titularId,
            creditoAprobado,
            creditoDisponible,
            mensualidad,
            pagosPorUsuario,
            participantes,
            diaCorte,
            fechaLimite,
            diaLimiteRecurrente,
            conceptos: []
        };
        tarjetas.push(nueva);
    }

    if (!await guardarEnStorage()) {
        renderizarTodo();
        return;
    }
    renderizarTodo();
    cerrarModalTarjeta();
}

function editarTarjeta(id) {
    abrirModalTarjeta(id);
}

async function cambiarEstadoPago(id) {
    if (mesSeleccionado !== obtenerMesActual()) return;
    const tarjeta = tarjetas.find(t => t.id === id);
    if (!tarjeta || creditoLiquidado(tarjeta)) return;

    if (tarjeta.pagada) {
        const incrementoAplicado = Math.round((Number(tarjeta.disponibleAbonadoPorPago) || 0) * 100);
        const disponibleActual = Math.round(obtenerDatosCredito(tarjeta).creditoDisponible * 100);
        tarjeta.creditoDisponible = Math.max(0, disponibleActual - incrementoAplicado) / 100;
        tarjeta.disponibleAbonadoPorPago = 0;
        tarjeta.pagada = false;
    } else {
        const datosCredito = obtenerDatosCredito(tarjeta);
        const disponibleCentavos = Math.round(datosCredito.creditoDisponible * 100);
        const creditoAprobadoCentavos = Math.round(datosCredito.creditoAprobado * 100);
        const mensualidadCentavos = Math.round(datosCredito.mensualidad * 100);
        const incrementoAplicado = Math.min(
            mensualidadCentavos,
            Math.max(0, creditoAprobadoCentavos - disponibleCentavos)
        );
        tarjeta.creditoDisponible = (disponibleCentavos + incrementoAplicado) / 100;
        tarjeta.disponibleAbonadoPorPago = incrementoAplicado / 100;
        tarjeta.pagada = true;
    }

    if (!await guardarEnStorage()) {
        renderizarTodo();
        return;
    }
    renderizarTodo();
}

async function eliminarTarjeta(id) {
    if (mesSeleccionado !== obtenerMesActual()) return;
    if (confirm('¿Estás seguro de eliminar esta tarjeta y todo su desglose?')) {
        tarjetas = tarjetas.filter(t => t.id !== id);
        if (!await guardarEnStorage()) {
            renderizarTodo();
            return;
        }
        renderizarTodo();
    }
}

function toggleMenuCrear() {
    if (mesSeleccionado === obtenerMesActual()) {
        document.getElementById('menuCrear').classList.toggle('hidden');
    }
}

function seleccionarCrear(tipo) {
    document.getElementById('menuCrear').classList.add('hidden');
    if (tipo === 'tarjeta') abrirModalTarjeta();
    if (tipo === 'credito') abrirModalCredito();
    if (tipo === 'prestamo') abrirModalPrestamo();
}

async function guardarColeccionUsuario(nombreColeccion, registros) {
    const referencia = db.collection('users').doc(usuarioActual.uid).collection(nombreColeccion);
    const existentes = await referencia.get();
    const idsActuales = new Set(registros.map(registro => registro.id));
    const lote = db.batch();

    existentes.docs.forEach(documento => {
        if (!idsActuales.has(documento.id)) lote.delete(documento.ref);
    });
    registros.forEach(registro => {
        lote.set(referencia.doc(registro.id), registro);
    });
    if (!existentes.empty || registros.length > 0) {
        await lote.commit();
    }
}

function opcionesPersonas(seleccionado = '') {
    return personas.map(persona =>
        `<option value="${escaparHTML(persona.id)}" ${persona.id === seleccionado ? 'selected' : ''}>${escaparHTML(persona.nombre)}</option>`
    ).join('');
}

function fechaLocalActual() {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function renderizarCamposPagosCredito(asignacion = {}, participantes = []) {
    document.getElementById('participantesCredito').innerHTML = personas.map(persona => {
        const key = encodeURIComponent(persona.id);
        const seleccionado = participantes.includes(persona.id);
        return `
            <div class="rounded-lg border border-slate-200 p-2">
                <label class="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input type="checkbox" id="creditoParticipa_${key}" ${seleccionado ? 'checked' : ''} onchange="togglePagoCredito('${key}')" class="rounded text-indigo-600">
                    ${escaparHTML(persona.nombre)}
                </label>
                <input type="number" min="0" step="0.01" id="creditoPago_${key}" value="${(Number(asignacion[persona.id]) || 0).toFixed(2)}" ${seleccionado ? '' : 'disabled'} class="mt-2 w-full px-2 py-1.5 border border-slate-200 rounded text-sm disabled:bg-slate-100">
            </div>
        `;
    }).join('');
}

function mostrarErrorFormulario(id, mensaje) {
    const elemento = document.getElementById(id);
    elemento.innerText = mensaje;
    elemento.classList.remove('hidden');
}

function togglePagoCredito(key) {
    const checkbox = document.getElementById(`creditoParticipa_${key}`);
    const input = document.getElementById(`creditoPago_${key}`);
    input.disabled = !checkbox.checked;
    if (!checkbox.checked) input.value = '0.00';
}

function avanzarFechaPagoCredito(fecha, frecuencia, diaRecurrente) {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    if (frecuencia === 'semanal') {
        const siguiente = new Date(Date.UTC(anio, mes - 1, dia + 7));
        return `${siguiente.getUTCFullYear()}-${String(siguiente.getUTCMonth() + 1).padStart(2, '0')}-${String(siguiente.getUTCDate()).padStart(2, '0')}`;
    }
    if (frecuencia === 'quincenal') {
        const siguiente = new Date(Date.UTC(anio, mes - 1, dia + 15));
        return `${siguiente.getUTCFullYear()}-${String(siguiente.getUTCMonth() + 1).padStart(2, '0')}-${String(siguiente.getUTCDate()).padStart(2, '0')}`;
    }
    const siguienteMes = new Date(Date.UTC(anio, mes, 1));
    const ultimoDia = new Date(Date.UTC(siguienteMes.getUTCFullYear(), siguienteMes.getUTCMonth() + 1, 0)).getUTCDate();
    const siguienteDia = Math.min(Number(diaRecurrente) || dia, ultimoDia);
    return `${siguienteMes.getUTCFullYear()}-${String(siguienteMes.getUTCMonth() + 1).padStart(2, '0')}-${String(siguienteDia).padStart(2, '0')}`;
}

function actualizarEtiquetaFrecuenciaCredito() {
    const frecuencia = document.getElementById('frecuenciaPagoCredito').value;
    document.getElementById('etiquetaPagoCredito').innerText = `Pago ${frecuencia} ($)`;
    document.getElementById('tituloParticipantesCredito').innerText = `Personas que pagan la cuota ${frecuencia}`;
    document.getElementById('ayudaParticipantesCredito').innerText = `Los importes deben sumar el pago ${frecuencia}.`;
}

function actualizarSaldoInicialCredito() {
    const saldo = document.getElementById('saldoPendienteCredito');
    if (saldo.dataset.editado !== 'true') {
        saldo.value = document.getElementById('montoCredito').value;
    }
}

function abrirModalCredito(id = '') {
    if (mesSeleccionado !== obtenerMesActual()) return;
    const credito = creditos.find(item => item.id === id);
    document.getElementById('formCredito').reset();
    document.getElementById('errorCredito').classList.add('hidden');
    document.getElementById('creditoId').value = credito?.id || '';
    document.getElementById('nombreCredito').value = credito?.nombre || '';
    document.getElementById('montoCredito').value = credito?.montoTotal ?? '';
    document.getElementById('cuotasTotales').value = credito?.cuotasTotales ?? '';
    document.getElementById('cuotasRestantes').value = credito?.cuotasRestantes ?? '';
    document.getElementById('pagoMensualCredito').value = credito ? obtenerPagoPorPeriodoCredito(credito) : '';
    document.getElementById('saldoPendienteCredito').value = credito ? obtenerSaldoPendienteCredito(credito) : '';
    document.getElementById('saldoPendienteCredito').dataset.editado = credito ? 'true' : 'false';
    document.getElementById('tasaInteresCredito').value = credito?.tasaInteresAnual ?? 0;
    document.getElementById('frecuenciaPagoCredito').value = obtenerFrecuenciaCredito(credito || {});
    document.getElementById('fechaPagoCredito').value = credito?.fechaPago || fechaLocalActual();
    actualizarEtiquetaFrecuenciaCredito();
    document.getElementById('titularCredito').innerHTML = opcionesPersonas(credito?.titularId || personas[0]?.id || '');
    renderizarCamposPagosCredito(credito?.pagosPorUsuario || {}, credito?.participantes || []);
    document.getElementById('tituloModalCredito').innerText = credito ? 'Editar crédito bancario' : 'Nuevo crédito bancario';
    document.getElementById('modalCredito').classList.remove('hidden');
}

function cerrarModalCredito() {
    document.getElementById('modalCredito').classList.add('hidden');
}

async function guardarCredito(event) {
    event.preventDefault();
    if (mesSeleccionado !== obtenerMesActual()) return;

    const id = document.getElementById('creditoId').value;
    const nombre = document.getElementById('nombreCredito').value.trim();
    const montoTotal = Number(document.getElementById('montoCredito').value);
    const cuotasTotales = Number(document.getElementById('cuotasTotales').value);
    const cuotasRestantes = Number(document.getElementById('cuotasRestantes').value);
    const pagoMensual = Number(document.getElementById('pagoMensualCredito').value);
    const saldoPendiente = Number(document.getElementById('saldoPendienteCredito').value);
    const tasaInteresAnual = Number(document.getElementById('tasaInteresCredito').value);
    const frecuenciaPago = document.getElementById('frecuenciaPagoCredito').value;
    const fechaPago = document.getElementById('fechaPagoCredito').value;
    const titularId = document.getElementById('titularCredito').value;
    const pagosPorUsuario = {};
    const participantes = [];
    let sumaAsignada = 0;

    personas.forEach(persona => {
        const key = encodeURIComponent(persona.id);
        const checkbox = document.getElementById(`creditoParticipa_${key}`);
        const input = document.getElementById(`creditoPago_${key}`);
        const importe = checkbox.checked ? Number(input.value) : 0;
        pagosPorUsuario[persona.id] = importe;
        if (checkbox.checked) participantes.push(persona.id);
        sumaAsignada += Math.round(importe * 100);
    });

    if (!nombre || !Number.isFinite(montoTotal) || montoTotal <= 0
        || !Number.isInteger(cuotasTotales) || cuotasTotales < 1
        || !Number.isInteger(cuotasRestantes) || cuotasRestantes < 0 || cuotasRestantes > cuotasTotales
        || !Number.isFinite(pagoMensual) || pagoMensual < 0
        || (cuotasRestantes > 0 && pagoMensual === 0)
        || !Number.isFinite(saldoPendiente) || saldoPendiente < 0
        || !Number.isFinite(tasaInteresAnual) || tasaInteresAnual < 0
        || !['mensual', 'quincenal', 'semanal'].includes(frecuenciaPago)
        || !/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)
        || participantes.length === 0
        || Object.values(pagosPorUsuario).some(importe => !Number.isFinite(importe) || importe < 0)
        || sumaAsignada !== Math.round(pagoMensual * 100)) {
        mostrarErrorFormulario('errorCredito', 'Verifica el monto, saldo, fecha y frecuencia. Selecciona participantes y asegúrate de que sus importes sumen exactamente el pago por periodo.');
        return;
    }

    const anteriores = creditos;
    const creditoAnterior = creditos.find(credito => credito.id === id);
    const registro = {
        id: id || db.collection('users').doc(usuarioActual.uid).collection('creditos').doc().id,
        nombre,
        montoTotal,
        saldoPendiente,
        cuotasTotales,
        cuotasRestantes,
        pagoMensual,
        pagoPorPeriodo: pagoMensual,
        tasaInteresAnual,
        frecuenciaPago,
        fechaPago,
        diaPagoRecurrente: Number(fechaPago.slice(-2)),
        movimientos: creditoAnterior?.movimientos || [],
        titularId,
        pagosPorUsuario,
        participantes
    };
    creditos = id
        ? creditos.map(credito => credito.id === id ? { ...credito, ...registro } : credito)
        : [...creditos, registro];

    try {
        await guardarColeccionUsuario('creditos', creditos);
        mostrarMensajeEstado('Crédito guardado en Firebase.');
        cerrarModalCredito();
        renderizarTodo();
    } catch (error) {
        creditos = anteriores;
        console.error('Error al guardar crédito en Firebase:', error);
        mostrarErrorFormulario('errorCredito', 'No se pudo guardar el crédito en Firebase. Revisa las reglas publicadas e inténtalo de nuevo.');
    }
}

function abrirModalPagoCredito(id) {
    const credito = creditos.find(item => item.id === id);
    if (!credito || obtenerSaldoPendienteCredito(credito) <= 0 || mesSeleccionado !== obtenerMesActual()) return;
    document.getElementById('formPagoCredito').reset();
    document.getElementById('errorPagoCredito').classList.add('hidden');
    document.getElementById('pagoCreditoId').value = id;
    const saldo = obtenerSaldoPendienteCredito(credito);
    document.getElementById('montoPagoCredito').max = saldo.toFixed(2);
    document.getElementById('montoPagoCredito').value = Math.min(
        obtenerPagoPorPeriodoCredito(credito),
        saldo
    ).toFixed(2);
    document.getElementById('fechaMovimientoCredito').value = fechaLocalActual();
    document.getElementById('modalPagoCredito').classList.remove('hidden');
}

function cerrarModalPagoCredito() {
    document.getElementById('modalPagoCredito').classList.add('hidden');
}

async function guardarPagoCredito(event) {
    event.preventDefault();
    const id = document.getElementById('pagoCreditoId').value;
    const credito = creditos.find(item => item.id === id);
    const montoCapturado = Number(document.getElementById('montoPagoCredito').value);
    const montoCentavos = Math.round(montoCapturado * 100);
    const monto = montoCentavos / 100;
    const fecha = document.getElementById('fechaMovimientoCredito').value;
    const saldoActual = credito ? obtenerSaldoPendienteCredito(credito) : 0;
    if (!credito || mesSeleccionado !== obtenerMesActual()
        || !Number.isFinite(montoCapturado) || montoCentavos <= 0
        || montoCentavos > Math.round(saldoActual * 100)
        || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        mostrarErrorFormulario('errorPagoCredito', 'El monto debe ser mayor a cero y no superar el saldo pendiente; revisa también la fecha.');
        return;
    }

    const saldoPendiente = Math.max(0, Math.round((saldoActual - monto) * 100) / 100);
    const movimiento = {
        id: db.collection('users').doc(usuarioActual.uid).collection('creditos').doc().id,
        monto,
        fecha,
        saldoDespues: saldoPendiente
    };
    const siguientePagoBase = credito.fechaPago || fecha;
    const diaPagoRecurrente = Number(credito.diaPagoRecurrente) || Number(siguientePagoBase.slice(-2));
    let siguienteFechaPago = avanzarFechaPagoCredito(siguientePagoBase, obtenerFrecuenciaCredito(credito), diaPagoRecurrente);
    while (siguienteFechaPago <= fecha) {
        siguienteFechaPago = avanzarFechaPagoCredito(siguienteFechaPago, obtenerFrecuenciaCredito(credito), diaPagoRecurrente);
    }
    const anteriores = creditos;
    creditos = creditos.map(item => item.id === id ? {
        ...item,
        saldoPendiente,
        fechaPago: siguienteFechaPago,
        diaPagoRecurrente,
        cuotasRestantes: Math.max(0, Number(item.cuotasRestantes) - 1),
        movimientos: [...(item.movimientos || []), movimiento]
    } : item);
    try {
        await guardarColeccionUsuario('creditos', creditos);
        mostrarMensajeEstado('Pago y movimiento guardados en Firebase.');
        cerrarModalPagoCredito();
        renderizarTodo();
    } catch (error) {
        creditos = anteriores;
        console.error('Error al guardar el pago del crédito:', error);
        mostrarErrorFormulario('errorPagoCredito', 'No se pudo guardar el pago en Firebase. Inténtalo de nuevo.');
        renderizarTodo();
    }
}

async function eliminarCredito(id) {
    const credito = creditos.find(item => item.id === id);
    if (!credito || mesSeleccionado !== obtenerMesActual()
        || !confirm(`¿Eliminar el crédito "${credito.nombre}"?`)) return;
    const anteriores = creditos;
    creditos = creditos.filter(item => item.id !== id);
    try {
        await guardarColeccionUsuario('creditos', creditos);
        mostrarMensajeEstado('Crédito eliminado.');
        renderizarTodo();
    } catch (error) {
        creditos = anteriores;
        console.error('Error al eliminar crédito:', error);
        mostrarMensajeEstado('No se pudo eliminar el crédito de Firebase.', true);
    }
}

function abrirModalPrestamo(id = '', opciones = {}) {
    if (mesSeleccionado !== obtenerMesActual()) return;
    const prestamo = prestamos.find(item => item.id === id);
    document.getElementById('formPrestamo').reset();
    document.getElementById('errorPrestamo').classList.add('hidden');
    prepararSelectorPersonaPrestamo(
        'prestamista',
        prestamo?.prestamistaId || personas[0]?.id || '',
        prestamo?.prestamistaNombre || opciones.prestamistaNombre || ''
    );
    prepararSelectorPersonaPrestamo('prestatario', prestamo?.prestatarioId || personas[1]?.id || '', prestamo?.prestatarioNombre || '');
    document.getElementById('prestamoId').value = prestamo?.id || '';
    document.getElementById('descripcionPrestamo').value = prestamo?.descripcion || opciones.descripcion || '';
    document.getElementById('montoPrestamo').value = prestamo?.monto ?? '';
    document.getElementById('tituloModalPrestamo').innerText = prestamo ? 'Editar préstamo personal' : 'Nuevo préstamo personal';
    document.getElementById('botonGuardarPrestamo').innerText = prestamo ? 'Guardar cambios' : 'Guardar préstamo';
    document.getElementById('modalPrestamo').classList.remove('hidden');
}

function prepararSelectorPersonaPrestamo(tipo, personaId, nombreLibre) {
    const selector = document.getElementById(tipo);
    selector.innerHTML = `${opcionesPersonas(personaId)}<option value="${valorOtraPersonaPrestamo}">Otra persona (nombre libre)</option>`;
    selector.value = nombreLibre ? valorOtraPersonaPrestamo : personaId;
    document.getElementById(`${tipo}Libre`).value = nombreLibre;
    actualizarPersonaLibrePrestamo(tipo);
}

function actualizarPersonaLibrePrestamo(tipo) {
    const selector = document.getElementById(tipo);
    const campo = document.getElementById(`${tipo}Libre`);
    const contenedorId = tipo === 'prestamista' ? 'contenedorPrestamistaLibre' : 'contenedorPrestatarioLibre';
    const esLibre = selector.value === valorOtraPersonaPrestamo;
    document.getElementById(contenedorId).classList.toggle('hidden', !esLibre);
    campo.required = esLibre;
}

function leerPartePrestamo(tipo) {
    const selector = document.getElementById(tipo);
    if (selector.value === valorOtraPersonaPrestamo) {
        return { id: '', nombre: document.getElementById(`${tipo}Libre`).value.trim() };
    }
    return { id: selector.value, nombre: '' };
}

function cerrarModalPrestamo() {
    document.getElementById('modalPrestamo').classList.add('hidden');
}

async function guardarPrestamo(event) {
    event.preventDefault();
    if (mesSeleccionado !== obtenerMesActual()) return;
    const id = document.getElementById('prestamoId').value;
    const monto = Number(document.getElementById('montoPrestamo').value);
    const descripcion = document.getElementById('descripcionPrestamo').value.trim();
    const prestamista = leerPartePrestamo('prestamista');
    const prestatario = leerPartePrestamo('prestatario');
    const prestamoAnterior = prestamos.find(item => item.id === id);
    const totalAbonado = prestamoAnterior
        ? (prestamoAnterior.abonos || []).reduce((total, abono) => total + Math.round((Number(abono.monto) || 0) * 100), 0)
        : 0;
    if (!descripcion || !Number.isFinite(monto) || monto <= 0
        || Math.round(monto * 100) < totalAbonado
        || (!prestamista.id && !prestamista.nombre) || (!prestatario.id && !prestatario.nombre)
        || (prestamista.id && prestamista.id === prestatario.id)
        || (prestamista.nombre && prestatario.nombre
            && prestamista.nombre.toLocaleLowerCase('es') === prestatario.nombre.toLocaleLowerCase('es'))) {
        mostrarErrorFormulario('errorPrestamo', Math.round(monto * 100) < totalAbonado
            ? 'El monto no puede ser menor al total de abonos ya registrados.'
            : 'Escribe una descripción, indica dos personas distintas y un monto mayor a cero.');
        return;
    }

    const anteriores = prestamos;
    const registro = {
        id: id || db.collection('users').doc(usuarioActual.uid).collection('prestamos').doc().id,
        descripcion,
        monto,
        prestamistaId: prestamista.id,
        prestamistaNombre: esNombreSrTono(prestamista.nombre || nombrePersona(prestamista.id))
            ? 'Sr. Toño'
            : prestamista.nombre,
        prestatarioId: prestatario.id,
        prestatarioNombre: prestatario.nombre,
        fecha: prestamoAnterior?.fecha || fechaLocalActual(),
        abonos: prestamoAnterior?.abonos || []
    };
    prestamos = id
        ? prestamos.map(item => item.id === id ? registro : item)
        : [...prestamos, registro];
    try {
        await guardarColeccionUsuario('prestamos', prestamos);
        mostrarMensajeEstado(id ? 'Cambios del préstamo guardados en Firebase.' : 'Préstamo guardado en Firebase.');
        cerrarModalPrestamo();
        renderizarTodo();
    } catch (error) {
        prestamos = anteriores;
        console.error('Error al guardar cambios del préstamo en Firebase:', error);
        mostrarErrorFormulario('errorPrestamo', 'No se pudo guardar el préstamo en Firebase. Revisa las reglas publicadas e inténtalo de nuevo.');
    }
}

function saldoPrestamo(prestamo) {
    const abonado = (prestamo.abonos || []).reduce((total, abono) => total + Math.round((Number(abono.monto) || 0) * 100), 0);
    return Math.max(0, Math.round(Number(prestamo.monto) * 100) - abonado) / 100;
}

let prestamoAbonoId = null;

function abrirModalAbono(id) {
    const prestamo = prestamos.find(item => item.id === id);
    if (!prestamo || saldoPrestamo(prestamo) <= 0 || mesSeleccionado !== obtenerMesActual()) return;
    prestamoAbonoId = id;
    document.getElementById('formAbono').reset();
    document.getElementById('errorAbono').classList.add('hidden');
    document.getElementById('fechaAbono').value = fechaLocalActual();
    const personaAbono = document.getElementById('personaAbono');
    const esPrestatarioLibre = Boolean(prestamo.prestatarioNombre);
    personaAbono.innerHTML = `${esPrestatarioLibre
        ? `<option value="${valorOtraPersonaPrestamo}">${escaparHTML(prestamo.prestatarioNombre)}</option>`
        : ''}${opcionesPersonas(prestamo.prestatarioId)}`;
    if (esPrestatarioLibre) personaAbono.value = valorOtraPersonaPrestamo;
    document.getElementById('montoAbono').max = saldoPrestamo(prestamo).toFixed(2);
    document.getElementById('modalAbono').classList.remove('hidden');
}

function cerrarModalAbono() {
    document.getElementById('modalAbono').classList.add('hidden');
    prestamoAbonoId = null;
}

async function guardarAbono(event) {
    event.preventDefault();
    const prestamo = prestamos.find(item => item.id === prestamoAbonoId);
    if (!prestamo || mesSeleccionado !== obtenerMesActual()) return;
    const monto = Number(document.getElementById('montoAbono').value);
    const saldo = saldoPrestamo(prestamo);
    if (!Number.isFinite(monto) || monto <= 0 || Math.round(monto * 100) > Math.round(saldo * 100)) {
        mostrarErrorFormulario('errorAbono', 'El abono debe ser mayor a cero y no puede superar el saldo pendiente.');
        return;
    }

    const anteriores = prestamos;
    const personaAbonoId = document.getElementById('personaAbono').value;
    const abono = {
        id: db.collection('users').doc(usuarioActual.uid).collection('prestamos').doc().id,
        monto,
        fecha: document.getElementById('fechaAbono').value,
        personaId: personaAbonoId === valorOtraPersonaPrestamo ? '' : personaAbonoId,
        personaNombre: personaAbonoId === valorOtraPersonaPrestamo
            ? prestamo.prestatarioNombre
            : nombrePersona(personaAbonoId)
    };
    prestamos = prestamos.map(item => item.id === prestamo.id
        ? { ...item, abonos: [...(item.abonos || []), abono] }
        : item);
    try {
        await guardarColeccionUsuario('prestamos', prestamos);
        mostrarMensajeEstado('Abono registrado.');
        cerrarModalAbono();
        renderizarTodo();
    } catch (error) {
        prestamos = anteriores;
        console.error('Error al guardar abono del préstamo:', error);
        mostrarErrorFormulario('errorAbono', 'No se pudo guardar el abono en Firebase.');
    }
}

async function eliminarPrestamo(id) {
    const prestamo = prestamos.find(item => item.id === id);
    if (!prestamo || mesSeleccionado !== obtenerMesActual()
        || !confirm(`¿Eliminar el préstamo "${prestamo.descripcion}" y su historial de abonos?`)) return;
    const anteriores = prestamos;
    prestamos = prestamos.filter(item => item.id !== id);
    try {
        await guardarColeccionUsuario('prestamos', prestamos);
        mostrarMensajeEstado('Préstamo eliminado.');
        renderizarTodo();
    } catch (error) {
        prestamos = anteriores;
        console.error('Error al eliminar préstamo:', error);
        mostrarMensajeEstado('No se pudo eliminar el préstamo de Firebase.', true);
    }
}

function renderizarObligaciones(filtro = '') {
    const contenedorCreditos = document.getElementById('contenedorCreditos');
    const contenedorPrestamos = document.getElementById('contenedorPrestamos');
    const term = filtro.toLocaleLowerCase('es');
    const esHistorico = mesSeleccionado !== obtenerMesActual();
    const creditosFiltrados = creditos.filter(credito =>
        `${credito.nombre} ${nombrePersona(credito.titularId)}`.toLocaleLowerCase('es').includes(term));
    const prestamosFiltrados = prestamos.filter(prestamo =>
        `${prestamo.descripcion} ${nombrePartePrestamo(prestamo, 'prestamista')} ${nombrePartePrestamo(prestamo, 'prestatario')}`.toLocaleLowerCase('es').includes(term));
    const filasCredito = creditosFiltrados.map(credito => {
        const saldoPendiente = obtenerSaldoPendienteCredito(credito);
        const activo = saldoPendiente > 0;
        const id = escaparHTML(credito.id);
        const seleccionado = obligacionDetalle?.tipo === 'credito' && obligacionDetalle.id === credito.id;
        const movimientos = credito.movimientos || [];
        const expandido = creditoMovimientosExpandidoId === credito.id;
        const frecuencia = obtenerFrecuenciaCredito(credito);
        return `
            <tr data-obligacion-tipo="credito" data-obligacion-id="${id}" tabindex="0" aria-label="Ver detalle del crédito ${escaparHTML(credito.nombre)}" class="cursor-pointer border-t border-slate-100 transition hover:bg-indigo-50/60 ${seleccionado ? 'bg-indigo-50' : ''}">
                <td class="whitespace-nowrap px-5 py-5">
                    <div class="flex items-center gap-2"><span class="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-600">Crédito</span><span class="font-semibold text-slate-900">${escaparHTML(credito.nombre)}</span></div>
                    <div class="mt-1 text-xs text-slate-500">Titular: ${escaparHTML(nombrePersona(credito.titularId))}</div>
                </td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-medium text-slate-800">${formatearMoneda(credito.montoTotal)}</td>
                <td class="whitespace-nowrap px-5 py-5">
                    <div class="text-sm font-semibold text-slate-800">${formatearMoneda(saldoPendiente)}</div>
                    <div class="mt-1 text-xs text-slate-500">${Number(credito.cuotasRestantes)} de ${Number(credito.cuotasTotales)} cuotas restantes</div>
                </td>
                <td class="whitespace-nowrap px-5 py-5 text-sm text-slate-700">${escaparHTML(credito.fechaPago || 'Sin fecha')}</td>
                <td class="whitespace-nowrap px-5 py-5 text-sm text-slate-700">${(Number(credito.tasaInteresAnual) || 0).toFixed(2)}%</td>
                <td class="whitespace-nowrap px-5 py-5">
                    <div class="text-sm font-semibold text-slate-800">${etiquetaFrecuenciaCredito(credito)}</div>
                    <div class="mt-1 text-xs text-slate-500">${formatearMoneda(obtenerPagoPorPeriodoCredito(credito))} por pago</div>
                </td>
                <td class="whitespace-nowrap px-5 py-5"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${activo ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${activo ? 'Activo' : 'Liquidado'}</span></td>
                <td class="whitespace-nowrap px-5 py-5 text-right">
                    <button type="button" data-expandir-movimientos="${id}" aria-expanded="${expandido}" class="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"><i class="fa-solid ${expandido ? 'fa-chevron-up' : 'fa-chevron-down'} mr-1"></i>Movimientos (${movimientos.length})</button>
                </td>
            </tr>
            ${expandido ? `<tr class="border-t border-slate-100 bg-slate-50/70"><td colspan="8" class="px-6 py-3"><div class="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white px-4">${renderizarMovimientosCredito(credito)}</div></td></tr>` : ''}
        `;
    }).join('');

    contenedorCreditos.innerHTML = filasCredito ? `
        <table class="w-full min-w-[1180px] text-left">
            <thead class="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                    <th class="px-5 py-4">Crédito / titular</th>
                    <th class="px-5 py-4">Monto original</th>
                    <th class="px-5 py-4">Saldo pendiente</th>
                    <th class="px-5 py-4">Fecha de pago</th>
                    <th class="px-5 py-4">Interés anual</th>
                    <th class="px-5 py-4">Frecuencia / pago</th>
                    <th class="px-5 py-4">Estado</th>
                    <th class="px-5 py-4">Movimientos</th>
                </tr>
            </thead>
            <tbody>${filasCredito}</tbody>
        </table>
    ` : '<p class="px-5 py-8 text-center text-sm text-slate-500">Aún no hay créditos bancarios registrados.</p>';

    contenedorPrestamos.innerHTML = renderizarTablaPrestamos(prestamosFiltrados, 'Aún no hay préstamos personales registrados.');

    const seccion = document.getElementById('seccionObligaciones');
    seccion.querySelectorAll('button[data-expandir-movimientos]').forEach(boton => {
        boton.addEventListener('click', event => {
            event.stopPropagation();
            creditoMovimientosExpandidoId = creditoMovimientosExpandidoId === boton.dataset.expandirMovimientos
                ? ''
                : boton.dataset.expandirMovimientos;
            renderizarObligaciones(filtro);
        });
    });

    seccion.querySelectorAll('tr[data-obligacion-id]').forEach(fila => {
        const abrir = () => abrirDetalleObligacion(fila.dataset.obligacionTipo, fila.dataset.obligacionId);
        fila.addEventListener('click', event => {
            if (!event.target.closest('button[data-expandir-movimientos]')) abrir();
        });
        fila.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                abrir();
            }
        });
    });

    if (obligacionDetalle) {
        const registros = obligacionDetalle.tipo === 'credito' ? creditosFiltrados : prestamosFiltrados;
        if (registros.some(registro => registro.id === obligacionDetalle.id)) {
            actualizarDetalleObligacion(esHistorico);
        } else {
            cerrarDetalleObligacion();
        }
    }
}

function renderizarTablaPrestamos(registros, mensajeVacio) {
    if (!registros.length) {
        return `<p class="px-5 py-8 text-center text-sm text-slate-500">${escaparHTML(mensajeVacio)}</p>`;
    }

    const filas = registros.map(prestamo => {
        const saldo = saldoPrestamo(prestamo);
        const seleccionado = obligacionDetalle?.tipo === 'prestamo' && obligacionDetalle.id === prestamo.id;
        const tipoSaldo = saldo > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
        return `
            <tr data-obligacion-tipo="prestamo" data-obligacion-id="${escaparHTML(prestamo.id)}" tabindex="0" aria-label="Ver detalle del préstamo ${escaparHTML(prestamo.descripcion)}" class="cursor-pointer border-t border-slate-100 transition hover:bg-indigo-50/60 ${seleccionado ? 'bg-indigo-50' : ''}">
                <td class="whitespace-nowrap px-5 py-5">
                    <div class="flex items-center gap-2"><span class="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Préstamo</span><span class="font-semibold text-slate-900">${escaparHTML(prestamo.descripcion)}</span></div>
                    <div class="mt-1 text-xs text-slate-500">${escaparHTML(nombrePartePrestamo(prestamo, 'prestamista'))} prestó a ${escaparHTML(nombrePartePrestamo(prestamo, 'prestatario'))}</div>
                </td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-medium text-slate-800">${formatearMoneda(prestamo.monto)}</td>
                <td class="whitespace-nowrap px-5 py-5 text-sm font-semibold text-slate-800">${formatearMoneda(saldo)} <span class="font-normal text-slate-500">pendiente</span></td>
                <td class="whitespace-nowrap px-5 py-5"><span class="rounded-full px-2.5 py-1 text-xs font-semibold ${tipoSaldo}">${saldo > 0 ? 'Pendiente' : 'Liquidado'}</span></td>
                <td class="whitespace-nowrap px-5 py-5 text-right text-slate-400"><i class="fa-solid fa-chevron-right text-xs"></i></td>
            </tr>
        `;
    }).join('');

    return `
        <table class="w-full min-w-[760px] text-left">
            <thead class="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                    <th class="px-5 py-4">Préstamo / participantes</th>
                    <th class="px-5 py-4">Monto original</th>
                    <th class="px-5 py-4">Saldo pendiente</th>
                    <th class="px-5 py-4">Estado</th>
                    <th class="px-5 py-4">Detalle</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    `;
}

// --- MODAL CONCEPTOS Y MENSUALIDADES ---
let tarjetaActualId = null;

function abrirModalConceptos(id) {
    tarjetaActualId = id;
    const tarjeta = tarjetas.find(t => t.id === id);
    if (!tarjeta) return;

    document.getElementById('tituloConceptosTarjeta').innerText = `Desglose: ${tarjeta.nombre}`;
    document.getElementById('conceptoTarjetaId').value = id;
    document.getElementById('formConcepto').reset();
    document.getElementById('formConcepto').classList.toggle('hidden', mesSeleccionado !== obtenerMesActual());
    renderizarCamposPersonasConcepto({}, obtenerIDsParticipantes(tarjeta));

    renderizarConceptos(tarjeta);
    document.getElementById('modalConceptos').classList.remove('hidden');
}

function renderizarCamposPersonasConcepto(asignacion = {}, participantes = []) {
    document.getElementById('contenedorPagosConcepto').innerHTML = personas
        .filter(persona => participantes.includes(persona.id))
        .map(persona => {
        const inputId = `conceptoPersona_${encodeURIComponent(persona.id)}`;
        return `
            <div>
                <label for="${inputId}" class="block text-xs font-medium text-indigo-600 mb-1">${escaparHTML(persona.nombre)} ($)</label>
                <input type="number" min="0" step="0.01" id="${inputId}" required value="${Number(asignacion[persona.id] || 0).toFixed(2)}" class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500">
            </div>
        `;
    }).join('');
}

function cerrarModalConceptos() {
    document.getElementById('modalConceptos').classList.add('hidden');
    tarjetaActualId = null;
    renderizarTodo();
}

function renderizarConceptos(tarjeta) {
    const esHistorico = mesSeleccionado !== obtenerMesActual();
    const lista = document.getElementById('listaConceptos');
    lista.innerHTML = '';

    if (!tarjeta.conceptos || tarjeta.conceptos.length === 0) {
        lista.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">No hay conceptos registrados en esta tarjeta. Agrega uno arriba.</p>`;
        document.getElementById('sumaConceptosTotal').innerText = `$0.00`;
        return;
    }

    let sumaTotal = 0;
    tarjeta.conceptos.forEach(c => {
        const asignacion = obtenerAsignacionConcepto(c);
        const subConcepto = Object.values(asignacion).reduce((total, importe) => total + importe, 0);
        sumaTotal += subConcepto;
        const idsParticipantes = tarjetaActualId
            ? obtenerIDsParticipantes(tarjetas.find(t => t.id === tarjetaActualId) || tarjeta)
            : personas.map(persona => persona.id);
        const repartoHTML = personas.filter(persona => idsParticipantes.includes(persona.id)).map(persona => `
            <span class="text-indigo-600 font-medium">${escaparHTML(persona.nombre)}: $${(asignacion[persona.id] || 0).toFixed(2)}</span>
        `).join('');

        const itemHTML = `
            <div class="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center gap-2">
                <div class="flex-grow">
                    <p class="text-sm font-semibold text-slate-800">${escaparHTML(c.desc)}</p>
                    <div class="flex flex-wrap gap-4 text-xs mt-0.5">
                        ${repartoHTML}
                    </div>
                </div>
                <div class="text-right flex items-center gap-3">
                    <span class="text-sm font-bold text-slate-900">$${subConcepto.toFixed(2)}</span>
                    <button onclick="eliminarConcepto('${c.id}')" ${esHistorico ? 'disabled' : ''} class="text-slate-400 hover:text-rose-600 p-1 transition disabled:opacity-40 disabled:cursor-not-allowed">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </div>
        `;
        lista.innerHTML += itemHTML;
    });

    document.getElementById('sumaConceptosTotal').innerText = `$${sumaTotal.toLocaleString('es-MX', {minimumFractionDigits: 2})}`;
}

function obtenerAsignacionConcepto(concepto) {
    const asignacion = Object.fromEntries(personas.map(persona => [persona.id, 0]));
    if (concepto.pagosPorUsuario && typeof concepto.pagosPorUsuario === 'object') {
        personas.forEach(persona => {
            asignacion[persona.id] = Number(concepto.pagosPorUsuario[persona.id]) || 0;
        });
        return asignacion;
    }

    const personaPabloId = personas.find(persona => persona.nombre.toLocaleLowerCase('es') === 'pablo')?.id || personas[0]?.id;
    const personaPapaId = personas.find(persona => ['papá', 'papa'].includes(persona.nombre.toLocaleLowerCase('es')))?.id || personas[1]?.id;
    agregarImporteLegacy(asignacion, personaPabloId, concepto.tu);
    agregarImporteLegacy(asignacion, personaPapaId, concepto.papa);
    return asignacion;
}

async function guardarConcepto(event) {
    event.preventDefault();
    if (mesSeleccionado !== obtenerMesActual()) return;
    if (!tarjetaActualId) return;

    const tarjeta = tarjetas.find(t => t.id === tarjetaActualId);
    if (!tarjeta) return;

    const desc = document.getElementById('descConcepto').value;
    const pagosPorUsuario = {};
    const participantes = obtenerIDsParticipantes(tarjeta);
    for (const persona of personas) {
        if (!participantes.includes(persona.id)) {
            pagosPorUsuario[persona.id] = 0;
            continue;
        }
        const input = document.getElementById(`conceptoPersona_${encodeURIComponent(persona.id)}`);
        const importe = Number(input.value);
        if (!Number.isFinite(importe) || importe < 0) {
            mostrarMensajeEstado('Los importes del concepto no pueden ser negativos.', true);
            return;
        }
        pagosPorUsuario[persona.id] = importe;
    }

    if (!tarjeta.conceptos) tarjeta.conceptos = [];

    tarjeta.conceptos.push({
        id: 'c_' + Date.now(),
        desc,
        pagosPorUsuario
    });
    actualizarAsignacionDesdeConceptos(tarjeta);

    if (!await guardarEnStorage()) {
        const tarjetaRestaurada = tarjetas.find(item => item.id === tarjetaActualId);
        if (tarjetaRestaurada) renderizarConceptos(tarjetaRestaurada);
        renderizarTodo();
        return;
    }
    document.getElementById('formConcepto').reset();
    renderizarCamposPersonasConcepto({}, participantes);
    renderizarConceptos(tarjeta);
    renderizarTodo();
}

async function eliminarConcepto(conceptoId) {
    if (mesSeleccionado !== obtenerMesActual()) return;
    const tarjeta = tarjetas.find(t => t.id === tarjetaActualId);
    if (!tarjeta) return;

    tarjeta.conceptos = tarjeta.conceptos.filter(c => c.id !== conceptoId);
    actualizarAsignacionDesdeConceptos(tarjeta);
    if (!await guardarEnStorage()) {
        const tarjetaRestaurada = tarjetas.find(item => item.id === tarjetaActualId);
        if (tarjetaRestaurada) renderizarConceptos(tarjetaRestaurada);
        renderizarTodo();
        return;
    }
    renderizarConceptos(tarjeta);
    renderizarTodo();
}

function actualizarAsignacionDesdeConceptos(tarjeta) {
    tarjeta.pagosPorUsuario = Object.fromEntries(personas.map(persona => [
        persona.id,
        tarjeta.conceptos.reduce((total, concepto) => total + (obtenerAsignacionConcepto(concepto)[persona.id] || 0), 0)
    ]));
    tarjeta.mensualidad = Object.values(tarjeta.pagosPorUsuario).reduce((total, importe) => total + importe, 0);
}

// --- EXPORTAR RESUMEN ---
function exportarDatos() {
    let textoResumen = `=== RESUMEN FINANCIERO FAMILIAR ===\nMes: ${mesSeleccionado}\n\n`;
    let mensualidadTotal = 0;
    const totalesPorPersona = Object.fromEntries(personas.map(persona => [persona.id, 0]));

    tarjetas.forEach(t => {
        const asignacion = obtenerAsignacionTarjeta(t);
        const datosCredito = obtenerDatosCredito(t);
        const titularNombre = nombrePersona(obtenerTitularId(t));

        textoResumen += `• Tarjeta: ${t.nombre} (${titularNombre})${creditoLiquidado(t) ? ' [LIQUIDADA]' : t.pagada ? ' [PAGADA]' : ''}\n`;
        textoResumen += `  Crédito aprobado: $${datosCredito.creditoAprobado.toFixed(2)} | Crédito disponible: $${datosCredito.creditoDisponible.toFixed(2)}\n`;
        textoResumen += `  Mensualidad: $${datosCredito.mensualidad.toFixed(2)}\n`;
        textoResumen += `  Fecha Límite: ${t.fechaLimite || 'N/A'}\n`;
        personas.forEach(persona => {
            const importe = asignacion[persona.id] || 0;
            textoResumen += `  ${persona.nombre}: $${importe.toFixed(2)}\n`;
            if (!tarjetaPagada(t)) totalesPorPersona[persona.id] += importe;
        });
        if (!tarjetaPagada(t)) mensualidadTotal += datosCredito.mensualidad;
        textoResumen += '\n';
    });

    if (mesSeleccionado === obtenerMesActual()) {
        creditos.forEach(credito => {
            const frecuencia = obtenerFrecuenciaCredito(credito);
            const factorMensual = obtenerFactorMensualCredito(credito);
            textoResumen += `• Crédito: ${credito.nombre} (${nombrePersona(credito.titularId)})\n`;
            textoResumen += `  Monto total: $${Number(credito.montoTotal).toFixed(2)} | Cuotas restantes: ${Number(credito.cuotasRestantes)} de ${Number(credito.cuotasTotales)}\n`;
            textoResumen += `  Saldo pendiente: $${obtenerSaldoPendienteCredito(credito).toFixed(2)} | Próximo pago: ${credito.fechaPago || 'Sin fecha'}\n`;
            textoResumen += `  Tasa anual: ${Number(credito.tasaInteresAnual || 0).toFixed(2)}% | Pago ${frecuencia}: $${obtenerPagoPorPeriodoCredito(credito).toFixed(2)}\n`;
            (credito.movimientos || []).forEach(movimiento => {
                textoResumen += `  Movimiento: ${movimiento.fecha} | Pago: $${Number(movimiento.monto).toFixed(2)} | Saldo: $${Number(movimiento.saldoDespues).toFixed(2)}\n`;
            });
            personas.forEach(persona => {
                const importe = Number(credito.pagosPorUsuario?.[persona.id]) || 0;
                textoResumen += `  ${persona.nombre}: $${importe.toFixed(2)}\n`;
                if (obtenerSaldoPendienteCredito(credito) > 0) totalesPorPersona[persona.id] += importe * factorMensual;
            });
            if (obtenerSaldoPendienteCredito(credito) > 0) mensualidadTotal += obtenerPagoPorPeriodoCredito(credito) * factorMensual;
            textoResumen += '\n';
        });

        prestamos.forEach(prestamo => {
            textoResumen += `• Préstamo: ${prestamo.descripcion}\n`;
            textoResumen += `  De ${nombrePartePrestamo(prestamo, 'prestamista')} a ${nombrePartePrestamo(prestamo, 'prestatario')} | Monto: $${Number(prestamo.monto).toFixed(2)} | Saldo: $${saldoPrestamo(prestamo).toFixed(2)}\n`;
            (prestamo.abonos || []).forEach(abono => {
                textoResumen += `  Abono ${abono.fecha} · ${nombrePersonaAbono(abono)}: $${Number(abono.monto).toFixed(2)}\n`;
            });
            textoResumen += '\n';
        });
    }

    textoResumen += `------------------------------------\n`;
    textoResumen += `MENSUALIDAD PENDIENTE TOTAL: $${mensualidadTotal.toFixed(2)}\n`;
    personas.forEach(persona => {
        textoResumen += `TOTAL A PAGAR ${persona.nombre}: $${totalesPorPersona[persona.id].toFixed(2)}\n`;
    });

    // Crear un archivo de texto descargable
    const blob = new Blob([textoResumen], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Resumen_Financiero_${mesSeleccionado}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}