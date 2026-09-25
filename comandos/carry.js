const { Config } = require('../database/modelos');
const { esPrivilegiadoTotalAsync } = require('../utils/whatsapp');
const escuadronesActivos = new Map();

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

    let escuadron = escuadronesActivos.get(chatId);

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

    let participantesGrupo = [];
    if (chatId.endsWith('@g.us') && (comando === 'carryleader' || comando === 'carryjoin')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            participantesGrupo = metadata.participants.map(u => u.id);
        } catch (err) {}
    }

    if (comando === 'carryleader') {
        if (escuadron) return await sock.sendMessage(chatId, { text: `❌ Ya hay un escuadrón activo liderado por ${escuadron.liderNombre}. Usa *carryclose* para cerrarlo primero.` }, { quoted: msg });
        
        let maxEspacios = 3;
        let motivo = "Salvar el Mundo";

        if (args.length > 0) {
            let ultimoArg = parseInt(args[args.length - 1]);
            if (!isNaN(ultimoArg)) {
                maxEspacios = ultimoArg;
                args.pop();
            }
            if (args.length > 0) {
                motivo = args.join(' ');
            }
        }
        
        escuadronesActivos.set(chatId, {
            liderId: sender,
            liderNombre: pushName,
            motivo: motivo,
            maxEspacios: maxEspacios,
            miembros: [] 
        });
        
        await sock.sendMessage(chatId, { 
            text: `📢 *NUEVO CARRY DISPONIBLE*\n👑 *${pushName}* ha creado un escuadrón.\n🎯 *Objetivo:* ${motivo}\n\nFaltan *${maxEspacios}* espacios. Usa *carryjoin* para unirte.`,
            mentions: participantesGrupo
        }, { quoted: msg });

    } else if (comando === 'carryjoin') {
        if (!escuadron) return await sock.sendMessage(chatId, { text: `❌ No hay ningún escuadrón activo. Usa *carryleader* primero.` }, { quoted: msg });
        if (escuadron.liderId === sender) return await sock.sendMessage(chatId, { text: `❌ Eres el líder, ya estás en el escuadrón.` }, { quoted: msg });
        if (escuadron.miembros.some(m => m.id === sender)) return await sock.sendMessage(chatId, { text: `❌ Ya estás dentro de este escuadrón.` }, { quoted: msg });
        
        escuadron.miembros.push({ id: sender, nombre: pushName });
        const espaciosRestantes = escuadron.maxEspacios - escuadron.miembros.length;

        if (espaciosRestantes > 0) {
            await sock.sendMessage(chatId, { 
                text: `📢 *ACTUALIZACIÓN DE CARRY*\n✅ *${pushName}* se unió al escuadrón para *${escuadron.motivo}*.\n\nFaltan *${espaciosRestantes}* espacios.`,
                mentions: participantesGrupo
            }, { quoted: msg });
        } else {
            let mencionesSquad = [escuadron.liderId, ...escuadron.miembros.map(m => m.id)];
            let todasLasMenciones = [...new Set([...mencionesSquad, ...participantesGrupo])];
            
            let textoLleno = `🚀 *¡ESCUADRÓN LLENO!*\n🎯 *Objetivo:* ${escuadron.motivo}\n\n👑 Líder: @${escuadron.liderId.split('@')[0]}\n`;
            
            escuadron.miembros.forEach((m, i) => {
                textoLleno += `🎮 P${i+2}: @${m.id.split('@')[0]}\n`;
            });
            textoLleno += `\n¡Listos para darle!`;

            await sock.sendMessage(chatId, { 
                text: textoLleno, 
                mentions: todasLasMenciones
            });
            escuadronesActivos.delete(chatId); 
        }

    } else if (comando === 'carryleave') {
        if (!escuadron) return;
        const index = escuadron.miembros.findIndex(m => m.id === sender);
        if (index !== -1) {
            escuadron.miembros.splice(index, 1);
            const espaciosRestantes = escuadron.maxEspacios - escuadron.miembros.length;
            await sock.sendMessage(chatId, { text: `🚪 *${pushName}* salió del escuadrón. Quedan *${espaciosRestantes}* espacios.` }, { quoted: msg });
        }

    } else if (comando === 'carryclose') {
        if (!escuadron) return await sock.sendMessage(chatId, { text: `❌ No hay escuadrones activos.` }, { quoted: msg });
        if (escuadron.liderId !== sender) return await sock.sendMessage(chatId, { text: `❌ Solo el líder (${escuadron.liderNombre}) puede cerrar el escuadrón.` }, { quoted: msg });
        
        escuadronesActivos.delete(chatId);
        await sock.sendMessage(chatId, { text: `🛑 Has cancelado el escuadrón.` }, { quoted: msg });
    }
}

module.exports = { comandoCarry };