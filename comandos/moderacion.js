const { User, Config } = require('../database/modelos');
const { esPrivilegiadoTotal } = require('../utils/whatsapp');

// Memoria temporal para los mutes activos
const mutesActivos = new Map();
// Memoria temporal para el anti-spam (Key: chatId_remitente -> Array de timestamps)
const spamRegistro = new Map();
const cacheListaBlanca = { valor: null, expira: 0 };

async function esAdmin(sock, chatId, userId) {
    if (esPrivilegiadoTotal(userId)) return true;

    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participante = groupMetadata.participants.find(p => p.id === userId);
        return participante && (participante.admin === 'admin' || participante.admin === 'superadmin');
    } catch (error) {
        return false;
    }
}

function obtenerObjetivo(msg, args = []) {
    const citado = msg.message?.extendedTextMessage?.contextInfo;
    const mencionadoPorEtiqueta = citado?.mentionedJid?.[0];
    const mencionadoPorRespuesta = citado?.participant;
    
    if (mencionadoPorEtiqueta) return mencionadoPorEtiqueta;
    if (mencionadoPorRespuesta) return mencionadoPorRespuesta;

    if (args && args.length > 0) {
        const textoUnido = args.join('');
        const numeros = textoUnido.replace(/[^0-9]/g, '');
        if (numeros.length > 5) {
            return `${numeros}@s.whatsapp.net`;
        }
    }
    return null;
}

