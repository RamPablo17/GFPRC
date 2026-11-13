const correoCuentaSrTono = 'tonito@gmail.com';

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('botonCerrarSesionSrTono').addEventListener('click', async () => {
        try {
            await auth.signOut();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('No se pudo cerrar la sesión:', error);
            mostrarMensajeSrTono('No se pudo cerrar la sesión. Inténtalo de nuevo.', true);
        }
    });

    auth.onAuthStateChanged(async usuario => {
        const acceso = document.getElementById('accesoRequeridoSrTono');
        const contenido = document.getElementById('contenidoSrTono');
        if (!usuario || usuario.email?.toLocaleLowerCase('es') !== correoCuentaSrTono) {
            acceso.classList.remove('hidden');
            contenido.classList.add('hidden');
            document.getElementById('correoUsuarioSrTono').textContent = usuario?.email || '';
            return;
        }

        acceso.classList.add('hidden');
        contenido.classList.remove('hidden');
        document.getElementById('correoUsuarioSrTono').textContent =
            usuario.email === correoCuentaSrTono ? 'Sesión de Toñito' : usuario.email || '';
        await cargarPrestamosSrTono(usuario);
    }, error => {
        console.error('No se pudo verificar la sesión:', error);
        mostrarMensajeSrTono('No se pudo verificar la sesión. Vuelve a cargar la página.', true);
    });
});

async function cargarPrestamosSrTono(usuario) {
    mostrarMensajeSrTono('Cargando préstamos…');
    try {
        const consulta = db.collectionGroup('prestamos')
            .where('prestamistaNombre', '==', 'Sr. Toño');
        const resultado = await consulta.get();
        const prestamos = resultado.docs.map(documento => ({
            ...documento.data(),
            id: documento.id
        }));
        renderizarPrestamosSrTono(prestamos);
        ocultarMensajeSrTono();
    } catch (error) {
        console.error('No se pudieron cargar los préstamos de Sr. Toño:', error);
        const detalle = error.code === 'permission-denied'
            ? 'Firestore denegó el acceso. Publica las reglas actualizadas de firestore.rules para permitir solo lectura de los préstamos cuyo prestamista sea "Sr. Toño".'
            : `Error de Firestore${error.code ? ` (${error.code})` : ''}.`;
        mostrarMensajeSrTono(`No se pudieron cargar los préstamos. ${detalle}`, true);
    }
}

function renderizarPrestamosSrTono(prestamos) {
    const contenedor = document.getElementById('contenedorPrestamosSrTono');
    if (!prestamos.length) {
        contenedor.innerHTML = `
            <div class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <i class="fa-solid fa-handshake text-xl"></i>
                </div>
                <h2 class="mt-4 text-base font-semibold text-slate-900">Aún no hay préstamos registrados</h2>
                <p class="mt-1 text-sm text-slate-500">Cuando se registre un préstamo de Sr. Toño, aparecerá aquí con sus abonos.</p>
            </div>
        `;
        return;
    }

    contenedor.innerHTML = `<div class="mx-auto max-w-4xl space-y-5">${prestamos.map(prestamo => {
        const abonos = [...(prestamo.abonos || [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        const totalAbonadoCentavos = abonos.reduce(
            (total, abono) => total + Math.round((Number(abono.monto) || 0) * 100),
            0
        );
        const montoCentavos = Math.round((Number(prestamo.monto) || 0) * 100);
        const saldoCentavos = Math.max(0, montoCentavos - totalAbonadoCentavos);
        const saldo = saldoCentavos / 100;
        const historial = abonos.length ? abonos.map(abono => `
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
                <div>
                    <p class="text-sm font-medium text-slate-700">${escaparHTMLSrTono(abono.fecha || 'Sin fecha')}</p>
                    <p class="mt-0.5 text-xs text-slate-500">Abonó ${escaparHTMLSrTono(abono.personaNombre || prestamo.prestatarioNombre || 'Sin nombre registrado')}</p>
                </div>
                <span class="text-sm font-semibold text-emerald-700">−${formatearMonedaSrTono(abono.monto)}</span>
            </div>
        `).join('') : '<p class="py-3 text-sm text-slate-500">Todavía no hay abonos registrados para este préstamo.</p>';

        return `
            <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div class="border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white p-5 sm:p-7">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wider text-emerald-700">Préstamo recibido</p>
                            <h2 class="mt-1 text-xl font-bold text-slate-900">${escaparHTMLSrTono(prestamo.descripcion || 'Préstamo de Sr. Toño')}</h2>
                            <p class="mt-1 text-sm text-slate-500">Sr. Toño · ${escaparHTMLSrTono(prestamo.fecha || 'Sin fecha')}</p>
                        </div>
                        <span class="rounded-full px-3 py-1.5 text-xs font-semibold ${saldo > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}">${saldo > 0 ? 'Pendiente' : 'Liquidado'}</span>
                    </div>
                    <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div class="rounded-xl border border-slate-100 bg-white p-4">
                            <p class="text-xs font-medium text-slate-500">Monto del préstamo</p>
                            <p class="mt-1 text-lg font-bold text-slate-900">${formatearMonedaSrTono(montoCentavos / 100)}</p>
                        </div>
                        <div class="rounded-xl border border-slate-100 bg-white p-4">
                            <p class="text-xs font-medium text-slate-500">Total abonado</p>
                            <p class="mt-1 text-lg font-bold text-emerald-700">${formatearMonedaSrTono(totalAbonadoCentavos / 100)}</p>
                        </div>
                        <div class="rounded-xl border border-amber-100 bg-amber-50 p-4">
                            <p class="text-xs font-medium text-amber-700">Saldo pendiente</p>
                            <p class="mt-1 text-lg font-bold text-slate-900">${formatearMonedaSrTono(saldo)}</p>
                        </div>
                    </div>
                </div>
                <div class="p-5 sm:p-7">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <h3 class="text-sm font-bold text-slate-900">Desglose de abonos</h3>
                            <p class="mt-0.5 text-xs text-slate-500">${abonos.length} abono${abonos.length === 1 ? '' : 's'} registrado${abonos.length === 1 ? '' : 's'}</p>
                        </div>
                        <i class="fa-solid fa-list-check text-emerald-600"></i>
                    </div>
                    <div class="mt-3 rounded-xl border border-slate-100 px-4">${historial}</div>
                </div>
            </article>
        `;
    }).join('')}</div>`;
}

function formatearMonedaSrTono(importe) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(importe) || 0);
}

function escaparHTMLSrTono(valor) {
    return String(valor).replace(/[&<>"']/g, caracter => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caracter]);
}

function mostrarMensajeSrTono(mensaje, esError = false) {
    const elemento = document.getElementById('mensajeSrTono');
    elemento.textContent = mensaje;
    elemento.classList.remove(
        'hidden',
        'border-rose-200',
        'bg-rose-50',
        'text-rose-700',
        'border-emerald-200',
        'bg-emerald-50',
        'text-emerald-700'
    );
    elemento.classList.add(...(esError
        ? ['border-rose-200', 'bg-rose-50', 'text-rose-700']
        : ['border-emerald-200', 'bg-emerald-50', 'text-emerald-700']));
}

function ocultarMensajeSrTono() {
    document.getElementById('mensajeSrTono').classList.add('hidden');
}
