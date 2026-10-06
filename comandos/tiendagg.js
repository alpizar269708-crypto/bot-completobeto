const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const BASE_URL = 'https://fortnite.gg';
let tiendaGGEnCurso = false;
let tiendaGGFase = 'iniciando';
let tiendaGGTimer = null;

const FILTROS = [
    { claves: ['todos', 'todo', 'all'], label: 'TODOS', path: '/cosmetics' },
    { claves: ['nuevos', 'nuevo', 'new'], label: 'NUEVOS', path: '/shop?type=new' },
    { claves: ['se van', 'sevan', 'salen', 'hoy', 'leaving'], label: 'SE VAN', path: '/shop?type=leaving' },
    { claves: ['skins', 'skin', 'trajes', 'outfits', 'outfit'], label: 'SKINS', path: '/cosmetics?type=outfit' },
    { claves: ['bailes', 'baile', 'emotes', 'emote', 'gestos'], label: 'BAILES', path: '/cosmetics?type=emote' },
    { claves: ['picos', 'pico', 'hachas', 'pickaxes', 'pickaxe'], label: 'PICOS', path: '/cosmetics?type=pickaxe' },
    { claves: ['mochilas', 'mochila', 'backpack', 'backpacks', 'backblings'], label: 'MOCHILAS', path: '/cosmetics?type=backpack' },
    { claves: ['planeadores', 'planeador', 'gliders', 'glider'], label: 'PLANEADORES', path: '/cosmetics?type=glider' },
    { claves: ['sidekicks', 'sidekick', 'compañeros', 'companeros'], label: 'COMPAÑEROS', path: '/cosmetics?type=sidekick' },
    { claves: ['kicks', 'zapatillas'], label: 'KICKS', path: '/cosmetics?type=kicks' },
    { claves: ['envolturas', 'envoltura', 'wraps', 'wrap'], label: 'ENVOLTURAS', path: '/cosmetics?type=wrap' },
    { claves: ['pantallas', 'pantalla', 'loadings', 'loading', 'loadingscreens'], label: 'PANTALLAS DE CARGA', path: '/cosmetics?type=loadingscreen' },
    { claves: ['musica', 'música', 'music'], label: 'MÚSICA', path: '/cosmetics?type=music' },
    { claves: ['estelas', 'estela', 'contrails', 'contrail'], label: 'ESTELAS', path: '/cosmetics?type=contrail' },
    { claves: ['sprays', 'spray', 'aerosoles', 'aerosol'], label: 'SPRAYS', path: '/cosmetics?type=spray' },
    { claves: ['emojis', 'emoji'], label: 'EMOJIS', path: '/cosmetics?type=emoji' },
    { claves: ['banners', 'banner'], label: 'BANNERS', path: '/cosmetics?type=banner' },
    { claves: ['lotes', 'lote', 'bundles', 'bundle'], label: 'LOTES', path: '/cosmetics?type=bundle' },
    { claves: ['autos', 'auto', 'cars', 'car'], label: 'AUTOS', path: '/cosmetics?type=car' },
    { claves: ['calcomanias', 'calcomanías', 'decal', 'decals'], label: 'CALCOMANÍAS', path: '/cosmetics?type=decal' },
    { claves: ['ruedas', 'rueda', 'wheels', 'wheel'], label: 'RUEDAS', path: '/cosmetics?type=wheel' },
    { claves: ['trails', 'trail', 'estelas racing'], label: 'TRAILS', path: '/cosmetics?type=trail' },
    { claves: ['impulsos', 'impulso', 'boost', 'boosts'], label: 'IMPULSOS', path: '/cosmetics?type=boost' },
    { claves: ['canciones', 'cancion', 'canción', 'jamtracks', 'jamtrack'], label: 'CANCIONES', path: '/cosmetics?type=jamtrack' },
    { claves: ['instrumentos', 'instrumento'], label: 'INSTRUMENTOS', path: '/cosmetics?type=instrument' },
    { claves: ['guitarras', 'guitarra', 'guitars', 'guitar'], label: 'GUITARRAS', path: '/cosmetics?type=guitar' },
    { claves: ['bajos', 'bajo', 'basses', 'bass'], label: 'BAJOS', path: '/cosmetics?type=bass' },
    { claves: ['baterias', 'batería', 'baterias', 'drums'], label: 'BATERÍAS', path: '/cosmetics?type=drums' },
    { claves: ['keytars', 'keytar'], label: 'KEYTARS', path: '/cosmetics?type=KEYTAR' },
    { claves: ['microfonos', 'micrófonos', 'microfono', 'mic', 'microphone'], label: 'MICRÓFONOS', path: '/cosmetics?type=microphone' },
    { claves: ['auras', 'aura'], label: 'AURAS', path: '/cosmetics?type=aura' },
    { claves: ['lego skins', 'lego skin', 'lego outfits', 'lego-outfit'], label: 'LEGO OUTFITS', path: '/cosmetics?game=lego&type=outfit' },
    { claves: ['lego bailes', 'lego emotes', 'lego-emote'], label: 'LEGO EMOTES', path: '/cosmetics?game=lego&type=emote' },
    { claves: ['construcciones', 'builds', 'build'], label: 'CONSTRUCCIONES', path: '/cosmetics?game=lego&type=build' },
    { claves: ['decoraciones', 'decoracion', 'decoración', 'decors', 'decor'], label: 'DECORACIONES', path: '/cosmetics?game=lego&type=decor' }
];

