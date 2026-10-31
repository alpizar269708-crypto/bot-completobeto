const { Config } = require('../database/modelos');
const { esPrivilegiadoTotalAsync, resolverLidAPn } = require('../utils/whatsapp');
const escuadronesActivos = new Map();
const buscoCarryActivos = new Map();
const escuadronesCompletados = new Map();
const DURACION_CARRY_COMPLETO = 30 * 60 * 1000;

const seleccionesEpicPendientes = new Map();
const MAX_CUENTAS_EPIC = 4;
async function identificadoresEpic(sock, usuarioId, alternativos = []) {
 const ids=[usuarioId,...alternativos].filter(Boolean).map(String), out=[];
 for(const id of ids){const pn=await resolverLidAPn(sock,id);out.push(id,String(pn||id));}
 return [...new Set(out)];
}
async function obtenerCuentasEpic(sock, usuarioId, alternativos = []) {
 const ids=await identificadoresEpic(sock,usuarioId,alternativos), cuentas=[];
 for(let n=1;n<=MAX_CUENTAS_EPIC;n++){
  let valor=null;
  for(const id of ids){const clave=n===1?'epic_id_'+id:'epic_id_'+id+'_'+n;const r=await Config.findOne({clave}).lean();if(r?.valor){valor=String(r.valor);break;}}
  if(valor) cuentas.push({numero:n,epicId:valor});
 }
 return cuentas;
}
async function guardarEpicId(sock, usuarioId, alternativos, cuenta, epicId) {
 const ids=await identificadoresEpic(sock,usuarioId,alternativos), actuales=await obtenerCuentasEpic(sock,usuarioId,alternativos);
 const repetido=actuales.find(c=>c.numero!==cuenta&&c.epicId.toLowerCase()===epicId.toLowerCase());
 if(repetido)return {duplicado:repetido.numero};
 for(const id of ids){const clave=cuenta===1?'epic_id_'+id:'epic_id_'+id+'_'+cuenta;await Config.findOneAndUpdate({clave},{valor:epicId},{upsert:true,new:true});}
 return {};
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

async function comandoCarry(sock, chatId, msg, comando, args = [], epicIdElegido = null) {
    const sender = msg.key.participant || msg.key.remoteJid;
    const idsAlternativos = [msg.key.participantAlt, msg.key.participantPn, msg.key.senderPn];
    const pushName = msg.pushName || 'Jugador';

    if (/^id[2-4]?$/.test(comando)) {
        const cuenta = comando === 'id' ? 1 : Number(comando.slice(2));
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const epicId = texto.trim().replace(/^[*_~`]+/, '').replace(/^id[2-4]?\b/i, '').trim();
        const cuentas = await obtenerCuentasEpic(sock, sender, idsAlternativos);
        if (!epicId) {
            const lista = cuentas.length ? cuentas.map(c => `• *ID${c.numero===1?'':c.numero}:* ${c.epicId}`).join('\n') : 'Todavía no tienes cuentas registradas.';
            return await sock.sendMessage(chatId,{text:`🎮 *TUS CUENTAS DE EPIC*\n\n${lista}\n\nRegistra hasta 4 con *ID*, *ID2*, *ID3* e *ID4*, seguido del nombre de Epic.`},{quoted:msg});
        }
        if(epicId.length<2||epicId.length>64||/[@\n\r]/.test(epicId)) return await sock.sendMessage(chatId,{text:'❌ Ese ID no parece válido (máximo 64 caracteres).'}, {quoted:msg});
        const existente=cuentas.find(c=>c.epicId.toLowerCase()===epicId.toLowerCase());
        if(existente) return await sock.sendMessage(chatId,{text:`ℹ️ Ese ID ya está registrado como tu cuenta ${existente.numero===1?'principal':existente.numero}. No lo dupliqué.`},{quoted:msg});
        const guardado=await guardarEpicId(sock,sender,idsAlternativos,cuenta,epicId);
        if(guardado.duplicado) return await sock.sendMessage(chatId,{text:`⚠️ Ese ID ya está registrado en tu cuenta ${guardado.duplicado}. Cada espacio debe tener un ID diferente.`},{quoted:msg});
        return await sock.sendMessage(chatId,{text:`✅ *ID ${cuenta===1?'PRINCIPAL':cuenta+' '}GUARDADO*\n🎮 *${epicId}*\n\nPuedes registrar hasta 4 cuentas.`},{quoted:msg});
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
    if (['blcarry', 'unblcarry', 'listacarrybl'].includes(comando)) {
        if (!(await esAdminValido(sock, chatId, msg))) {
            return await sock.sendMessage(chatId, { text: '❌ Estos comandos de lista negra son exclusivos de los administradores.' }, { quoted: msg });
        }
        let configBL = await Config.findOne({ clave: `carry_bl_${chatId}` });
        let listaNegra = [];
        if (configBL?.valor) {
            try { const parsed = JSON.parse(configBL.valor); if (Array.isArray(parsed)) listaNegra = parsed; } catch (e) {}
        }
        const normalizarRegistro = item => typeof item === 'string'
            ? { id: item, motivo: 'Motivo no registrado (entrada anterior)', agregadoPor: null, agregadoPorNombre: 'No disponible' }
            : item;

        if (comando === 'listacarrybl') {
            if (!listaNegra.length) return await sock.sendMessage(chatId, { text: '📋 La lista negra de carry en este grupo está vacía.' }, { quoted: msg });
            let txt = '🚫 *LISTA NEGRA DE CARRY*\\n\\n';
            const menciones = [];
            listaNegra.forEach((item, idx) => {
                const r = normalizarRegistro(item);
                txt += `${idx + 1}. @${String(r.id).split('@')[0]}\\n   📝 *Motivo:* ${r.motivo || 'No especificado'}\\n   👮 *Agregó:* ${r.agregadoPor ? '@' + String(r.agregadoPor).split('@')[0] : (r.agregadoPorNombre || 'No disponible')}\\n\\n`;
                menciones.push(r.id);
                if (r.agregadoPor) menciones.push(r.agregadoPor);
            });
            return await sock.sendMessage(chatId, { text: txt.trim(), mentions: [...new Set(menciones)] }, { quoted: msg });
        }

        const objetivo = extraerUsuarioObjetivo(msg, args);
        if (!objetivo) return await sock.sendMessage(chatId, { text: '❌ Debes mencionar a un usuario, escribir su número o responder a un mensaje suyo. En *blcarry* también indica el motivo.' }, { quoted: msg });
        const hayRespuesta = Boolean(msg.message?.extendedTextMessage?.contextInfo?.participant);
        const motivo = (hayRespuesta ? args : args.slice(1)).join(' ').trim();

        if (comando === 'blcarry') {
            if (await esPrivilegiadoTotalAsync(sock, objetivo)) {
                return await sock.sendMessage(chatId, { text: '🛡️ Los dueños del bot están protegidos y no pueden ser agregados a la lista negra de carry.' }, { quoted: msg });
            }
            if (!motivo) return await sock.sendMessage(chatId, { text: '❌ Indica el motivo.\\n\\nEjemplo: *blcarry @usuario Abandonó varios carries sin avisar* (o responde a su mensaje y escribe el motivo).' }, { quoted: msg });
            const existente = listaNegra.map(normalizarRegistro).find(r => r.id === objetivo);
            if (existente) return await sock.sendMessage(chatId, { text: `⚠️ @${objetivo.split('@')[0]} ya está en la lista negra.\\n📝 *Motivo:* ${existente.motivo || 'No especificado'}`, mentions: [objetivo] }, { quoted: msg });
            listaNegra.push({ id: objetivo, motivo, agregadoPor: sender, agregadoPorNombre: pushName, fecha: new Date().toISOString() });
            await Config.findOneAndUpdate({ clave: `carry_bl_${chatId}` }, { valor: JSON.stringify(listaNegra) }, { upsert: true });
            return await sock.sendMessage(chatId, { text: `🚫 @${objetivo.split('@')[0]} fue agregado a la lista negra.\\n📝 *Motivo:* ${motivo}\\n👮 *Agregado por:* @${String(sender).split('@')[0]}`, mentions: [objetivo, sender] }, { quoted: msg });
        }
        if (comando === 'unblcarry') {
            const index = listaNegra.findIndex(item => normalizarRegistro(item).id === objetivo);
            if (index === -1) return await sock.sendMessage(chatId, { text: `⚠️ @${objetivo.split('@')[0]} no estaba en la lista negra.`, mentions: [objetivo] }, { quoted: msg });
            listaNegra.splice(index, 1);
            await Config.findOneAndUpdate({ clave: `carry_bl_${chatId}` }, { valor: JSON.stringify(listaNegra) }, { upsert: true });
            return await sock.sendMessage(chatId, { text: `✅ @${objetivo.split('@')[0]} fue removido de la lista negra de carry.`, mentions: [objetivo] }, { quoted: msg });
        }
        return;
    }
    // =====================================================

    // Rechazar únicamente solicitudes o uniones de carry de usuarios en lista negra.
    const comandosParaSolicitarCarry = ['carryleader', 'carryjoin', 'buscocarry', 'doycarry', 'x2busco'];
    if (comandosParaSolicitarCarry.includes(comando)) {
        let configBL = await Config.findOne({ clave: `carry_bl_${chatId}` });
        let listaNegra = [];
        if (configBL?.valor) {
            try { const parsed = JSON.parse(configBL.valor); if (Array.isArray(parsed)) listaNegra = parsed; } catch (e) {}
        }
        const esDuenoBot = await esPrivilegiadoTotalAsync(sock, sender);
        const idsRemitente = await identificadoresEpic(sock, sender, idsAlternativos);
        const registroBL = esDuenoBot ? null : listaNegra.map(item => typeof item === 'string'
            ? { id: item, motivo: 'Motivo no registrado (entrada anterior)', agregadoPor: null, agregadoPorNombre: 'No disponible' }
            : item).find(item => idsRemitente.includes(item.id));
        if (registroBL) {
            const quienAgrego = registroBL.agregadoPor
                ? '@' + String(registroBL.agregadoPor).split('@')[0]
                : (registroBL.agregadoPorNombre || 'No disponible');
            const menciones = [sender];
            if (registroBL.agregadoPor) menciones.push(registroBL.agregadoPor);
            return await sock.sendMessage(chatId, {
                text: `⛔ *SOLICITUD DE CARRY RECHAZADA*\\n\\nNo puedes crear ni unirte a carries en este grupo porque estás en la lista negra.\\n📝 *Motivo:* ${registroBL.motivo || 'No especificado'}\\n👮 *Agregado por:* ${quienAgrego}`,
                mentions: menciones
            }, { quoted: msg });
        }
    }

    const comandosConID = ['carryleader', 'carryjoin', 'buscocarry', 'doycarry', 'x2busco'];
    const cuentasEpic = await obtenerCuentasEpic(sock, sender, idsAlternativos);
    if (['carryjoin','doycarry','x2busco'].includes(comando) && cuentasEpic.length > 1 && !epicIdElegido) {
        seleccionesEpicPendientes.set(`${chatId}:${sender}`,{comando,args:[...args],cuentas:cuentasEpic,expira:Date.now()+120000});
        return await sock.sendMessage(chatId,{text:`🎮 *¿CON CUÁL CUENTA TE VAS A UNIR?*\n\n${cuentasEpic.map(c=>`${c.numero}. ${c.epicId}`).join('\n')}\n\nResponde con el número de la cuenta. Tienes 2 minutos.`},{quoted:msg});
    }
    const epicIdRemitente = epicIdElegido || cuentasEpic[0]?.epicId || null;
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
            if (!busqueda) return await sock.sendMessage(chatId, { text: '❌ No hay una búsqueda de carry activa.' }, { quoted: msg });
            if (busqueda.solicitanteId === sender) {
                buscoCarryActivos.delete(chatId);
                return await sock.sendMessage(chatId, { text: '🔒 *BUSCO CARRY CERRADO*\nLa búsqueda se cerró y ya nadie puede unirse.' }, { quoted: msg });
            }
            const indiceMiembro = busqueda.miembros.findIndex(m => m.id === sender);
            if (indiceMiembro !== -1) {
                const [saliente] = busqueda.miembros.splice(indiceMiembro, 1);
                const rol = saliente.rol === 'Ofrece carry' ? '🛟 Ofrecía el carry' : '🎮 Buscaba carry';
                return await sock.sendMessage(chatId, { text: '🚪 *SALISTE DE LA BÚSQUEDA DE CARRY*\n' + mencionarJugador(sender, saliente.epicId) + ' salió de la búsqueda.\n' + rol + '.\nQuedan *' + Math.max(0, busqueda.maxEspacios - busqueda.miembros.length) + '* espacios disponibles.' }, { quoted: msg });
            }
            return await sock.sendMessage(chatId, { text: '❌ Solo quien abrió esta búsqueda puede cerrarla. Si formas parte de ella, puedes usar *buscooff* para salir.' }, { quoted: msg });
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
        if (!escuadron) return await sock.sendMessage(chatId, { text: '❌ No hay escuadrones activos.' }, { quoted: msg });
        if (escuadron.liderId === sender) {
            escuadronesActivos.delete(chatId);
            return await sock.sendMessage(chatId, { text: '🛑 *CARRY CERRADO*\nEl líder canceló el escuadrón.' }, { quoted: msg });
        }
        const indiceMiembro = escuadron.miembros.findIndex(m => m.id === sender);
        if (indiceMiembro !== -1) {
            const [saliente] = escuadron.miembros.splice(indiceMiembro, 1);
            return await sock.sendMessage(chatId, { text: '🚪 *SALISTE DEL CARRY*\n' + mencionarJugador(sender, saliente.epicId) + ' salió del escuadrón.\nQuedan *' + Math.max(0, escuadron.maxEspacios - escuadron.miembros.length) + '* espacios disponibles.' }, { quoted: msg });
        }
        return await sock.sendMessage(chatId, { text: '❌ Solo el líder (' + escuadron.liderNombre + ') puede cerrar este carry. Si formas parte del escuadrón, puedes usar *carryclose* para salir.' }, { quoted: msg });

    }
}

async function manejarRespuestaSeleccionCarry(sock, chatId, msg, remitente, texto) {
 const clave=`${chatId}:${remitente}`, p=seleccionesEpicPendientes.get(clave);
 if(!p)return false;
 if(p.expira<=Date.now()){seleccionesEpicPendientes.delete(clave);return false;}
 const t=String(texto||'').trim(); if(!/^[1-4]$/.test(t))return false;
 const cuenta=p.cuentas.find(c=>c.numero===Number(t));
 if(!cuenta){await sock.sendMessage(chatId,{text:'❌ Ese número no corresponde a una cuenta de la lista.'},{quoted:msg});return true;}
 seleccionesEpicPendientes.delete(clave);
 await comandoCarry(sock,chatId,msg,p.comando,p.args,cuenta.epicId); return true;
}
module.exports = { comandoCarry, manejarRespuestaSeleccionCarry };