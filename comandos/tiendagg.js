const cheerio = require('cheerio');

const BASE_URL = 'https://fortnite.gg';

const FILTROS = [
    { claves: ['todos', 'todo', 'all'], label: 'TODOS', path: '/shop' },
    { claves: ['nuevos', 'nuevo', 'new'], label: 'NUEVOS', path: '/shop?type=new' },
    { claves: ['se van', 'sevan', 'salen', 'hoy', 'leaving'], label: 'SE VAN', path: '/shop?type=leaving' },

    { claves: ['skins', 'skin', 'trajes', 'outfits', 'outfit'], label: 'SKINS', path: '/shop?filter=outfits' },
    { claves: ['bailes', 'baile', 'emotes', 'emote', 'gestos'], label: 'BAILES', path: '/shop?filter=emotes' },
    { claves: ['picos', 'pico', 'hachas', 'pickaxes', 'pickaxe'], label: 'PICOS', path: '/shop?filter=pickaxes' },
    { claves: ['mochilas', 'mochila', 'backpack', 'backpacks', 'backblings'], label: 'MOCHILAS', path: '/shop?filter=backblings' },
    { claves: ['planeadores', 'planeador', 'gliders', 'glider'], label: 'PLANEADORES', path: '/shop?filter=gliders' },
    { claves: ['sidekicks', 'sidekick', 'compañeros', 'companeros'], label: 'COMPAÑEROS', path: '/shop?filter=sidekicks' },
    { claves: ['kicks', 'zapatillas'], label: 'KICKS', path: '/shop?filter=kicks' },
    { claves: ['envolturas', 'envoltura', 'wraps', 'wrap'], label: 'ENVOLTURAS', path: '/shop?filter=wraps' },
    { claves: ['pantallas', 'pantalla', 'loadings', 'loading', 'loadingscreens'], label: 'PANTALLAS DE CARGA', path: '/shop?filter=loadingscreens' },
    { claves: ['musica', 'música', 'music'], label: 'MÚSICA', path: '/shop?filter=music' },
    { claves: ['estelas', 'estela', 'contrails', 'contrail'], label: 'ESTELAS', path: '/shop?filter=contrails' },
    { claves: ['sprays', 'spray', 'aerosoles', 'aerosol'], label: 'SPRAYS', path: '/shop?filter=sprays' },
    { claves: ['emojis', 'emoji'], label: 'EMOJIS', path: '/shop?filter=emojis' },
    { claves: ['banners', 'banner'], label: 'BANNERS', path: '/shop?filter=banners' },
    { claves: ['lotes', 'lote', 'bundles', 'bundle'], label: 'LOTES', path: '/shop?filter=bundles' },

    { claves: ['autos', 'auto', 'cars', 'car'], label: 'AUTOS', path: '/shop?filter=cars' },
    { claves: ['calcomanias', 'calcomanías', 'decal', 'decals'], label: 'CALCOMANÍAS', path: '/shop?filter=decals' },
    { claves: ['ruedas', 'rueda', 'wheels', 'wheel'], label: 'RUEDAS', path: '/shop?filter=wheels' },
    { claves: ['trails', 'trail', 'estelas racing'], label: 'TRAILS', path: '/shop?filter=trails' },
    { claves: ['impulsos', 'impulso', 'boost', 'boosts'], label: 'IMPULSOS', path: '/shop?filter=boosts' },

    { claves: ['canciones', 'cancion', 'canción', 'jamtracks', 'jamtrack'], label: 'CANCIONES', path: '/shop?filter=jamtracks' },
    { claves: ['instrumentos', 'instrumento'], label: 'INSTRUMENTOS', path: '/shop?filter=instruments' },
    { claves: ['guitarras', 'guitarra', 'guitars', 'guitar'], label: 'GUITARRAS', path: '/shop?filter=guitars' },
    { claves: ['bajos', 'bajo', 'basses', 'bass'], label: 'BAJOS', path: '/shop?filter=basses' },
    { claves: ['baterias', 'batería', 'baterias', 'drums'], label: 'BATERÍAS', path: '/shop?filter=drums' },
    { claves: ['keytars', 'keytar'], label: 'KEYTARS', path: '/shop?filter=keytars' },
    { claves: ['microfonos', 'micrófonos', 'microfono', 'mic', 'microphone'], label: 'MICRÓFONOS', path: '/shop?filter=microphones' },
    { claves: ['auras', 'aura'], label: 'AURAS', path: '/shop?filter=auras' },

    { claves: ['lego skins', 'lego skin', 'lego outfits', 'lego-outfit'], label: 'LEGO OUTFITS', path: '/shop?filter=lego-outfits' },
    { claves: ['lego bailes', 'lego emotes', 'lego-emote'], label: 'LEGO EMOTES', path: '/shop?filter=lego-emotes' },
    { claves: ['construcciones', 'builds', 'build'], label: 'CONSTRUCCIONES', path: '/shop?filter=builds' },
    { claves: ['decoraciones', 'decoracion', 'decoración', 'decors', 'decor'], label: 'DECORACIONES', path: '/shop?filter=decors' }
];