const RAREZAS = {
    legendary: 'Legendaria', epic: 'Épica', rare: 'Rara', uncommon: 'Poco común',
    common: 'Común', mythic: 'Mítica', icon: 'Icon', gaming: 'Gaming'
};

const TIPOS = {
    outfit: 'Skin', outfits: 'Skins', emote: 'Baile', emotes: 'Bailes',
    pickaxe: 'Pico', pickaxes: 'Picos', backpack: 'Mochila', backblings: 'Mochilas',
    glider: 'Planeador', gliders: 'Planeadores', sidekick: 'Compañero', sidekicks: 'Compañeros',
    kicks: 'Kicks', wrap: 'Envoltura', wraps: 'Envolturas', loadingscreen: 'Pantalla de carga',
    loadingscreens: 'Pantallas de carga', music: 'Música', contrail: 'Estela', contrails: 'Estelas',
    spray: 'Spray', sprays: 'Sprays', emoji: 'Emoji', emojis: 'Emojis', banner: 'Banner',
    banners: 'Banners', bundle: 'Lote', bundles: 'Lotes', car: 'Auto', cars: 'Autos',
    decal: 'Calcomanía', decals: 'Calcomanías', wheel: 'Rueda', wheels: 'Ruedas',
    trail: 'Trail', trails: 'Trails', boost: 'Impulso', boosts: 'Impulsos',
    jamtrack: 'Canción', jamtracks: 'Canciones', instrument: 'Instrumento', instruments: 'Instrumentos',
    guitar: 'Guitarra', guitars: 'Guitarras', bass: 'Bajo', basses: 'Bajos', drums: 'Batería',
    keytar: 'Keytar', microphone: 'Micrófono', aura: 'Aura', build: 'Construcción',
    builds: 'Construcciones', decor: 'Decoración', decors: 'Decoraciones'
};

function normalizar(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function encontrarFiltro(argumentos) {
    const texto = normalizar(Array.isArray(argumentos) ? argumentos.join(' ') : argumentos);
    if (!texto) return null;
    let mejor = null;
    for (const filtro of FILTROS) {
        for (const clave of filtro.claves) {
            const k = normalizar(clave);
            if (texto === k || texto.startsWith(k + ' ')) {
                if (!mejor || k.length > mejor.longitud) mejor = { filtro, longitud: k.length };
            }
        }
    }
    return mejor?.filtro || null;
}

async function reportarFase(sock, chatId, msg, fase) {
    tiendaGGFase = fase;
    try {
        await sock.sendMessage(chatId, { text: `🛠️ *JASC STORE — DIAGNÓSTICO*\n\n📍 ${fase}` }, { quoted: msg });
    } catch (error) {
        console.error('❌ No pude enviar diagnóstico de tiendagg:', error.message);
    }
}

async function abrirNavegador() {
    return puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--no-first-run', '--no-zygote',
            '--disable-blink-features=AutomationControlled'
        ]
    });
}

async function prepararPagina(page) {
    page.setDefaultNavigationTimeout(15000);
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' });
    await page.setRequestInterception(true);
    page.on('request', request => {
        const tipo = request.resourceType();
        if (['image', 'media', 'font'].includes(tipo)) request.abort().catch(() => {});
        else request.continue().catch(() => {});
    });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
}

async function buscarCosmeticosEnPagina(page, termino) {
    const url = BASE_URL + '/cosmetics';
    console.log('🔎 TIENDAGG: buscando "' + termino + '" en ' + url);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (error) {
        console.warn('⚠️ Fortnite.GG: la carga del catálogo agotó tiempo: ' + error.message);
    }

    const buscador = await page.$('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]');
    if (!buscador) throw new Error('No encontré el buscador del catálogo de Fortnite.GG');

    await buscador.click({ clickCount: 3 });
    await buscador.type(termino, { delay: 20 });
    await new Promise(resolve => setTimeout(resolve, 1200));

    await page.evaluate(() => {
        document.querySelectorAll('#items a.item-icon').forEach(el => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            if (!visible) el.remove();
        });
    });

    return page.content();
}

