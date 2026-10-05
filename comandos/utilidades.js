const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
function extraerUrlTikTok(texto) {
    const fuente = String(texto || '').trim();
    if (!fuente) return null;

    // WhatsApp/web puede entregar el enlace con formato Markdown:
    // [https://vt.tiktok.com/...](https://vt.tiktok.com/...)
    const markdown = [...fuente.matchAll(/\]\((https?:\/\/(?:www\.)?(?:(?:tiktok\.com|m\.tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com))\/[^)\s]+)\)/gi)]
        .map(m => m[1]);

    const urls = [
        ...markdown,
        ...(fuente.match(/https?:\/\/(?:www\.)?(?:(?:tiktok\.com|m\.tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com))\/[^\s<>\]\)]+/gi) || [])
    ];

    for (let url of urls) {
        url = url.replace(/[),.;!?]+$/g, '');
        try {
            const u = new URL(url);
            if (/(^|\.)tiktok\.com$/i.test(u.hostname)) return u.toString();
        } catch (_) {}
    }

    // También aceptamos un enlace sin https://.
    const sinEsquema = fuente.match(/(?:www\.)?(?:(?:tiktok\.com|m\.tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com))\/[^\s<>\]\)]+/i);
    if (sinEsquema?.[0]) {
        try {
            const u = new URL('https://' + sinEsquema[0].replace(/[),.;!?]+$/g, ''));
            if (/(^|\.)tiktok\.com$/i.test(u.hostname)) return u.toString();
        } catch (_) {}
    }

    return null;
}

async function resolverEnlaceTikTok(url) {
    let original;
    try { original = new URL(url); } catch { return url; }

    const esCanonico = /\/(?:@[^/]+\/video\/|video\/|photo\/)/i.test(original.pathname);
    if (esCanonico) return url;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
    };

    try {
        const respuesta = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers,
            signal: AbortSignal.timeout(15000)
        });
        if (respuesta.url && /tiktok\.com/i.test(respuesta.url)) {
            const finalUrl = new URL(respuesta.url);
            if (/\/(?:@[^/]+\/video\/|video\/|photo\/)/i.test(finalUrl.pathname)) {
                return finalUrl.toString();
            }
        }
    } catch (error) {
        console.warn('⚠️ No se pudo resolver TikTok por HTTP:', error.message);
    }

    // Algunos enlaces vt/vm son enviados por TikTok a una URL intermedia
    // (por ejemplo /?_r=1). Chromium sigue la navegación real y nos da la URL final.
    if (/^(?:vt|vm)\.tiktok\.com$/i.test(original.hostname) || /\/t\//i.test(original.pathname)) {
        let browser;
        try {
            browser = await puppeteer.launch(opcionesPuppeteer());
            const page = await browser.newPage();
            await page.setUserAgent(headers['User-Agent']);
            await page.setExtraHTTPHeaders({ 'Accept-Language': headers['Accept-Language'] });
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));
            const finalUrl = page.url();
            if (finalUrl && /tiktok\.com/i.test(finalUrl)) {
                const u = new URL(finalUrl);
                if (/\/(?:@[^/]+\/video\/|video\/|photo\/)/i.test(u.pathname)) return u.toString();
            }
        } catch (error) {
            console.warn('⚠️ No se pudo resolver TikTok con navegador:', error.message);
        } finally {
            if (browser) await browser.close().catch(() => {});
        }
    }

    return url;
}