const RAREZAS = {
    legendary: 'Legendaria',
    epic: 'Épica',
    rare: 'Rara',
    uncommon: 'Poco común',
    common: 'Común',
    mythic: 'Mítica',
    icon: 'Icon',
    gaming: 'Gaming'
};

const TIPOS = {
    outfit: 'Skin',
    outfits: 'Skins',
    emote: 'Baile',
    emotes: 'Bailes',
    pickaxe: 'Pico',
    pickaxes: 'Picos',
    backpack: 'Mochila',
    backblings: 'Mochilas',
    glider: 'Planeador',
    gliders: 'Planeadores',
    sidekick: 'Compañero',
    sidekicks: 'Compañeros',
    kicks: 'Kicks',
    wrap: 'Envoltura',
    wraps: 'Envolturas',
    loadingscreen: 'Pantalla de carga',
    loadingscreens: 'Pantallas de carga',
    music: 'Música',
    contrail: 'Estela',
    contrails: 'Estelas',
    spray: 'Spray',
    sprays: 'Sprays',
    emoji: 'Emoji',
    emojis: 'Emojis',
    banner: 'Banner',
    banners: 'Banners',
    bundle: 'Lote',
    bundles: 'Lotes',
    car: 'Auto',
    cars: 'Autos',
    decal: 'Calcomanía',
    decals: 'Calcomanías',
    wheel: 'Rueda',
    wheels: 'Ruedas',
    trail: 'Trail',
    trails: 'Trails',
    boost: 'Impulso',
    boosts: 'Impulsos',
    jamtrack: 'Canción',
    jamtracks: 'Canciones',
    instrument: 'Instrumento',
    instruments: 'Instrumentos',
    guitar: 'Guitarra',
    guitars: 'Guitarras',
    bass: 'Bajo',
    basses: 'Bajos',
    drums: 'Batería',
    keytar: 'Keytar',
    microphone: 'Micrófono',
    aura: 'Aura',
    build: 'Construcción',
    builds: 'Construcciones',
    decor: 'Decoración',
    decors: 'Decoraciones'
};

function normalizar(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function encontrarFiltro(argumentos) {
    const texto = normalizar(Array.isArray(argumentos) ? argumentos.join(' ') : argumentos);
    if (!texto) return null;

    let mejor = null;

    for (const filtro of FILTROS) {
        for (const clave of filtro.claves) {
            const k = normalizar(clave);
            if (texto === k || texto.startsWith(k + ' ')) {
                if (!mejor || k.length > mejor.longitud) {
                    mejor = { filtro, longitud: k.length };
                }
            }
        }
    }

    return mejor?.filtro || null;
}

async function fetchTexto(url, opciones = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opciones.timeout || 20000);

    try {
        const respuesta = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'https://fortnite.gg/shop'
            }
        });

        if (!respuesta.ok) {
            throw new Error('HTTP ' + respuesta.status);
        }

        const html = await respuesta.text();
        if (!html || html.length < 1000) {
            throw new Error('Fortnite.GG devolvió una respuesta vacía');
        }

        return html;
    } finally {
        clearTimeout(timeout);
    }
}

function limpiarTexto(texto) {
    return String(texto || '').replace(/\s+/g, ' ').trim();
}

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

