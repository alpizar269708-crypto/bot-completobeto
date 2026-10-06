const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const BASE_URL = 'https://fortnite.gg';
let tiendaGGEnCurso = false;
let tiendaGGFase = 'iniciando';
let tiendaGGTimer = null;
const sesionesTiendaGG = new Map();
const TIENDAGG_SESION_TTL_MS = 5 * 60 * 1000;

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
    // No interceptamos solicitudes: Fortnite.GG usa contenido dinámico y una
    // solicitud interceptada sin resolución puede dejar la página esperando.
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
}

async function buscarCosmeticosEnPagina(page, termino, reportar = async () => {}) {
    const url = BASE_URL + '/cosmetics';
    console.log('🔎 TIENDAGG: buscando "' + termino + '" en ' + url);
    await reportar('Abriendo catálogo de cosméticos...');
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (error) {
        console.warn('⚠️ Fortnite.GG: la carga del catálogo agotó tiempo: ' + error.message);
    }

    await reportar('Catálogo abierto. Buscando el campo de búsqueda...');

    // Evitamos page.$/ElementHandle aquí. La búsqueda es una operación puramente
    // DOM y podemos localizar + modificar el input dentro de una sola evaluación.
    let datosBusqueda;
    try {
        datosBusqueda = await Promise.race([
            page.evaluate((valor) => {
                const selectores = [
                    'input[type="search"]',
                    'input[placeholder*="Search" i]',
                    'input[aria-label*="Search" i]'
                ];

                let input = null;
                for (const selector of selectores) {
                    input = document.querySelector(selector);
                    if (input) break;
                }

                if (!input) {
                    const candidatos = Array.from(document.querySelectorAll('input'));
                    input = candidatos.find(el => {
                        const texto = [
                            el.getAttribute('placeholder'),
                            el.getAttribute('aria-label'),
                            el.getAttribute('name')
                        ].filter(Boolean).join(' ');
                        return /search|buscar|cosmetic/i.test(texto);
                    }) || null;
                }

                if (!input) {
                    return {
                        encontrado: false,
                        inputs: document.querySelectorAll('input').length
                    };
                }

                const setter = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    'value'
                )?.set;

                if (setter) setter.call(input, valor);
                else input.value = valor;

                for (const tipo of ['focus', 'input', 'change']) {
                    input.dispatchEvent(new Event(tipo, { bubbles: true }));
                }

                input.dispatchEvent(new KeyboardEvent('keydown', {
                    bubbles: true,
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13
                }));
                input.dispatchEvent(new KeyboardEvent('keyup', {
                    bubbles: true,
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13
                }));

                return {
                    encontrado: true,
                    valor: input.value,
                    placeholder: input.getAttribute('placeholder') || '',
                    ariaLabel: input.getAttribute('aria-label') || ''
                };
            }, termino),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('La página no respondió al inspeccionar el buscador en 5 segundos')), 5000)
            )
        ]);
    } catch (error) {
        throw new Error('No pude inspeccionar/aplicar el buscador de Fortnite.GG: ' + error.message);
    }

    if (!datosBusqueda?.encontrado) {
        throw new Error(
            'No encontré el buscador del catálogo de Fortnite.GG (inputs detectados: ' +
            String(datosBusqueda?.inputs ?? 0) + ')'
        );
    }

    await reportar(
        'Campo encontrado y búsqueda aplicada: ' +
        String(datosBusqueda.valor || termino)
    );

    await reportar('Búsqueda aplicada. Esperando resultados...');
    await new Promise(resolve => setTimeout(resolve, 1800));

    await reportar('Filtrando coincidencias visibles...');
    await page.evaluate(() => {
        document.querySelectorAll('#items a.item-icon').forEach(el => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            if (!visible) el.remove();
        });
    });

    await reportar('Resultados listos. Leyendo coincidencias...');
    return page.content();
}

async function obtenerHtmlConNavegador(page, url) {
    const respuesta = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 12000
    });

    await new Promise(resolve => setTimeout(resolve, 1200));

    return {
        html: await page.content(),
        status: respuesta?.status?.() ?? null,
        finalUrl: page.url()
    };
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

function extraerValorEntreEtiquetas(texto, etiqueta, siguiente) {
    const hasta = siguiente ? '(?=\\s+' + siguiente + '\\s*:)' : '(?=$)';
    const regex = new RegExp(etiqueta + '\\s*:\\s*(?:\\|\\s*)?(.+?)' + hasta, 'i');
    const match = String(texto || '').match(regex);
    return match ? limpiarTexto(match[1]).replace(/^\\|\\s*/, '').replace(/\\s*\\|$/, '').trim() : null;
}