async function obtenerHtmlConNavegador(page, url, selector = null) {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    } catch (error) {
        console.warn('⚠️ Fortnite.GG: navegación agotó tiempo: ' + error.message);
    }

    if (selector) {
        try {
            await page.waitForSelector(selector, { timeout: 3000 });
        } catch (_) {
            console.warn('⚠️ Fortnite.GG: no apareció el selector esperado: ' + selector);
        }
    }

    await new Promise(resolve => setTimeout(resolve, 400));
    return page.content();
}

function limpiarTexto(texto) { return String(texto || '').replace(/\s+/g, ' ').trim(); }

function extraerCampo($, nombre) {
    let valor = null;
    $('.fn-detail-table tr').each((_, tr) => {
        if (valor) return;
        const th = limpiarTexto($(tr).find('th').first().text());
        if (normalizar(th).replace(/:$/, '') === normalizar(nombre).replace(/:$/, '')) {
            valor = limpiarTexto($(tr).find('td').first().text());
        }
    });
    return valor;
}

function traducirRareza(valor) { return RAREZAS[normalizar(valor)] || valor; }
function traducirTipo(valor) { return TIPOS[normalizar(valor)] || valor; }

function extraerDetalle(html, itemBase) {
    const $ = cheerio.load(html);
    const nombre = limpiarTexto($('.fn-detail-name').first().text()) || itemBase.nombre;
    const tipoEl = $('.fn-detail-type').first();
    let rareza = '';
    let tipo = '';
    if (tipoEl.length) {
        rareza = limpiarTexto(tipoEl.find('span').first().text());
        const clon = tipoEl.clone();
        clon.find('span').remove();
        tipo = limpiarTexto(clon.text());
    }

    const precio = limpiarTexto($('.fn-item-price').first().text()) || itemBase.precio || 'No disponible';
    const timeEl = $('time.shop-out').first();
    const salidaTexto = limpiarTexto(timeEl.text());
    const salidaIso = timeEl.attr('datetime') || null;
    const descripcion = [];
    const etiquetas = [];

    $('.fn-detail-desc.grey').each((_, el) => {
        const texto = limpiarTexto($(el).text());
        if (!texto) return;
        if (/^\[.*\]$/.test(texto)) etiquetas.push(texto.replace(/^\[|\]$/g, ''));
        else if (!descripcion.includes(texto)) descripcion.push(texto);
    });

    let conjunto = null;
    $('span.grey').each((_, el) => {
        if (conjunto) return;
        const inicio = limpiarTexto($(el).text());
        if (!/^Part of the$/i.test(inicio)) return;
        const texto = limpiarTexto($(el).parent().text());
        const match = texto.match(/^Part of the\s+(.+?)\s+set$/i);
        if (match) conjunto = match[1].trim();
    });

    return {
        nombre,
        tipo: traducirTipo(tipo || itemBase.tipo || ''),
        rareza: traducirRareza(rareza),
        precio,
        salida: salidaTexto || limpiarTexto($('.fn-shop-text').first().text()).replace(/^🕑\s*Leaving Shop on\s*/i, ''),
        salidaIso,
        fuente: extraerCampo($, 'Source'),
        temporada: extraerCampo($, 'Introduced in'),
        lanzamiento: extraerCampo($, 'Release date'),
        ultimaVez: extraerCampo($, 'Last seen'),
        apariciones: extraerCampo($, 'Occurrences'),
        descripcion: descripcion[0] || null,
        etiquetas,
        conjunto,
        url: itemBase.url,
        id: itemBase.id
    };
}

