// Registro temporal en memoria de mensajes eliminados para todos.
// No se escribe contenido en MongoDB ni en archivos. Los registros expiran en 2 horas.
const VENTANA_MS = 2 * 60 * 60 * 1000;
const MAX_MENSAJES_POR_CHAT = 300;
const MAX_ELIMINADOS_POR_CHAT = 200;
const MAX_CHATS_EN_MEMORIA = 50;
const MAX_TEXTO_GUARDADO = 4000;
const MAX_MEDIA_POR_MENSAJE = 32 * 1024 * 1024;
const MAX_MEDIA_TOTAL_POR_CHAT = 64 * 1024 * 1024;
const MAX_MEDIA_TOTAL_GLOBAL = 256 * 1024 * 1024;

const mensajesPorChat = new Map();
const eliminadosPorChat = new Map();

function bytesMultimediaDelChat(chatId) {
    let total = 0;
    for (const mapa of [mensajesPorChat, eliminadosPorChat]) {
        for (const registro of (mapa.get(chatId)?.values() || [])) total += registro.mediaBytes || 0;
    }
    return total;
}

function bytesMultimediaGlobales() {
    let total = 0;
    for (const mapa of [mensajesPorChat, eliminadosPorChat]) {
        for (const registros of mapa.values()) {
            for (const registro of registros.values()) total += registro.mediaBytes || 0;
        }
    }
    return total;
}

function textoDeMensaje(message) {
    if (!message) return '';
    const contenido = message.ephemeralMessage?.message
        || message.viewOnceMessage?.message
        || message.viewOnceMessageV2?.message
        || message.documentWithCaptionMessage?.message
        || message;
    const contacto = contenido.contactMessage;
    const ubicacion = contenido.locationMessage || contenido.liveLocationMessage;
    const encuesta = contenido.pollCreationMessage || contenido.pollCreationMessageV2 || contenido.pollCreationMessageV3;
    const reaccion = contenido.reactionMessage?.text;
    const producto = contenido.productMessage?.product;
    const opcionesEncuesta = encuesta?.options?.map(o => o.optionName).filter(Boolean).join(' | ');
    const coordenadas = ubicacion && Number.isFinite(ubicacion.degreesLatitude) && Number.isFinite(ubicacion.degreesLongitude)
        ? `Ubicación: ${ubicacion.degreesLatitude}, ${ubicacion.degreesLongitude}${ubicacion.name ? ` · ${ubicacion.name}` : ''}${ubicacion.address ? ` · ${ubicacion.address}` : ''}` : '';
    return contenido.conversation
        || contenido.extendedTextMessage?.text
        || contenido.imageMessage?.caption
        || contenido.videoMessage?.caption
        || contenido.documentMessage?.caption
        || contenido.audioMessage?.caption
        || contenido.stickerMessage?.description
        || (contacto ? `Contacto: ${contacto.displayName || ''} ${contacto.vcard || ''}`.trim() : '')
        || (contenido.contactsArrayMessage ? `Contactos: ${(contenido.contactsArrayMessage.contacts || []).map(c => c.displayName || c.vcard || '').join(' | ')}` : '')
        || coordenadas
        || (encuesta ? `Encuesta: ${encuesta.name || ''}${opcionesEncuesta ? ` · Opciones: ${opcionesEncuesta}` : ''}` : '')
        || (reaccion ? `Reacción: ${reaccion}` : '')
        || (contenido.buttonsResponseMessage ? `Respuesta: ${contenido.buttonsResponseMessage.selectedDisplayText || contenido.buttonsResponseMessage.selectedButtonId || ''}` : '')
        || (contenido.listResponseMessage ? `Respuesta: ${contenido.listResponseMessage.title || ''} ${contenido.listResponseMessage.description || ''}` : '')
        || (contenido.templateButtonReplyMessage ? `Respuesta: ${contenido.templateButtonReplyMessage.selectedDisplayText || contenido.templateButtonReplyMessage.selectedId || ''}` : '')
        || (producto ? `Producto: ${producto.title || ''} ${producto.description || ''}` : '')
        || '';
}