function traducirRareza(valor) {
    const clave = normalizar(valor);
    return RAREZAS[clave] || valor;
}

function traducirTipo(valor) {
    const clave = normalizar(valor);
    return TIPOS[clave] || valor;
}

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
        const contenedor = $(el).parent();
        const texto = limpiarTexto(contenedor.text());
        const match = texto.match(/^Part of the\s+(.+?)\s+set$/i);
        if (match) conjunto = match[1].trim();
    });

    const salida = {
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

    return salida;
}

function extraerItemsTienda(html) {
    const $ = cheerio.load(html);
    const items = [];
    const vistos = new Set();

    $('a.item-icon[data-id]').each((_, el) => {
        const id = String($(el).attr('data-id') || '').trim();
        let href = String($(el).attr('href') || '').trim();
        const nombre = limpiarTexto($(el).find('.item-icon-name').first().text()) ||
            limpiarTexto($(el).find('img').first().attr('alt') || '').replace(/^Fortnite\s+/i, '');

        if (!href || !id) return;

        try {
            href = new URL(href, BASE_URL).toString();
        } catch (_) {
            return;
        }

        const clave = id + '|' + href;
        if (vistos.has(clave)) return;
        vistos.add(clave);

        const precioCard = limpiarTexto($(el).find('.item-icon-price').first().text());

        items.push({
            id,
            nombre,
            url: href,
            precio: precioCard,
            tipo: ''
        });
    });

    return items;
}

function formatearItem(item, indice) {
    const lineas = [];
    lineas.push(`${indice}. 🎮 *${item.nombre}*`);

    if (item.precio) {
        const precio = String(item.precio).trim();
        lineas.push(`   💰 ${precio}`);
    }

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

    return lineas.join('\\n');
}

async function enriquecerItems(items) {
    const resultado = [];
    const concurrencia = 6;

    for (let inicio = 0; inicio < items.length; inicio += concurrencia) {
        const lote = items.slice(inicio, inicio + concurrencia);

        const enriquecidos = await Promise.all(lote.map(async (item) => {
            try {
                const html = await fetchTexto(item.url, { timeout: 12000 });
                return extraerDetalle(html, item);
            } catch (error) {
                console.warn(`⚠️ Fortnite.GG: no se pudo leer ${item.url}: ${error.message}`);
                return item;
            }
        }));

        resultado.push(...enriquecidos);
    }

    return resultado;
}

async function enviarPorPartes(sock, chatId, msg, partes) {
    for (const parte of partes) {
        await sock.sendMessage(chatId, { text: parte }, { quoted: msg });
    }
}

async function comandoTiendaGG(sock, chatId, msg, args) {
    const filtro = encontrarFiltro(args);

    if (!filtro) {
        const texto = `🛒 *TIENDA FORTNITE.GG*\n\n` +
            `Usa un filtro, por ejemplo:\n\n` +
            `🔷 tiendagg nuevos\n` +
            `🔷 tiendagg se van\n` +
            `🔷 tiendagg skins\n` +
            `🔷 tiendagg bailes\n` +
            `🔷 tiendagg picos\n` +
            `🔷 tiendagg mochilas\n` +
            `🔷 tiendagg planeadores\n` +
            `🔷 tiendagg envolturas\n` +
            `🔷 tiendagg lotes\n\n` +
            `La fuente es Fortnite.GG; el comando actual *tienda* no se modifica.\n\n` +
            `Apoya a un creador: *JASC13*`;

        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
        return;
    }

    try {
        await sock.sendMessage(chatId, {
            text: `⏳ *TIENDA FORTNITE.GG*\n\nLeyendo filtro: *${filtro.label}*...\nPuede tardar unos segundos mientras consulto los detalles.`
        }, { quoted: msg });

        const url = BASE_URL + filtro.path;
        console.log(`🛒 TIENDAGG: consultando ${url}`);

        const html = await fetchTexto(url, { timeout: 20000 });
        const itemsBase = extraerItemsTienda(html);

        if (!itemsBase.length) {
            throw new Error('No se encontraron artículos en el HTML de Fortnite.GG');
        }

        console.log(`🛒 TIENDAGG: ${itemsBase.length} artículos detectados`);

        const items = await enriquecerItems(itemsBase);

        const cabecera =
            `🛒 *TIENDA FORTNITE.GG — ${filtro.label}*\n` +
            `📦 ${items.length} artículo(s)\n\n`;

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

        actual += `Apoya a un creador: *JASC13*`;
        if (actual.trim()) bloques.push(actual.trim());

        await enviarPorPartes(sock, chatId, msg, bloques);
    } catch (error) {
        console.error('❌ Error en tiendagg:', error);

        await sock.sendMessage(chatId, {
            text: `❌ No pude leer la tienda de Fortnite.GG.\n\nDetalle: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 300)}`
        }, { quoted: msg });
    }
}