function extraerItemsTienda(html) {
    const $ = cheerio.load(html);
    const items = [];
    const vistos = new Set();

    $('#items a.item-icon[href*="/cosmetics?id="]').each((_, el) => {
        let href = String($(el).attr('href') || '').trim();
        const idMatch = href.match(/[?&]id=([^&]+)/i) || href.match(/^\/cosmetics\/([^?#]+)/i);
        const id = idMatch ? decodeURIComponent(idMatch[1]) : href;
        const nombre = limpiarTexto($(el).find('.item-icon-name').first().text()) ||
            limpiarTexto($(el).find('[class*="name"]').first().text()) ||
            limpiarTexto($(el).find('img').first().attr('alt') || '').replace(/^Fortnite\s+/i, '') ||
            limpiarTexto($(el).text()).replace(/\b\d+(?:\.\d+)?\b/g, '').trim();

        if (!href) return;
        try { href = new URL(href, BASE_URL).toString(); } catch (_) { return; }

        const clave = id + '|' + href;
        if (vistos.has(clave)) return;
        vistos.add(clave);

        items.push({
            id,
            nombre,
            url: href,
            precio: limpiarTexto($(el).find('.item-icon-price').first().text()),
            tipo: ''
        });
    });

    return items;
}

function formatearItem(item, indice) {
    const lineas = [`${indice}. 🎮 *${item.nombre}*`];
    if (item.precio) lineas.push(`   💰 ${String(item.precio).trim()} pavos`);
    if (item.tipo || item.rareza) {
        const partes = [item.rareza, item.tipo].filter(Boolean);
        if (partes.length) lineas.push(`   🏷️ ${partes.join(' • ')}`);
    }
    if (item.descripcion) lineas.push(`   📝 ${item.descripcion}`);
    if (item.lanzamiento) lineas.push(`   📅 Salió: ${item.lanzamiento}`);
    if (item.ultimaVez) lineas.push(`   👀 Última vez: ${item.ultimaVez}`);
    if (item.salida) lineas.push(`   🕑 Se va de la tienda: ${item.salida}`);
    if (item.apariciones) lineas.push(`   🔁 Apariciones: ${item.apariciones}`);
    if (item.temporada) lineas.push(`   📚 Introducido en: ${item.temporada}`);
    if (item.fuente) lineas.push(`   📌 Fuente: ${item.fuente === 'Shop' ? 'Tienda' : item.fuente}`);
    if (item.conjunto) lineas.push(`   🧩 Conjunto: ${item.conjunto}`);
    if (item.etiquetas?.length) lineas.push(`   ⚡ ${item.etiquetas.join(' • ')}`);
    return lineas.join('\n');
}

async function enriquecerItems(items, page, reportar) {
    const resultado = [];

    await reportar('Preparando lectura detallada de ' + items.length + ' coincidencia(s)...');

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await reportar('Leyendo detalle ' + (i + 1) + '/' + items.length + ': ' + item.nombre);

        try {
            const html = await obtenerHtmlConNavegador(page, item.url, '.fn-detail-name');
            resultado.push(extraerDetalle(html, item));
        } catch (error) {
            console.warn('⚠️ Fortnite.GG: no se pudo leer el detalle de ' + item.nombre + ': ' + error.message);
            await reportar('No se pudo leer "' + item.nombre + '". Continuando con el siguiente...');
            resultado.push(item);
        }
    }

    return resultado;
}

async function enviarPorPartes(sock, chatId, msg, partes) {
    for (const parte of partes) await sock.sendMessage(chatId, { text: parte }, { quoted: msg });
}

async function comandoTiendaGG(sock, chatId, msg, args) {
    const filtro = encontrarFiltro(args);
    const textoBusqueda = normalizar(Array.isArray(args) ? args.join(' ') : args);

    if (!filtro && !textoBusqueda) {
        const texto = `🛍️ *JASC STORE*\n\nUsa un filtro, por ejemplo:\n\n🔷 tiendagg nuevos\n🔷 tiendagg se van\n🔷 tiendagg skins\n🔷 tiendagg bailes\n🔷 tiendagg picos\n🔷 tiendagg mochilas\n🔷 tiendagg planeadores\n🔷 tiendagg envolturas\n🔷 tiendagg lotes\n\nEl comando actual *tienda* no se modifica.\n\nApoya a un creador: *JASC13*`;
        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
        return;
    }

    if (tiendaGGEnCurso) {
        await sock.sendMessage(chatId, { text: '⏳ 🛍️ *JASC STORE* ya está consultando la tienda. Espera a que termine la consulta actual.' }, { quoted: msg });
        return;
    }

    tiendaGGEnCurso = true;
    tiendaGGFase = 'iniciando consulta';
    let browser = null;
    let tiendaGGAbortada = false;
    const iniciarTiempo = Date.now();

    const actualizarFase = fase => {
        tiendaGGFase = fase;
        return fase;
    };

    tiendaGGTimer = setTimeout(async () => {
        tiendaGGAbortada = true;
        tiendaGGEnCurso = false;
        const faseTimeout = tiendaGGFase;
        console.error('❌ TIENDAGG TIMEOUT. Fase:', faseTimeout);
        if (browser) await browser.close().catch(() => {});

        try {
            await sock.sendMessage(chatId, {
                text: `❌ *JASC STORE — TIMEOUT*\n\nLa consulta lleva demasiado tiempo.\n\n📍 Se quedó en: *${faseTimeout}*\n⏱️ Se cerró el navegador y se liberó la consulta.`
            }, { quoted: msg });
        } catch (error) {
            console.error('❌ Error enviando timeout de tiendagg:', error.message);
        }
    }, 60000);

    try {
        await sock.sendMessage(chatId, {
            text: filtro
                ? `⏳ 🛍️ *JASC STORE*\n\nLeyendo filtro: *${filtro.label}*...\nConsultando el catálogo...`
                : `🔎 🛍️ *JASC STORE*\n\nBuscando: *${args.join(' ')}*...`
        }, { quoted: msg });

        const fase = async texto => {
            actualizarFase(texto);
            await reportarFase(sock, chatId, msg, texto);
        };

        await fase('Abriendo navegador Puppeteer...');
        browser = await abrirNavegador();

        await fase('Puppeteer abierto. Creando página principal...');
        await fase('Creando página principal...');
        const page = await browser.newPage();

        await fase('Página principal creada. Preparando conexión...');
        await prepararPagina(page);
        await fase('Página principal lista.');

        let html;
        if (filtro) {
            await fase('Navegando a: ' + filtro.path);
            const url = BASE_URL + filtro.path;
            console.log('🛒 TIENDAGG: abriendo navegador para ' + url);
            html = await obtenerHtmlConNavegador(page, url, '#items a.item-icon[href*="/cosmetics?id="]');
        } else {
            await fase('Escribiendo la búsqueda: ' + args.join(' '));
            html = await buscarCosmeticosEnPagina(page, args.join(' '));
        }

        await fase('Página cargada. Extrayendo coincidencias...');
        const itemsBase = extraerItemsTienda(html);

        if (!itemsBase.length) {
            throw new Error(filtro
                ? 'No se encontraron artículos en el catálogo de Fortnite.GG'
                : 'No encontré coincidencias para "' + args.join(' ') + '"');
        }

        console.log('🛒 TIENDAGG: ' + itemsBase.length + ' artículos detectados');
        await fase(itemsBase.length + ' coincidencia(s) detectada(s).');

        let items = itemsBase;
        if (itemsBase.length <= 10) {
            await fase('Preparando lectura detallada de ' + itemsBase.length + ' coincidencia(s)...');
            items = await enriquecerItems(itemsBase, page, fase);
        } else {
            await fase('Hay más de 10 coincidencias; mostrando datos del catálogo para evitar sobrecargar Render.');
        }

        const cabecera = (filtro
            ? `🛍️ *JASC STORE — ${filtro.label}*\n`
            : `🔎 *RESULTADOS PARA: ${args.join(' ')}*\n`) +
            `📦 ${items.length} coincidencia(s)\n\n`;

        const bloques = [];
        let actual = cabecera;

        for (let i = 0; i < items.length; i++) {
            const bloque = formatearItem(items[i], i + 1) + '\n\n';
            if ((actual + bloque).length > 60000) {
                bloques.push(actual.trim());
                actual = '';
            }
            actual += bloque;
        }

        actual += 'Apoya a un creador: *JASC13*';
        if (actual.trim()) bloques.push(actual.trim());

        await fase('Consulta terminada. Enviando resultados...');
        await enviarPorPartes(sock, chatId, msg, bloques);

        console.log('✅ TIENDAGG terminado en ' + ((Date.now() - iniciarTiempo) / 1000).toFixed(1) + 's');
    } catch (error) {
        console.error('❌ Error en tiendagg:', error);
        if (tiendaGGAbortada) return;

        try {
            await sock.sendMessage(chatId, {
                text: `❌ *JASC STORE — ERROR*\n\n📍 Se trabó en: *${tiendaGGFase}*\n\n💥 Error: ${String(error?.message || error).replace(/\\s+/g, ' ').slice(0, 700)}`
            }, { quoted: msg });
        } catch (sendError) {
            console.error('❌ No pude enviar el error por WhatsApp:', sendError.message);
        }

        await sock.sendMessage(chatId, {
            text: `❌ No pude leer la tienda en este momento.\n\nDetalle: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 300)}`
        }, { quoted: msg });
    } finally {
        if (tiendaGGTimer) clearTimeout(tiendaGGTimer);
        tiendaGGTimer = null;
        tiendaGGEnCurso = false;
        tiendaGGFase = 'iniciando';
    }
}

module.exports = { comandoTiendaGG };