// Banear, guardar motivo y expulsar de todos los grupos
async function banearYExpulsar(sock, userId, motivo = 'Baneado por un administrador') {
    const cleanId = userId.includes('@') ? userId : `${userId.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    
    await User.findOneAndUpdate(
        { numero: cleanId }, 
        { baneado: true, banMotivo: motivo }, 
        { upsert: true }
    );

    try {
        const grupos = await sock.groupFetchAllParticipating();
        for (const groupId in grupos) {
            const grupo = grupos[groupId];
            const esMiembro = grupo.participants.some(p => p.id === cleanId);
            if (esMiembro) {
                try {
                    await sock.groupParticipantsUpdate(groupId, [cleanId], 'remove');
                } catch (err) {
                    console.log(`No se pudo expulsar al usuario de ${grupo.subject}.`);
                }
            }
        }
    } catch (error) {
        console.log('Error al buscar grupos para expulsar:', error);
    }
}

async function verificarNuevoMiembro(sock, update) {
    if (update.action !== 'add') return;

    const chatId = update.id;
    const nuevosParticipantes = update.participants;

    // En comunidades no enviar bienvenidas a la sección de Avisos.
    try {
        const metadata = await sock.groupMetadata(chatId);
        if (metadata?.isCommunityAnnounce === true) return;
    } catch (error) {}

    const bienvenidaDesactivada = await Config.findOne({ clave: `bienvenida_desactivada_${chatId}` });
    const bienvenidaPersonalizada = await Config.findOne({ clave: `bienvenida_personalizada_${chatId}` });

    for (const participante of nuevosParticipantes) {
        const jid = typeof participante === 'string' ? participante : (participante.id || participante.phoneNumber);
        if (!jid) continue;

        let usuarioBD = await User.findOne({ numero: jid });
        if (usuarioBD && usuarioBD.baneado) {
            try {
                await sock.groupParticipantsUpdate(chatId, [jid], 'remove');
                await sock.sendMessage(chatId, {
                    text: `🚨 @${jid.split('@')[0]} está en la lista negra (Motivo: ${usuarioBD.banMotivo}) y no puede permanecer en este grupo. Expulsado automáticamente.`,
                    mentions: [jid]
                });
            } catch (error) {
                console.log('No se pudo expulsar al usuario renegado.');
            }
        } else if (!bienvenidaDesactivada || bienvenidaDesactivada.valor !== 'true') {
            try {
                const textoBienvenida = bienvenidaPersonalizada?.valor
                    ? bienvenidaPersonalizada.valor.replace(/\\{usuario\\}/gi, `@${jid.split('@')[0]}`)
                    : `Bienvenido/a @${jid.split('@')[0]} a la escupidera de Salty, esperamos que seas lo suficientemente rudo para estar aquí.`;

                await sock.sendMessage(chatId, {
                    text: textoBienvenida,
                    mentions: [jid]
                });
            } catch (error) {
                console.log('No se pudo enviar el mensaje de bienvenida.');
            }
        }
    }
}

async function comandoDesactivarBienvenida(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ Este comando solo se usa en grupos.' }, { quoted: msg });
        return;
    }

    if (!(await esAdmin(sock, chatId, msg.key.participant))) {
        await sock.sendMessage(chatId, { text: '❌ Solo los administradores del grupo pueden configurar la bienvenida.' }, { quoted: msg });
        return;
    }

    await Config.findOneAndUpdate(
        { clave: `bienvenida_desactivada_${chatId}` },
        { valor: 'true' },
        { upsert: true }
    );

    await sock.sendMessage(chatId, { text: '🔕 Bienvenida desactivada en este grupo.\n\nPara volver a activarla, usa *activarbienvenida*.' }, { quoted: msg });
}

async function comandoActivarBienvenida(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) return;
    if (!(await esAdmin(sock, chatId, msg.key.participant))) return;

    await Config.deleteOne({ clave: `bienvenida_desactivada_${chatId}` });
    await sock.sendMessage(chatId, { text: '🔔 Bienvenida activada. Se usará el mensaje personalizado si existe; de lo contrario, el mensaje por defecto.' }, { quoted: msg });
}

async function comandoPersonalizarBienvenida(sock, chatId, msg, texto) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ Este comando solo se usa en grupos.' }, { quoted: msg });
        return;
    }

    if (!(await esAdmin(sock, chatId, msg.key.participant))) {
        await sock.sendMessage(chatId, { text: '❌ Solo los administradores del grupo pueden personalizar la bienvenida.' }, { quoted: msg });
        return;
    }

    const mensaje = (texto || '').trim();
    if (!mensaje) {
        await sock.sendMessage(chatId, { text: '❌ Escribe el mensaje después del comando.\nEjemplo: *personalizarbienvenida Hola {usuario}, bienvenido al grupo ❤️*\n\nPuedes usar *{usuario}* para mencionar automáticamente al nuevo integrante.' }, { quoted: msg });
        return;
    }

    await Config.findOneAndUpdate(
        { clave: `bienvenida_personalizada_${chatId}` },
        { valor: mensaje },
        { upsert: true }
    );
    await Config.deleteOne({ clave: `bienvenida_desactivada_${chatId}` });

    await sock.sendMessage(chatId, { text: '✅ Bienvenida personalizada guardada y activada.\nUsa *{usuario}* donde quieras mencionar al nuevo integrante.' }, { quoted: msg });
}

async function comandoRestaurarBienvenida(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) return;
    if (!(await esAdmin(sock, chatId, msg.key.participant))) return;

    await Config.deleteOne({ clave: `bienvenida_personalizada_${chatId}` });
    await Config.deleteOne({ clave: `bienvenida_desactivada_${chatId}` });
    await sock.sendMessage(chatId, { text: '🔄 Bienvenida restaurada al mensaje por defecto.' }, { quoted: msg });
}

function normalizarLinkListaBlanca(link) {
    // Compatibilidad con entradas antiguas que hayan quedado como objetos.
    if (link && typeof link === 'object') {
        link = link.url || link.link || link.href || '';
    }
    return String(link || '').trim().replace(/[),.;!?]+$/g, '').toLowerCase();
}

function obtenerInfoURLListaBlanca(valor) {
    const normalizado = normalizarLinkListaBlanca(valor);
    if (!normalizado) return null;

    const conProtocolo = /^(?:https?:\/\/)/i.test(normalizado)
        ? normalizado
        : `https://${normalizado}`;

    try {
        const url = new URL(conProtocolo);
        let hostname = (url.hostname || '').toLowerCase();
        if (hostname.startsWith('www.')) hostname = hostname.slice(4);
        if (!hostname) return null;

        const entradaSinProtocolo = normalizado.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
        const resto = entradaSinProtocolo.split('/')[0].split('?')[0].split('#')[0];
        const esDominioCompleto = resto === entradaSinProtocolo && url.pathname === '/' && !url.search && !url.hash;

        return {
            normalizado,
            hostname,
            pathname: url.pathname || '/',
            search: url.search || '',
            hash: url.hash || '',
            esDominioCompleto
        };
    } catch (error) {
        return null;
    }
}

