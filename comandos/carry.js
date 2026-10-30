const { Config } = require('../database/modelos');
const { esPrivilegiadoTotalAsync, resolverLidAPn } = require('../utils/whatsapp');
const escuadronesActivos = new Map();
const buscoCarryActivos = new Map();
const escuadronesCompletados = new Map();
const DURACION_CARRY_COMPLETO = 30 * 60 * 1000;

async function claveEpicId(sock, usuarioId) {
    const usuarioNormalizado = await resolverLidAPn(sock, usuarioId);
    return 'epic_id_' + String(usuarioNormalizado || usuarioId);
}
async function obtenerEpicId(sock, usuarioId) {
    const registro = await Config.findOne({ clave: await claveEpicId(sock, usuarioId) }).lean();
    return registro?.valor || null;
}
function mencionarJugador(usuarioId, epicId, etiqueta = '') {
    return `${etiqueta}${etiqueta ? ' ' : ''}@${String(usuarioId).split('@')[0]} — 🆔 Epic: ${epicId || 'Sin registrar'}`;
}

// Función auxiliar para verificar si el usuario es admin del grupo
async function esAdminValido(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) return false;
    if (msg.key.fromMe || await esPrivilegiadoTotalAsync(sock, msg.key.participant || msg.key.remoteJid)) return true;
    const remitente = msg.key.participant;
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participante = groupMetadata.participants.find(p => p.id === remitente);
        if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
            return true;
        }
    } catch (e) {}
    return false;
}

// Extraer número de usuario de mención, texto o mensaje citado
function extraerUsuarioObjetivo(msg, args) {
    // 1. Si responde a un mensaje
    const quoted = msg.message?.extendedTextMessage?.contextInfo;
    if (quoted && quoted.participant) {
        return quoted.participant;
    }
    // 2. Si menciona o escribe un número en args
    if (args.length > 0) {
        let limpio = args[0].replace(/[^0-9]/g, '');
        if (limpio.length >= 10) {
            return limpio + '@s.whatsapp.net';
        }
    }
    return null;
}