function extraerDatosTikTokDePagina(pagina, cookies = '') {
    let data = null;
    const extraerJsonScript = (id) => {
        const inicio = pagina.indexOf('<script id="' + id + '"');
        if (inicio < 0) return null;
        const contenido = pagina.indexOf('>', inicio);
        const fin = pagina.indexOf('</script>', contenido);
        if (contenido < 0 || fin < 0) return null;
        try { return JSON.parse(pagina.slice(contenido + 1, fin)); } catch { return null; }
    };
    data = extraerJsonScript('__UNIVERSAL_DATA_FOR_REHYDRATION__') || extraerJsonScript('SIGI_STATE');
    let item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct || null;
    if (!item && data?.ItemModule) item = Object.values(data.ItemModule).find(x => x?.video?.playAddr || x?.video?.downloadAddr) || null;
    const video = item?.video;
    if (!video) throw new Error('TikTok no entregó los datos del video en la página');
    const candidatos = [];
    if (Array.isArray(video.bitrateInfo)) for (const calidad of video.bitrateInfo) {
        for (const videoUrl of (calidad?.PlayAddr?.UrlList || [])) if (videoUrl) candidatos.push({
            url: String(videoUrl).replace(/\\u0026/g, '&').replace(/\\u002F/g, '/'),
            bitrate: Number(calidad?.Bitrate || 0), codec: String(calidad?.CodecType || '')
        });
    }
    for (const videoUrl of [video.downloadAddr, video.playAddr]) if (videoUrl) candidatos.push({
        url: String(videoUrl).replace(/\\u0026/g, '&').replace(/\\u002F/g, '/'),
        bitrate: Number(video.bitrate || 0), codec: String(video.codecType || 'h264')
    });
    const validos = candidatos.filter(x => typeof x.url === 'string' && (x.url.startsWith('https://') || x.url.startsWith('http://')));
    if (!validos.length) throw new Error('TikTok no devolvió una URL MP4');
    const h264 = validos.filter(x => /h264/i.test(x.codec));
    const lista = h264.length ? h264 : validos;
    lista.sort((a,b) => b.bitrate - a.bitrate);
    return { videoUrl: lista[0].url, cookie: cookies, titulo: item?.desc || 'TikTok' };
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

    const extraerJsonScript = (id) => {
        const inicio = pagina.indexOf('<script id="' + id + '"');
        if (inicio < 0) return null;
        const inicioContenido = pagina.indexOf('>', inicio);
        if (inicioContenido < 0) return null;
        const fin = pagina.indexOf('</script>', inicioContenido);
        if (fin < 0) return null;
        try {
            return JSON.parse(pagina.slice(inicioContenido + 1, fin));
        } catch {
            return null;
        }
    };

    data = extraerJsonScript('__UNIVERSAL_DATA_FOR_REHYDRATION__');

    // TikTok también ha usado SIGI_STATE como fuente de datos.
    if (!data) {
        data = extraerJsonScript('SIGI_STATE');
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

    const validos = candidatos.filter(x =>
        typeof x.url === 'string' &&
        (x.url.startsWith('https://') || x.url.startsWith('http://'))
    );
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

async function obtenerTikTokConNavegador(url) {
    let browser;
    try {
        browser = await puppeteer.launch(opcionesPuppeteer());
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' });
        await page.setViewport({ width: 1365, height: 900 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(resolve => setTimeout(resolve, 2500));
        const pagina = await page.content();
        const cookies = (await page.cookies()).map(c => c.name + '=' + c.value).join('; ');
        return extraerDatosTikTokDePagina(pagina, cookies);
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

async function descargarVideoTikTokConNavegador(videoUrl, cookie = '') {
    let browser;
    try {
        browser = await puppeteer.launch(opcionesPuppeteer());
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1365, height: 900 });
        if (cookie) {
            const cookies = cookie.split(';').map(x => x.trim()).filter(Boolean).map(x => {
                const i = x.indexOf('=');
                return i > 0 ? { name:x.slice(0,i), value:x.slice(i+1), domain:'.tiktok.com', path:'/' } : null;
            }).filter(Boolean);
            if (cookies.length) await page.setCookie(...cookies);
        }
        await page.setExtraHTTPHeaders({
            'Referer':'https://www.tiktok.com/',
            'Accept-Language':'es-MX,es;q=0.9,en;q=0.8'
        });

        let videoResponse = null;
        page.on('response', response => {
            try {
                if (videoResponse || !response.ok()) return;
                const h = response.headers();
                const type = String(h['content-type'] || '').toLowerCase();
                const u = response.url();
                const len = Number(h['content-length'] || 0);
                const media = type.includes('video/') ||
                    /\.(mp4|m4v|mov)(?:$|[?#])/i.test(u) ||
                    /tiktokcdn\.com/i.test(u) && len > 10000;
                if (media) videoResponse = response;
            } catch (_) {}
        });

        await page.goto('about:blank', {waitUntil:'domcontentloaded', timeout:15000});
        await page.evaluate(url => {
            const v=document.createElement('video');
            v.muted=true; v.preload='auto'; v.src=url; v.load();
            document.body.appendChild(v);
        }, videoUrl);

        const inicio=Date.now();
        while (!videoResponse && Date.now()-inicio<30000)
            await new Promise(r=>setTimeout(r,200));

        if (videoResponse) {
            try {
                const b=await videoResponse.buffer();
                if (b?.length>10000) return b;
            } catch (_) {}
        }

        // Segunda vía: fetch dentro de Chromium.
        try {
            const b64=await page.evaluate(async url => {
                const r=await fetch(url,{credentials:'include'});
                if(!r.ok) throw new Error('HTTP '+r.status);
                const a=new Uint8Array(await r.arrayBuffer());
                let s='';
                for(let i=0;i<a.length;i+=0x8000) s+=String.fromCharCode(...a.subarray(i,i+0x8000));
                return btoa(s);
            },videoUrl);
            const b=Buffer.from(b64,'base64');
            if(b.length>10000) return b;
        } catch (_) {}

        // Tercera vía: navegación directa al recurso.
        try {
            let rmp4=null;
            const handler=r=>{
                try {
                    const type=String(r.headers()['content-type']||'');
                    if(!rmp4 && r.ok() && (/video\//i.test(type)||/\.(mp4|m4v|mov)(?:$|[?#])/i.test(r.url())||/tiktokcdn\.com/i.test(r.url()))) rmp4=r;
                } catch(_){}
            };
            page.on('response',handler);
            await page.goto(videoUrl,{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>{});
            if(rmp4){
                const b=await rmp4.buffer();
                if(b?.length>10000) return b;
            }
        } catch (_) {}

        throw new Error('Chromium no pudo obtener el cuerpo del MP4 del CDN');
    } finally {
        if(browser) await browser.close().catch(()=>{});
    }
}

async function obtenerCookiesTikTokParaYtDlp(url) {
    let browser;
    try {
        browser = await puppeteer.launch(opcionesPuppeteer());
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language':'es-MX,es;q=0.9,en;q=0.8',
            'Upgrade-Insecure-Requests':'1'
        });
        await page.goto(url, { waitUntil:'domcontentloaded', timeout:45000 }).catch(()=>{});
        await new Promise(resolve => setTimeout(resolve, 4000));
        const cookies = await page.cookies();
        if (!cookies.length) return null;

        const lineas = ['# Netscape HTTP Cookie File', '# Generated automatically for yt-dlp'];
        for (const c of cookies) {
            lineas.push([
                c.domain || '.tiktok.com',
                c.domain?.startsWith('.') ? 'TRUE' : 'FALSE',
                c.path || '/',
                c.secure ? 'TRUE' : 'FALSE',
                Math.round(c.expires > 0 ? c.expires : 0),
                c.name,
                c.value || ''
            ].join('\t'));
        }

        const archivo = path.join(os.tmpdir(), 'tiktok-cookies-' + crypto.randomBytes(8).toString('hex') + '.txt');
        fs.writeFileSync(archivo, lineas.join('\n') + '\n', 'utf8');
        return archivo;
    } catch (e) {
        console.warn('⚠️ No se pudieron obtener cookies de TikTok para yt-dlp:', e?.message || e);
        return null;
    } finally {
        if (browser) await browser.close().catch(()=>{});
    }
}

async function ejecutarYtDlpDescarga(url, cookieFile = null) {
    const salida = path.join(os.tmpdir(), 'tiktok-' + crypto.randomBytes(8).toString('hex') + '.mp4');
    try {
        const opciones = {
            output: salida,
            format: 'best[ext=mp4]/best',
            noWarnings: true,
            noPlaylist: true,
            noCheckCertificates: true,
            impersonate: 'chrome',
            jsRuntimes: 'node',
            remoteComponents: 'ejs:github',
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            referer: 'https://www.tiktok.com/',
            socketTimeout: 30,
            retries: 5,
            fragmentRetries: 5,
            extractorRetries: 3,
            noPart: true,
            geoBypass: true
        };
        if (cookieFile) opciones.cookies = cookieFile;

        await youtubedl(url, opciones, { timeout: 120000 });

        if (!fs.existsSync(salida)) throw new Error('yt-dlp terminó pero no creó el archivo MP4');
        const buffer = fs.readFileSync(salida);
        if (!buffer.length || buffer.length < 10000) throw new Error('yt-dlp creó un archivo de video vacío o inválido');
        return buffer;
    } catch (e) {
        throw new Error(String(e?.message || e).replace(/\s+/g, ' ').slice(0, 700));
    } finally {
        try { if (fs.existsSync(salida)) fs.unlinkSync(salida); } catch (_) {}
    }
}

async function descargarTikTokConYtDlp(url) {
    let ultimo = null;

    // Deja que yt-dlp haga la descarga completa. Esto evita perder cookies,
    // headers, redirects y lógica específica del extractor al pasar la URL a fetch.
    try {
        return await ejecutarYtDlpDescarga(url);
    } catch (e) {
        ultimo = e;
        console.warn('⚠️ yt-dlp directo falló:', e.message);
    }

    // Se omite la extracción de cookies desde el perfil de Chrome en Render.
    // SnapTik y los extractores con navegador cubren esta vía.

    // Último intento: extracción JSON + descarga manual de la URL devuelta.
    try {
        const datos = await youtubedl(url,{
            dumpSingleJson:true,
            noWarnings:true,
            noPlaylist:true,
            noCheckCertificates:true,
            format:'best[ext=mp4]/best',
            impersonate:'chrome',
            jsRuntimes:'node',
            remoteComponents:'ejs:github',
            userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            referer:'https://www.tiktok.com/',
            socketTimeout:30,
            retries:3
        },{timeout:90000});

        const formatos=Array.isArray(datos?.formats)?datos.formats:[];
        const candidatos=[
            datos?.requested_downloads?.[0]?.url,
            datos?.url,
            ...formatos.filter(f=>f?.url&&(!f.ext||f.ext==='mp4'))
                .sort((a,b)=>Number(b.tbr||0)-Number(a.tbr||0)).map(f=>f.url)
        ].filter(x=>typeof x==='string'&&/^https?:\/\/.*/i.test(x));

        for(const u of candidatos.slice(0,3)){
            try {
                const b=await descargarVideoTikTok(u);
                if(b?.length>10000) return b;
            } catch(e){ ultimo=e; }
        }
    } catch(e) {
        ultimo = e;
    }

    throw new Error('yt-dlp no pudo descargar el TikTok' + (ultimo?.message ? ': ' + ultimo.message : ''));
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
            'Referer': 'https://www.tikwm.com/'
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
            'Referer': 'https://www.tiktok.com/',
            ...(cookie ? { 'Cookie': cookie } : {})
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

async function descargarTikTokConSnapTik(url) {
    let browser;
    try {
        browser = await puppeteer.launch(opcionesPuppeteer());
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' });
        await page.goto('https://snaptik.fi/es', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(r => setTimeout(r, 1200));
        const input = await page.$('input[type="url"], input[name="url"], input[placeholder*="URL" i], input');
        if (!input) throw new Error('SnapTik no mostró el campo de enlace');
        await input.click({ clickCount: 3 });
        await input.type(url, { delay: 3 });
        const botones = await page.$('button, input[type="submit"], input[type="button"], a');
        let downloadButton = null;
        for (const button of botones) {
            const text = await button.evaluate(el => (el.innerText || el.textContent || el.value || '').trim());
            if (/descargar|download/i.test(text)) { downloadButton = button; break; }
        }
        if (!downloadButton) {
            console.warn('⚠️ SnapTik: no encontré botón Descargar. Intentando Enter en el campo.');
            await input.press('Enter').catch(() => {});
        } else {
            await downloadButton.click().catch(async () => {
                await input.press('Enter').catch(() => {});
            });
        }
        let mediaResponse = null;
        page.on('response', response => {
            try {
                const type = String(response.headers()['content-type'] || '').toLowerCase();
                const u = response.url();
                if (response.ok() && (type.includes('video/') || /\.mp4(?:$|[?#])/i.test(u))) mediaResponse = response;
            } catch (_) {}
        });
        await page.waitForFunction(() => Array.from(document.querySelectorAll('a[href]')).some(a => /\.mp4|download|tiktokcdn/i.test(a.href)), { timeout: 45000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 3500));
        if (mediaResponse) {
            const buffer = await mediaResponse.buffer().catch(() => null);
            if (buffer?.length > 10000) return buffer;
        }
        const links = await page.$eval('a[href]', as => as.map(a => ({ href: a.href, text: (a.innerText || a.textContent || '').trim() })).filter(x => /^https?:/i.test(x.href)));
        console.log('🎵 SnapTik: enlaces encontrados:', links.length);
        links.sort((a,b) => {
            const score = x => (/\.mp4/i.test(x.href) ? 100 : 0) + (/hd|1080|720/i.test(x.text + x.href) ? 30 : 0) + (/download/i.test(x.href) ? 10 : 0);
            return score(b) - score(a);
        });
        for (const link of links.slice(0, 10)) {
            try {
                const result = await page.evaluate(async href => {
                    const r = await fetch(href, { credentials: 'include', redirect: 'follow' });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const type = String(r.headers.get('content-type') || '').toLowerCase();
                    if (type.includes('text/html')) throw new Error('HTML');
                    const data = new Uint8Array(await r.arrayBuffer());
                    let binary = '';
                    for (let i=0; i<data.length; i+=0x8000) binary += String.fromCharCode(...data.subarray(i,i+0x8000));
                    return btoa(binary);
                }, link.href);
                const buffer = Buffer.from(result, 'base64');
                if (buffer.length > 10000) return buffer;
            } catch (_) {}
        }
        throw new Error('SnapTik no devolvió un MP4 descargable');
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}


async function comandoTiktok(sock, chatId, msg, args) {
    const textoArgumentos = Array.isArray(args) ? args.join(' ') : String(args || '');
    const urlOriginal = extraerUrlTikTok(textoArgumentos);
    console.log('🎵 TIKTOK: comando recibido. Texto:', textoArgumentos);
    console.log('🎵 TIKTOK: URL extraída:', urlOriginal || 'NO ENCONTRADA');

    if (!urlOriginal) {
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
        let videoBuffer = null;

        // Resolvemos enlaces vt/vm/t para entregar a cada proveedor el URL
        // canónico siempre que TikTok permita obtenerlo.
        url = await resolverEnlaceTikTok(url);
        console.log('🎵 TIKTOK: URL a procesar:', url);

        // SnapTik es el método principal: acepta los enlaces copiados desde
        // Compartir y ofrece descarga HD 1080p/720p sin marca de agua.
        try {
            console.log('🎵 TIKTOK: intentando SnapTik...');
            videoBuffer = await descargarTikTokConSnapTik(url);
            if (!videoBuffer?.length && url !== urlOriginal) {
                videoBuffer = await descargarTikTokConSnapTik(urlOriginal);
            }
            console.log('🎵 TIKTOK: SnapTik respondió con', videoBuffer?.length || 0, 'bytes');
        } catch (errorSnapTik) {
            console.warn('⚠️ SnapTik falló:', errorSnapTik.message);
            errores.push('SnapTik: ' + errorSnapTik.message);
        }

        // Si SnapTik no pudo, pasamos al extractor directo de TikTok.
        if (!videoBuffer) {
            try {
                datos = await obtenerTikTokDirecto(url);
            } catch (errorDirecto) {
                errores.push('TikTok directo: ' + errorDirecto.message);
            }
        }

        if (!datos && !videoBuffer) {
            try {
                datos = await obtenerTikTokConNavegador(url);
            } catch (errorNavegador) {
                errores.push('TikTok navegador: ' + errorNavegador.message);
            }
        }

        // Respaldo independiente: yt-dlp usa su propio extractor de TikTok.
        if (!datos) {
            try {
                const videoYtDlp = await descargarTikTokConYtDlp(url);
                videoBuffer = videoYtDlp;
            } catch (errorYtDlp) {
                errores.push(errorYtDlp.message);
            }
        }

        // Si TikTok no entregó el MP4 directamente, usamos los proveedores externos.
        if (!datos && !videoBuffer) {
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
            
            
        }

        if (!datos?.videoUrl && !videoBuffer) {
            throw new Error(errores.join(' | ') || 'Ningún servicio devolvió el video');
        }

        if (!videoBuffer) try {
            videoBuffer = await descargarVideoTikTok(datos.videoUrl, datos.cookie || '');
        } catch (errorDescarga) {
            errores.push('CDN directo: ' + errorDescarga.message);
            try {
                videoBuffer = await descargarVideoTikTokConNavegador(datos.videoUrl, datos.cookie || '');
            } catch (errorNavegador) {
                errores.push('CDN navegador: ' + errorNavegador.message);
            }

            // Si el parser encontró una URL pero el CDN la rechaza, no nos
            // quedamos atrapados con esa URL: volvemos a un extractor distinto.
            if (!videoBuffer) {
                try {
                    videoBuffer = await descargarTikTokConYtDlp(url);
                } catch (errorYtDlp) {
                    errores.push(errorYtDlp.message);
                }
            }
        }
        if (!videoBuffer?.length) throw new Error(errores.join(' | ') || 'No se pudo descargar el video');

        await sock.sendMessage(chatId, {
            video: videoBuffer,
            mimetype: 'video/mp4',
            caption: '🎵 *TikTok sin marca de agua*\n\nTu video está listo.\n\nApoya a un creador, código: *JASC13*'
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
