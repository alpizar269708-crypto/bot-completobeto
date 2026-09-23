const { esProgramadorBot } = require('./programadorbot');
const { Config, RifaJasc13Cashback } = require('../database/modelos');

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

            if (!esProgramadorBot(msg) && !isAdmin) {
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

    if (sender !== propietario) return;

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

            if (!esProgramadorBot(msg) && !isAdmin) {
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
        if (!esProgramadorBot(msg) && (!propietario || sender !== propietario)) return;
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

    if (!esProgramadorBot(msg) && (!propietario || sender !== propietario)) return;

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
            
            if (!esProgramadorBot(msg) && !isAdmin) {
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

                if (!esProgramadorBot(msg) && !isAdmin) {
                    return await sock.sendMessage(chatId, { text: `❌ Permiso denegado. Solo los administradores del grupo pueden realizar el sorteo.` }, { quoted: msg });
                }
            } catch (e) {
                console.error("Error al verificar admin al sortear rifa:", e);
                return;
            }
        } else {
            const propietario = await obtenerPropietarioRifas();
            if (!esProgramadorBot(msg) && (!propietario || sender !== propietario)) {
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
const CLAVE_PROPIETARIO_JASC13 = 'rifajasc13_propietario';
const CLAVE_PARTICIPANTES_JASC13 = 'rifajasc13_participantes';
const CLAVE_MIGRACION_CASHBACK_JASC13 = 'rifajasc13_cashback_migrado_v1';
const PORCENTAJE_CASHBACK_JASC13 = 0.05;

function normalizarNumeroVisible(numero) {
    const limpio = String(numero || '').replace(/[^0-9]/g, '');
    if (!limpio) return 'Desconocido';
    if (limpio.startsWith('521') && limpio.length === 13) return '+52' + limpio.slice(3);
    return '+' + limpio;
}

function extraerNumeroJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

async function resolverContactoJasc13(sock, jid) {
    if (!jid) return { numeroVisible: 'Desconocido', mentionJid: null, mentionNumber: null };
    let mentionJid = jid; let numero = extraerNumeroJid(jid);
    if (jid.endsWith('@lid')) {
        try {
            const lidMapping = sock.signalRepository?.lidMapping;
            if (lidMapping?.getPNForLID) {
                const pn = await lidMapping.getPNForLID(jid);
                if (pn) { mentionJid = pn; numero = extraerNumeroJid(pn); }
            }
        } catch (e) { console.error('⚠️ No se pudo resolver LID a número de teléfono:', e.message); }
    }
    return { numeroVisible: normalizarNumeroVisible(numero), mentionJid, mentionNumber: extraerNumeroJid(mentionJid) };
}

async function cargarEstadoRifaJasc13() {
    const propietarioConfig = await Config.findOne({ clave: CLAVE_PROPIETARIO_JASC13 });
    const participantesConfig = await Config.findOne({ clave: CLAVE_PARTICIPANTES_JASC13 });
    const migracionCashback = await Config.findOne({ clave: CLAVE_MIGRACION_CASHBACK_JASC13 });
    const propietario = propietarioConfig?.valor || null;
    const participantes = new Map();
    let requiereGuardar = false;
    let lista = [];
    if (participantesConfig?.valor) {
        try { lista = JSON.parse(participantesConfig.valor); } catch (e) { console.error('Error cargando participantes JASC13:', e.message); }
    }
    if (Array.isArray(lista)) {
        for (const item of lista) {
            if (!item?.id) continue;
            const puntos = Number(item.puntos);
            if (!Number.isFinite(puntos)) continue;
            if (Number.isFinite(Number(item.boletos))) {
                participantes.set(item.id, { puntos: Math.max(0, Math.floor(puntos)), boletos: Math.max(0, Math.floor(Number(item.boletos))) });
            } else {
                participantes.set(item.id, { puntos: Math.max(0, Math.floor(puntos)) % 1000, boletos: Math.floor(Math.max(0, Math.floor(puntos)) / 1000) });
                requiereGuardar = true;
            }
        }
    }
    if (!migracionCashback) {
        for (const item of lista) {
            const baseHistorica = Number(item?.puntos);
            if (!item?.id || !Number.isFinite(baseHistorica) || baseHistorica <= 0) continue;
            const cashbackHistorico = Number((baseHistorica * PORCENTAJE_CASHBACK_JASC13).toFixed(2));
            if (cashbackHistorico > 0) {
                await RifaJasc13Cashback.findOneAndUpdate({ numero: item.id }, { $inc: { cashback: cashbackHistorico } }, { upsert: true });
            }
        }
        await Config.findOneAndUpdate({ clave: CLAVE_MIGRACION_CASHBACK_JASC13 }, { valor: 'true' }, { upsert: true });
    }
    if (requiereGuardar) await guardarParticipantesJasc13(participantes);
    return { propietario, participantes };
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

async function guardarPropietarioJasc13(propietario) {
    await Config.findOneAndUpdate(
        { clave: CLAVE_PROPIETARIO_JASC13 },
        { valor: propietario },
        { upsert: true }
    );
}

async function obtenerPropietarioRifasJasc13() {
    const config = await Config.findOne({ clave: CLAVE_PROPIETARIO_JASC13 }).select('valor').lean();
    return config?.valor || null;
}

async function comandoMenuRifaJasc13(sock, chatId, msg) {
    // Menú privado y exclusivo del propietario registrado de la rifa JASC13.
    if (chatId.endsWith('@g.us') && !esProgramadorBot(msg)) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const propietario = await obtenerPropietarioRifasJasc13();

    if (!esProgramadorBot(msg) && (!propietario || sender !== propietario)) {
        return await sock.sendMessage(chatId, {
            text: '❌ Este menú es privado y exclusivo del propietario de la rifa JASC13.'
        }, { quoted: msg });
    }

    const menuTexto = `🎟️ *MENÚ SECRETO - RIFA CÓDIGO DE CREADOR (JASC13)* 🎟️\n\n` +
        `• *rifajasc13 iniciar* - Inicia la rifa y te registra como propietario único.\n` +
        `• *rifajasc13 agregar [@usuario/número] [PaVos]* - Convierte PaVos a boletos (1000 PaVos = 1 boleto) y acumula 5% de Cashback con dos decimales.\n` +
        `• *rifajasc13 cashback @usuario* - Consulta el Cashback actual.\n` +
        `• *rifajasc13 cashback ver @usuario* - Consulta el Cashback actual.\n` +
        `• *rifajasc13 cashback todos* - Muestra todos los Cashback acumulados.\n` +
        `• *rifajasc13 cashback canjear @usuario [cantidad]* - Canjea Cashback.\n` +
        `• *rifajasc13 ver* - Muestra la lista de participantes, puntos y boletos actuales.\n` +
        `• *rifajasc13 quitar [número]* - Elimina a un participante de la lista.\n` +
        `• *rifajasc13 vaciar* - Limpia toda la lista de participantes.\n` +
        `• *rifajasc13 sortear [ganadores]* - Realiza el sorteo ponderado y reinicia la lista.`;

    await sock.sendMessage(chatId, { text: menuTexto }, { quoted: msg });
}

async function comandoRifaJasc13(sock, chatId, msg, args) {
    const sender = msg.key.participant || msg.key.remoteJid;

    // Todo el estado se recupera de MongoDB, por lo que sobrevive reinicios/deploys de Render.
    let { propietario, participantes } = await cargarEstadoRifaJasc13();

    // El propietario queda guardado permanentemente hasta que se cambie explícitamente con iniciar.
    // El ProgramadorBot (número maestro) tiene restricción 0 y puede administrar la rifa
    // aunque el propietario registrado sea otro número.
    const esMaestro = esProgramadorBot(msg);
    if (propietario && sender !== propietario && !esMaestro) {
        return await sock.sendMessage(chatId, {
            text: '❌ Acceso denegado. Esta rifa ya fue iniciada y está reservada para su propietario.'
        }, { quoted: msg });
    }

    if (!args || args.length === 0) {
        return await sock.sendMessage(chatId, {
            text: '❌ Comando incompleto. Escribe *menurifajasc13* en chat privado para ver la ayuda.'
        }, { quoted: msg });
    }

    const accion = args[0].toLowerCase();

    if (accion === 'iniciar') {
        if (!propietario) {
            propietario = sender;
            await guardarPropietarioJasc13(propietario);
        }

        await guardarParticipantesJasc13(participantes);

        return await sock.sendMessage(chatId, {
            text: '🚀 *¡Rifa JASC13 iniciada!* Has quedado vinculado como el único propietario y administrador permanente de esta rifa. Los puntos sobrantes y el Cashback acumulado se conservan.'
        }, { quoted: msg });
    }

    if (!propietario) {
        return await sock.sendMessage(chatId, {
            text: '❌ La rifa aún no ha sido iniciada.\n\nEjecuta el comando para abrir la rifa.'
        }, { quoted: msg });
    }

    if (accion === 'ver') {
        if (participantes.size === 0) {
            return await sock.sendMessage(chatId, { text: '📭 La rifa exclusiva JASC13 está vacía.' }, { quoted: msg });
        }

        let texto = '🎟️ *PARTICIPANTES - RIFA JASC13*\n\n';
        let i = 1;
        const mentions = [];

        for (const [id, data] of participantes.entries()) {
            const boletos = Number(data.boletos) || 0;
            const puntos = Number(data.puntos) || 0;
            const faltantes = puntos === 0 ? 1000 : 1000 - puntos;
            const cashbackDoc = await RifaJasc13Cashback.findOne({ numero: id }).select('cashback').lean();
            const cashback = Number(cashbackDoc?.cashback) || 0;
            const contacto = await resolverContactoJasc13(sock, id);
            texto += `${i}. 📱 ${contacto.numeroVisible} → Puntos: *${puntos}* | Boletos: *${boletos}* (Faltan ${faltantes} pts) | Cashback: *${cashback.toFixed(2)}* Pavos\n`;
            if (contacto.mentionJid && contacto.mentionNumber) {
                texto += `   👤 @${contacto.mentionNumber}\n`;
                mentions.push(contacto.mentionJid);
            }
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
            text: '🧹 *¡Lista limpiada!* Se han borrado todos los participantes de la rifa JASC13.'
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
        const pavosAgregados = parseInt(args[args.length - 1], 10);
        if (isNaN(pavosAgregados) || pavosAgregados <= 0) return await sock.sendMessage(chatId, { text: '❌ Especifica una cantidad válida de PaVos al final (ej. rifajasc13 agregar @usuario 1500).' }, { quoted: msg });
        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) targetId = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        else if (msg.message?.extendedTextMessage?.contextInfo?.participant) targetId = msg.message.extendedTextMessage.contextInfo.participant;
        else { const numLimpio = args[1]?.replace(/[^0-9]/g, ''); if (numLimpio && numLimpio.length > 5) targetId = numLimpio + '@s.whatsapp.net'; }
        if (!targetId) return await sock.sendMessage(chatId, { text: '❌ No se pudo identificar al usuario. Menciona al usuario o responde a su mensaje.' }, { quoted: msg });
        const datosUsuario = participantes.get(targetId) || { puntos: 0, boletos: 0 };
        const puntosTotales = (Number(datosUsuario.puntos) || 0) + pavosAgregados;
        const boletosGanados = Math.floor(puntosTotales / 1000);
        datosUsuario.puntos = puntosTotales % 1000;
        datosUsuario.boletos = (Number(datosUsuario.boletos) || 0) + boletosGanados;
        const cashbackGanado = Number((pavosAgregados * PORCENTAJE_CASHBACK_JASC13).toFixed(2));
        if (cashbackGanado > 0) await RifaJasc13Cashback.findOneAndUpdate({ numero: targetId }, { $inc: { cashback: cashbackGanado } }, { upsert: true });
        participantes.set(targetId, datosUsuario);
        await guardarParticipantesJasc13(participantes);
        const faltantes = datosUsuario.puntos === 0 ? 1000 : 1000 - datosUsuario.puntos;
        const cashbackDoc = await RifaJasc13Cashback.findOne({ numero: targetId }).select('cashback').lean();
        const cashbackTotal = Number(cashbackDoc?.cashback) || 0;
        const contacto = await resolverContactoJasc13(sock, targetId);
        const respuesta = `✅ *PaVos registrados exitosamente*\n👤 Usuario: @${contacto.mentionNumber || targetId.split('@')[0]}\n📱 Teléfono: *${contacto.numeroVisible}*\n➕ PaVos registrados: *+${pavosAgregados}*\n🎟️ Boletos agregados: *+${boletosGanados}*\n🎟️ Boletos actuales: *${datosUsuario.boletos}*\n📌 Puntos sobrantes guardados: *${datosUsuario.puntos}*\n📍 Faltan para otro boleto: *${faltantes} pts*\n💰 Cashback ganado: *+${cashbackGanado.toFixed(2)}* Pavos\n💰 Cashback acumulado: *${cashbackTotal.toFixed(2)}* Pavos`;
        return await sock.sendMessage(chatId, { text: respuesta, mentions: contacto.mentionJid ? [contacto.mentionJid] : [] });
    }

    if (accion === 'cashback') {
        const subaccion = (args[1] || '').toLowerCase();

        // cashback todos
        if (subaccion === 'todos') {
            const docs = await RifaJasc13Cashback.find({ cashback: { $gt: 0 } })
                .sort({ cashback: -1 })
                .select('numero cashback')
                .lean();

            if (docs.length === 0) {
                return await sock.sendMessage(chatId, { text: '📭 No hay Cashback acumulado.' }, { quoted: msg });
            }

            const texto = [
                '💰 *CASHBACK JASC13*',
                '',
                ...await Promise.all(docs.map(async (d, i) => {
                    const contacto = await resolverContactoJasc13(sock, d.numero);
                    const esLid = String(d.numero || '').endsWith('@lid');

                    // Los contactos con LID se muestran por su mención de WhatsApp.
                    // Los contactos normales se muestran únicamente por teléfono.
                    if (esLid && contacto.mentionNumber) {
                        return `${i + 1}. 👤 @${contacto.mentionNumber} → *${(Number(d.cashback) || 0).toFixed(2)}* Pavos`;
                    }

                    return `${i + 1}. 📱 ${contacto.numeroVisible} → *${(Number(d.cashback) || 0).toFixed(2)}* Pavos`;
                }))
            ].join('\\n');

            const mencionesCashback = await Promise.all(docs.map(async d => {
                const contacto = await resolverContactoJasc13(sock, d.numero);
                const esLid = String(d.numero || '').endsWith('@lid');

                // Conservamos el LID original para que WhatsApp pueda renderizar
                // el username asociado a ese contacto.
                return esLid ? d.numero : contacto.mentionJid;
            }));

            return await sock.sendMessage(chatId, {
                text: texto,
                mentions: mencionesCashback.filter(Boolean)
            }, { quoted: msg });
        }

        let targetId = null;
        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetId = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else {
            const indiceNumero = (subaccion === 'ver' || subaccion === 'canjear') ? 2 : 1;
            const numeroArg = args[indiceNumero]?.replace(/[^0-9]/g, '');
            if (numeroArg && numeroArg.length > 5) targetId = numeroArg + '@s.whatsapp.net';
        }

        if (!targetId) {
            return await sock.sendMessage(chatId, {
                text: '❌ Indica el usuario. Ejemplos: *rifajasc13 cashback @usuario* o *rifajasc13 cashback ver @usuario*.'
            }, { quoted: msg });
        }

        // cashback @usuario = consulta
        if (subaccion !== 'canjear') {
            const cashbackDoc = await RifaJasc13Cashback.findOne({ numero: targetId }).select('cashback').lean();
            const disponible = Number(cashbackDoc?.cashback) || 0;

            const contacto = await resolverContactoJasc13(sock, targetId);
            return await sock.sendMessage(chatId, {
                text: `💰 *CASHBACK DISPONIBLE*\n\n👤 Usuario: @${contacto.mentionNumber || targetId.split('@')[0]}\n📱 Teléfono: *${contacto.numeroVisible}*\n💳 Cashback actual: *${disponible.toFixed(2)}* Pavos`,
                mentions: contacto.mentionJid ? [contacto.mentionJid] : []
            }, { quoted: msg });
        }

        const cantidadCashback = Number(parseFloat(args[args.length - 1]).toFixed(2));
        if (isNaN(cantidadCashback) || cantidadCashback <= 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Indica la cantidad a canjear. Ejemplo: *rifajasc13 cashback canjear @usuario 500*.'
            }, { quoted: msg });
        }

        const cashbackDoc = await RifaJasc13Cashback.findOne({ numero: targetId });
        const disponible = Number(cashbackDoc?.cashback) || 0;

        if (disponible < cantidadCashback) {
            return await sock.sendMessage(chatId, {
                text: `❌ Cashback insuficiente. El usuario tiene *${disponible.toFixed(2)}* Pavos disponibles.`
            }, { quoted: msg });
        }

        cashbackDoc.cashback = Number((disponible - cantidadCashback).toFixed(2));
        await cashbackDoc.save();

        const contactoCanje = await resolverContactoJasc13(sock, targetId);
        return await sock.sendMessage(chatId, {
            text: `💸 *CASHBACK CANJEADO*\n\n👤 Usuario: @${contactoCanje.mentionNumber || targetId.split('@')[0]}\n📱 Teléfono: *${contactoCanje.numeroVisible}*\n➖ Utilizado: *${cantidadCashback.toFixed(2)}* Pavos\n💰 Restante: *${Number(cashbackDoc.cashback).toFixed(2)}* Pavos`,
            mentions: contactoCanje.mentionJid ? [contactoCanje.mentionJid] : []
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
            const boletos = Number(data.boletos) || 0;
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

        const contactosGanadores = await Promise.all(ganadores.map(ganadorId => resolverContactoJasc13(sock, ganadorId)));
        const mentions = contactosGanadores.map(contacto => contacto.mentionJid).filter(Boolean);
        let mensajeGanador = ganadores.length === 1
            ? '🎉 *¡TENEMOS GANADOR DE LA RIFA EXCLUSIVA!* 🎉\n\n'
            : `🎉 *¡TENEMOS ${ganadores.length} GANADORES DE LA RIFA EXCLUSIVA!* 🎉\n\n`;

        contactosGanadores.forEach((contacto, index) => {
            mensajeGanador += `🏆 *Ganador ${index + 1}:* @${contacto.mentionNumber || contacto.numeroVisible.replace(/[^0-9]/g, '')} · 📱 ${contacto.numeroVisible} 🎊\n`;
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

        for (const data of participantes.values()) data.boletos = 0;
        for (const [id, data] of participantes.entries()) {
            if ((Number(data.puntos) || 0) === 0) participantes.delete(id);
        }
        await guardarParticipantesJasc13(participantes);

        await sock.sendMessage(chatId, {
            text: '🔄 *Rifa JASC13 reiniciada.* Se consumieron solamente los boletos de esta edición; los puntos sobrantes y el Cashback se conservaron para la siguiente.'
        });
    }
}

module.exports = { comandoRifa, comandoRifaInscripcion, comandoRifaJasc13, comandoMenuRifaJasc13, comandoAbrirRifa, comandoActivarRifaAqui, comandoCerrarRifa };