function linkPermitidoPorListaBlanca(linkDetectado, listaBlanca) {
    const detectado = obtenerInfoURLListaBlanca(linkDetectado);
    if (!detectado) return false;

    return listaBlanca.some(entrada => {
        const permitida = obtenerInfoURLListaBlanca(entrada);
        if (!permitida) return false;

        // Una entrada como "betomaster.com" o "https://betomaster.com"
        // autoriza todo el dominio, incluyendo rutas y subdominios.
        if (permitida.esDominioCompleto) {
            return detectado.hostname === permitida.hostname
                || detectado.hostname.endsWith(`.${permitida.hostname}`);
        }

        const base = permitida.normalizado;
        return detectado.normalizado === base
            || detectado.normalizado.startsWith(`${base}/`)
            || detectado.normalizado.startsWith(`${base}?`)
            || detectado.normalizado.startsWith(`${base}#`);
    });
}

async function obtenerLinksListaBlanca() {
    if (cacheListaBlanca.valor && cacheListaBlanca.expira > Date.now()) {
        return cacheListaBlanca.valor;
    }
    const config = await Config.findOne({ clave: 'links_lista_blanca' }).lean();
    if (!config?.valor) {
        cacheListaBlanca.valor = [];
        cacheListaBlanca.expira = Date.now() + 5000;
        return [];
    }
    try {
        const lista = JSON.parse(config.valor);
        const normalizada = Array.isArray(lista) ? lista.map(normalizarLinkListaBlanca) : [];
        cacheListaBlanca.valor = normalizada;
        cacheListaBlanca.expira = Date.now() + 5000;
        return normalizada;
    } catch (error) {
        cacheListaBlanca.valor = [];
        cacheListaBlanca.expira = Date.now() + 5000;
        return [];
    }
}

async function comandoListaBlancaLinks(sock, chatId, msg, args = []) {
    const esGrupo = chatId.endsWith('@g.us');
    const remitente = msg.key.participant || chatId;
    if (esGrupo && !msg.key.fromMe && !(await esAdmin(sock, chatId, remitente))) {
        await sock.sendMessage(chatId, { text: '❌ Solo los administradores pueden gestionar la lista blanca de links.' }, { quoted: msg });
        return;
    }
    const accion = (args[0] || '').toLowerCase();
    const link = normalizarLinkListaBlanca(args.slice(1).join(' '));
    if (!accion || accion === 'ayuda') {
        await sock.sendMessage(chatId, { text: '🟢 *LISTA BLANCA DE LINKS*\n\nGuarda links concretos o dominios completos.\n\n➕ *listablanca agregar [link o dominio]*\nEjemplo de dominio completo: *listablanca agregar betomaster.com*\nEso permitirá *https://betomaster.com/cualquier/ruta* y sus subdominios.\n\nEjemplo de link concreto: *listablanca agregar https://ejemplo.com/ruta*\n\n➖ *listablanca quitar [link o dominio]*\n👀 *listablanca ver*\n🧹 *listablanca vaciar*' }, { quoted: msg });
        return;
    }
    if (accion === 'ver') {
        const lista = await obtenerLinksListaBlanca();
        const texto = lista.length ? `🟢 *LINKS EN LISTA BLANCA* (${lista.length}):\n\n${lista.map((l, i) => `*${i + 1}.* ${l}`).join('\n')}` : '🟢 La lista blanca de links está vacía.';
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
        return;
    }
    if (accion === 'vaciar') {
        await Config.deleteOne({ clave: 'links_lista_blanca' });
        cacheListaBlanca.valor = [];
        cacheListaBlanca.expira = Date.now() + 5000;
        await sock.sendMessage(chatId, { text: '🧹 Lista blanca de links vaciada.' }, { quoted: msg });
        return;
    }
    const accionesAgregar = ['agregar', 'añadir', 'add'];
    const accionesQuitar = ['quitar', 'eliminar', 'remove'];
    if (!accionesAgregar.includes(accion) && !accionesQuitar.includes(accion)) {
        await sock.sendMessage(chatId, { text: '❌ Acción no válida. Usa: *listablanca agregar [link]*, *quitar [link]*, *ver* o *vaciar*.' }, { quoted: msg });
        return;
    }
    if (!link) {
        await sock.sendMessage(chatId, { text: '❌ Debes indicar el link.\nEjemplo: *listablanca agregar https://ejemplo.com/*' }, { quoted: msg });
        return;
    }
    const listaActual = await obtenerLinksListaBlanca();
    if (accionesAgregar.includes(accion)) {
        if (listaActual.includes(link)) {
            await sock.sendMessage(chatId, { text: 'ℹ️ Ese link ya está en la lista blanca.' }, { quoted: msg });
            return;
        }
        listaActual.push(link);
        await Config.findOneAndUpdate({ clave: 'links_lista_blanca' }, { valor: JSON.stringify(listaActual) }, { upsert: true });
        cacheListaBlanca.valor = listaActual;
        cacheListaBlanca.expira = Date.now() + 5000;
        await sock.sendMessage(chatId, { text: `✅ Link agregado a la lista blanca.\n\n🔗 ${link}\n\nAhora ese link no será borrado por el anti-links.` }, { quoted: msg });
        return;
    }
    // También permite quitar por número: *listablanca quitar 1*
    // Esto es útil para eliminar una entrada directamente desde la lista mostrada.
    const numeroEntrada = Number(args[1]);
    let indice = -1;
    if (Number.isInteger(numeroEntrada) && numeroEntrada >= 1 && numeroEntrada <= listaActual.length) {
        indice = numeroEntrada - 1;
    } else {
        indice = listaActual.indexOf(link);
    }

    if (indice === -1) {
        await sock.sendMessage(chatId, { text: '❌ Esa entrada no está en la lista blanca. Puedes usar *listablanca quitar 1* para quitarla por número.' }, { quoted: msg });
        return;
    }

    const linkEliminado = listaActual[indice];
    listaActual.splice(indice, 1);
    if (listaActual.length === 0) {
        await Config.deleteOne({ clave: 'links_lista_blanca' });
    } else {
        await Config.findOneAndUpdate({ clave: 'links_lista_blanca' }, { valor: JSON.stringify(listaActual) }, { upsert: true });
    }
    cacheListaBlanca.valor = listaActual;
    cacheListaBlanca.expira = Date.now() + 5000;
    await sock.sendMessage(chatId, { text: `✅ Link eliminado de la lista blanca.\n\n🔗 ${linkEliminado || link}` }, { quoted: msg });
}

