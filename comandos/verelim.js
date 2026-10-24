// Registro temporal en memoria de mensajes eliminados para todos.
// No se escribe contenido en MongoDB ni en archivos. Los registros expiran en 2 horas.
const VENTANA_MS = 2 * 60 * 60 * 1000;
const MAX_MENSAJES_POR_CHAT = 300;
const MAX_ELIMINADOS_POR_CHAT = 200;
const MAX_CHATS_EN_MEMORIA = 100;
const MAX_TEXTO_GUARDADO = 4000;
const MAX_MEDIA_POR_MENSAJE = 8 * 1024 * 1024;
const MAX_MEDIA_TOTAL_POR_CHAT = 24 * 1024 * 1024;

const mensajesPorChat = new Map();
const eliminadosPorChat = new Map();

function textoDeMensaje(message) {
    if (!message) return '';
    const contenido = message.ephemeralMessage?.message
        || message.viewOnceMessage?.message
        || message.viewOnceMessageV2?.message
        || message.documentWithCaptionMessage?.message
        || message;
    return contenido.conversation
        || contenido.extendedTextMessage?.text
        || contenido.imageMessage?.caption
        || contenido.videoMessage?.caption
        || contenido.documentMessage?.caption
        || contenido.audioMessage?.caption
        || contenido.stickerMessage?.description
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
        media: null, mediaBytes: 0, mimetype: null, fileName: null, ptt: false
    };
    const contenido = msg.message.ephemeralMessage?.message || msg.message.viewOnceMessage?.message || msg.message.viewOnceMessageV2?.message || msg.message.documentWithCaptionMessage?.message || msg.message;
    const campoMedia = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].find(campo => contenido[campo]);
    if (campoMedia && sock) {
        try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: sock.logger, reuploadRequest: sock.updateMediaMessage });
            const bytesActuales = [...registros.values()].reduce((total, r) => total + (r.mediaBytes || 0), 0);
            if (Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= MAX_MEDIA_POR_MENSAJE && bytesActuales + buffer.length <= MAX_MEDIA_TOTAL_POR_CHAT) {
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

    const menciones = [...new Set(eliminados.map(r => r.quienElimino).filter(jid => jid && jid.includes('@')))];
    const bloques = eliminados.slice(0, 30).map((r, i) => {
        const hora = new Date(r.timestampEliminacion).toLocaleTimeString('es-MX', {
            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City'
        });
        const contenido = r.texto?.trim()
            ? r.texto.trim().slice(0, 1800)
            : `[Se eliminó un mensaje de tipo ${r.tipo}. El archivo multimedia original no se almacena.]`;
        const etiqueta = r.quienElimino?.includes('@') ? `@${r.quienElimino.split('@')[0]}` : 'No identificado';
        return `*Mensaje eliminado #${i + 1}* · ${hora}\n👤 Lo eliminó: ${etiqueta}\n🗑️ Contenido: ${contenido}`;
    });

    const extra = eliminados.length > 30 ? `\n\nSe muestran 30 de ${eliminados.length} mensajes. Los registros se borran automáticamente al cumplir 2 horas.` : '\n\nLos registros se borran automáticamente al cumplir 2 horas.';
    await sock.sendMessage(chatId, {
        text: `🕵️ *MENSAJES ELIMINADOS PARA TODOS*\n📍 Este chat · últimas 2 horas\n\n${bloques.join('\n\n')}${extra}`,
        mentions: menciones
    }, { quoted: msg });
}

module.exports = { registrarMensajeReciente, registrarEliminacion, comandoVerEliminados };