module.exports = {
    comandoTiendaGG
};
) || /v-?bucks/i.test(precio) ? '' : ' V-Bucks';
        lineas.push(`   💰 ${precio}${sufijo}`);
    }
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
    lineas.push(`   🔗 ${item.url}`);

    return lineas.join('\n');
}

async function enriquecerItems(items) {
    const resultado = [];
    const concurrencia = 6;

    for (let inicio = 0; inicio < items.length; inicio += concurrencia) {
        const lote = items.slice(inicio, inicio + concurrencia);

        const enriquecidos = await Promise.all(lote.map(async (item) => {
            try {
                const html = await fetchTexto(item.url, { timeout: 12000 });
                return extraerDetalle(html, item);
            } catch (error) {
                console.warn(`⚠️ Fortnite.GG: no se pudo leer ${item.url}: ${error.message}`);
                return item;
            }
        }));

        resultado.push(...enriquecidos);
    }

    return resultado;
}

async function enviarPorPartes(sock, chatId, msg, partes) {
    for (const parte of partes) {
        await sock.sendMessage(chatId, { text: parte }, { quoted: msg });
    }
}

async function comandoTiendaGG(sock, chatId, msg, args) {
    const filtro = encontrarFiltro(args);

    if (!filtro) {
        const texto = `🛒 *TIENDA FORTNITE.GG*\n\n` +
            `Usa un filtro, por ejemplo:\n\n` +
            `🔷 tiendagg nuevos\n` +
            `🔷 tiendagg se van\n` +
            `🔷 tiendagg skins\n` +
            `🔷 tiendagg bailes\n` +
            `🔷 tiendagg picos\n` +
            `🔷 tiendagg mochilas\n` +
            `🔷 tiendagg planeadores\n` +
            `🔷 tiendagg envolturas\n` +
            `🔷 tiendagg lotes\n\n` +
            `La fuente es Fortnite.GG; el comando actual *tienda* no se modifica.\n\n` +
            `Apoya a un creador: *JASC13*`;

        await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
        return;
    }

    try {
        await sock.sendMessage(chatId, {
            text: `⏳ *TIENDA FORTNITE.GG*\n\nLeyendo filtro: *${filtro.label}*...\nPuede tardar unos segundos mientras consulto los detalles.`
        }, { quoted: msg });

        const url = BASE_URL + filtro.path;
        console.log(`🛒 TIENDAGG: consultando ${url}`);

        const html = await fetchTexto(url, { timeout: 20000 });
        const itemsBase = extraerItemsTienda(html);

        if (!itemsBase.length) {
            throw new Error('No se encontraron artículos en el HTML de Fortnite.GG');
        }

        console.log(`🛒 TIENDAGG: ${itemsBase.length} artículos detectados`);

        const items = await enriquecerItems(itemsBase);

        const cabecera =
            `🛒 *TIENDA FORTNITE.GG — ${filtro.label}*\n` +
            `📦 ${items.length} artículo(s)\n\n`;

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

        actual += `Apoya a un creador: *JASC13*`;
        if (actual.trim()) bloques.push(actual.trim());

        await enviarPorPartes(sock, chatId, msg, bloques);
    } catch (error) {
        console.error('❌ Error en tiendagg:', error);

        await sock.sendMessage(chatId, {
            text: `❌ No pude leer la tienda de Fortnite.GG.\n\nDetalle: ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 300)}`
        }, { quoted: msg });
    }
}

module.exports = {
    comandoTiendaGG
};
