const { Config } = require('../database/modelos');
const { esPrivilegiadoTotalAsync, normalizarNumeroTelefono } = require('../utils/whatsapp');

const rifasActivas = new Map();
const rifasAbiertas = new Set();

async function obtenerPropietarioRifas() {
    const config = await Config.findOne({ clave: 'rifa_propietario' });
    return config?.valor || null;
}

async function comandoAbrirRifa(sock, chatId, msg) {
    const sender = msg.key.participant || msg.key.remoteJid;

    if (chatId.endsWith('@g.us')) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            const tienePrivilegiosTotales = await esPrivilegiadoTotalAsync(sock, sender);

            if (!isAdmin && !tienePrivilegiosTotales) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Permiso denegado. Solo los administradores del grupo pueden iniciar la rifa.'
                }, { quoted: msg });
            }

            await Config.findOneAndUpdate(
                { clave: `rifa_propietario_${chatId}` },
                { valor: sender },
                { upsert: true }
            );

            rifasAbiertas.add(chatId);
            await Config.findOneAndUpdate(
                { clave: `rifa_abierta_${chatId}` },
                { valor: 'true' },
                { upsert: true }
            );

            return await sock.sendMessage(chatId, {
                text: '🔓 *Rifa iniciada en este grupo.* Ya se puede usar *rifainscripcion*.'
            }, { quoted: msg });
        } catch (e) {
            console.error("Error al verificar admin al iniciar rifa:", e);
            return;
        }
    }

    let propietario = await obtenerPropietarioRifas();

    if (!propietario) {
        await Config.findOneAndUpdate(
            { clave: 'rifa_propietario' },
            { valor: sender },
            { upsert: true }
        );
        propietario = sender;
    }

    if (sender !== propietario && !(await esPrivilegiadoTotalAsync(sock, sender))) return;

    await sock.sendMessage(chatId, {
        text: '🔓 *Rifa habilitada.*\n\nAhora usa *activarrifaaqui* dentro del grupo donde quieras abrir la inscripción.'
    }, { quoted: msg });
}
async function comandoCerrarRifa(sock, chatId, msg) {
    const sender = msg.key.participant || msg.key.remoteJid;

    if (chatId.endsWith('@g.us')) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            const tienePrivilegiosTotales = await esPrivilegiadoTotalAsync(sock, sender);

            if (!isAdmin && !tienePrivilegiosTotales) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Permiso denegado. Solo los administradores del grupo pueden cerrar la rifa.'
                }, { quoted: msg });
            }
        } catch (e) {
            console.error("Error al verificar admin al cerrar rifa:", e);
            return;
        }
    } else {
        const propietario = await obtenerPropietarioRifas();
        if (!propietario || (sender !== propietario && !(await esPrivilegiadoTotalAsync(sock, sender)))) return;
    }

    rifasAbiertas.delete(chatId);
    await Config.findOneAndUpdate(
        { clave: `rifa_abierta_${chatId}` },
        { valor: 'false' },
        { upsert: true }
    );

    await sock.sendMessage(chatId, {
        text: '🔒 *Rifa cerrada.* Nadie puede inscribirse mientras permanezca cerrada. Los participantes actuales se conservan.'
    }, { quoted: msg });
}