function tipoDeMensaje(message) {
    if (!message) return 'mensaje';
    const contenido = message.ephemeralMessage?.message
        || message.viewOnceMessage?.message
        || message.viewOnceMessageV2?.message
        || message.documentWithCaptionMessage?.message
        || message;
    if (contenido.imageMessage) return 'Imagen';
    if (contenido.videoMessage) return 'Video';
    if (contenido.audioMessage) return 'Audio';
    if (contenido.documentMessage) return 'Documento';
    if (contenido.stickerMessage) return 'Sticker';
    if (contenido.contactMessage) return 'Contacto';
    if (contenido.contactsArrayMessage) return 'Contactos';
    if (contenido.locationMessage) return 'Ubicación';
    if (contenido.liveLocationMessage) return 'Ubicación en tiempo real';
    if (contenido.pollCreationMessage || contenido.pollCreationMessageV2 || contenido.pollCreationMessageV3) return 'Encuesta';
    if (contenido.reactionMessage) return 'Reacción';
    if (contenido.buttonsResponseMessage || contenido.listResponseMessage || contenido.templateButtonReplyMessage) return 'Respuesta interactiva';
    if (contenido.productMessage) return 'Producto';
    if (contenido.conversation || contenido.extendedTextMessage?.text) return 'Texto';
    return 'Mensaje';
}

function limpiarMapa(mapa, ahora) {
    for (const [chatId, registros] of mapa) {
        for (const [id, registro] of registros) {
            if (ahora - registro.timestamp > VENTANA_MS) registros.delete(id);
        }
        if (registros.size === 0) mapa.delete(chatId);
    }
}

async function registrarMensajeReciente(msg, sock) {
    const chatId = msg?.key?.remoteJid;
    const id = msg?.key?.id;
    if (!chatId || !id || !msg.message || msg.message.protocolMessage) return;

    const ahora = Date.now();
    limpiarMapa(mensajesPorChat, ahora);
    let registros = mensajesPorChat.get(chatId);
    if (!registros) {
        if (mensajesPorChat.size >= MAX_CHATS_EN_MEMORIA) mensajesPorChat.delete(mensajesPorChat.keys().next().value);
        registros = new Map();
        mensajesPorChat.set(chatId, registros);
    }

    const registro = {
        id,
        chatId,
        remitente: msg.key.participant || (msg.key.fromMe ? 'bot' : chatId),
        texto: textoDeMensaje(msg.message).slice(0, MAX_TEXTO_GUARDADO),
        tipo: tipoDeMensaje(msg.message),
        timestamp: Number(msg.messageTimestamp || Math.floor(ahora / 1000)) * 1000,
        media: null, mediaBytes: 0, mimetype: null, fileName: null, ptt: false,
        menciones: [], datosExtra: ''
    };
    const contenido = msg.message.ephemeralMessage?.message || msg.message.viewOnceMessage?.message || msg.message.viewOnceMessageV2?.message || msg.message.documentWithCaptionMessage?.message || msg.message;
    const tipoPrincipal = ['extendedTextMessage','imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage','contactMessage','contactsArrayMessage','locationMessage','liveLocationMessage','pollCreationMessage','pollCreationMessageV2','pollCreationMessageV3','reactionMessage','buttonsResponseMessage','listResponseMessage','templateButtonReplyMessage','productMessage'].find(k => contenido[k]);
    const objetoPrincipal = tipoPrincipal ? contenido[tipoPrincipal] : null;
    const contexto = objetoPrincipal?.contextInfo || {};
    registro.menciones = Array.isArray(contexto.mentionedJid) ? [...contexto.mentionedJid] : [];
    if (contexto.quotedMessage) registro.datosExtra = `Mensaje citado: ${textoDeMensaje(contexto.quotedMessage) || tipoDeMensaje(contexto.quotedMessage)}`.slice(0, 1000);
    const campoMedia = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].find(campo => contenido[campo]);
    if (campoMedia && sock) {
        try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: sock.logger, reuploadRequest: sock.updateMediaMessage });
            const bytesChat = bytesMultimediaDelChat(chatId);
            const bytesGlobales = bytesMultimediaGlobales();
            if (Buffer.isBuffer(buffer) && buffer.length > 0
                && buffer.length <= MAX_MEDIA_POR_MENSAJE
                && bytesChat + buffer.length <= MAX_MEDIA_TOTAL_POR_CHAT
                && bytesGlobales + buffer.length <= MAX_MEDIA_TOTAL_GLOBAL) {
                registro.media = buffer; registro.mediaBytes = buffer.length;
                registro.mimetype = contenido[campoMedia]?.mimetype || null;
                registro.fileName = contenido[campoMedia]?.fileName || null;
                registro.ptt = !!contenido[campoMedia]?.ptt;
            }
        } catch (error) { console.warn('No se pudo guardar temporalmente el archivo para verelim:', error.message || error); }
    }
    registros.set(id, registro);

    while (registros.size > MAX_MENSAJES_POR_CHAT) {
        registros.delete(registros.keys().next().value);
    }
}

