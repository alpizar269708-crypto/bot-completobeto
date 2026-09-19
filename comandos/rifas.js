const rifasActivas = new Map();

async function comandoRifa(sock, chatId, msg, args) {
    // Candado para Administradores
    if (chatId.endsWith('@g.us')) {
        try {
            const sender = msg.key.participant || msg.key.remoteJid;
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            
            if (!isAdmin) {
                return await sock.sendMessage(chatId, { text: `❌ Permiso denegado. Solo los administradores del grupo pueden gestionar las rifas.` }, { quoted: msg });
            }
        } catch (e) {
            console.error("Error al verificar admin en rifa:", e);
        }
    }

    if (!args || args.length === 0) {
        return await sock.sendMessage(chatId, { text: `🎟️ *SISTEMA DE RIFAS*\nUso: rifa [agregar/ver/quitar/sortear] [nombre]` }, { quoted: msg });
    }

    const accion = args[0].toLowerCase();
    const parametro = args.slice(1).join(' ').trim();
    let participantes = rifasActivas.get(chatId) || [];

    if (accion === 'agregar') {
        if (!parametro) return await sock.sendMessage(chatId, { text: `❌ Dime a quién agregar. Ejemplo: rifa agregar Juan` }, { quoted: msg });
        participantes.push(parametro);
        rifasActivas.set(chatId, participantes);
        await sock.sendMessage(chatId, { text: `✅ *${parametro}* agregado a la rifa.` }, { quoted: msg });

    } else if (accion === 'ver') {
        if (participantes.length === 0) return await sock.sendMessage(chatId, { text: `📭 La rifa está vacía.` }, { quoted: msg });
        let texto = `🎟️ *PARTICIPANTES DE LA RIFA (${participantes.length}):*\n\n`;
        participantes.forEach((p, i) => texto += `${i + 1}. ${p}\n`);
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });

    } else if (accion === 'quitar') {
        if (!parametro) return await sock.sendMessage(chatId, { text: `❌ Dime el número o nombre exacto a quitar.` }, { quoted: msg });
        
        const index = parseInt(parametro) - 1;
        if (!isNaN(index) && index >= 0 && index < participantes.length) {
            const eliminado = participantes.splice(index, 1);
            rifasActivas.set(chatId, participantes);
            await sock.sendMessage(chatId, { text: `🗑️ Participante #${index + 1} (${eliminado}) eliminado.` }, { quoted: msg });
        } else {
            const idx = participantes.findIndex(p => p.toLowerCase() === parametro.toLowerCase());
            if (idx !== -1) {
                participantes.splice(idx, 1);
                rifasActivas.set(chatId, participantes);
                await sock.sendMessage(chatId, { text: `🗑️ *${parametro}* eliminado de la rifa.` }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: `❌ No encontré a ese participante.` }, { quoted: msg });
            }
        }

    } else if (accion === 'sortear') {
        if (participantes.length === 0) return await sock.sendMessage(chatId, { text: `❌ No hay nadie en la rifa para sortear.` }, { quoted: msg });
        const ganador = participantes[Math.floor(Math.random() * participantes.length)];
        await sock.sendMessage(chatId, { text: `🎉 *¡TENEMOS GANADOR!*\n\n🏆 El ganador de la rifa es: *${ganador}* 🎊` }, { quoted: msg });
    }
}

module.exports = { comandoRifa };