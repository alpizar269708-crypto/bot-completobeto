const crypto = require('crypto');
const { resolverContactoWhatsApp } = require('../utils/whatsapp');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// 🚀 Caché para no repetir conversiones idénticas y deduplicar trabajos simultáneos.
const stickerCache = new Map();
const stickerEnProceso = new Map();
const STICKER_CACHE_TTL_MS = 10 * 60 * 1000;
const STICKER_CACHE_MAX = 12;

// 🎨 1. Sticker (conversión híbrida: Cloudinary + fallback local)
function limpiarCacheStickers() {
    const ahora = Date.now();
    for (const [clave, dato] of stickerCache) {
        if (dato.expira <= ahora) stickerCache.delete(clave);
    }
    while (stickerCache.size > STICKER_CACHE_MAX) {
        const primeraClave = stickerCache.keys().next().value;
        if (primeraClave === undefined) break;
        stickerCache.delete(primeraClave);
    }
}

function obtenerConfiguracionCloudinary() {
    const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
    const uploadPreset = String(process.env.CLOUDINARY_UPLOAD_PRESET || '').trim();
    if (!cloudName) return null;
    if (apiKey && apiSecret) return { cloudName, apiKey, apiSecret };
    if (uploadPreset) return { cloudName, uploadPreset };
    return null;
}

function crearFirmaCloudinary(params, apiSecret) {
    const cadena = Object.keys(params)
        .filter(clave => params[clave] !== undefined && params[clave] !== null && params[clave] !== '')
        .sort()
        .map(clave => clave + '=' + params[clave])
        .join('&');
    return crypto.createHash('sha1').update(cadena + apiSecret).digest('hex');
}

async function subirVideoCloudinary(buffer, hash) {
    const config = obtenerConfiguracionCloudinary();
    if (!config) return null;
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = 'wa_sticker_' + hash;
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'video/mp4' }), 'sticker.mp4');

    if (config.apiKey && config.apiSecret) {
        form.append('api_key', config.apiKey);
        form.append('timestamp', String(timestamp));
        form.append('public_id', publicId);
        form.append('signature', crearFirmaCloudinary({ public_id: publicId, timestamp }, config.apiSecret));
    } else {
        form.append('upload_preset', config.uploadPreset);
    }

    const respuesta = await fetch(
        'https://api.cloudinary.com/v1_1/' + encodeURIComponent(config.cloudName) + '/video/upload',
        { method: 'POST', body: form, signal: AbortSignal.timeout(20000) }
    );
    if (!respuesta.ok) {
        const detalle = await respuesta.text().catch(() => '');
        throw new Error('Cloudinary upload ' + respuesta.status + ': ' + detalle.slice(0, 300));
    }
    const datos = await respuesta.json();
    return { cloudName: config.cloudName, publicId: datos.public_id || publicId };
}

async function descargarStickerCloudinary(buffer, hash) {
    const config = obtenerConfiguracionCloudinary();
    if (!config) return null;

    // Primero intentamos reutilizar el asset ya transformado. Así, después de un
    // reinicio de Render, un video repetido puede saltarse por completo el upload.
    const publicId = 'wa_sticker_' + hash;
    const transformacion = 'c_fill,w_512,h_512,fl_animated.fl_awebp,vs_10,q_auto:good';
    const urlBase = 'https://res.cloudinary.com/' + encodeURIComponent(config.cloudName) +
        '/video/upload/' + transformacion + '/';

    let url = urlBase + encodeURIComponent(publicId) + '.webp';
    let respuesta = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (respuesta.ok) {
        const resultadoExistente = Buffer.from(await respuesta.arrayBuffer());
        if (resultadoExistente.length) return resultadoExistente;
    }

    const asset = await subirVideoCloudinary(buffer, hash);
    if (!asset) return null;

    url = urlBase + encodeURIComponent(asset.publicId || publicId) + '.webp';
    respuesta = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!respuesta.ok) throw new Error('Cloudinary transform ' + respuesta.status);

    const resultado = Buffer.from(await respuesta.arrayBuffer());
    if (!resultado.length) throw new Error('Cloudinary devolvió un sticker vacío.');
    return resultado;
}

async function convertirStickerLocal(buffer, esVideo) {
    const sticker = new Sticker(buffer, {
        pack: 'TechMasters & Stream',
        author: 'Humberto Alpízar',
        type: StickerTypes.CROPPED,
        quality: esVideo ? 10 : 50
    });
    return sticker.toBuffer();
}

async function convertirVideoASticker(buffer, hash) {
    limpiarCacheStickers();
    const cacheado = stickerCache.get('vid:' + hash);
    if (cacheado && cacheado.expira > Date.now()) return cacheado.buffer;
    if (cacheado) stickerCache.delete('vid:' + hash);
    if (stickerEnProceso.has(hash)) return stickerEnProceso.get(hash);

    const trabajo = (async () => {
        let resultado = null;
        if (obtenerConfiguracionCloudinary()) {
            try {
                resultado = await descargarStickerCloudinary(buffer, hash);
            } catch (error) {
                console.warn('⚠️ Cloudinary no pudo convertir el sticker; usando fallback local:', error.message);
            }
        }
        if (!resultado) resultado = await convertirStickerLocal(buffer, true);
        stickerCache.set('vid:' + hash, { buffer: resultado, expira: Date.now() + STICKER_CACHE_TTL_MS });
        limpiarCacheStickers();
        return resultado;
    })();
    stickerEnProceso.set(hash, trabajo);
    try {
        return await trabajo;
    } finally {
        stickerEnProceso.delete(hash);
    }
}