function registrarEliminacion(msg, sock) {
    const protocolo = msg?.message?.protocolMessage;
    // Baileys usa ProtocolMessage.Type.REVOKE = 0 para "Eliminar para todos".
    if (!protocolo || !(protocolo.type === 0 || protocolo.type === 'REVOKE')) return false;

    // No registrar eliminaciones hechas por el propio bot. Esto evita que
    // verelim muestre los mensajes que el bot borra al aplicar un mute.
    if (msg?.key?.fromMe) return true;

    const chatId = msg?.key?.remoteJid;
    const idOriginal = protocolo.key?.id;
    if (!chatId || !idOriginal) return true;

    const ahora = Date.now();
    limpiarMapa(mensajesPorChat, ahora);
    limpiarMapa(eliminadosPorChat, ahora);

    const original = mensajesPorChat.get(chatId)?.get(idOriginal);
    // Solo se muestra contenido que el bot recibió y conservó temporalmente.
    if (!original || ahora - original.timestamp > VENTANA_MS) return true;

    let registros = eliminadosPorChat.get(chatId);
    if (!registros) {
        if (eliminadosPorChat.size >= MAX_CHATS_EN_MEMORIA) eliminadosPorChat.delete(eliminadosPorChat.keys().next().value);
        registros = new Map();
    }
    const idEvento = msg.key.id || `${idOriginal}:${ahora}`;
    const quienElimino = msg.key.participant
        || (msg.key.fromMe ? sock?.user?.id : null)
        || msg.key.remoteJid;

    registros.set(idEvento, {
        ...original,
        timestampEliminacion: ahora,
        quienElimino
    });
    while (registros.size > MAX_ELIMINADOS_POR_CHAT) {
        registros.delete(registros.keys().next().value);
    }
    eliminadosPorChat.set(chatId, registros);
    mensajesPorChat.get(chatId)?.delete(idOriginal);
    return true;
}

function registrarEliminacionPorBot(msg, motivo = 'Moderación automática') {
    const chatId = msg?.key?.remoteJid;
    const id = msg?.key?.id;
    if (!chatId || !id) return false;

    const ahora = Date.now();
    limpiarMapa(mensajesPorChat, ahora);
    limpiarMapa(eliminadosPorChat, ahora);
    const original = mensajesPorChat.get(chatId)?.get(id) || {
        id,
        chatId,
        remitente: msg.key.participant || msg.key.remoteJid,
        texto: textoDeMensaje(msg.message).slice(0, MAX_TEXTO_GUARDADO),
        tipo: tipoDeMensaje(msg.message),
        timestamp: Number(msg.messageTimestamp || Math.floor(ahora / 1000)) * 1000,
        media: null,
        mediaBytes: 0,
        mimetype: null,
        fileName: null,
        ptt: false
    };

    let registros = eliminadosPorChat.get(chatId);
    if (!registros) {
        if (eliminadosPorChat.size >= MAX_CHATS_EN_MEMORIA) eliminadosPorChat.delete(eliminadosPorChat.keys().next().value);
        registros = new Map();
        eliminadosPorChat.set(chatId, registros);
    }
    registros.set(`bot:${id}:${ahora}`, {
        ...original,
        timestampEliminacion: ahora,
        quienElimino: 'bot',
        motivo
    });
    while (registros.size > MAX_ELIMINADOS_POR_CHAT) registros.delete(registros.keys().next().value);
    mensajesPorChat.get(chatId)?.delete(id);
    return true;
}

function obtenerEliminados(chatId) {
    const ahora = Date.now();
    limpiarMapa(eliminadosPorChat, ahora);
    const registros = eliminadosPorChat.get(chatId);
    if (!registros) return [];
    return [...registros.values()]
        .filter(r => ahora - r.timestampEliminacion <= VENTANA_MS)
        .sort((a, b) => b.timestampEliminacion - a.timestampEliminacion);
}

