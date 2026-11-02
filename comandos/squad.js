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

async function comandoSquad(sock, chatId, msg, comando, args = []) {
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, { text: '❌ Este comando solo funciona dentro de grupos.' }, { quoted: msg });
    }
    const usuario = msg.key.participant || chatId;
    const busquedas = obtenerBusquedasActivas(chatId);

    if (comando === 'buscajugadores') {
        if (!busquedas.length) {
            return sock.sendMessage(chatId, { text: '🎮 *BÚSQUEDAS FORTNITE DE ESTE GRUPO*\n\nNo hay búsquedas activas.' }, { quoted: msg });
        }
        const menciones = [];
        const detalle = busquedas.map((b, i) => {
            menciones.push(b.usuario);
            return `${i + 1}. *${b.modalidad.toUpperCase()}* — ${b.jugadoresActuales}/${b.totalJugadores}\n👤 @${b.usuario.split('@')[0]} — 🆔 Epic: ${b.epicId || 'Sin registrar'}\n⏳ Expira en ${Math.max(1, Math.ceil((b.expiraEn - Date.now()) / 60000))} min`;
        }).join('\n\n');
        return sock.sendMessage(chatId, {
            text: '🎮 *BÚSQUEDAS FORTNITE DE ESTE GRUPO*\n\n' + detalle,
            mentions: [...new Set(menciones)]
        }, { quoted: msg });
    }

    if (comando === 'cancelarbusqueda') {
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
    const totalJugadores = { duo: 2, trio: 3, squad: 4 }[modalidad];
    if (!totalJugadores) {
        return sock.sendMessage(chatId, {
            text: '❌ Indica la modalidad: *buscajugador duo*, *buscajugador trio* o *buscajugador squad*.'
        }, { quoted: msg });
    }
    if (busquedas.some(b => b.usuario === usuario)) {
        return sock.sendMessage(chatId, { text: 'ℹ️ Ya tienes una búsqueda activa en este grupo. Usa *cancelarbusqueda* para cerrarla.' }, { quoted: msg });
    }

    const alternativos = [msg.key.participantAlt, msg.key.participantPn, msg.key.senderPn].filter(Boolean);
    const cuentas = await obtenerCuentasEpic(sock, usuario, alternativos);
    const epicId = cuentas.find(c => c.numero === 1)?.epicId || null;
    const registro = {
        usuario, modalidad, totalJugadores, jugadoresActuales: 1, epicId,
        expiraEn: Date.now() + DURACION_BUSQUEDA_MS
    };
    busquedas.push(registro);
    busquedasPorGrupo.set(chatId, busquedas);
    const timer = setTimeout(() => obtenerBusquedasActivas(chatId), DURACION_BUSQUEDA_MS);
    if (typeof timer.unref === 'function') timer.unref();

    return sock.sendMessage(chatId, {
        text: `🎮 *BUSCO COMPAÑEROS FORTNITE*\n\n🎯 *Modalidad:* ${modalidad.toUpperCase()}\n👥 *Jugadores:* 1/${totalJugadores}\n👤 @${usuario.split('@')[0]}\n🆔 *Epic:* ${epicId || 'Sin registrar'}\n\nConsulta las búsquedas de este grupo con *buscajugadores*.\nCancela la tuya con *cancelarbusqueda*.\n⏳ Expira en 60 minutos.\n\nApoya a un creador: *JASC13*`,
        mentions: [usuario]
    }, { quoted: msg });
}

module.exports = { comandoSquad };
