const { Config } = require('../database/modelos');

const rifasActivas = new Map();
const rifasAbiertas = new Set();

async function obtenerPropietarioRifas() {
    const config = await Config.findOne({ clave: 'rifa_propietario' });
    return config?.valor || null;
}

async function comandoAbrirRifa(sock, chatId, msg) {
    if (chatId.endsWith('@g.us')) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    let propietario = await obtenerPropietarioRifas();

    if (!propietario) {
        await Config.findOneAndUpdate(
            { clave: 'rifa_propietario' },
            { valor: sender },
            { upsert: true }
        );
        propietario = sender;
    }

    if (sender !== propietario) return;

    await sock.sendMessage(chatId, {
        text: '🔓 *Rifa habilitada.*\n\nAhora usa *activarrifaaqui* dentro del grupo donde quieras abrir la inscripción.'
    }, { quoted: msg });
}

async function comandoActivarRifaAqui(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const propietario = await obtenerPropietarioRifas();

    if (!propietario || sender !== propietario) return;

    rifasAbiertas.add(chatId);
    await Config.findOneAndUpdate(
        { clave: `rifa_abierta_${chatId}` },
        { valor: 'true' },
        { upsert: true }
    );

    await sock.sendMessage(chatId, {
        text: '🔓 *Rifa activada en este grupo.* Ya se puede usar *rifainscripcion* aquí.'
    }, { quoted: msg });
}

async function rifaEstaAbierta(chatId) {
    if (rifasAbiertas.has(chatId)) return true;
    const config = await Config.findOne({ clave: `rifa_abierta_${chatId}` });
    if (config?.valor === 'true') {
        rifasAbiertas.add(chatId);
        return true;
    }
    return false;
}

// === COMANDO PARA USUARIOS NORMALES ===
async function comandoRifaInscripcion(sock, chatId, msg) {
    if (!(await rifaEstaAbierta(chatId))) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const pushName = msg.pushName || 'Usuario';

    let participantes = rifasActivas.get(chatId) || [];

    // Validar que no esté inscrito ya (por su ID único de WhatsApp)
    const yaInscrito = participantes.find(p => p.id === sender);
    if (yaInscrito) {
        return await sock.sendMessage(chatId, { text: `❌ Ya estás inscrito en la rifa actual, *${pushName}*. Solo se permite una inscripción por número.` }, { quoted: msg });
    }

    participantes.push({ id: sender, nombre: pushName });
    rifasActivas.set(chatId, participantes);

    await sock.sendMessage(chatId, { text: `✅ ¡Listo, *${pushName}*! Te has inscrito a la rifa correctamente. (Participante #${participantes.length})` }, { quoted: msg });
}