async function comandoVerEliminados(sock, chatId, msg) {
    const eliminados = obtenerEliminados(chatId);
    if (!eliminados.length) {
        await sock.sendMessage(chatId, {
            text: '🧹 No tengo mensajes eliminados para todos de las últimas *2 horas* en este chat. Solo puedo mostrar mensajes que el bot haya recibido mientras estaba conectado.'
        }, { quoted: msg });
        return;
    }

    const menciones = [...new Set(eliminados.flatMap(r => [r.quienElimino, ...(r.menciones || [])]).filter(jid => jid && jid.includes('@')))];
    const bloques = eliminados.slice(0, 30).map((r, i) => {
        const hora = new Date(r.timestampEliminacion).toLocaleTimeString('es-MX', {
            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City'
        });
        const contenido = r.texto?.trim()
            ? r.texto.trim().slice(0, 1800)
            : `[Mensaje de tipo ${r.tipo}]`;
        const etiquetasMencion = (r.menciones || []).map(jid => `@${String(jid).split('@')[0]}`).join(' ');
        const extraMensaje = [etiquetasMencion ? `\n👥 Menciones: ${etiquetasMencion}` : '', r.datosExtra ? `\n🧵 ${r.datosExtra}` : ''].join('');
        const etiqueta = r.quienElimino === 'bot' ? '🤖 BOT' : (r.quienElimino?.includes('@') ? `@${r.quienElimino.split('@')[0]}` : 'No identificado');
        const motivo = r.motivo ? `\n📌 Motivo: ${r.motivo}` : '';
        return `*Mensaje eliminado #${i + 1}* · ${hora}\n👤 Lo eliminó: ${etiqueta}${motivo}\n📦 Tipo: ${r.tipo}\n🗑️ Contenido: ${contenido}${extraMensaje}`;
    });

    const extra = eliminados.length > 30 ? `\n\nSe muestran 30 de ${eliminados.length} mensajes. Los registros se borran automáticamente al cumplir 2 horas.` : '\n\nLos registros se borran automáticamente al cumplir 2 horas.';
    await sock.sendMessage(chatId, {
        text: `🕵️ *MENSAJES ELIMINADOS PARA TODOS*\n📍 Este chat · últimas 2 horas\n\n${bloques.join('\n\n')}${extra}`,
        mentions: menciones
    }, { quoted: msg });

    // Reenvía también los archivos multimedia que se guardaron temporalmente.
    for (let i = 0; i < Math.min(eliminados.length, 30); i++) {
        const r = eliminados[i];
        if (!r.media || !r.media.length) continue;
        const etiqueta = r.quienElimino?.includes('@') ? `@${r.quienElimino.split('@')[0]}` : 'No identificado';
        const cabecera = `🗑️ *Archivo eliminado #${i + 1}*\n👤 Lo eliminó: ${etiqueta}`;
        const mentions = [...new Set([r.quienElimino, ...(r.menciones || [])].filter(jid => jid && jid.includes('@')))];
        try {
            if (r.tipo === 'Imagen') await sock.sendMessage(chatId, { image: r.media, caption: `${cabecera}${r.texto ? `\n📝 ${r.texto}` : ''}`, mimetype: r.mimetype || undefined, mentions });
            else if (r.tipo === 'Video') await sock.sendMessage(chatId, { video: r.media, caption: `${cabecera}${r.texto ? `\n📝 ${r.texto}` : ''}`, mimetype: r.mimetype || undefined, mentions });
            else if (r.tipo === 'Sticker') {
                await sock.sendMessage(chatId, { text: cabecera, mentions });
                await sock.sendMessage(chatId, { sticker: r.media });
            } else if (r.tipo === 'Audio') {
                await sock.sendMessage(chatId, { text: cabecera, mentions });
                await sock.sendMessage(chatId, { audio: r.media, mimetype: r.mimetype || 'audio/ogg; codecs=opus', ptt: r.ptt });
            } else if (r.tipo === 'Documento') await sock.sendMessage(chatId, { document: r.media, mimetype: r.mimetype || 'application/octet-stream', fileName: r.fileName || 'archivo_recuperado', caption: cabecera, mentions });
        } catch (error) {
            console.error('No se pudo reenviar multimedia eliminado:', error.message || error);
            await sock.sendMessage(chatId, { text: `${cabecera}\n⚠️ No pude volver a enviar el archivo multimedia.`, mentions });
        }
    }
}

module.exports = { registrarMensajeReciente, registrarEliminacion, registrarEliminacionPorBot, comandoVerEliminados };
