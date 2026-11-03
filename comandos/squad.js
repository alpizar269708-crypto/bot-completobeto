const { obtenerCuentasEpic } = require('./carry');

// Las búsquedas viven únicamente en memoria y dentro del grupo donde se publican.
const busquedasPorGrupo = new Map();
const DURACION_BUSQUEDA_MS = 60 * 60 * 1000;

function obtenerBusquedasActivas(chatId) {
    const activas = (busquedasPorGrupo.get(chatId) || []).filter(b => b.expiraEn > Date.now());
    if (activas.length) busquedasPorGrupo.set(chatId, activas);
    else busquedasPorGrupo.delete(chatId);
    return activas;
}

async function publicarBusqueda(sock, chatId, msg, usuario, modalidad, totalJugadores, motivo, epicId) {
    const busquedas = obtenerBusquedasActivas(chatId);
    busquedas.push({
        usuario, modalidad, totalJugadores, motivo, jugadoresActuales: 1, epicId,
        expiraEn: Date.now() + DURACION_BUSQUEDA_MS
    });
    busquedasPorGrupo.set(chatId, busquedas);
    const timer = setTimeout(() => obtenerBusquedasActivas(chatId), DURACION_BUSQUEDA_MS);
    if (typeof timer.unref === 'function') timer.unref();

    return sock.sendMessage(chatId, {
        text: `🎮 *BUSCO COMPAÑEROS FORTNITE*\\n\\n🎯 *Modalidad:* ${modalidad.toUpperCase()}\\n📝 *Motivo:* ${motivo}\\n👥 *Jugadores:* 1/${totalJugadores}\\n👤 @${usuario.split('@')[0]}\\n🆔 *Epic:* ${epicId}\\n\\nConsulta las búsquedas de este grupo con *buscajugadores*.\\nCancela la tuya con *cancelarbusqueda*.\\n⏳ Expira en 60 minutos.\\n\\nApoya a un creador: *JASC13*`,
        mentions: [usuario]
    }, { quoted: msg });
}