// === COMANDO EXCLUSIVO PARA ADMINISTRADORES ===
async function comandoRifa(sock, chatId, msg, args) {
    if (!(await rifaEstaAbierta(chatId))) return;

    // Candado estricto para Administradores
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
        return await sock.sendMessage(chatId, { text: `🎟️ *PANEL DE RIFAS (ADMIN)*\nUso: rifa [ver / quitar / vaciar / sortear]` }, { quoted: msg });
    }

    const accion = args[0].toLowerCase();
    const parametro = args.slice(1).join(' ').trim();
    let participantes = rifasActivas.get(chatId) || [];

    if (accion === 'ver') {
        if (participantes.length === 0) return await sock.sendMessage(chatId, { text: `📭 La rifa está vacía.` }, { quoted: msg });
        let texto = `🎟️ *PARTICIPANTES DE LA RIFA (${participantes.length}):*\n\n`;
        participantes.forEach((p, i) => texto += `${i + 1}. ${p.nombre}\n`);
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });

    } else if (accion === 'quitar') {
        if (!parametro) return await sock.sendMessage(chatId, { text: `❌ Dime el número en la lista para quitar (ej. rifa quitar 1).` }, { quoted: msg });
        
        const index = parseInt(parametro) - 1;
        if (!isNaN(index) && index >= 0 && index < participantes.length) {
            const eliminado = participantes.splice(index, 1)[0];
            rifasActivas.set(chatId, participantes);
            await sock.sendMessage(chatId, { text: `🗑️ Participante #${index + 1} (${eliminado.nombre}) eliminado.` }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Número no válido. Usa "rifa ver" para checar los números.` }, { quoted: msg });
        }

    } else if (accion === 'vaciar') {
        rifasActivas.delete(chatId);
        await sock.sendMessage(chatId, { text: `🧹 *¡Rifa vaciada!* Se han eliminado a todos los participantes. La lista está en cero.` }, { quoted: msg });

    } else if (accion === 'sortear') {
        if (participantes.length === 0) return await sock.sendMessage(chatId, { text: `❌ No hay nadie en la rifa para sortear.` }, { quoted: msg });
        
        const ganador = participantes[Math.floor(Math.random() * participantes.length)];
        
        await sock.sendMessage(chatId, { 
            text: `🎉 *¡TENEMOS GANADOR!*\n\n🏆 El ganador de la rifa es: @${ganador.id.split('@')[0]} 🎊`,
            mentions: [ganador.id]
        });
    }
}

// ==========================================
// RIFAS EXCLUSIVAS CÓDIGO DE CREADOR (JASC13)
// ==========================================
let propietarioJasc13 = null;
let participantesJasc13 = new Map(); // key: id de WhatsApp, value: { puntos }

async function comandoMenuRifaJasc13(sock, chatId, msg) {
    // Blindaje: Solo se muestra si se usa en chat privado con el bot
    if (chatId.endsWith('@g.us')) {
        return; // Ignora por completo en grupos para mantenerlo oculto
    }

    const menuTexto = `🎟️ *MENÚ SECRETO - RIFA CÓDIGO DE CREADOR (JASC13)* 🎟️\n\n` +
        `• *rifajasc13 iniciar* - Inicia la rifa y te registra como propietario único.\n` +
        `• *rifajasc13 agregar [@usuario/número] [puntos]* - Suma puntos (1000 pts = 1 boleto).\n` +
        `• *rifajasc13 ver* - Muestra la lista de participantes, puntos y boletos actuales.\n` +
        `• *rifajasc13 quitar [número]* - Elimina a un participante de la lista.\n` +
        `• *rifajasc13 vaciar* - Limpia toda la lista de participantes.\n` +
        `• *rifajasc13 sortear [ganadores]* - Realiza el sorteo ponderado con la cantidad de ganadores indicada (por defecto 1), notifica a todos y reinicia la lista.`;
    
    await sock.sendMessage(chatId, { text: menuTexto }, { quoted: msg });
}

async function comandoRifaJasc13(sock, chatId, msg, args) {
    const sender = msg.key.participant || msg.key.remoteJid;

    // BLOQUEO ABSOLUTO: Si ya hay un dueño y el remitente NO es el dueño, no puede hacer nada.
    if (propietarioJasc13 !== null && sender !== propietarioJasc13) {
        return await sock.sendMessage(chatId, { text: `❌ Acceso denegado. Este comando ya fue reclamado por otro administrador y está bloqueado permanentemente para los demás.` }, { quoted: msg });
    }

    if (!args || args.length === 0) {
        return await sock.sendMessage(chatId, { text: `❌ Comando incompleto. Escribe *menurifajasc13* en chat privado para ver la ayuda.` }, { quoted: msg });
    }

    const accion = args[0].toLowerCase();

    // Comando para iniciar la rifa y asignarte como propietario único
    if (accion === 'iniciar') {
        propietarioJasc13 = sender;
        participantesJasc13.clear();
        return await sock.sendMessage(chatId, { text: `🚀 *¡Rifa JASC13 iniciada!* Has quedado vinculado como el único propietario y administrador permanente de esta rifa.` }, { quoted: msg });
    }

    // Verificación por si el dueño intenta usar otros comandos sin haber iniciado la rifa primero
    if (!propietarioJasc13) {
        return await sock.sendMessage(chatId, { text: `❌ La rifa aún no ha sido iniciada. Ejecuta "rifajasc13 iniciar" primero.` }, { quoted: msg });
    }

    if (accion === 'ver') {
        if (participantesJasc13.size === 0) {
            return await sock.sendMessage(chatId, { text: `📭 La rifa exclusiva JASC13 está vacía.` }, { quoted: msg });
        }
        let texto = `🎟️ *PARTICIPANTES - RIFA JASC13*\n\n`;
        let i = 1;
        const mentions = [];
        for (const [id, data] of participantesJasc13.entries()) {
            const boletos = Math.floor(data.puntos / 1000);
            const resto = data.puntos % 1000;
            const faltantes = resto === 0 ? 0 : 1000 - resto;
            texto += `${i}. @${id.split('@')[0]} → Puntos: *${data.puntos}* | Boletos: *${boletos}* (Faltan ${faltantes} pts)\n`;
            mentions.push(id);
            i++;
        }
        return await sock.sendMessage(chatId, { text: texto, mentions });
    }

    if (accion === 'vaciar') {
        participantesJasc13.clear();
        return await sock.sendMessage(chatId, { text: `🧹 *¡Lista limpiada!* Se han borrado todos los participantes de la rifa JASC13.` }, { quoted: msg });
    }

    if (accion === 'quitar') {
        const indexParam = args[1];
        if (!indexParam) return await sock.sendMessage(chatId, { text: `❌ Indica el número de la lista a quitar (ej. rifajasc13 quitar 1).` }, { quoted: msg });
        
        const arrayKeys = Array.from(participantesJasc13.keys());
        const idx = parseInt(indexParam) - 1;
        if (isNaN(idx) || idx < 0 || idx >= arrayKeys.length) {
            return await sock.sendMessage(chatId, { text: `❌ Número de participante no válido. Usa "rifajasc13 ver".` }, { quoted: msg });
        }
        const eliminadoId = arrayKeys[idx];
        participantesJasc13.delete(eliminadoId);
        return await sock.sendMessage(chatId, { text: `🗑️ Participante eliminado correctamente de la lista.` });
    }

    if (accion === 'agregar') {
        let targetId = null;
        let puntosAgregados = parseInt(args[args.length - 1]);

        if (isNaN(puntosAgregados)) {
            return await sock.sendMessage(chatId, { text: `❌ Especifica una cantidad válida de puntos al final (ej. rifajasc13 agregar @usuario 1500).` }, { quoted: msg });
        }

        // Detectar usuario mediante mención o respuesta a mensaje
        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetId = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            targetId = msg.message.extendedTextMessage.contextInfo.participant;
        } else {
            let numLimpio = args[1]?.replace(/[^0-9]/g, '');
            if (numLimpio && numLimpio.length > 5) {
                targetId = numLimpio + '@s.whatsapp.net';
            }
        }

        if (!targetId) {
            return await sock.sendMessage(chatId, { text: `❌ No se pudo identificar al usuario. Menciona al usuario o responde a su mensaje.` }, { quoted: msg });
        }

        let datosUsuario = participantesJasc13.get(targetId) || { puntos: 0 };
        let puntosAnteriores = datosUsuario.puntos;
        datosUsuario.puntos += puntosAgregados;
        
        let boletosAnteriores = Math.floor(puntosAnteriores / 1000);
        let boletosNuevos = Math.floor(datosUsuario.puntos / 1000);
        let boletosGanados = boletosNuevos - boletosAnteriores;
        
        let resto = datosUsuario.puntos % 1000;
        let faltantes = resto === 0 ? 0 : 1000 - resto;

        participantesJasc13.set(targetId, datosUsuario);

        let respuesta = `✅ *Puntos registrados exitosamente*\n` +
            `👤 Usuario: @${targetId.split('@')[0]}\n` +
            `➕ Puntos sumados: *+${puntosAgregados}*\n` +
            `📊 Puntos totales: *${datosUsuario.puntos}*\n` +
            `🎟️ Boletos totales: *${boletosNuevos}* ${boletosGanados > 0 ? `(¡Ganó +${boletosGanados} boleto(s) nuevos!)` : ''}\n` +
            `📌 Puntos faltantes para el siguiente boleto: *${faltantes}*`;

        return await sock.sendMessage(chatId, { text: respuesta, mentions: [targetId] });
    }

    if (accion === 'sortear') {
        if (participantesJasc13.size === 0) {
            return await sock.sendMessage(chatId, { text: `❌ No hay participantes en la rifa JASC13 para sortear.` }, { quoted: msg });
        }

        // rifajasc13 sortear -> 1 ganador
        // rifajasc13 sortear 10 -> 10 ganadores distintos
        const cantidadSolicitada = args[1] === undefined ? 1 : parseInt(args[1], 10);

        if (!Number.isInteger(cantidadSolicitada) || cantidadSolicitada < 1) {
            return await sock.sendMessage(chatId, { text: `❌ Indica una cantidad válida de ganadores (ej. *rifajasc13 sortear 10*).` }, { quoted: msg });
        }

        // Sorteo ponderado por boletos: cada 1000 puntos = 1 boleto.
        const boletosPorParticipante = new Map();

        for (const [id, data] of participantesJasc13.entries()) {
            const boletos = Math.floor(data.puntos / 1000);
            if (boletos > 0) {
                boletosPorParticipante.set(id, boletos);
            }
        }

        if (boletosPorParticipante.size === 0) {
            return await sock.sendMessage(chatId, { text: `❌ Los participantes aún no acumulan suficientes boletos para el sorteo.` }, { quoted: msg });
        }

        if (cantidadSolicitada > boletosPorParticipante.size) {
            return await sock.sendMessage(chatId, {
                text: `❌ No hay suficientes participantes con boletos para elegir *${cantidadSolicitada}* ganadores. Actualmente hay *${boletosPorParticipante.size}*.`
            }, { quoted: msg });
        }

        // Elegimos ganadores sin repetir personas. La probabilidad sigue
        // siendo proporcional a la cantidad de boletos de cada participante.
        const disponibles = new Map(boletosPorParticipante);
        const ganadores = [];

        for (let ronda = 0; ronda < cantidadSolicitada; ronda++) {
            let totalBoletosDisponibles = 0;

            for (const boletos of disponibles.values()) {
                totalBoletosDisponibles += boletos;
            }

            let objetivo = Math.random() * totalBoletosDisponibles;
            let ganadorId = null;

            for (const [id, boletos] of disponibles.entries()) {
                objetivo -= boletos;
                if (objetivo < 0) {
                    ganadorId = id;
                    break;
                }
            }

            if (!ganadorId) break;

            ganadores.push(ganadorId);
            disponibles.delete(ganadorId);
        }

        if (ganadores.length === 0) {
            return await sock.sendMessage(chatId, { text: `❌ No fue posible realizar el sorteo.` }, { quoted: msg });
        }

        const mentions = ganadores;
        let mensajeGanador = ganadores.length === 1
            ? `🎉 *¡TENEMOS GANADOR DE LA RIFA EXCLUSIVA!* 🎉\n\n`
            : `🎉 *¡TENEMOS ${ganadores.length} GANADORES DE LA RIFA EXCLUSIVA!* 🎉\n\n`;

        ganadores.forEach((ganadorId, index) => {
            mensajeGanador += `🏆 *Ganador ${index + 1}:* @${ganadorId.split('@')[0]} 🎊\n`;
        });

        mensajeGanador += `\n❤️ ¡Muchas gracias por apoyar usando el código de creador *JASC13*!\n`;
        mensajeGanador += `🎮 Sigue utilizando el código en la tienda de Fortnite para ganar más recompensas y participar en futuras rifas.`;

        // Notificar en el chat actual etiquetando a todos los ganadores.
        await sock.sendMessage(chatId, { text: mensajeGanador, mentions });

        // Enviar notificación directa a cada ganador.
        for (const ganadorId of ganadores) {
            try {
                await sock.sendMessage(ganadorId, {
                    text: `🎉 ¡Felicidades! Has sido seleccionado como ganador de la rifa exclusiva con el código de creador JASC13.\n\n❤️ ¡Gracias por tu apoyo continuo!\n\n🎮 Sigue usando el código *JASC13* en Fortnite para obtener más beneficios.`
                });
            } catch (e) {
                console.error("Error al enviar mensaje privado al ganador de la rifa:", e);
            }
        }

        // Reiniciar la lista automáticamente después de sortear.
        participantesJasc13.clear();
        await sock.sendMessage(chatId, { text: `🔄 *La lista de la rifa JASC13 se ha reiniciado a cero* para la siguiente edición.` });
    }
}

module.exports = { comandoRifa, comandoRifaInscripcion, comandoRifaJasc13, comandoMenuRifaJasc13, comandoAbrirRifa, comandoActivarRifaAqui };