function extraerDetalle(html, itemBase) {
    const $ = cheerio.load(html);

    let descripcionJsonLd = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        if (descripcionJsonLd) return;
        try {
            const raw = $(el).contents().text().trim();
            if (!raw) return;
            const data = JSON.parse(raw);
            const candidatos = Array.isArray(data) ? data : [data];
            const producto = candidatos.find(x => x && typeof x === 'object' && x['@type'] === 'Product');
            if (typeof producto?.description === 'string' && producto.description.trim()) {
                descripcionJsonLd = limpiarTexto(producto.description);
            }
        } catch (_) {}
    });

    $('script, style, noscript, template, iframe').remove();

    const root = $('main').first().length ? $('main').first() : $('body');
    const textoVisible = limpiarTexto(root.text());

    const nombre = limpiarTexto($('.fn-detail-name').first().text()) ||
        limpiarTexto(root.find('h1').first().text()) ||
        limpiarTexto($('h1').first().text()) ||
        itemBase.nombre;

    let rareza = '';
    let tipo = '';
    const tipoEl = $('.fn-detail-type').first();
    if (tipoEl.length) {
        rareza = limpiarTexto(tipoEl.find('span').first().text());
        const clon = tipoEl.clone();
        clon.find('span').remove();
        tipo = limpiarTexto(clon.text());
    }

    if (!tipo || !rareza) {
        const tituloTipo = textoVisible.match(/(?:^|\\s)(legendary|epic|rare|uncommon|common|mythic|icon|gaming)\\s+([a-z ]+?)(?=\\s+Image:|\\s+V-Bucks|\\s+Source:)/i);
        if (tituloTipo) {
            rareza = rareza || tituloTipo[1];
            tipo = tipo || tituloTipo[2].trim();
        }
    }

    let precio = limpiarTexto($('.fn-item-price').first().text());
    if (!precio) {
        const precioMatch = textoVisible.match(/V-Bucks\\s+([\\d,.]+)/i);
        if (precioMatch) precio = precioMatch[1];
    }
    precio = precio || itemBase.precio || 'No disponible';

    const timeEl = $('time.shop-out').first();
    let salida = limpiarTexto(timeEl.text());
    if (!salida) {
        const salidaMatch = textoVisible.match(/Leaving Shop on\\s+(.+?)(?=\\s+(?:Shop on Fortnite\\.com|#EpicPartner|Source\\s*:)|$)/i);
        if (salidaMatch) salida = limpiarTexto(salidaMatch[1]);
    }

    const descripcion = [];
    const etiquetas = [];
    $('.fn-detail-desc.grey, .fn-detail-desc').each((_, el) => {
        const texto = limpiarTexto($(el).text());
        if (!texto) return;
        if (/^\\[.*\\]$/.test(texto)) etiquetas.push(texto.replace(/^\\[|\\]$/g, ''));
        else if (!descripcion.includes(texto) && texto.length < 500) descripcion.push(texto);
    });
    if (!descripcion.length && descripcionJsonLd) descripcion.push(descripcionJsonLd);

    const fuente = extraerValorEntreEtiquetas(textoVisible, 'Source', 'Introduced in');
    const temporada = extraerValorEntreEtiquetas(textoVisible, 'Introduced in', 'Release date');
    const lanzamiento = extraerValorEntreEtiquetas(textoVisible, 'Release date', 'Last seen');
    const ultimaVez = extraerValorEntreEtiquetas(textoVisible, 'Last seen', 'Occurrences');

    const ocurrencias = textoVisible.match(/Occurrences\\s*:\\s*(?:\\|\\s*)?(\\d+)(?=\\s+Date\\s+Days\\s+ago)/i);
    const apariciones = ocurrencias ? ocurrencias[1] : null;

    const conjuntoMatch = textoVisible.match(/Part of the\\s+(.+?)\\s+set/i);
    const conjunto = conjuntoMatch ? limpiarTexto(conjuntoMatch[1]) : null;

    return {
        nombre,
        tipo: traducirTipo(tipo || itemBase.tipo || ''),
        rareza: traducirRareza(rareza),
        precio,
        salida,
        salidaIso: timeEl.attr('datetime') || null,
        fuente: fuente || extraerCampo($, 'Source'),
        temporada: temporada || extraerCampo($, 'Introduced in'),
        lanzamiento: lanzamiento || extraerCampo($, 'Release date'),
        ultimaVez: ultimaVez || extraerCampo($, 'Last seen'),
        apariciones: apariciones || extraerCampo($, 'Occurrences'),
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

async function leerFichaTiendaGG(browser, item) {
    let page = null;
    try {
        page = await browser.newPage();
        await prepararPagina(page);

        const respuesta = await obtenerHtmlConNavegador(page, item.url);
        const detalle = extraerDetalle(respuesta.html, item);

        // Si el HTML no trae prácticamente ningún dato de la ficha, no mandamos
        // una ficha vacía como si fuera correcta.
        const tieneDatos = detalle.nombre || detalle.precio || detalle.tipo ||
            detalle.rareza || detalle.lanzamiento || detalle.ultimaVez ||
            detalle.descripcion || detalle.conjunto;

        if (!tieneDatos) {
            throw new Error('Fortnite.GG no devolvió datos utilizables para esta ficha');
        }

        return detalle;
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

async function manejarSeleccionTiendaGG(sock, chatId, msg, texto, remitente) {
    const clave = String(chatId) + ':' + String(remitente || chatId);
    const sesion = sesionesTiendaGG.get(clave);

    if (!sesion) return false;

    if (sesion.expira <= Date.now()) {
        sesionesTiendaGG.delete(clave);
        return false;
    }

    const numeroTexto = String(texto || '').trim();
    if (!/^\d+$/.test(numeroTexto)) return false;

    const numero = Number(numeroTexto);
    const item = sesion.items[numero - 1];

    if (!item) {
        await sock.sendMessage(chatId, {
            text: '❌ Ese número no corresponde a la lista. Elige uno de los números mostrados.'
        }, { quoted: msg });
        return true;
    }

    const contexto = msg.message?.extendedTextMessage?.contextInfo;
    const replyId = contexto?.stanzaId || null;

    if (replyId && sesion.resultMessageId && replyId !== sesion.resultMessageId) {
        return false;
    }

    sesionesTiendaGG.delete(clave);

    if (tiendaGGEnCurso) {
        await sock.sendMessage(chatId, {
            text: '⏳ 🛍️ *JASC STORE* todavía está ocupada con otra consulta.'
        }, { quoted: msg });
        return true;
    }

    tiendaGGEnCurso = true;
    tiendaGGFase = 'leyendo una sola ficha';
    let browser = null;

    try {
        await sock.sendMessage(chatId, {
            text: '📖 🛍️ *JASC STORE*\n\nLeyendo ficha: *' + item.nombre + '*...'
        }, { quoted: msg });

        browser = await abrirNavegador();
        const detalle = await leerFichaTiendaGG(browser, item);

        await sock.sendMessage(chatId, {
            text: '🛍️ *JASC STORE*\n\n' +
                formatearItem(detalle, 1) +
                '\n\nApoya a un creador: *JASC13*'
        }, { quoted: msg });
    } catch (error) {
        console.error('❌ TIENDAGG selección:', error);
        await sock.sendMessage(chatId, {
            text: '❌ *JASC STORE*\n\nNo pude leer la ficha de *' + item.nombre +
                '* en este momento.\n\n💥 ' +
                String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500)
        }, { quoted: msg });
    } finally {
        if (browser) await browser.close().catch(() => {});
        tiendaGGEnCurso = false;
        tiendaGGFase = 'iniciando';
    }

    return true;
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
            html = await buscarCosmeticosEnPagina(page, args.join(' '), fase);
        }

        const itemsBase = extraerItemsTienda(html);

        if (!itemsBase.length) {
            throw new Error(filtro
                ? 'No se encontraron artículos en el catálogo de Fortnite.GG'
                : 'No encontré coincidencias para "' + args.join(' ') + '"');
        }

        console.log('🛒 TIENDAGG: ' + itemsBase.length + ' artículos detectados');

        // Protegemos WhatsApp/Node de filtros gigantes (por ejemplo TODOS).
        // Una búsqueda concreta como "Freddy Krueger" conserva todas sus coincidencias.
        const MAX_OPCIONES = 50;
        const opciones = itemsBase.slice(0, MAX_OPCIONES);
        const hayMasOpciones = itemsBase.length > MAX_OPCIONES;

        let textoLista = (filtro
            ? '🛍️ *JASC STORE — ' + filtro.label + '*\n'
            : '🔎 *RESULTADOS PARA: ' + args.join(' ') + '*\n') +
            '📦 ' + itemsBase.length + ' coincidencia(s)\n' +
            (hayMasOpciones ? '👀 Mostrando las primeras ' + MAX_OPCIONES + '. Refina la búsqueda para ver menos resultados.\n' : '') +
            '\n';

        for (let i = 0; i < opciones.length; i++) {
            textoLista += (i + 1) + '. 🎮 ' + (opciones[i].nombre || 'Sin nombre') + '\n\n';
        }

        textoLista += '❓ *¿Cuál quieres ver?*\nResponde a este mensaje con el número o envía solo el número.\n\nApoya a un creador: *JASC13*';

        // Guardamos solamente las opciones visibles + URLs + IDs. El navegador se
        // cierra al terminar la búsqueda y NO se conserva ninguna página abierta.
        const sent = await sock.sendMessage(chatId, { text: textoLista }, { quoted: msg });
        const remitenteSesion = msg.key.participant || msg.key.participantAlt || chatId;

        sesionesTiendaGG.set(
            String(chatId) + ':' + String(remitenteSesion),
            {
                items: opciones,
                resultMessageId: sent?.key?.id || null,
                expira: Date.now() + TIENDAGG_SESION_TTL_MS
            }
        );

        console.log('✅ TIENDAGG: lista enviada; navegador listo para cerrarse y esperar selección.');

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
        if (browser) await browser.close().catch(() => {});
        tiendaGGEnCurso = false;
        tiendaGGFase = 'iniciando';
    }
}

module.exports = { comandoTiendaGG, manejarSeleccionTiendaGG };