async function manejarRespuestaSeleccionSquad(sock, chatId, msg, remitente, texto) {
    const clave = `${chatId}:${remitente}`;
    const pendiente = seleccionesEpicPendientes.get(clave);
    if (!pendiente) return false;
    if (pendiente.expiraEn <= Date.now()) {
        seleccionesEpicPendientes.delete(clave);
        return false;
    }
    const respuesta = String(texto || '').trim().replace(/[ *_`]/g, '').toLowerCase();
    if (respuesta === 'cancelar') {
        seleccionesEpicPendientes.delete(clave);
        await sock.sendMessage(chatId, { text: '✅ Selección cancelada. No se publicó ninguna búsqueda.' }, { quoted: msg });
        return true;
    }
    if (!/^\\d+$/.test(respuesta)) return false;
    const cuenta = pendiente.cuentas.find(c => c.numero === Number(respuesta));
    if (!cuenta) {
        await sock.sendMessage(chatId, { text: '❌ Ese número no corresponde a un ID de la lista. Responde con uno de los números mostrados o *cancelar*.' }, { quoted: msg });
        return true;
    }
    seleccionesEpicPendientes.delete(clave);
    if (obtenerBusquedasActivas(chatId).some(b => b.usuario === remitente)) {
        await sock.sendMessage(chatId, { text: 'ℹ️ Ya tienes una búsqueda activa en este grupo. Usa *cancelarbusqueda* para cerrarla.' }, { quoted: msg });
        return true;
    }
    await publicarBusqueda(sock, chatId, msg, remitente, pendiente.modalidad, pendiente.totalJugadores, pendiente.motivo, cuenta.epicId);
    return true;
}

async function comandoSquad(sock, chatId, msg, comando, args = []) {
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, { text: '❌ Este comando solo funciona dentro de grupos.' }, { quoted: msg });
    }
    const usuario = msg.key.participant || chatId;
    const busquedas = obtenerBusquedasActivas(chatId);

    if (comando === 'buscajugadores') {
        if (!busquedas.length) {
            return sock.sendMessage(chatId, { text: '🎮 *BÚSQUEDAS FORTNITE DE ESTE GRUPO*\\n\\nNo hay búsquedas activas.' }, { quoted: msg });
        }
        const menciones = [];
        const detalle = busquedas.map((b, i) => {
            menciones.push(b.usuario);
            return `${i + 1}. *${b.modalidad.toUpperCase()}* — ${b.jugadoresActuales}/${b.totalJugadores}\\n📝 *Motivo:* ${b.motivo || 'No especificado'}\\n👤 @${b.usuario.split('@')[0]} — 🆔 Epic: ${b.epicId || 'Sin registrar'}\\n⏳ Expira en ${Math.max(1, Math.ceil((b.expiraEn - Date.now()) / 60000))} min`;
        }).join('\\n\\n');
        return sock.sendMessage(chatId, {
            text: '🎮 *BÚSQUEDAS FORTNITE DE ESTE GRUPO*\\n\\n' + detalle,
            mentions: [...new Set(menciones)]
        }, { quoted: msg });
    }

    if (comando === 'cancelarbusqueda') {
        seleccionesEpicPendientes.delete(`${chatId}:${usuario}`);
        const indice = busquedas.findIndex(b => b.usuario === usuario);
        if (indice === -1) {
            return sock.sendMessage(chatId, { text: 'ℹ️ No tienes una búsqueda activa en este grupo.' }, { quoted: msg });
        }
        busquedas.splice(indice, 1);
        if (busquedas.length) busquedasPorGrupo.set(chatId, busquedas);
        else busquedasPorGrupo.delete(chatId);
        return sock.sendMessage(chatId, { text: '✅ Tu búsqueda Fortnite fue cancelada.' }, { quoted: msg });
    }

    const modalidad = String(args[0] || '').toLowerCase();
    const motivo = args.slice(1).join(' ').trim();
    const totalJugadores = { duo: 2, trio: 3, squad: 4 }[modalidad];
    if (!totalJugadores) {
        return sock.sendMessage(chatId, {
            text: '❌ Indica la modalidad y el motivo. Ejemplos:\\n*buscajugador duo Misiones de historia*\\n*buscajugador trio Subir nivel de poder*\\n*buscajugador squad Misiones de 160*.'
        }, { quoted: msg });
    }
    if (!motivo) {
        return sock.sendMessage(chatId, { text: '❌ Debes indicar el motivo de la búsqueda.\\n\\nEjemplo: *buscajugador squad Misiones de 160*' }, { quoted: msg });
    }
    if (busquedas.some(b => b.usuario === usuario)) {
        return sock.sendMessage(chatId, { text: 'ℹ️ Ya tienes una búsqueda activa en este grupo. Usa *cancelarbusqueda* para cerrarla.' }, { quoted: msg });
    }

    const alternativos = [msg.key.participantAlt, msg.key.participantPn, msg.key.senderPn].filter(Boolean);
    const cuentas = await obtenerCuentasEpic(sock, usuario, alternativos);
    if (!cuentas.length) {
        return sock.sendMessage(chatId, { text: '❌ No tienes ningún Epic ID registrado. Primero registra tu cuenta con *ID* o *ID1* a *ID4* y vuelve a buscar compañeros.' }, { quoted: msg });
    }
    seleccionesEpicPendientes.set(`${chatId}:${usuario}`, {
        modalidad, totalJugadores, motivo, cuentas, expiraEn: Date.now() + DURACION_SELECCION_MS
    });
    const lista = cuentas.map(c => `${c.numero}. *ID${c.numero}:* ${c.epicId}`).join('\\n');
    return sock.sendMessage(chatId, {
        text: `🎮 *ELIGE TU EPIC ID*\\n\\n📝 *Motivo:* ${motivo}\\n\\nAntes de publicar tu búsqueda de ${modalidad.toUpperCase()}, indica qué cuenta quieres usar:\\n\\n${lista}\\n\\nResponde con el número de la cuenta elegida.\\nEscribe *cancelar* si ya no deseas publicar la búsqueda.\\n⏳ Tienes 5 minutos para elegir.`
    }, { quoted: msg });
}

module.exports = { comandoSquad, manejarRespuestaSeleccionSquad };