async function comandoSticker(sock, msg) {
    const chatJid = msg.key.remoteJid;
    try {
        const msgTipo = msg.message?.imageMessage || msg.message?.videoMessage;
        const msjCitado = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const citadoTipo = msjCitado?.imageMessage || msjCitado?.videoMessage;
        if (!msgTipo && !citadoTipo) {
            return await sock.sendMessage(chatJid, { text: '⚠️ Por favor, responde a una imagen o video, o envíalo adjunto a la imagen.' }, { quoted: msg });
        }

        const esVideo = !!(msg.message?.videoMessage || msjCitado?.videoMessage);
        if (esVideo) {
            const duracion = msg.message?.videoMessage?.seconds || msjCitado?.videoMessage?.seconds || 0;
            if (duracion > 10) {
                return await sock.sendMessage(chatJid, { text: '⚠️ El video es muy largo. Por favor envía videos de máximo 10 segundos para no saturar el sistema.' }, { quoted: msg });
            }
        }

        const msjMultimedia = citadoTipo ? { message: msjCitado } : msg;
        const buffer = await downloadMediaMessage(msjMultimedia, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        let stickerBuffer;

        if (esVideo) {
            stickerBuffer = await convertirVideoASticker(buffer, hash);
        } else {
            const clave = 'img:' + hash;
            limpiarCacheStickers();
            const cacheado = stickerCache.get(clave);
            if (cacheado && cacheado.expira > Date.now()) {
                stickerBuffer = cacheado.buffer;
            } else {
                stickerBuffer = await convertirStickerLocal(buffer, false);
                stickerCache.set(clave, { buffer: stickerBuffer, expira: Date.now() + STICKER_CACHE_TTL_MS });
                limpiarCacheStickers();
            }
        }

        await sock.sendMessage(chatJid, { sticker: stickerBuffer }, { quoted: msg });
    } catch (e) {
        console.error('Error al crear el sticker:', e);
        await sock.sendMessage(chatJid, { text: '❌ Error al crear el sticker. Asegúrate de que el formato sea soportado.' }, { quoted: msg });
    }
}

// 📢 2. Todos (Etiqueta masiva a miembros del grupo)
async function comandoTodos(sock, chatId, msg) {
    if (!chatId.endsWith('@g.us')) return;

    try {
        // Solo administradores del grupo o el programador pueden usar este comando.
        // Un usuario normal no recibe ninguna respuesta.
        const remitente = msg.key.participant || '';
        let autorizado = !!msg.key.fromMe || !!msg.programadorBot;

        if (!autorizado) {
            const metadataPermisos = await sock.groupMetadata(chatId);
            const participante = metadataPermisos.participants.find(p =>
                p.id === remitente ||
                p.phoneNumber === remitente
            );
            autorizado = !!participante && (
                participante.admin === 'admin' ||
                participante.admin === 'superadmin'
            );
        }

        if (!autorizado) return;

        const metadata = await sock.groupMetadata(chatId);
        const mentions = metadata.participants
            .map(p => p.id || p.phoneNumber)
            .filter(Boolean);

        // Las menciones van en el campo nativo de WhatsApp, no como @número
        // dentro del texto. Así el anuncio no queda lleno con cientos de números.
        const texto = '📢 *¡ATENCIÓN A TODOS!* 📢\\n\\n' +
            'Apoya a un creador: *JASC13*';

        await sock.sendMessage(chatId, { text: texto, mentions }, { quoted: msg });
    } catch (e) {
        console.error('Error en comando todos:', e);
        // No enviamos mensajes de error: si no puede procesarse, queda silencioso.
    }
}

// 🎬 3. TikTok (Descarga sin marca de agua)
async function comandoTiktok(sock, chatId, msg, args) {
    const url = args[0];
    if (!url || !url.includes('tiktok.com')) {
        await sock.sendMessage(chatId, { text: '⚠️ Proporciona un enlace válido de TikTok. Ejemplo: `tiktok [link]`' }, { quoted: msg });
        return;
    }
    try {
        await sock.sendMessage(chatId, { text: '⏳ Descargando video de TikTok...' }, { quoted: msg });
        const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data && data.data && data.data.play) {
            const videoUrl = data.data.play;
            await sock.sendMessage(chatId, { 
                video: { url: videoUrl }, 
                caption: '🎬 *TikTok sin marca de agua*\nApoya al creador con el código: *JASC13*' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: '❌ No se pudo obtener el video.' }, { quoted: msg });
        }
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Error al procesar el enlace de TikTok.' }, { quoted: msg });
    }
}