async function comandoActivarRifaAqui(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const propietario = await obtenerPropietarioRifas();

    if (!propietario || (sender !== propietario && !(await esPrivilegiadoTotalAsync(sock, sender)))) return;

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

async function cargarParticipantesRifa(chatId) {
    const memoria = rifasActivas.get(chatId);
    if (Array.isArray(memoria)) return memoria;

    try {
        const config = await Config.findOne({ clave: `rifa_participantes_${chatId}` });
        if (!config?.valor) {
            const lista = [];
            rifasActivas.set(chatId, lista);
            return lista;
        }

        const lista = JSON.parse(config.valor);
        const participantes = Array.isArray(lista) ? lista : [];
        rifasActivas.set(chatId, participantes);
        return participantes;
    } catch (e) {
        console.error('Error cargando participantes de la rifa:', e.message);
        return [];
    }
}

async function guardarParticipantesRifa(chatId, participantes) {
    await Config.findOneAndUpdate(
        { clave: `rifa_participantes_${chatId}` },
        { valor: JSON.stringify(participantes) },
        { upsert: true }
    );
    rifasActivas.set(chatId, participantes);
}

// === COMANDO PARA USUARIOS NORMALES ===
async function comandoRifaInscripcion(sock, chatId, msg) {
    if (!(await rifaEstaAbierta(chatId))) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const pushName = msg.pushName || 'Usuario';

    const participantes = await cargarParticipantesRifa(chatId);

    const yaInscrito = participantes.find(p => p.id === sender);
    if (yaInscrito) {
        return await sock.sendMessage(chatId, { text: `❌ Ya estás inscrito en la rifa actual, *${pushName}*. Solo se permite una inscripción por número.` }, { quoted: msg });
    }

    participantes.push({ id: sender, nombre: pushName });
    await guardarParticipantesRifa(chatId, participantes);

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
            const tienePrivilegiosTotales = await esPrivilegiadoTotalAsync(sock, sender);
            
            if (!isAdmin && !tienePrivilegiosTotales) {
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
    let participantes = await cargarParticipantesRifa(chatId);

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
            await guardarParticipantesRifa(chatId, participantes);
            await sock.sendMessage(chatId, { text: `🗑️ Participante #${index + 1} (${eliminado.nombre}) eliminado.` }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Número no válido. Usa "rifa ver" para checar los números.` }, { quoted: msg });
        }

    } else if (accion === 'vaciar') {
        rifasActivas.delete(chatId);
        await Config.findOneAndDelete({ clave: `rifa_participantes_${chatId}` });
        await sock.sendMessage(chatId, { text: `🧹 *¡Rifa vaciada!* Se han eliminado a todos los participantes. La lista está en cero.` }, { quoted: msg });

    } else if (accion === 'sortear') {
        const sender = msg.key.participant || msg.key.remoteJid;

        if (chatId.endsWith('@g.us')) {
            try {
                const groupMetadata = await sock.groupMetadata(chatId);
                const participant = groupMetadata.participants.find(p => p.id === sender);
                const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
                const tienePrivilegiosTotales = await esPrivilegiadoTotalAsync(sock, sender);

                if (!isAdmin && !tienePrivilegiosTotales) {
                    return await sock.sendMessage(chatId, { text: `❌ Permiso denegado. Solo los administradores del grupo pueden realizar el sorteo.` }, { quoted: msg });
                }
            } catch (e) {
                console.error("Error al verificar admin al sortear rifa:", e);
                return;
            }
        } else {
            const propietario = await obtenerPropietarioRifas();
            if (!propietario || (sender !== propietario && !(await esPrivilegiadoTotalAsync(sock, sender)))) {
                return await sock.sendMessage(chatId, { text: `❌ Permiso denegado. Solo la persona que abrió la rifa puede realizar el sorteo.` }, { quoted: msg });
            }
        }

        if (participantes.length === 0) return await sock.sendMessage(chatId, { text: `❌ No hay nadie en la rifa para sortear.` }, { quoted: msg });
        
        const ganador = participantes[Math.floor(Math.random() * participantes.length)];
        
        await sock.sendMessage(chatId, { 
            text: `🎉 *¡TENEMOS GANADOR!*

🏆 El ganador de la rifa es: @${ganador.id.split('@')[0]} 🎊`,
            mentions: [ganador.id]
        });

        // Finalizar la rifa automáticamente: cerrar inscripciones y limpiar la lista.
        // Esto equivale a ejecutar "cerrarrifa" después de seleccionar al ganador.
        rifasActivas.delete(chatId);
        await Config.findOneAndDelete({ clave: `rifa_participantes_${chatId}` });

        rifasAbiertas.delete(chatId);
        await Config.findOneAndUpdate(
            { clave: `rifa_abierta_${chatId}` },
            { valor: 'false' },
            { upsert: true }
        );

        await sock.sendMessage(chatId, {
            text: '🔒 *Rifa finalizada y cerrada automáticamente.* La lista fue limpiada y ya no se aceptan nuevas inscripciones. Para una nueva rifa, un administrador deberá volver a abrirla.'
        });
    }
}

// ==========================================
// RIFAS EXCLUSIVAS CÓDIGO DE CREADOR (JASC13)
// ==========================================
const CLAVE_PARTICIPANTES_JASC13 = 'rifajasc13_participantes';
const CLAVE_CASHBACK_JASC13 = 'rifajasc13_cashback';

function calcularCashbackJasc13(puntos) {
    return Number((Number(puntos) * 0.05).toFixed(2));
}
function esMensajeRecuperableJasc13(texto) {
    const limpio = String(texto || '').toLowerCase();
    return limpio.includes('pavos registrados exitosamente') &&
        limpio.includes('pavos registrados:') &&
        limpio.includes('apoya a un creador:') &&
        limpio.includes('jasc13');
}

function extraerRegistroJasc13DeMensaje(texto) {
    if (!esMensajeRecuperableJasc13(texto)) return null;

    const lineaUsuario = String(texto).match(/usuario:\s*@([^\n]+)/i);
    const lineaPuntos = String(texto).match(/pavos registrados:\s*\*\+?([0-9][0-9,\s.]*)\*/i);

    if (!lineaUsuario || !lineaPuntos) return null;

    const numero = normalizarNumeroTelefono(lineaUsuario[1]);
    const puntos = Number(lineaPuntos[1].replace(/[^0-9]/g, ''));

    if (!numero || !Number.isInteger(puntos) || puntos <= 0) return null;
    return { numero, puntos };
}

function encontrarIdParticipantePorNumeroJasc13(participantes, numeroNormalizado) {
    for (const id of participantes.keys()) {
        if (normalizarNumeroTelefono(id) === numeroNormalizado) return id;
    }
    return null;
}

async function comandoRecuperarRegistroJasc13(sock, chatId, msg, texto) {
    const sender = msg.key.participant || msg.key.remoteJid;

    if (!(await esPrivilegiadoTotalAsync(sock, sender))) return false;

    const registro = extraerRegistroJasc13DeMensaje(texto);
    if (!registro) return false;

    const { participantes, cashback } = await cargarEstadoRifaJasc13();
    let targetId = encontrarIdParticipantePorNumeroJasc13(participantes, registro.numero);

    if (!targetId) targetId = registro.numero + '@s.whatsapp.net';

    const datosUsuario = participantes.get(targetId) || { puntos: 0 };
    const puntosAnteriores = Number(datosUsuario.puntos) || 0;
    const cashbackGenerado = calcularCashbackJasc13(registro.puntos);
    const cashbackAnterior = Number(cashback.get(targetId) || 0);
    const cashbackNuevo = Number((cashbackAnterior + cashbackGenerado).toFixed(2));

    datosUsuario.puntos = puntosAnteriores + registro.puntos;
    participantes.set(targetId, datosUsuario);
    cashback.set(targetId, cashbackNuevo);

    await guardarParticipantesJasc13(participantes);
    await guardarCashbackJasc13(cashback);

    const boletos = Math.floor(datosUsuario.puntos / 1000);
    const resto = datosUsuario.puntos % 1000;
    const faltantes = resto === 0 ? 0 : 1000 - resto;

    await sock.sendMessage(chatId, {
        text: '♻️ *REGISTRO JASC13 RECUPERADO* ♻️\n\n' +
            '👤 Usuario: @' + registro.numero + '\n' +
            '➕ Puntos recuperados: *+' + registro.puntos + '*\n' +
            '💎 Puntos actuales: *' + datosUsuario.puntos + '*\n' +
            '🎟️ Boletos actuales: *' + boletos + '* (Faltan *' + faltantes + ' pts*)\n' +
            '💰 Cashback generado: *+' + cashbackGenerado + ' pavos*\n' +
            '💵 Cashback acumulado: *' + cashbackNuevo + ' pavos*\n\n' +
            '✅ Se tomó únicamente la cantidad de PaVos registrados del mensaje histórico; boletos y cashback se calcularon automáticamente.',
        mentions: [targetId]
    }, { quoted: msg });

    return true;
}


async function cargarEstadoRifaJasc13() {
    const participantesConfig = await Config.findOne({ clave: CLAVE_PARTICIPANTES_JASC13 });
    const cashbackConfig = await Config.findOne({ clave: CLAVE_CASHBACK_JASC13 });

    const participantes = new Map();
    const cashback = new Map();

    if (participantesConfig?.valor) {
        try {
            const lista = JSON.parse(participantesConfig.valor);
            if (Array.isArray(lista)) {
                for (const item of lista) {
                    if (!item?.id) continue;
                    const puntos = Number(item.puntos);
                    if (Number.isFinite(puntos)) participantes.set(item.id, { puntos });
                }
            }
        } catch (e) {
            console.error('Error cargando participantes JASC13:', e.message);
        }
    }

    if (cashbackConfig?.valor) {
        try {
            const listaCashback = JSON.parse(cashbackConfig.valor);
            if (Array.isArray(listaCashback)) {
                for (const item of listaCashback) {
                    const valor = Number(item?.cashback);
                    if (item?.id && Number.isFinite(valor) && valor >= 0) cashback.set(item.id, valor);
                }
            }
        } catch (e) {
            console.error('Error cargando cashback JASC13:', e.message);
        }
    }

    // Migración automática para participantes antiguos de JASC13:
    // si el participante ya existía con puntos pero todavía no tenía una
    // entrada de cashback, se le asigna una sola vez el 5% de sus puntos actuales.
    let cashbackMigrado = false;
    for (const [id, data] of participantes.entries()) {
        if (cashback.has(id)) continue;

        const puntosActuales = Number(data.puntos) || 0;
        cashback.set(id, calcularCashbackJasc13(puntosActuales));
        cashbackMigrado = true;
    }

    if (cashbackMigrado) {
        await guardarCashbackJasc13(cashback);
    }

    return { participantes, cashback };
}

async function guardarParticipantesJasc13(participantes) {
    const lista = Array.from(participantes.entries()).map(([id, data]) => ({
        id,
        puntos: Number(data.puntos) || 0
    }));

    await Config.findOneAndUpdate(
        { clave: CLAVE_PARTICIPANTES_JASC13 },
        { valor: JSON.stringify(lista) },
        { upsert: true }
    );
}

async function guardarCashbackJasc13(cashback) {
    const lista = Array.from(cashback.entries()).map(([id, valor]) => ({
        id,
        cashback: Number(valor) || 0
    }));

    await Config.findOneAndUpdate(
        { clave: CLAVE_CASHBACK_JASC13 },
        { valor: JSON.stringify(lista) },
        { upsert: true }
    );
}

async function comandoMenuRifaJasc13(sock, chatId, msg) {
    // Menú secreto: no aparece en grupos ni en los menús públicos.
    if (chatId.endsWith('@g.us')) return;

    const menuTexto = `🎟️ *MENÚ SECRETO - RIFA CÓDIGO DE CREADOR (JASC13)* 🎟️\n\n` +
        `🔒 El creador está fijado permanentemente. Ya no necesitas usar *rifajasc13 iniciar*.\n\n` +
        `➕ *rifajasc13 agregar [@usuario/número] [puntos]* - Suma puntos y genera 5% de cashback.\n` +
        `🔢 *rifajasc13 [número]sumar [puntos]* - Suma puntos directamente al participante de ese número.\n` +
        `👀 *rifajasc13 ver* - Muestra participantes, puntos, boletos y cashback.\n` +
        `🗑️ *rifajasc13 quitar [número]* - Quita al participante sin borrar su cashback.\n` +
        `🧹 *rifajasc13 vaciar* - Vacía la lista actual, conservando todo el cashback.\n` +
        `🎰 *rifajasc13 sortear [ganadores]* - Sortea y reinicia puntos/boletos a 0, conservando el cashback.\n` +
        `💸 *cajecash [@usuario/número] [pavos]* - Canjea y descuenta cashback.\n` +
        `♻️ *Recuperación:* reenvía un mensaje histórico de *PaVos registrados exitosamente* del bot y recuperaré automáticamente el número y los puntos.`;

    await sock.sendMessage(chatId, { text: menuTexto }, { quoted: msg });
}

async function comandoRifaJasc13(sock, chatId, msg, args) {
    const sender = msg.key.participant || msg.key.remoteJid;

    // El creador de JASC13 está fijado al número con privilegios totales.
    // Ya no se utiliza iniciar para elegir o cambiar propietario.
    if (!(await esPrivilegiadoTotalAsync(sock, sender))) {
        return await sock.sendMessage(chatId, {
            text: '❌ Acceso denegado. Esta rifa JASC13 solo puede ser administrada por su creador.'
        }, { quoted: msg });
    }

    // Todo el estado se recupera de MongoDB y sobrevive reinicios/deploys de Render.
    const { participantes, cashback } = await cargarEstadoRifaJasc13();

    if (!args || args.length === 0) {
        return await sock.sendMessage(chatId, {
            text: '❌ Comando incompleto. Escribe *menurifajasc13* en chat privado para ver la ayuda.'
        }, { quoted: msg });
    }

    const accion = args[0].toLowerCase();

    if (accion === 'iniciar') {
        return await sock.sendMessage(chatId, {
            text: '🔒 *Rifa JASC13 fijada.* El creador está establecido permanentemente y ya no es necesario usar *rifajasc13 iniciar*.'
        }, { quoted: msg });
    }

    if (accion === 'ver') {
        if (participantes.size === 0) {
            return await sock.sendMessage(chatId, { text: '📭 La rifa exclusiva JASC13 está vacía.' }, { quoted: msg });
        }

        let texto = '🎟️ *PARTICIPANTES - RIFA JASC13* 🎟️\n\n';
        let i = 1;
        const mentions = [];

        for (const [id, data] of participantes.entries()) {
            const usuario = id?.split('@')[0] || 'Usuario desconocido';
            const puntos = Number(data.puntos) || 0;
            const boletos = Math.floor(puntos / 1000);
            const resto = puntos % 1000;
            const faltantes = resto === 0 ? 0 : 1000 - resto;
            const cashbackActual = Number(cashback.get(id) || 0);

            texto += `👤 *${i}. @${usuario}*\n`;
            texto += `💎 Puntos: *${puntos}*\n`;
            texto += `🎟️ Boletos: *${boletos}* (Faltan *${faltantes} pts*)\n`;
            texto += `🪙 Cashback: *${cashbackActual} pavos*\n\n`;

            mentions.push(id);
            i++;
        }

        return await sock.sendMessage(chatId, { text: texto, mentions });
    }

    if (accion === 'vaciar') {
        participantes.clear();
        await Config.findOneAndUpdate(
            { clave: CLAVE_PARTICIPANTES_JASC13 },
            { valor: '[]' },
            { upsert: true }
        );

        return await sock.sendMessage(chatId, {
            text: '🧹 *¡Lista limpiada!* Se borraron los participantes de la rifa JASC13, pero el 💰 cashback se conserva.'
        }, { quoted: msg });
    }

    if (accion === 'quitar') {
        const indexParam = args[1];
        if (!indexParam) {
            return await sock.sendMessage(chatId, {
                text: '❌ Indica el número de la lista a quitar (ej. rifajasc13 quitar 1).'
            }, { quoted: msg });
        }

        const arrayKeys = Array.from(participantes.keys());
        const idx = parseInt(indexParam, 10) - 1;

        if (isNaN(idx) || idx < 0 || idx >= arrayKeys.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Número de participante no válido. Usa "rifajasc13 ver".'
            }, { quoted: msg });
        }

        const eliminadoId = arrayKeys[idx];
        participantes.delete(eliminadoId);
        await guardarParticipantesJasc13(participantes);

        return await sock.sendMessage(chatId, {
            text: '🗑️ Participante eliminado correctamente de la lista.'
        });
    }

    if (accion === 'agregar') {
        let targetId = null;
        const puntosAgregados = parseInt(args[args.length - 1], 10);

        if (isNaN(puntosAgregados) || puntosAgregados <= 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Especifica una cantidad válida de puntos al final (ej. rifajasc13 agregar @usuario 1500).'
            }, { quoted: msg });
        }

        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetId = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            targetId = msg.message.extendedTextMessage.contextInfo.participant;
        } else {
            const numLimpio = args[1]?.replace(/[^0-9]/g, '');
            if (numLimpio && numLimpio.length > 5) {
                targetId = numLimpio + '@s.whatsapp.net';
            }
        }

        if (!targetId) {
            return await sock.sendMessage(chatId, {
                text: '❌ No se pudo identificar al usuario. Menciona al usuario o responde a su mensaje.'
            }, { quoted: msg });
        }

        const datosUsuario = participantes.get(targetId) || { puntos: 0 };
        const puntosAnteriores = Number(datosUsuario.puntos) || 0;
        const cashbackGenerado = calcularCashbackJasc13(puntosAgregados);
        const cashbackAnterior = Number(cashback.get(targetId) || 0);
        const cashbackNuevo = Number((cashbackAnterior + cashbackGenerado).toFixed(2));

        datosUsuario.puntos = puntosAnteriores + puntosAgregados;

        const boletosAnteriores = Math.floor(puntosAnteriores / 1000);
        const boletosNuevos = Math.floor(datosUsuario.puntos / 1000);
        const boletosGanados = boletosNuevos - boletosAnteriores;
        const resto = datosUsuario.puntos % 1000;
        const faltantes = resto === 0 ? 0 : 1000 - resto;

        participantes.set(targetId, datosUsuario);
        cashback.set(targetId, cashbackNuevo);
        await guardarParticipantesJasc13(participantes);
        await guardarCashbackJasc13(cashback);

        const respuesta = `✅ *Puntos registrados exitosamente*\n` +
            `👤 Usuario: @${targetId.split('@')[0]}\n` +
            `➕ Puntos sumados: *+${puntosAgregados}*\n` +
            `📊 Puntos totales: *${datosUsuario.puntos}*\n` +
            `🎟️ Boletos totales: *${boletosNuevos}* ${boletosGanados > 0 ? `(¡Ganó +${boletosGanados} boleto(s) nuevos!)` : ''}\n` +
            `📌 Puntos faltantes para el siguiente boleto: *${faltantes}*\n` +
            `💰 Cashback generado: *+${cashbackGenerado} pavos*\n` +
            `💵 Cashback acumulado: *${cashbackNuevo} pavos*`;

        return await sock.sendMessage(chatId, { text: respuesta, mentions: [targetId] });
    }

    if (accion === 'addvarios') {
        const textoMensaje = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

        // Lee las líneas que aparecen debajo de "rifajasc13 addvarios".
        const lineas = textoMensaje.split(/\r?\n/).slice(1);
        const operaciones = [];

        for (const linea of lineas) {
            const coincidencia = linea.match(/^\s*(\d+)\s*[.)\-:]?\s+(\d+)\s*$/);
            if (!coincidencia) continue;

            const numeroLista = parseInt(coincidencia[1], 10);
            const puntosAgregados = parseInt(coincidencia[2], 10);

            if (Number.isInteger(numeroLista) && numeroLista >= 1 && Number.isInteger(puntosAgregados) && puntosAgregados > 0) {
                operaciones.push({ numeroLista, puntosAgregados });
            }
        }

        if (operaciones.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ No encontré operaciones válidas.\n\nUsa *rifajasc13 addvarios* y debajo escribe, por ejemplo:\n\n1. 1000\n2. 3000\n5) 5000'
            }, { quoted: msg });
        }

        const ids = Array.from(participantes.keys());
        const resultados = [];
        const errores = [];
        const mentions = [];

        for (const operacion of operaciones) {
            const { numeroLista, puntosAgregados } = operacion;

            if (numeroLista > ids.length) {
                errores.push(`#${numeroLista}: no existe`);
                continue;
            }

            const targetId = ids[numeroLista - 1];
            const datosUsuario = participantes.get(targetId) || { puntos: 0 };
            const puntosAnteriores = Number(datosUsuario.puntos) || 0;
            const cashbackGenerado = calcularCashbackJasc13(puntosAgregados);
            const cashbackAnterior = Number(cashback.get(targetId) || 0);
            const cashbackNuevo = Number((cashbackAnterior + cashbackGenerado).toFixed(2));

            datosUsuario.puntos = puntosAnteriores + puntosAgregados;
            participantes.set(targetId, datosUsuario);
            cashback.set(targetId, cashbackNuevo);

            resultados.push({
                numeroLista,
                targetId,
                puntosAgregados,
                puntosTotales: datosUsuario.puntos,
                boletos: Math.floor(datosUsuario.puntos / 1000),
                cashbackGenerado,
                cashbackNuevo
            });

            mentions.push(targetId);
        }

        if (resultados.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Ningún número de la lista era válido. Usa *rifajasc13 ver* para revisar los participantes.'
            }, { quoted: msg });
        }

        await guardarParticipantesJasc13(participantes);
        await guardarCashbackJasc13(cashback);

        let respuesta = '✅ *ACTUALIZACIÓN MÚLTIPLE JASC13* ✅\n\n';
        for (const resultado of resultados) {
            respuesta += `👤 *#${resultado.numeroLista}. @${resultado.targetId.split('@')[0]}*\n`;
            respuesta += `➕ Puntos agregados: *+${resultado.puntosAgregados}*\n`;
            respuesta += `💎 Puntos totales: *${resultado.puntosTotales}*\n`;
            respuesta += `🎟️ Boletos: *${resultado.boletos}*\n`;
            respuesta += `💰 Cashback generado: *+${resultado.cashbackGenerado} pavos*\n`;
            respuesta += `💵 Cashback acumulado: *${resultado.cashbackNuevo} pavos*\n\n`;
        }

        if (errores.length > 0) {
            respuesta += '⚠️ *No se procesaron:* ' + errores.join(', ') + '.\n\n';
        }

        respuesta += `📌 Se actualizaron *${resultados.length}* participante(s).`;

        return await sock.sendMessage(chatId, { text: respuesta, mentions }, { quoted: msg });
    }

    const sumarPorNumero = accion.match(/^(\d+)sumar$/);
    if (sumarPorNumero) {
        const numeroLista = parseInt(sumarPorNumero[1], 10);
        const puntosAgregados = parseInt(args[1], 10);
        const ids = Array.from(participantes.keys());

        if (!Number.isInteger(numeroLista) || numeroLista < 1 || numeroLista > ids.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Ese número de participante no existe. Usa *rifajasc13 ver* para consultar la lista.'
            }, { quoted: msg });
        }

        if (!Number.isInteger(puntosAgregados) || puntosAgregados <= 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Indica los puntos a sumar. Ejemplo: *rifajasc13 ' + numeroLista + 'sumar 500*.'
            }, { quoted: msg });
        }

        const targetId = ids[numeroLista - 1];
        const datosUsuario = participantes.get(targetId) || { puntos: 0 };
        const puntosAnteriores = Number(datosUsuario.puntos) || 0;
        const cashbackGenerado = calcularCashbackJasc13(puntosAgregados);
        const cashbackAnterior = Number(cashback.get(targetId) || 0);
        const cashbackNuevo = Number((cashbackAnterior + cashbackGenerado).toFixed(2));

        datosUsuario.puntos = puntosAnteriores + puntosAgregados;
        participantes.set(targetId, datosUsuario);
        cashback.set(targetId, cashbackNuevo);

        await guardarParticipantesJasc13(participantes);
        await guardarCashbackJasc13(cashback);

        const boletosNuevos = Math.floor(datosUsuario.puntos / 1000);
        const resto = datosUsuario.puntos % 1000;
        const faltantes = resto === 0 ? 0 : 1000 - resto;

        return await sock.sendMessage(chatId, {
            text: '✅ *Puntos sumados al participante #' + numeroLista + '*\n' +
                '👤 Usuario: @' + targetId.split('@')[0] + '\n' +
                '➕ Puntos añadidos: *+' + puntosAgregados + '*\n' +
                '📊 Puntos totales: *' + datosUsuario.puntos + '*\n' +
                '🎟️ Boletos: *' + boletosNuevos + '* (Faltan *' + faltantes + ' pts*)\n' +
                '💰 Cashback generado: *+' + cashbackGenerado + ' pavos*\n' +
                '💵 Cashback acumulado: *' + cashbackNuevo + ' pavos*',
            mentions: [targetId]
        }, { quoted: msg });
    }

    if (accion === 'quitarrifajasc13' || accion === 'quitarpuntos') {
        const sender = msg.key.participant || msg.key.remoteJid;
        const tienePrivilegiosTotales = await esPrivilegiadoTotalAsync(sock, sender);

        if (!tienePrivilegiosTotales) {
            return await sock.sendMessage(chatId, { text: '❌ Solo los propietarios permanentes de JASC13 pueden modificar puntos y cashback de la rifa.' }, { quoted: msg });
        }

        // messageHandler envía: ['quitarrifajasc13', usuario_o_numero, puntos]
        const objetivo = args[1];
        const puntosRestar = parseInt(args[2], 10);
        let targetId = null;
        let numeroLista = null;

        // Formato: quitarrifajasc13 10 500
        if (/^\d+$/.test(String(objetivo || ''))) {
            numeroLista = parseInt(objetivo, 10);
            const lista = Array.from(participantes.entries());
            const item = lista[numeroLista - 1];
            if (item) targetId = item[0];
        } else {
            // Formato: quitarrifajasc13 @usuario 500
            targetId = obtenerObjetivoRifaJasc13(msg, [objetivo, String(puntosRestar)]);
            if (!targetId && objetivo) {
                const numero = String(objetivo).replace(/[^0-9]/g, '');
                if (numero.length > 5) targetId = numero + '@s.whatsapp.net';
            }
        }

        if (!targetId || !Number.isInteger(puntosRestar) || puntosRestar <= 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Uso correcto:\n*quitarrifajasc13 @usuario 500*\no\n*quitarrifajasc13 10 500*'
            }, { quoted: msg });
        }

        const datosUsuario = participantes.get(targetId);
        if (!datosUsuario) {
            return await sock.sendMessage(chatId, { text: '❌ Ese participante no existe en la rifa. Usa *rifajasc13 ver* para revisar la lista.' }, { quoted: msg });
        }

        const puntosAnteriores = Number(datosUsuario.puntos) || 0;
        if (puntosRestar > puntosAnteriores) {
            return await sock.sendMessage(chatId, {
                text: '❌ No puedes restar más puntos de los que tiene el participante.\n\n📊 Puntos actuales: *' + puntosAnteriores + '*'
            }, { quoted: msg });
        }

        const cashbackRestar = calcularCashbackJasc13(puntosRestar);
        const cashbackAnterior = Number(cashback.get(targetId) || 0);
        const cashbackNuevo = Math.max(0, Number((cashbackAnterior - cashbackRestar).toFixed(2)));

        datosUsuario.puntos = puntosAnteriores - puntosRestar;
        participantes.set(targetId, datosUsuario);
        cashback.set(targetId, cashbackNuevo);

        await guardarParticipantesJasc13(participantes);
        await guardarCashbackJasc13(cashback);

        const boletos = Math.floor(datosUsuario.puntos / 1000);
        const resto = datosUsuario.puntos % 1000;
        const faltantes = resto === 0 ? 0 : 1000 - resto;

        await sock.sendMessage(chatId, {
            text: '➖ *PUNTOS RESTADOS DE JASC13*\n\n' +
                '👤 Participante: @' + targetId.split('@')[0] + '\n' +
                '➖ Puntos restados: *-' + puntosRestar + '*\n' +
                '💎 Puntos actuales: *' + datosUsuario.puntos + '*\n' +
                '🎟️ Boletos actuales: *' + boletos + '*\n' +
                '💰 Cashback restado: *-' + cashbackRestar + ' pavos*\n' +
                '💵 Cashback actual: *' + cashbackNuevo + ' pavos*\n' +
                '📌 Faltan *' + faltantes + '* puntos para el siguiente boleto.',
            mentions: [targetId]
        }, { quoted: msg });
        return;
    }

    if (accion === 'cajecash') {
        if (!args || args.length < 2) {
            return await sock.sendMessage(chatId, {
                text: '💸 *Uso:* cajecash [@usuario / número de lista] [pavos]\nEjemplos: *cajecash @usuario 100* o *cajecash 1 100*.'
            }, { quoted: msg });
        }

        const cantidadSolicitada = Number(args[args.length - 1]);
        if (!Number.isFinite(cantidadSolicitada) || cantidadSolicitada <= 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ La cantidad de pavos a canjear debe ser mayor que 0.'
            }, { quoted: msg });
        }

        let targetId = null;
        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetId = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else {
            const primerArgumento = args[0]?.trim() || '';
            const numeroLista = Number(primerArgumento);

            if (Number.isInteger(numeroLista) && numeroLista >= 1) {
                const ids = Array.from(participantes.keys());
                targetId = ids[numeroLista - 1] || null;
            } else {
                const numLimpio = primerArgumento.replace(/[^0-9]/g, '');
                if (numLimpio.length > 5) targetId = numLimpio + '@s.whatsapp.net';
            }
        }

        if (!targetId) {
            return await sock.sendMessage(chatId, {
                text: '❌ No pude identificar al participante. Etiquétalo o usa el número que aparece en *rifajasc13 ver*.'
            }, { quoted: msg });
        }

        const saldoCashback = Number(cashback.get(targetId) || 0);
        if (saldoCashback < cantidadSolicitada) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Cashback insuficiente.*\n\n' +
                    '💰 Disponible: *' + saldoCashback + ' pavos*\n' +
                    '💸 Solicitado: *' + cantidadSolicitada + ' pavos*'
            }, { quoted: msg });
        }

        const saldoNuevo = Number((saldoCashback - cantidadSolicitada).toFixed(2));
        cashback.set(targetId, saldoNuevo);
        await guardarCashbackJasc13(cashback);

        return await sock.sendMessage(chatId, {
            text: '💸 *Cashback canjeado correctamente* 💸\n\n' +
                '👤 Usuario: @' + targetId.split('@')[0] + '\n' +
                '💰 Cashback canjeado: *' + cantidadSolicitada + ' pavos*\n' +
                '💵 Cashback restante: *' + saldoNuevo + ' pavos*\n\n' +
                '✅ Solo se descontó el cashback. Los puntos y boletos no se tocaron.',
            mentions: [targetId]
        }, { quoted: msg });
    }

    if (accion === 'sortear') {
        if (participantes.size === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ No hay participantes en la rifa JASC13 para sortear.'
            }, { quoted: msg });
        }

        const cantidadSolicitada = args[1] === undefined ? 1 : parseInt(args[1], 10);

        if (!Number.isInteger(cantidadSolicitada) || cantidadSolicitada < 1) {
            return await sock.sendMessage(chatId, {
                text: '❌ Indica una cantidad válida de ganadores (ej. *rifajasc13 sortear 10*).'
            }, { quoted: msg });
        }

        const boletosPorParticipante = new Map();

        for (const [id, data] of participantes.entries()) {
            const boletos = Math.floor(data.puntos / 1000);
            if (boletos > 0) boletosPorParticipante.set(id, boletos);
        }

        if (boletosPorParticipante.size === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Los participantes aún no acumulan suficientes boletos para el sorteo.'
            }, { quoted: msg });
        }

        if (cantidadSolicitada > boletosPorParticipante.size) {
            return await sock.sendMessage(chatId, {
                text: `❌ No hay suficientes participantes con boletos para elegir *${cantidadSolicitada}* ganadores. Actualmente hay *${boletosPorParticipante.size}*.`
            }, { quoted: msg });
        }

        const disponibles = new Map(boletosPorParticipante);
        const ganadores = [];

        for (let ronda = 0; ronda < cantidadSolicitada; ronda++) {
            let totalBoletosDisponibles = 0;
            for (const boletos of disponibles.values()) totalBoletosDisponibles += boletos;

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
            return await sock.sendMessage(chatId, { text: '❌ No fue posible realizar el sorteo.' }, { quoted: msg });
        }

        const mentions = ganadores;
        let mensajeGanador = ganadores.length === 1
            ? '🎉 *¡TENEMOS GANADOR DE LA RIFA EXCLUSIVA!* 🎉\n\n'
            : `🎉 *¡TENEMOS ${ganadores.length} GANADORES DE LA RIFA EXCLUSIVA!* 🎉\n\n`;

        ganadores.forEach((ganadorId, index) => {
            mensajeGanador += `🏆 *Ganador ${index + 1}:* @${ganadorId.split('@')[0]} 🎊\n`;
        });

        mensajeGanador += '\n❤️ ¡Muchas gracias por apoyar usando el código de creador *JASC13*!\n';
        mensajeGanador += '🎮 Sigue utilizando el código en la tienda de Fortnite para ganar más recompensas y participar en futuras rifas.';

        await sock.sendMessage(chatId, { text: mensajeGanador, mentions });

        for (const ganadorId of ganadores) {
            try {
                await sock.sendMessage(ganadorId, {
                    text: '🎉 ¡Felicidades! Has sido seleccionado como ganador de la rifa exclusiva con el código de creador JASC13.\n\n❤️ ¡Gracias por tu apoyo continuo!\n\n🎮 Sigue usando el código *JASC13* en Fortnite para obtener más beneficios.'
                });
            } catch (e) {
                console.error('Error al enviar mensaje privado al ganador de la rifa:', e);
            }
        }

        // El sorteo elimina puntos no canjeados y todos los boletos, pero conserva el cashback.
        for (const data of participantes.values()) {
            data.puntos = 0;
        }

        await guardarParticipantesJasc13(participantes);
        await guardarCashbackJasc13(cashback);

        await sock.sendMessage(chatId, {
            text: '🔄 *Rifa JASC13 reiniciada.*\n\n' +
                '🎟️ Todos los boletos fueron eliminados.\n' +
                '💎 Todos los puntos no canjeados fueron reiniciados a 0.\n' +
                '💰 El cashback se conservó completo para cada participante.'
        });
    }
}

module.exports = { comandoRifa, comandoRifaInscripcion, comandoRifaJasc13, comandoMenuRifaJasc13, comandoRecuperarRegistroJasc13, comandoAbrirRifa, comandoActivarRifaAqui, comandoCerrarRifa };
