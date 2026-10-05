const crypto = require('crypto');
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

// 🎬 2. TikTok (Descarga sin marca de agua)
async function resolverEnlaceTikTok(url) {
    // Los enlaces vm/vt.tiktok.com son redirecciones. Resolverlos primero
    // evita que los servicios externos reciban un enlace corto que todavía
    // no hayan podido interpretar.
    if (!/vm\.tiktok\.com|vt\.tiktok\.com/i.test(url)) return url;

    try {
        const respuesta = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(15000)
        });

        if (respuesta.url && /tiktok\.com/i.test(respuesta.url)) {
            return respuesta.url;
        }
    } catch (error) {
        console.warn('⚠️ No se pudo resolver el enlace corto de TikTok:', error.message);
    }

    return url;
}

async function obtenerTikTokDirecto(url) {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const headersBase = {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
    };

    let respuesta = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: headersBase,
        signal: AbortSignal.timeout(30000)
    });

    if (!respuesta.ok) {
        throw new Error('TikTok página respondió HTTP ' + respuesta.status);
    }

    const cookies = typeof respuesta.headers.getSetCookie === 'function'
        ? respuesta.headers.getSetCookie().map(x => x.split(';')[0]).join('; ')
        : '';

    const pagina = await respuesta.text();
    let data = null;

    const universal = pagina.match(
        /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\\/script>/i
    );

    if (universal) {
        try {
            data = JSON.parse(universal[1]);
        } catch {
            data = null;
        }
    }

    // TikTok también ha usado SIGI_STATE como fuente de datos.
    if (!data) {
        const sigi = pagina.match(
            /<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\\/script>/i
        );
        if (sigi) {
            try {
                data = JSON.parse(sigi[1]);
            } catch {
                data = null;
            }
        }
    }

    let item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct || null;

    if (!item && data?.ItemModule) {
        const valores = Object.values(data.ItemModule);
        item = valores.find(x => x?.video?.playAddr || x?.video?.downloadAddr) || null;
    }

    const video = item?.video;
    if (!video) {
        throw new Error('TikTok no entregó los datos del video en la página');
    }

    const candidatos = [];

    if (Array.isArray(video.bitrateInfo)) {
        for (const calidad of video.bitrateInfo) {
            const urls = calidad?.PlayAddr?.UrlList || [];
            for (const videoUrl of urls) {
                if (videoUrl) {
                    candidatos.push({
                        url: videoUrl.replace(/\\u0026/g, '&').replace(/\\u002F/g, '/'),
                        bitrate: Number(calidad?.Bitrate || 0),
                        codec: String(calidad?.CodecType || '')
                    });
                }
            }
        }
    }

    for (const videoUrl of [video.downloadAddr, video.playAddr]) {
        if (videoUrl) {
            candidatos.push({
                url: String(videoUrl).replace(/\\u0026/g, '&').replace(/\\u002F/g, '/'),
                bitrate: Number(video.bitrate || 0),
                codec: String(video.codecType || 'h264')
            });
        }
    }

    const validos = candidatos.filter(x => /^https?:\\/\\//i.test(x.url));
    if (!validos.length) {
        throw new Error('TikTok no devolvió una URL MP4');
    }

    // Preferimos H.264 porque WhatsApp maneja mejor ese MP4 que HEVC/ByteVC1.
    const h264 = validos.filter(x => /h264/i.test(x.codec));
    const lista = h264.length ? h264 : validos;
    lista.sort((a, b) => b.bitrate - a.bitrate);

    return {
        videoUrl: lista[0].url,
        cookie: cookies,
        titulo: item?.desc || 'TikTok'
    };
}

function extraerVideoTikWM(data) {
    const datos = data?.data;

    // TikWM ha usado distintos nombres según la respuesta/versión.
    const videoUrl =
        datos?.hdplay ||
        datos?.play ||
        datos?.wmplay ||
        datos?.video?.hdplay ||
        datos?.video?.play ||
        data?.hdplay ||
        data?.play;

    if (data?.code !== undefined && Number(data.code) !== 0) {
        throw new Error(data?.msg || data?.message || 'TikWM rechazó el enlace');
    }

    if (!videoUrl) {
        throw new Error(data?.msg || data?.message || 'TikWM no devolvió una URL de video');
    }

    return {
        videoUrl,
        titulo: datos?.title || data?.title || 'TikTok'
    };
}

async function obtenerTikTokTikWM(url, metodo = 'POST') {
    const opciones = {
        method: metodo,
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
            ...(cookie ? { 'Cookie': cookie } : {})
        },
        signal: AbortSignal.timeout(30000)
    };

    if (metodo === 'POST') {
        opciones.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        opciones.headers['Cookie'] = 'current_language=en';
        opciones.body = new URLSearchParams({
            url,
            hd: '1',
            web: '1',
            count: '12',
            cursor: '0'
        });
    } else {
        opciones.headers['Cookie'] = 'current_language=en';
        opciones.body = undefined;
    }

    const endpoint = metodo === 'GET'
        ? 'https://www.tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1'
        : 'https://www.tikwm.com/api/';

    const respuesta = await fetch(endpoint, opciones);

    if (!respuesta.ok) {
        throw new Error('TikWM ' + metodo + ' respondió HTTP ' + respuesta.status);
    }

    const texto = await respuesta.text();
    let data;

    try {
        data = JSON.parse(texto);
    } catch {
        throw new Error('TikWM ' + metodo + ' devolvió una respuesta no válida');
    }

    return extraerVideoTikWM(data);
}