// 🌐 4. Traduce (Traductor instantáneo)
async function comandoTraduce(sock, chatId, msg, args) {
    const idioma = args[0];
    const texto = args.slice(1).join(' ');
    if (!idioma || !texto) {
        await sock.sendMessage(chatId, { text: '⚠️ Uso correcto: `traduce [idioma] [texto]`\nEjemplo: `traduce en Hola mundo`' }, { quoted: msg });
        return;
    }
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${idioma}&dt=t&q=${encodeURIComponent(texto)}`);
        const data = await res.json();
        const traducido = data[0][0][0];
        await sock.sendMessage(chatId, { text: `🌐 *Traducción (${idioma.toUpperCase()})*:\n\n${traducido}` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Error al traducir el texto.' }, { quoted: msg });
    }
}

// 🎨 5. Skin (Buscador de objetos de Fortnite)
async function comandoSkin(sock, chatId, msg, args) {
    const nombreSkin = args.join(' ');
    if (!nombreSkin) {
        await sock.sendMessage(chatId, { text: '⚠️ Escribe el nombre de la skin. Ejemplo: `skin Midas`' }, { quoted: msg });
        return;
    }
    try {
        const res = await fetch(`https://fortnite-api.com/v2/cosmetics/br/search?name=${encodeURIComponent(nombreSkin)}&language=es`);
        const data = await res.json();
        if (data && data.status === 200 && data.data) {
            const item = data.data;
            let mensaje = `🎨 *SKIN: ${item.name}*\n\n`;
            mensaje += `📌 *Rareza:* ${item.rarity?.displayValue || 'Desconocida'}\n`;
            mensaje += `📝 *Descripción:* ${item.description || 'Sin descripción'}\n`;
            if (item.images?.icon) {
                await sock.sendMessage(chatId, { image: { url: item.images.icon }, caption: mensaje }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: mensaje }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(chatId, { text: '❌ No se encontró ninguna skin con ese nombre.' }, { quoted: msg });
        }
    } catch (e) {
        await sock.sendMessage(chatId, { text: '❌ Error al buscar la skin.' }, { quoted: msg });
    }
}

// 📊 6. Stats (Estadísticas de Fortnite)
async function comandoStats(sock, chatId, msg, args) {
    if (!args || args.length === 0) {
        return await sock.sendMessage(chatId, { text: `❌ Debes escribir el nombre de usuario de Epic Games.\nEjemplo: *stats alpizarh117*` }, { quoted: msg });
    }

    const nombreUsuario = args.join(' ');
    let msgCarga = await sock.sendMessage(chatId, { text: `🎮 Consultando estadísticas para *${nombreUsuario}*...` }, { quoted: msg });

    try {
        const respuesta = await fetch(`https://fortnite-api.com/v2/stats/br/v2?name=${encodeURIComponent(nombreUsuario)}`, {
            headers: {
                'Authorization': 'cbb386fe-de0e-438d-9f71-bf4001b95e9b' // Reemplaza esto con tu llave real de fortnite-api.com
            }
        });

        const datos = await respuesta.json();

        if (!datos.status || datos.status !== 200 || !datos.data) {
            return await sock.sendMessage(chatId, { 
                text: `❌ No se encontraron estadísticas para *${nombreUsuario}*.\nVerifica que el nombre sea correcto o que su perfil sea público.` 
            }, { quoted: msg });
        }

        const stats = datos.data.stats.all.overall;
        const cuenta = datos.data.account;

        let textoRespuesta = `📊 *ESTADÍSTICAS DE EPIC GAMES*\n\n` +
            `👤 *Jugador:* ${cuenta.name}\n` +
            `🏆 *Nivel de Cuenta:* ${datos.data.battlePass.level}\n\n` +
            `🕹️ *Partidas Jugadas:* ${stats.matches}\n` +
            `👑 *Top 1:* ${stats.wins}\n` +
            `🎯 *Kills:* ${stats.kills} (${stats.kd.toFixed(2)} K/D)\n` +
            `⏱️ *Tiempo Jugado:* ${Math.round(stats.minutesPlayed / 60)} horas\n\n` +
            `Support-a-Creator: *JASC13* ❤️`;

        await sock.sendMessage(chatId, { text: textoRespuesta }, { quoted: msg });

    } catch (error) {
        console.error("Error en comando stats:", error);
        await sock.sendMessage(chatId, { text: `⚠️ Ocurrió un error de conexión al consultar la API de Fortnite para *${nombreUsuario}*.` }, { quoted: msg });
    }
};

// 🛒 7. Contacto (Menú de atención y compras)
async function comandoContacto(sock, chatId, msg) {
    let texto = `🛒 *CENTRO DE ATENCIÓN Y COMPRAS* 🛒\n\n`;
    texto += `¿Deseas adquirir paVos, skins, pases de batalla o servicios técnicos?\n\n`;
    texto += `💬 Escribe directamente al administrador para gestionar tu pedido.\n\n`;
    texto += `Support-a-Creator: *JASC13* ❤️`;
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
}

module.exports = {
    comandoSticker,
    comandoTodos,
    comandoTiktok,
    comandoTraduce,
    comandoSkin,
    comandoStats,
    comandoContacto
};