async function verificarLinkDeMismaComunidad(sock, msg, texto) {
    const chatJid = msg.key.remoteJid;
    if (!chatJid.endsWith('@g.us')) return false;

    // No hacemos consultas a WhatsApp si el mensaje no contiene una mención de grupo
    // ni un enlace de invitación de grupo.
    const groupMentions = msg.message?.extendedTextMessage?.contextInfo?.groupMentions || [];
    const invitaciones = String(texto || '').match(/(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/gi) || [];
    if (groupMentions.length === 0 && invitaciones.length === 0) return false;

    try {
        const metadataActual = await sock.groupMetadata(chatJid);
        const comunidadActual = metadataActual?.linkedParent;
        if (!comunidadActual) return false;

        // WhatsApp puede enviar una mención de grupo mediante groupMentions.
        for (const mencion of groupMentions) {
            const grupoMencionado = mencion?.groupJid || mencion?.jid || mencion?.groupId;
            if (!grupoMencionado) continue;

            try {
                const metadataMencionado = await sock.groupMetadata(grupoMencionado);
                if (metadataMencionado?.linkedParent === comunidadActual) return true;
            } catch (e) {}
        }

        // También contempla cuando el grupo se comparte mediante su enlace de invitación.
        for (const invitacion of invitaciones) {
            const codigo = invitacion.split('/').pop();
            if (!codigo) continue;

            try {
                const info = await sock.groupGetInviteInfo(codigo);
                if (info?.linkedParent === comunidadActual) return true;
            } catch (e) {}
        }
    } catch (e) {}

    return false;
}

async function verificarAntiLinks(sock, msg) {
    const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || msg.message?.documentMessage?.caption || '';
    const remitente = msg.key.participant || msg.key.remoteJid;
    const chatJid = msg.key.remoteJid;
    if (!chatJid.endsWith('@g.us')) return false;

    if (await verificarLinkDeMismaComunidad(sock, msg, texto)) return false;

    // Los administradores del grupo, incluido el usuario con privilegios totales,
    // quedan fuera de la moderación de enlaces.
    if (await esAdmin(sock, chatJid, remitente)) return false;

    const regexLink = /(?:https?:\/\/|www\.)[^\s]+|(?:chat\.whatsapp\.com|wa\.me|t\.me)\/[^\s]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;
    const coincidencias = texto.match(regexLink) || [];
    if (coincidencias.length === 0) return false;

    const listaBlanca = await obtenerLinksListaBlanca();
    const linksNoPermitidos = coincidencias.filter(linkDetectado => {
        return !linkPermitidoPorListaBlanca(linkDetectado, listaBlanca);
    });
    if (linksNoPermitidos.length === 0) return false;

    try {
        await sock.sendMessage(chatJid, { delete: msg.key });
    } catch (error) {
        console.log(`No se pudo borrar el mensaje con link en ${chatJid}: ${error?.message || error}`);
    }

    let usuarioBD = await User.findOne({ numero: remitente });
    if (!usuarioBD) usuarioBD = await User.create({ numero: remitente, warns: [] });
    if (!Array.isArray(usuarioBD.warns)) usuarioBD.warns = [];
    usuarioBD.warns.push({ motivo: 'Envío de enlaces no autorizados', fecha: new Date() });
    usuarioBD.markModified('warns');
    const totalWarns = usuarioBD.warns.length;
    let mensajeAviso = `⚠️ @${remitente.split('@')[0]} Enviar enlaces no autorizados está prohibido.\n📌 *Advertencias:* ${totalWarns}/3`;
    if (totalWarns >= 3) {
        await banearYExpulsar(sock, remitente, 'Acumulación de 3 advertencias por enlaces no autorizados');
        mensajeAviso += '\n\n🚨 *Límite alcanzado:* El usuario ha sido agregado a la lista negra y expulsado de todos los grupos.';
    }
    await usuarioBD.save();
    await sock.sendMessage(chatJid, { text: mensajeAviso, mentions: [remitente] });
    return true;
}
// 🛡️ Filtro Anti-Spam Automático
async function verificarAntiSpam(sock, msg) {
    const chatJid = msg.key.remoteJid;
    if (!chatJid.endsWith('@g.us')) return false;
    
    const remitente = msg.key.participant || chatJid;
    if (await esAdmin(sock, chatJid, remitente)) return false;

    const ahora = Date.now();
    const key = `${chatJid}_${remitente}`;

    if (!spamRegistro.has(key)) {
        spamRegistro.set(key, []);
    }

    let timestamps = spamRegistro.get(key);
    timestamps = timestamps.filter(t => ahora - t < 5000);
    timestamps.push(ahora);
    spamRegistro.set(key, timestamps);

    if (timestamps.length >= 7) {
        spamRegistro.set(key, []);

        try {
            await sock.sendMessage(chatJid, { delete: msg.key });
        } catch (e) {}

        let usuarioBD = await User.findOne({ numero: remitente });
        if (!usuarioBD) {
            usuarioBD = await User.create({ numero: remitente, warns: [] });
        }
        if (!Array.isArray(usuarioBD.warns)) usuarioBD.warns = [];

        usuarioBD.warns.push({ motivo: 'Spam detectado (7 mensajes en 5 segundos)', fecha: new Date() });
        usuarioBD.markModified('warns');
        const totalWarns = usuarioBD.warns.length;

        let mensajeAviso = `⚠️ @${remitente.split('@')[0]} estás enviando mensajes demasiado rápido (Spam).\n` +
                           `📌 *Advertencias:* ${totalWarns}/3`;

        if (totalWarns >= 3) {
            await banearYExpulsar(sock, remitente, 'Acumulación de 3 advertencias por spam');
            mensajeAviso += `\n\n🚨 *Límite alcanzado:* El usuario ha sido baneado y expulsado por spam.`;
        }

        await usuarioBD.save();
        await sock.sendMessage(chatJid, { text: mensajeAviso, mentions: [remitente] });
        return true;
    }

    return false;
}

async function comandoWarn(sock, numero, msg, args = []) {
    const chatJid = msg.key.remoteJid;
    if (!chatJid.endsWith('@g.us')) {
        await sock.sendMessage(chatJid, { text: '❌ Este comando solo se usa en grupos.' }, { quoted: msg });
        return;
    }

    const remitente = msg.key.participant;
    if (!msg.key.fromMe && !(await esAdmin(sock, chatJid, remitente))) {
        await sock.sendMessage(chatJid, { text: '❌ Solo los administradores pueden usar este comando.' }, { quoted: msg });
        return;
    }

    const objetivo = obtenerObjetivo(msg, args);

    if (!objetivo) {
        await sock.sendMessage(chatJid, { text: '❌ Debes etiquetar a alguien o responder al mensaje. Ejemplo:\nwarn @usuario motivo' }, { quoted: msg });
        return;
    }

    const citado = msg.message?.extendedTextMessage?.contextInfo;
    let motivo = 'Sin motivo especificado';
    if (citado?.mentionedJid?.[0]) {
        const motivoArgs = args.slice(1).join(' ');
        if (motivoArgs) motivo = motivoArgs;
    } else if (args && args.length > 0) {
        motivo = args.join(' ');
    }

    let usuarioBD = await User.findOne({ numero: objetivo });
    if (!usuarioBD) {
        usuarioBD = await User.create({ numero: objetivo, warns: [] });
    }

    if (!Array.isArray(usuarioBD.warns)) usuarioBD.warns = [];

    usuarioBD.warns.push({ motivo, fecha: new Date() });
    usuarioBD.markModified('warns');
    const totalWarns = usuarioBD.warns.length;

    let respuesta = `⚠️ *ADVERTENCIA REGISTRADA*\n\n` +
                    `👤 Usuario: @${objetivo.split('@')[0]}\n` +
                    `📝 Motivo: ${motivo}\n` +
                    `📌 Total: ${totalWarns}/3`;

    if (totalWarns >= 3) {
        await banearYExpulsar(sock, objetivo, `Acumulación de 3 warns (Última razón: ${motivo})`);
        respuesta += `\n\n🚨 *Límite alcanzado:* El usuario alcanzó los 3 warns, fue baneado y expulsado de los grupos.`;
    }

    await usuarioBD.save();
    await sock.sendMessage(chatJid, { text: respuesta, mentions: [objetivo] }, { quoted: msg });
}

async function comandoLimpiarWarns(sock, numero, msg, args = []) {
    const chatJid = msg.key.remoteJid;
    const remitente = msg.key.participant || chatJid;
    if (chatJid.endsWith('@g.us') && !msg.key.fromMe && !(await esAdmin(sock, chatJid, remitente))) {
        await sock.sendMessage(chatJid, { text: '❌ Solo los administradores pueden limpiar los warns.' }, { quoted: msg });
        return;
    }
    const objetivo = obtenerObjetivo(msg, args);
    if (!objetivo) {
        await sock.sendMessage(chatJid, { text: '❌ Debes mencionar o responder al usuario al que quieres limpiar los warns.\nEjemplo: *limpiarwarns @usuario*' }, { quoted: msg });
        return;
    }
    const usuarioBD = await User.findOne({ numero: objetivo });
    if (!usuarioBD) {
        await sock.sendMessage(chatJid, { text: `ℹ️ @${objetivo.split('@')[0]} no tiene un registro de usuario ni warns.`, mentions: [objetivo] }, { quoted: msg });
        return;
    }
    usuarioBD.warns = [];
    usuarioBD.markModified('warns');
    await usuarioBD.save();
    await sock.sendMessage(chatJid, { text: `✅ Se borraron todos los warns de @${objetivo.split('@')[0]}.\n📌 Warns actuales: *0/3*`, mentions: [objetivo] }, { quoted: msg });
}

async function comandoVerWarns(sock, numero, msg, args = []) {
    const chatJid = msg.key.remoteJid;
    const objetivo = obtenerObjetivo(msg, args) || msg.key.participant || chatJid;

    let usuarioBD = await User.findOne({ numero: objetivo });
    if (!usuarioBD || !Array.isArray(usuarioBD.warns) || usuarioBD.warns.length === 0) {
        await sock.sendMessage(chatJid, { text: `✅ El usuario @${objetivo.split('@')[0]} no tiene advertencias registradas.`, mentions: [objetivo] }, { quoted: msg });
        return;
    }

    let historial = `📋 *HISTORIAL DE ADVERTENCIAS*\n` +
                    `👤 Usuario: @${objetivo.split('@')[0]}\n` +
                    `📌 Total: ${usuarioBD.warns.length}/3\n\n`;

    usuarioBD.warns.forEach((w, index) => {
        const fechaFormateada = new Date(w.fecha || Date.now()).toLocaleDateString();
        historial += `*${index + 1}.* ${w.motivo} _(${fechaFormateada})_\n`;
    });

    await sock.sendMessage(chatJid, { text: historial, mentions: [objetivo] }, { quoted: msg });
}

async function comandoBan(sock, numero, msg, args = []) {
    const chatJid = msg.key.remoteJid;
    if (chatJid.endsWith('@g.us') && !msg.key.fromMe && !(await esAdmin(sock, chatJid, msg.key.participant))) {
        await sock.sendMessage(chatJid, { text: '❌ Solo los administradores pueden banear.' }, { quoted: msg });
        return;
    }

    const objetivo = obtenerObjetivo(msg, args);
    if (!objetivo) {
        await sock.sendMessage(chatJid, { text: '❌ Etiqueta o responde al mensaje de quien deseas banear con un motivo. Ejemplo:\nban @usuario Motivo aquí' }, { quoted: msg });
        return;
    }

    let motivo = 'Baneado por un administrador';
    const citado = msg.message?.extendedTextMessage?.contextInfo;
    if (citado?.mentionedJid?.[0]) {
        const motivoArgs = args.slice(1).join(' ');
        if (motivoArgs) motivo = motivoArgs;
    } else if (citado?.participant && args.length > 0) {
        motivo = args.join(' ');
    } else if (!citado && args.length > 1) {
        motivo = args.slice(1).join(' ');
    }

    await banearYExpulsar(sock, objetivo, motivo);
    await sock.sendMessage(chatJid, { text: `🚫 El usuario @${objetivo.split('@')[0]} fue agregado a la lista negra.\n📝 Motivo: _${motivo}_`, mentions: [objetivo] }, { quoted: msg });
}

async function comandoUnban(sock, numero, msg, args = []) {
    const chatJid = msg.key.remoteJid;
    if (chatJid.endsWith('@g.us') && !msg.key.fromMe && !(await esAdmin(sock, chatJid, msg.key.participant))) {
        await sock.sendMessage(chatJid, { text: '❌ Solo los administradores pueden desbanear.' }, { quoted: msg });
        return;
    }

    const objetivo = obtenerObjetivo(msg, args);
    if (!objetivo) {
        await sock.sendMessage(chatJid, { text: '❌ Etiqueta o responde al mensaje de quien deseas desbanear. Ejemplo:\nunban @usuario' }, { quoted: msg });
        return;
    }

    await User.findOneAndUpdate({ numero: objetivo }, { baneado: false, warns: [], banMotivo: '' });
    await sock.sendMessage(chatJid, { text: `✅ El usuario @${objetivo.split('@')[0]} fue removido de la lista negra y se limpiaron sus warns.`, mentions: [objetivo] }, { quoted: msg });
}

async function comandoListaNegra(sock, numero, msg) {
    const chatJid = msg.key.remoteJid;
    const remitente = msg.key.participant || chatJid;
    
    if (chatJid.endsWith('@g.us') && !msg.key.fromMe && !(await esAdmin(sock, chatJid, remitente))) {
        await sock.sendMessage(chatJid, { text: '❌ Solo los administradores pueden ver la lista negra.' }, { quoted: msg });
        return;
    }

    const baneados = await User.find({ baneado: true });
    
    if (!baneados || baneados.length === 0) {
        await sock.sendMessage(chatJid, { text: '📋 La lista negra está vacía actualmente.' }, { quoted: msg });
        return;
    }

    let texto = `🚫 *LISTA NEGRA (BANEADOS)* (${baneados.length}):\n\n`;
    const mentions = [];
    
    baneados.forEach((b, index) => {
        const numeroLimpio = b.numero.split('@')[0];
        const motivo = b.banMotivo || 'Sin motivo especificado';
        texto += `*${index + 1}.* @${numeroLimpio}\n   📝 Motivo: _${motivo}_y\n\n`;
        mentions.push(b.numero);
    });

    texto += `💡 Usa *unbanlist [número]* para desbanear por índice (Ej: unbanlist 2)`;

    await sock.sendMessage(chatJid, { text: texto, mentions }, { quoted: msg });
}

async function comandoUnbanList(sock, numero, msg, args = []) {
    const chatJid = msg.key.remoteJid;
    const remitente = msg.key.participant || chatJid;

    if (chatJid.endsWith('@g.us') && !msg.key.fromMe && !(await esAdmin(sock, chatJid, remitente))) {
        await sock.sendMessage(chatJid, { text: '❌ Solo los administradores pueden usar este comando.' }, { quoted: msg });
        return;
    }

    const indexArg = args[0];
    const numeroIndice = parseInt(indexArg);

    if (isNaN(numeroIndice)) {
        await sock.sendMessage(chatJid, { text: '❌ Debes indicar el número de la lista negra. Ejemplo:\nunbanlist 2' }, { quoted: msg });
        return;
    }

    const baneados = await User.find({ baneado: true });

    if (numeroIndice < 1 || numeroIndice > baneados.length) {
        await sock.sendMessage(chatJid, { text: `❌ Número inválido. Hay ${baneados.length} usuarios en la lista negra actualmente.` }, { quoted: msg });
        return;
    }

    const usuarioObjetivo = baneados[numeroIndice - 1];
    usuarioObjetivo.baneado = false;
    usuarioObjetivo.warns = [];
    usuarioObjetivo.banMotivo = '';
    await usuarioObjetivo.save();

    const numeroLimpio = usuarioObjetivo.numero.split('@')[0];
    
    // CORREGIDO: Se cambió 'chatId' por 'chatJid'
    await sock.sendMessage(chatJid, { 
        text: `✅ El usuario @${numeroLimpio} (posición #${numeroIndice}) fue removido de la lista negra y sus advertencias se reiniciaron.`, 
        mentions: [usuarioObjetivo.numero] 
    }, { quoted: msg });
}

// 🔒 Abrir / Cerrar Grupo
async function comandoGrupo(sock, chatId, msg, args) {
    if (!(await esAdmin(sock, chatId, msg.key.participant))) {
        await sock.sendMessage(chatId, { text: '❌ Solo los administradores pueden usar este comando.' }, { quoted: msg });
        return;
    }
    const accion = args[0]?.toLowerCase();
    if (accion === 'cerrar') {
        await sock.groupSettingUpdate(chatId, 'announcement');
        await sock.sendMessage(chatId, { text: '🔒 *Grupo cerrado.* Ahora solo los administradores pueden enviar mensajes.' }, { quoted: msg });
    } else if (accion === 'abrir') {
        await sock.groupSettingUpdate(chatId, 'not_announcement');
        await sock.sendMessage(chatId, { text: '🔓 *Grupo abierto.* Todos los participantes pueden enviar mensajes.' }, { quoted: msg });
    } else {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `grupo cerrar` o `grupo abrir`.' }, { quoted: msg });
    }
}

// 🔇 Mute / Unmute
async function comandoMute(sock, chatId, msg, args) {
    if (!(await esAdmin(sock, chatId, msg.key.participant))) return;
    const objetivo = obtenerObjetivo(msg, args);
    if (!objetivo) {
        await sock.sendMessage(chatId, { text: '⚠️ Debes mencionar o responder al usuario que deseas mutear.' }, { quoted: msg });
        return;
    }
    const tiempoMinutos = parseInt(args[1]) || 30;
    const expira = Date.now() + (tiempoMinutos * 60 * 1000);
    mutesActivos.set(`${chatId}_${objetivo}`, expira);
    await sock.sendMessage(chatId, { text: `🔇 Usuario muteado durante ${tiempoMinutos} minutos.` }, { quoted: msg });
}

async function comandoUnmute(sock, chatId, msg, args) {
    if (!(await esAdmin(sock, chatId, msg.key.participant))) return;
    const objetivo = obtenerObjetivo(msg, args);
    if (!objetivo) {
        await sock.sendMessage(chatId, { text: '⚠️ Debes mencionar o responder al usuario.' }, { quoted: msg });
        return;
    }
    mutesActivos.delete(`${chatId}_${objetivo}`);
    await sock.sendMessage(chatId, { text: '🔊 Usuario desmuteado con éxito.' }, { quoted: msg });
}

function verificarMute(chatId, remitente) {
    const key = `${chatId}_${remitente}`;
    if (mutesActivos.has(key)) {
        const expira = mutesActivos.get(key);
        if (Date.now() < expira) return true;
        else mutesActivos.delete(key);
    }
    return false;
}

// 👥 Inactivos
async function comandoInactivos(sock, chatId, msg) {
    if (!(await esAdmin(sock, chatId, msg.key.participant))) return;
    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        await sock.sendMessage(chatId, { text: `👥 El grupo cuenta actualmente con *${groupMetadata.participants.length}* miembros registrados.` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ No se pudo obtener la lista de miembros.' }, { quoted: msg });
    }
}

module.exports = { 
    verificarAntiLinks, 
    verificarAntiSpam,
    comandoListaBlancaLinks,
    comandoWarn, 
    comandoLimpiarWarns,
    comandoVerWarns, 
    comandoBan, 
    comandoUnban, 
    verificarNuevoMiembro, 
    comandoListaNegra, 
    comandoUnbanList,
    comandoGrupo,
    comandoMute,
    comandoUnmute,
    verificarMute,
    comandoInactivos,
    comandoDesactivarBienvenida,
    comandoActivarBienvenida,
    comandoPersonalizarBienvenida,
    comandoRestaurarBienvenida
};