async function obtenerTikTokTDown(url) {
    const endpoint = 'https://tdownv4.sl-bjs.workers.dev/?down=' + encodeURIComponent(url);
    const respuesta = await fetch(endpoint, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(30000)
    });

    if (!respuesta.ok) {
        throw new Error('TDown respondió HTTP ' + respuesta.status);
    }

    const texto = await respuesta.text();
    let data;

    try {
        data = JSON.parse(texto);
    } catch {
        throw new Error('TDown devolvió una respuesta no válida');
    }

    const videoUrl =
        data?.download_url ||
        data?.downloadUrl ||
        data?.url ||
        data?.video_url ||
        data?.videoUrl ||
        data?.data?.download_url ||
        data?.data?.downloadUrl ||
        data?.data?.url;

    if (!videoUrl) {
        throw new Error(data?.message || data?.msg || 'TDown no devolvió un video descargable');
    }

    return {
        videoUrl,
        titulo: data?.title || data?.data?.title || 'TikTok'
    };
}

async function descargarVideoTikTok(videoUrl, cookie = '') {
    const respuesta = await fetch(videoUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
            'Referer': 'https://www.tikwm.com/'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(90000)
    });

    if (!respuesta.ok) {
        throw new Error('No se pudo descargar el MP4: HTTP ' + respuesta.status);
    }

    const videoBuffer = Buffer.from(await respuesta.arrayBuffer());
    if (!videoBuffer.length) {
        throw new Error('El servidor devolvió un video vacío');
    }

    return videoBuffer;
}

async function comandoTiktok(sock, chatId, msg, args) {
    const urlOriginal = args[0];

    if (!urlOriginal || !/^(https?:\/\/)?([a-z0-9-]+\.)?tiktok\.com\//i.test(urlOriginal)) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Proporciona un enlace válido de TikTok. Ejemplo: `tiktok [link]`'
        }, { quoted: msg });
        return;
    }

    try {
        await sock.sendMessage(chatId, {
            text: '⏳ Descargando video de TikTok...'
        }, { quoted: msg });

        let url = urlOriginal;
        let datos;
        const errores = [];

        // Primero resolvemos enlaces cortos para que todos los proveedores
        // reciban, cuando sea posible, el enlace canónico del video.
        url = await resolverEnlaceTikTok(url);

        // Primero intentamos extraer el MP4 directamente de la página de TikTok.
        // Esto evita depender de TikWM/TDown, que desde Render pueden devolver 403/500.
        try {
            datos = await obtenerTikTokDirecto(url);
        } catch (errorDirecto) {
            errores.push('TikTok directo: ' + errorDirecto.message);
        }

        // Si TikTok no entregó el MP4 directamente, usamos los proveedores externos.
        for (const metodo of ['POST', 'GET']) {
            try {
                datos = await obtenerTikTokTikWM(url, metodo);
                if (datos?.videoUrl) break;
            } catch (errorTikWM) {
                errores.push('TikWM ' + metodo + ': ' + errorTikWM.message);
            }
        }

        // Si era un enlace corto y la resolución falló, damos una segunda
        // oportunidad al enlace original después de unos segundos.
        if (!datos && url !== urlOriginal) {
            await new Promise(resolve => setTimeout(resolve, 4000));

            for (const metodo of ['POST', 'GET']) {
                try {
                    datos = await obtenerTikTokTikWM(urlOriginal, metodo);
                    if (datos?.videoUrl) break;
                } catch (errorTikWM) {
                    errores.push('TikWM corto ' + metodo + ': ' + errorTikWM.message);
                }
            }
        }

        // Segundo servicio independiente.
        if (!datos) {
            try {
                datos = await obtenerTikTokTDown(url);
            } catch (errorTDown) {
                errores.push('TDown: ' + errorTDown.message);
            }
        }

        if (!datos?.videoUrl) {
            throw new Error(errores.join(' | ') || 'Ningún servicio devolvió el video');
        }

        const videoBuffer = await descargarVideoTikTok(datos.videoUrl, datos.cookie || '');

        await sock.sendMessage(chatId, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            caption: '🎬 *TikTok sin marca de agua*\nApoya al creador con el código: *JASC13*'
        }, { quoted: msg });

    } catch (e) {
        console.error('Error al descargar TikTok:', e?.stack || e);
        await sock.sendMessage(chatId, {
            text: '❌ No pude descargar ese TikTok. Intenta nuevamente con el enlace de *Compartir → Copiar enlace*.'
        }, { quoted: msg });
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
    comandoTiktok,
    comandoTraduce,
    comandoSkin,
    comandoStats,
    comandoContacto
};