async function comandoCarry(sock, chatId, msg, comando, args = []) {
    const sender = msg.key.participant || msg.key.remoteJid;
    const pushName = msg.pushName || 'Jugador';

    if (comando === 'id') {
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const epicId = texto.trim().replace(/^[*_~`]+/, '').replace(/^id\b/i, '').trim();
        if (!epicId) {
            const actual = await obtenerEpicId(sock, sender);
            return await sock.sendMessage(chatId, { text: actual ? `🎮 Tu ID de Epic registrado es: *${actual}*\n\nPara cambiarlo, escribe *ID TuNuevoID*.` : '🎮 *Registra tu ID de Epic*\n\nEscribe *ID TuIDDeEpic* para guardarlo y poder participar en los carries.' }, { quoted: msg });
        }
        if (epicId.length < 2 || epicId.length > 64 || /[@\n\\r]/.test(epicId)) return await sock.sendMessage(chatId, { text: '❌ Ese ID no parece válido. Escribe *ID TuIDDeEpic* (máximo 64 caracteres).' }, { quoted: msg });
        await Config.findOneAndUpdate({ clave: await claveEpicId(sock, sender) }, { valor: epicId }, { upsert: true, new: true });
        return await sock.sendMessage(chatId, { text: `✅ *ID DE EPIC GUARDADO*\n🎮 Tu ID: *${epicId}*\n\nA partir de ahora aparecerá junto a tu etiqueta en los avisos de carry.` }, { quoted: msg });
    }

    let escuadron = escuadronesActivos.get(chatId);

    if (comando === 'carryver') {
        if (!chatId.endsWith('@g.us')) return await sock.sendMessage(chatId, { text: '❌ Este comando solo funciona en grupos.' }, { quoted: msg });
        const ahora = Date.now();
        const completados = (escuadronesCompletados.get(chatId) || []).filter(s => ahora - s.completadoEn < DURACION_CARRY_COMPLETO);
        if (completados.length) escuadronesCompletados.set(chatId, completados); else escuadronesCompletados.delete(chatId);
        const activos = escuadronesActivos.get(chatId);
        const busqueda = buscoCarryActivos.get(chatId);
        if (!activos && !busqueda && !completados.length) return await sock.sendMessage(chatId, { text: '📋 *CARRIES DEL GRUPO*\n\nNo hay carries activos, búsquedas abiertas ni escuadrones completados en los últimos 30 minutos.' }, { quoted: msg });
        let texto = '📋 *CARRIES DEL GRUPO*\n';
        const menciones = [];
        if (activos) {
            texto += `\n🟢 *ESCUADRÓN EN BUSCA DE JUGADORES*\n🎯 *Objetivo:* ${activos.motivo}\n👑 Líder: ${mencionarJugador(activos.liderId, activos.liderEpicId)}\n`;
            menciones.push(activos.liderId);
            activos.miembros.forEach((m, i) => { texto += `${mencionarJugador(m.id, m.epicId, '🎮 P' + (i + 2) + ':')}\n`; menciones.push(m.id); });
            texto += `Faltan *${Math.max(0, activos.maxEspacios - activos.miembros.length)}* espacios.\n`;
        }
        if (busqueda) {
            texto += `\n🔎 *BÚSQUEDA DE CARRY ABIERTA*\n🙋 Solicitante: ${mencionarJugador(busqueda.solicitanteId, busqueda.solicitanteEpicId)}\n🎯 *Objetivo:* ${busqueda.motivo}\n`;
            menciones.push(busqueda.solicitanteId);
            busqueda.miembros.forEach(m => { texto += `${mencionarJugador(m.id, m.epicId, m.rol === 'Ofrece carry' ? '🛟 Ofrece carry:' : '🎮 Busca carry:')}\n`; menciones.push(m.id); });
            texto += `Faltan *${Math.max(0, busqueda.maxEspacios - busqueda.miembros.length)}* espacios.\n`;
        }
        if (completados.length) {
            texto += '\n🏁 *ESCUADRONES COMPLETADOS (ÚLTIMOS 30 MIN)*\n';
            completados.slice().reverse().forEach((s, i) => {
                const minutos = Math.max(0, Math.ceil((DURACION_CARRY_COMPLETO - (ahora - s.completadoEn)) / 60000));
                texto += `\n${i + 1}. 🎯 *Objetivo:* ${s.motivo}\n👑 Líder/solicitante: ${mencionarJugador(s.liderId, s.liderEpicId)}\n`;
                menciones.push(s.liderId);
                s.miembros.forEach((m, j) => { texto += `${mencionarJugador(m.id, m.epicId, '🎮 P' + (j + 2) + ':')}\n`; menciones.push(m.id); });
                texto += `⏳ Visible aproximadamente ${minutos} min más.\n`;
            });
        }
        return await sock.sendMessage(chatId, { text: texto, mentions: [...new Set(menciones)] }, { quoted: msg });
    }

    // === GESTIÓN DE LISTA NEGRA DE CARRY (SOLO ADMINS) ===
    if (comando === 'blcarry' || comando === 'unblcarry' || comando === 'listcarrybl') {
        if (!(await esAdminValido(sock, chatId, msg))) {
            return await sock.sendMessage(chatId, { text: `❌ Este comando exclusivo de lista negra es solo para administradores.` }, { quoted: msg });
        }

        let configBL = await Config.findOne({ clave: `carry_bl_${chatId}` });
        let listaNegra = configBL ? JSON.parse(configBL.valor) : [];

        if (comando === 'listcarrybl') {
            if (listaNegra.length === 0) {
                return await sock.sendMessage(chatId, { text: `📋 La lista negra de carry en este grupo está vacía.` }, { quoted: msg });
            }
            let txt = `🚫 *LISTA NEGRA DE CARRY*\n\n`;
            listaNegra.forEach((id, idx) => {
                txt += `${idx + 1}. @${id.split('@')[0]}\n`;
            });
            return await sock.sendMessage(chatId, { text: txt, mentions: listaNegra }, { quoted: msg });
        }

        let objetivo = extraerUsuarioObjetivo(msg, args);
        if (!objetivo) {
            return await sock.sendMessage(chatId, { text: `❌ Debes mencionar a un usuario, escribir su número o responder a un mensaje suyo.` }, { quoted: msg });
        }

        if (comando === 'blcarry') {
            if (listaNegra.includes(objetivo)) {
                return await sock.sendMessage(chatId, { text: `⚠️ El usuario @${objetivo.split('@')[0]} ya está en la lista negra de carry.`, mentions: [objetivo] }, { quoted: msg });
            }
            listaNegra.push(objetivo);
            await Config.findOneAndUpdate({ clave: `carry_bl_${chatId}` }, { valor: JSON.stringify(listaNegra) }, { upsert: true });
            return await sock.sendMessage(chatId, { text: `🚫 El usuario @${objetivo.split('@')[0]} ha sido agregado a la lista negra de carry.`, mentions: [objetivo] }, { quoted: msg });
        }

        if (comando === 'unblcarry') {
            let index = listaNegra.indexOf(objetivo);
            if (index === -1) {
                return await sock.sendMessage(chatId, { text: `⚠️ El usuario @${objetivo.split('@')[0]} no estaba en la lista negra.`, mentions: [objetivo] }, { quoted: msg });
            }
            listaNegra.splice(index, 1);
            await Config.findOneAndUpdate({ clave: `carry_bl_${chatId}` }, { valor: JSON.stringify(listaNegra) }, { upsert: true });
            return await sock.sendMessage(chatId, { text: `✅ El usuario @${objetivo.split('@')[0]} fue removido de la lista negra de carry.`, mentions: [objetivo] }, { quoted: msg });
        }
        return;
    }
    // =====================================================

    // Verificar si el usuario está en lista negra antes de unirse o crear
    let configBL = await Config.findOne({ clave: `carry_bl_${chatId}` });
    let listaNegra = configBL ? JSON.parse(configBL.valor) : [];
    if (listaNegra.includes(sender)) {
        return await sock.sendMessage(chatId, { text: `❌ Estás en la lista negra de carry de este grupo y no puedes participar.` }, { quoted: msg });
    }

    const comandosConID = ['carryleader', 'carryjoin', 'buscocarry', 'doycarry', 'x2busco'];
    const epicIdRemitente = await obtenerEpicId(sender);
    if (comandosConID.includes(comando) && !epicIdRemitente) {
        return await sock.sendMessage(chatId, { text: '⚠️ *Primero registra tu ID de Epic.*\n\nEscribe *ID TuIDDeEpic* y vuelve a intentar. Así los demás podrán identificarte dentro del juego.' }, { quoted: msg });
    }

    let participantesGrupo = [];
    if (chatId.endsWith('@g.us') && ['carryleader', 'carryjoin', 'buscocarry', 'doycarry', 'x2busco'].includes(comando)) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            participantesGrupo = metadata.participants.map(u => u.id);
        } catch (err) {}
    }

    // Sistema paralelo para buscar carry: doycarry ofrece el carry y x2busco se suma como otro jugador.
    if (['buscocarry', 'buscooff', 'doycarry', 'x2busco'].includes(comando)) {
        if (!chatId.endsWith('@g.us')) return await sock.sendMessage(chatId, { text: '❌ Este comando solo funciona en grupos.' }, { quoted: msg });
        let busqueda = buscoCarryActivos.get(chatId);
        if (comando === 'buscooff') {
            if (!busqueda) return await sock.sendMessage(chatId, { text: '❌ No hay una búsqueda de carry activa para cerrar.' }, { quoted: msg });
            if (busqueda.solicitanteId !== sender && !(await esAdminValido(sock, chatId, msg))) {
                return await sock.sendMessage(chatId, { text: '❌ Solo quien abrió el buscocarry o un administrador puede cerrarlo.' }, { quoted: msg });
            }
            buscoCarryActivos.delete(chatId);
            return await sock.sendMessage(chatId, { text: '🔒 *BUSCO CARRY CERRADO*\nLa búsqueda se cerró y ya nadie puede unirse.' }, { quoted: msg });
        }
        if (comando === 'buscocarry') {
            if (busqueda) return await sock.sendMessage(chatId, { text: '❌ Ya hay una búsqueda de carry activa. Únete con *doycarry* o *x2busco*.' }, { quoted: msg });
            if (args.length < 1 || !/^[1-3]$/.test(String(args[0]).trim())) return await sock.sendMessage(chatId, { text: '❌ *Formato:* buscocarry [1-3] [motivo]\n\nIndica cuántos jugadores faltan (de 1 a 3). El aviso menciona a todos de forma oculta.' }, { quoted: msg });
            const espacios = Number(args[0]);
            const motivo = args.slice(1).join(' ').trim() || 'Carry por coordinar';
            busqueda = { solicitanteId: sender, solicitanteNombre: pushName, solicitanteEpicId: epicIdRemitente, motivo, maxEspacios: espacios, miembros: [] };
            buscoCarryActivos.set(chatId, busqueda);
            await sock.sendMessage(chatId, { text: `🔎 *BUSCO CARRY*\n🙋 ${mencionarJugador(sender, epicIdRemitente)} está buscando carry.\n🎯 *Objetivo:* ${motivo}\n\nFaltan *${espacios}* espacios.\n🛟 Para ofrecer el carry: *doycarry*\n🎮 Para unirse como otro jugador que busca carry: *x2busco*`, mentions: [...new Set([sender, ...participantesGrupo])] }, { quoted: msg });
            return;
        }
        if (!busqueda) return await sock.sendMessage(chatId, { text: '❌ No hay una búsqueda activa. Usa *buscocarry [1-3] [motivo]* primero.' }, { quoted: msg });
        if (busqueda.solicitanteId === sender) return await sock.sendMessage(chatId, { text: '❌ Tú abriste la búsqueda; no puedes unirte a ella.' }, { quoted: msg });
        if (busqueda.miembros.some(m => m.id === sender)) return await sock.sendMessage(chatId, { text: '❌ Ya estás dentro de esta búsqueda de carry.' }, { quoted: msg });
        if (busqueda.miembros.length >= busqueda.maxEspacios) return await sock.sendMessage(chatId, { text: '❌ El escuadrón ya está completo.' }, { quoted: msg });
        busqueda.miembros.push({ id: sender, nombre: pushName, epicId: epicIdRemitente, rol: comando === 'doycarry' ? 'Ofrece carry' : 'Busca carry' });
        const restantes = busqueda.maxEspacios - busqueda.miembros.length;
        if (restantes > 0) {
            await sock.sendMessage(chatId, { text: `🤝 *BUSCO CARRY: ACTUALIZACIÓN*\n${mencionarJugador(sender, epicIdRemitente, comando === 'doycarry' ? '🛟' : '🎮')} se unió (${comando === 'doycarry' ? 'ofrece el carry' : 'también busca carry'}).\n🎯 *Objetivo:* ${busqueda.motivo}\n\nFaltan *${restantes}* espacios.`, mentions: participantesGrupo }, { quoted: msg });
        } else {
            const mentions = [...new Set([busqueda.solicitanteId, ...busqueda.miembros.map(m => m.id), ...participantesGrupo])];
            let texto = `🚀 *¡ESCUADRÓN DE CARRY COMPLETO!*\n🎯 *Objetivo:* ${busqueda.motivo}\n\n🙋 Busca carry: ${mencionarJugador(busqueda.solicitanteId, busqueda.solicitanteEpicId)}\n`;
            busqueda.miembros.forEach(m => { texto += `${mencionarJugador(m.id, m.epicId, m.rol === 'Ofrece carry' ? '🛟 Ofrece carry:' : '🎮 Busca carry:')}\n`; });
            texto += '\n¡Coordínense y a jugar!';
            await sock.sendMessage(chatId, { text: texto, mentions });
            const historial = (escuadronesCompletados.get(chatId) || []).filter(s => Date.now() - s.completadoEn < DURACION_CARRY_COMPLETO);
            historial.push({ motivo: busqueda.motivo, liderId: busqueda.solicitanteId, liderEpicId: busqueda.solicitanteEpicId, miembros: busqueda.miembros.map(m => ({ ...m })), completadoEn: Date.now() });
            escuadronesCompletados.set(chatId, historial);
            buscoCarryActivos.delete(chatId);
        }
        return;
    }
    if (comando === 'carryleader') {
        if (escuadron) return await sock.sendMessage(chatId, { text: `❌ Ya hay un escuadrón activo liderado por ${escuadron.liderNombre}. Usa *carryclose* para cerrarlo primero.` }, { quoted: msg });
        
        if (args.length < 1 || !/^[1-3]$/.test(String(args[0]).trim())) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Formato incorrecto*\n\nUsa: *carryleader [1-3] [motivo]*\n\nEl número indica cuántos jugadores faltan para completar el escuadrón.\n• *1* = falta 1 jugador\n• *2* = faltan 2 jugadores\n• *3* = faltan 3 jugadores'
            }, { quoted: msg });
        }

        const maxEspacios = Number(args[0]);
        args = args.slice(1);
        if (args.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Debes indicar el motivo del carry.\n\nUsa: *carryleader [1-3] [motivo]*'
            }, { quoted: msg });
        }

        const motivo = args.join(' ');
        
        escuadronesActivos.set(chatId, {
            liderId: sender,
            liderNombre: pushName,
            liderEpicId: epicIdRemitente,
            motivo: motivo,
            maxEspacios: maxEspacios,
            miembros: [] 
        });
        
        await sock.sendMessage(chatId, { 
            text: `📢 *NUEVO CARRY DISPONIBLE*\n👑 ${mencionarJugador(sender, epicIdRemitente)} ha creado un escuadrón.\n🎯 *Objetivo:* ${motivo}\n\nFaltan *${maxEspacios}* espacios. Usa *carryjoin* para unirte.`,
            mentions: participantesGrupo
        }, { quoted: msg });

    } else if (comando === 'carryjoin') {
        if (!escuadron) return await sock.sendMessage(chatId, { text: `❌ No hay ningún escuadrón activo. Usa *carryleader* primero.` }, { quoted: msg });
        if (escuadron.liderId === sender) return await sock.sendMessage(chatId, { text: `❌ Eres el líder, ya estás en el escuadrón.` }, { quoted: msg });
        if (escuadron.miembros.some(m => m.id === sender)) return await sock.sendMessage(chatId, { text: `❌ Ya estás dentro de este escuadrón.` }, { quoted: msg });
        
        escuadron.miembros.push({ id: sender, nombre: pushName, epicId: epicIdRemitente });
        const espaciosRestantes = escuadron.maxEspacios - escuadron.miembros.length;

        if (espaciosRestantes > 0) {
            await sock.sendMessage(chatId, { 
                text: `📢 *ACTUALIZACIÓN DE CARRY*\n✅ ${mencionarJugador(sender, epicIdRemitente)} se unió al escuadrón para *${escuadron.motivo}*.\n\nFaltan *${espaciosRestantes}* espacios.`,
                mentions: participantesGrupo
            }, { quoted: msg });
        } else {
            let mencionesSquad = [escuadron.liderId, ...escuadron.miembros.map(m => m.id)];
            let todasLasMenciones = [...new Set([...mencionesSquad, ...participantesGrupo])];
            
            let textoLleno = `🚀 *¡ESCUADRÓN LLENO!*\n🎯 *Objetivo:* ${escuadron.motivo}\n\n👑 Líder: ${mencionarJugador(escuadron.liderId, escuadron.liderEpicId)}\n`;
            
            escuadron.miembros.forEach((m, i) => {
                textoLleno += `${mencionarJugador(m.id, m.epicId, '🎮 P' + (i + 2) + ':')}\n`;
            });
            textoLleno += `\n¡Listos para darle!`;

            await sock.sendMessage(chatId, { 
                text: textoLleno, 
                mentions: todasLasMenciones
            });
            const historial = (escuadronesCompletados.get(chatId) || []).filter(s => Date.now() - s.completadoEn < DURACION_CARRY_COMPLETO);
            historial.push({ motivo: escuadron.motivo, liderId: escuadron.liderId, liderEpicId: escuadron.liderEpicId, miembros: escuadron.miembros.map(m => ({ ...m })), completadoEn: Date.now() });
            escuadronesCompletados.set(chatId, historial);
            escuadronesActivos.delete(chatId); 
        }

    } else if (comando === 'carryleave') {
        if (!chatId.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, { text: '❌ Este comando solo funciona en grupos.' }, { quoted: msg });
        }
        if (!escuadron) {
            return await sock.sendMessage(chatId, { text: '❌ No hay ningún escuadrón activo del que puedas salir.' }, { quoted: msg });
        }
        const index = escuadron.miembros.findIndex(m => m.id === sender);
        if (index === -1) {
            return await sock.sendMessage(chatId, { text: '❌ No estás unido a este escuadrón. El líder no puede abandonarlo con este comando; debe usar *carryclose* para cerrarlo.' }, { quoted: msg });
        }
        escuadron.miembros.splice(index, 1);
        const espaciosRestantes = escuadron.maxEspacios - escuadron.miembros.length;
        await sock.sendMessage(chatId, {
            text: `🚪 *${pushName}* salió del escuadrón. Quedan *${espaciosRestantes}* espacios disponibles.`
        }, { quoted: msg });

    } else if (comando === 'carryclose') {
        if (!escuadron) return await sock.sendMessage(chatId, { text: `❌ No hay escuadrones activos.` }, { quoted: msg });
        if (escuadron.liderId !== sender) return await sock.sendMessage(chatId, { text: `❌ Solo el líder (${escuadron.liderNombre}) puede cerrar el escuadrón.` }, { quoted: msg });
        
        escuadronesActivos.delete(chatId);
        await sock.sendMessage(chatId, { text: `🛑 Has cancelado el escuadrón.` }, { quoted: msg });
    }
}

module.exports = { comandoCarry };