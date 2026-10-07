const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const puppeteer = require('puppeteer');
const youtubeDlExec = require('youtube-dl-exec');
const ytDlpPersonalizado = path.join(process.cwd(), '.venv', 'bin', 'yt-dlp');
const youtubedl = fs.existsSync(ytDlpPersonalizado)
    ? youtubeDlExec.create(ytDlpPersonalizado)
    : youtubeDlExec;

console.log('✅ Módulo TikTok: parser de enlaces + SnapTik activo');

function obtenerEjecutableChrome() {
    const candidatos = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/opt/render/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',
        path.join(os.homedir(), '.cache', 'puppeteer', 'chrome', 'linux-153.0.8010.36', 'chrome-linux64', 'chrome')
    ].filter(Boolean);
    for (const candidato of candidatos) {
        try { if (fs.existsSync(candidato)) return candidato; } catch (_) {}
    }
    try {
        const raiz = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
        const base = path.join(raiz, 'chrome');
        if (fs.existsSync(base)) {
            const versiones = fs.readdirSync(base).filter(x => /^linux-/.test(x)).sort().reverse();
            for (const version of versiones) {
                const candidato = path.join(base, version, 'chrome-linux64', 'chrome');
                if (fs.existsSync(candidato)) return candidato;
            }
        }
    } catch (_) {}
    return null;
}

function opcionesPuppeteer() {
    const executablePath = obtenerEjecutableChrome();
    return {
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };
}
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const STICKER_PACK = 'JASC13';
const STICKER_AUTHOR = 'JASC13 - BOT';
const STICKER_WATERMARK = 'JASC13';
const STICKER_SUPPORT_TEXT = 'Apoya a un creador: JASC13';

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

function crearMarcaAguaSvg() {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="64">
        <text x="496" y="42" text-anchor="end"
            font-family="Arial, Helvetica, sans-serif"
            font-size="28" font-weight="700"
            fill="white" stroke="black" stroke-width="6" paint-order="stroke"
            opacity="0.82">JASC13</text>
    </svg>`);
}

async function aplicarMarcaAguaImagen(buffer) {
    return sharp(buffer)
        .resize(512, 512, { fit: 'cover', position: 'centre' })
        .composite([{ input: crearMarcaAguaSvg(), gravity: 'southeast' }])
        .png()
        .toBuffer();
}

async function aplicarMarcaAguaVideo(buffer) {
    if (!ffmpegPath) throw new Error('FFmpeg no está disponible en el servidor.');
    const base = path.join(os.tmpdir(), 'sticker-watermark-' + crypto.randomBytes(8).toString('hex'));
    const entrada = base + '.mp4';
    const salida = base + '-wm.mp4';
    fs.writeFileSync(entrada, buffer);

    try {
        const filtro = [
            "scale=512:512:force_original_aspect_ratio=increase",
            "crop=512:512",
            "drawtext=text='JASC13':fontcolor=white:fontsize=28:borderw=4:bordercolor=black@0.85:x=w-text_w-16:y=h-text_h-16"
        ].join(',');
        await execFileAsync(ffmpegPath, [
            '-y', '-i', entrada,
            '-vf', filtro,
            '-an',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '24',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            salida
        ], { timeout: 90000, maxBuffer: 1024 * 1024 });

        const resultado = fs.readFileSync(salida);
        if (!resultado.length) throw new Error('FFmpeg devolvió un video vacío.');
        return resultado;
    } finally {
        for (const archivo of [entrada, salida]) {
            try { fs.unlinkSync(archivo); } catch (_) {}
        }
    }
}

async function convertirStickerLocal(buffer, esVideo) {
    const fuenteConMarca = esVideo
        ? await aplicarMarcaAguaVideo(buffer)
        : await aplicarMarcaAguaImagen(buffer);

    const sticker = new Sticker(fuenteConMarca, {
        pack: STICKER_PACK,
        author: STICKER_AUTHOR,
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
                // La marca se aplica ANTES de subir a Cloudinary para que la ruta
                // rápida tampoco pueda generar un sticker sin JASC13.
                const videoConMarca = await aplicarMarcaAguaVideo(buffer);
                resultado = await descargarStickerCloudinary(videoConMarca, hash);
            } catch (error) {
                console.warn('⚠️ Cloudinary no pudo convertir el sticker marcado; usando fallback local:', error.message);
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