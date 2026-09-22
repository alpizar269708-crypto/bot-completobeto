const crypto = require('crypto');
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirYFormatearRecompensa(texto, iconClass) {
    const cls = (iconClass || "").toLowerCase();
    const txt = (texto || "").toLowerCase();
    const combinada = cls + " " + txt;

    const matchNum = txt.match(/\d+/);
    const cantidad = matchNum ? matchNum[0] : "";
    const prefix = cantidad ? `*${cantidad}* ` : "";

    if (combinada.includes('ice storm') || combinada.includes('epic mini-boss') || 
        combinada.includes('slowing pools') || combinada.includes('wall weakening') || 
        combinada.includes('deathburst') || combinada.includes('acid pools') || 
        combinada.includes('metal corrosion') || combinada.includes('smoke screens') ||
        combinada.includes('fire storm') || combinada.includes('uncharted') || 
        combinada.includes('adept') || combinada.includes('powerful') || combinada.includes('frenzied')) {
        return "";
    }

    if (combinada.includes('supercharger')) {
        if (combinada.includes('survivor')) return '⚡ Supercargador de superviviente';
        if (combinada.includes('hero')) return '⚡ Supercargador de héroe';
        if (combinada.includes('weapon')) return '⚡ Supercargador de arma';
        if (combinada.includes('trap')) return '⚡ Supercargador de trampa';
        return '⚡ Supercargador';
    }

    if (combinada.includes('workerbasic') || combinada.includes('survivor')) {
        if (combinada.includes('legendary')) return '👤 Superviviente legendario';
        if (combinada.includes('epic')) return '👤 Superviviente épico';
        return '👤 Superviviente';
    }
    if (combinada.includes('defender')) {
        if (combinada.includes('legendary')) return '🛡️ Defensor legendario';
        if (combinada.includes('epic')) return '🛡️ Defensor épico';
        return '🛡️ Defensor';
    }

    if (combinada.includes('frost-up') || combinada.includes('ele_water')) return `❄️ ${prefix}Frost-Up`;
    if (combinada.includes('fire-up') || combinada.includes('ele_fire')) return `🔥 ${prefix}Fire-Up`;
    if (combinada.includes('amp-up') || combinada.includes('ele_nature')) return `⚡ ${prefix}Amp-Up`;
    if (combinada.includes('epic perk') || combinada.includes('t03_high')) return `🟣 ${prefix}Modificación épica`;
    if (combinada.includes('legendary perk') || combinada.includes('t04_high')) return `🟠 ${prefix}Modificación legendaria`;
    if (combinada.includes('re-perk') || combinada.includes('alteration')) return `🔄 ${prefix}Re-modificación`;

    if (combinada.includes('reagent_c') || combinada.includes('storm shard')) return `💎 ${prefix}Esquirla de tormenta`;
    if (combinada.includes('reagent_t03') || combinada.includes('eye')) return `🌀 ${prefix}Ojo de la tormenta`;
    if (combinada.includes('reagent_t01') || combinada.includes('rain')) return `💧 ${prefix}Gota de lluvia pura`;
    if (combinada.includes('reagent_t02') || combinada.includes('lightning')) return `⚡ ${prefix}Relámpago en botella`;

    if (combinada.includes('ticket') || combinada.includes('campaign_event_currency')) return `🎫 ${prefix}Billetes`;
    if (combinada.includes('gold') || combinada.includes('eventscaling')) return cantidad ? `🪙 ${prefix}Oro` : '🪙 Oro';

    if (combinada.includes('schematicxp')) return `📘 ${cantidad ? prefix : 'x5 '}XP de plano`;
    if (combinada.includes('survivorxp')) return `📗 ${cantidad ? prefix : 'x4 '}XP de superviviente`;
    if (combinada.includes('heroxp')) return `📙 ${cantidad ? prefix : ''}XP de héroe`;
    if (combinada.includes('venturexp')) return `🗺️ ${cantidad ? prefix : ''}XP de aventura`;

    return "";
}

function traducirMisionYBioma(nombreIngles, textoCompletoZona) {
    const misionesMap = {
        'fight the storm': 'Lucha contra la tormenta',
        'retrieve the data': 'Recupera los datos',
        'repair the shelter': 'Repara el refugio',
        'ride the lightning': 'Viaja en el rayo',
        'evacuate the shelter': 'Evacúa el refugio',
        'deliver the bomb': 'Entrega la bomba',
        'resupply': 'Reabastecimiento',
        'eliminate and collect': 'Elimina y recolecta',
        'rescue the survivors': 'Rescata a los supervivientes',
        'atlas': 'Atlas',
        'trap storm': 'Tormenta de trampas'
    };

    const misionEsp = misionesMap[nombreIngles.toLowerCase()] || nombreIngles;

    let limpio = textoCompletoZona
        .replace(/group/gi, '')
        .replace(/retrieve the data/gi, '')
        .replace(/evacuate the shelter/gi, '')
        .replace(/deliver the bomb/gi, '')
        .replace(/ride the lightning/gi, '')
        .replace(/repair the shelter/gi, '')
        .replace(/fight the storm/gi, '')
        .replace(/legendary survivor/gi, '')
        .replace(/epic survivor/gi, '')
        .replace(/legendary defender/gi, '')
        .replace(/epic defender/gi, '')
        .replace(/uncommon survivor/gi, '')
        .replace(/rare survivor/gi, '')
        .replace(/\b(x\s*)+/gi, '')
        .replace(/[-–]/g, '')
        .trim();

    const biomasMap = {
        'thunder route 99': 'Ruta del Trueno 99',
        'thunder route': 'Ruta del Trueno 99',
        'industrial park': 'Parque industrial',
        'ghost town': 'Pueblo fantasma',
        'autumn suburbs': 'Suburbios otoñales',
        'autumn city': 'Ciudad otoñal',
        'grasslands': 'Praderas',
        'desert': 'Desierto',
        'city': 'Ciudad',
        'lakeside': 'Orilla del lago',
        'tropical': 'Tropical',
        'forest': 'Bosque',
        'suburbs': 'Suburbios'
    };

    let biomaEsp = "";
    const lowerLimpio = limpio.toLowerCase();
    
    for (const [key, val] of Object.entries(biomasMap)) {
        if (lowerLimpio.includes(key)) {
            biomaEsp = val;
            break;
        }
    }

    if (!biomaEsp) {
        biomaEsp = limpio.split('  ')[0].trim() || "Zona desconocida";
    }

    let bunkerStr = "";
    if (lowerLimpio.includes('bunker') || lowerLimpio.includes('búnker')) {
        bunkerStr = " (Búnker)";
    }

    return `${misionEsp} - ${biomaEsp}${bunkerStr}`;
}

function limpiarTextoSTW(texto) {
    return String(texto || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function textoConSaltos($, node) {
    const blockTags = new Set([
        'ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DIV','DL','DT','DD',
        'FIELDSET','FIGURE','FIGCAPTION','FOOTER','FORM','H1','H2','H3',
        'H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE',
        'SECTION','TABLE','TBODY','THEAD','TFOOT','TR','UL'
    ]);

    function recorrer(el) {
        if (el.type === 'text') {
            return el.data || '';
        }

        if (el.type !== 'tag' && el.type !== 'root') {
            return '';
        }

        const nombre = String(el.name || '').toUpperCase();

        if (nombre === 'BR') {
            return '\n';
        }

        const esBloque = blockTags.has(nombre);
        const hijos = (el.children || []).map(recorrer).join('');

        return esBloque ? '\n' + hijos + '\n' : hijos;
    }

    return recorrer(node);
}

function obtenerLineasSTW($) {
    const body = $('body')[0];
    if (!body) return [];

    return textoConSaltos($, body)
        .split(/\n+/)
        .map(limpiarTextoSTW)
        .filter(Boolean);
}

const MISIONES_STW = [
    'fight the storm',
    'retrieve the data',
    'repair the shelter',
    'ride the lightning',
    'evacuate the shelter',
    'deliver the bomb',
    'resupply',
    'eliminate and collect',
    'rescue the survivors',
    'build the radar',
    'destroy the encampments',
    'refuel the homebase',
    'hit the road',
    'rescue the survivors',
    'atlas'
];

const ZONAS_STW = [
    'stonewood',
    'plankerton',
    'canny valley',
    'twine peaks',
    'venture'
];

function esNumeroPuro(linea) {
    return /^\d{1,4}$/.test(String(linea || '').trim());
}

function obtenerNumeroAnterior(lineas, indice, maxAtras = 8) {
    for (let i = indice - 1; i >= Math.max(0, indice - maxAtras); i--) {
        const valor = Number(lineas[i]);

        if (
            esNumeroPuro(lineas[i]) &&
            Number.isInteger(valor) &&
            valor >= 1 &&
            valor <= 160
        ) {
            return valor;
        }
    }

    return null;
}

function extraerMisionDeLinea(linea) {
    const limpio = limpiarTextoSTW(linea);

    if (!limpio || !limpio.includes(' - ')) {
        return null;
    }

    const lower = limpio.toLowerCase();

    let encontrada = null;

    for (const nombre of MISIONES_STW) {
        if (lower.startsWith(nombre + ' - ') ||
            lower.startsWith('category 1 ' + nombre + ' - ') ||
            lower.startsWith('category 2 ' + nombre + ' - ') ||
            lower.startsWith('category 3 ' + nombre + ' - ') ||
            lower.startsWith('category 4 ' + nombre + ' - ')) {
            encontrada = nombre;
            break;
        }
    }

    if (!encontrada) {
        return null;
    }

    let resto = limpio;

    const prefijoCategoria = resto.match(/^category\s+([1-4])\s+/i);
    const categoria = prefijoCategoria ? Number(prefijoCategoria[1]) : null;

    if (prefijoCategoria) {
        resto = resto.replace(/^category\s+[1-4]\s+/i, '');
    }

    if (!resto.toLowerCase().startsWith(encontrada)) {
        return null;
    }

    resto = resto.slice(encontrada.length).replace(/^\s+group\s*/i, ' ');
    resto = resto.replace(/^\s*-\s*/, '').trim();

    if (!resto) return null;

    return {
        original: encontrada,
        mision: traducirMisionYBioma(encontrada, resto),
        ubicacion: resto,
        categoria
    };
}

function detectarTipoLineaSTW(linea, actual) {
    const lower = limpiarTextoSTW(linea).toLowerCase();

    if (lower.includes('megaalertcategory_miniboss') ||
        lower.includes('mega alert')) {
        return 'mega';
    }

    if (lower.includes('storm_miniboss') ||
        lower.includes('mini boss')) {
        return 'miniboss';
    }

    if (lower.includes('elemental alerts')) {
        return 'elemental';
    }

    if (lower.includes('storm alerts')) {
        return 'storm';
    }

    return actual;
}

function detectarRarezaSegmento(segmento) {
    const texto = segmento.join(' ').toLowerCase();

    if (/\blegendary\b/.test(texto)) return 'legendary';
    if (/\bepic\b/.test(texto)) return 'epic';
    if (/\brare\b/.test(texto)) return 'rare';
    if (/\buncommon\b/.test(texto)) return 'uncommon';
    if (/\bcommon\b/.test(texto)) return 'common';

    return null;
}

function detectarCantidadVbucksSegmento(segmento) {
    for (const linea of segmento) {
        if (esNumeroPuro(linea)) {
            const numero = Number(linea);

            if (numero >= 5 && numero <= 1000) {
                return numero;
            }
        }
    }

    const texto = segmento.join(' ');
    const match = texto.match(/(?:v[\s-]?bucks|vbucks|v bucks)\s*(?:x\s*)?(\d{1,4})/i);

    if (match) {
        return Number(match[1]);
    }

    return 50;
}

function obtenerNombreRecompensa(segmento) {
    const ignorar = new Set([
        'common',
        'uncommon',
        'rare',
        'epic',
        'legendary',
        'mythic',
        'survivor',
        'defender',
        'hero',
        'schematic',
        'vbucks',
        'v bucks',
        'v-bucks',
        'x 4',
        'x 5'
    ]);

    for (let i = 0; i < segmento.length; i++) {
        const lower = segmento[i].toLowerCase();

        if (
            lower === 'legendary' ||
            lower === 'epic'
        ) {
            for (let j = i + 1; j < Math.min(segmento.length, i + 4); j++) {
                const candidata = limpiarTextoSTW(segmento[j]);
                const lc = candidata.toLowerCase();

                if (!candidata || esNumeroPuro(candidata)) continue;
                if (ignorar.has(lc)) continue;
                if (lc.startsWith('mega alert') || lc.startsWith('elemental alert')) continue;

                return candidata;
            }
        }
    }

    return '';
}

function construirMisionSTW(lineas, indice, zona, tipoAlerta) {
    const info = extraerMisionDeLinea(lineas[indice]);

    if (!info) return null;

    const pl = obtenerNumeroAnterior(lineas, indice);

    if (!pl) return null;

    const siguienteMision = [];

    for (let i = indice + 1; i < Math.min(lineas.length, indice + 80); i++) {
        if (extraerMisionDeLinea(lineas[i])) {
            break;
        }

        siguienteMision.push(lineas[i]);
    }

    const segmentoTexto = siguienteMision.join(' ');
    const lowerSegmento = segmentoTexto.toLowerCase();

    const rareza = detectarRarezaSegmento(siguienteMision);

    const tieneVbucks =
        /v[\s-]?bucks|vbucks|v bucks/.test(lowerSegmento) ||
        tipoAlerta === 'vbucks';

    const cantidadVbucks = tieneVbucks
        ? detectarCantidadVbucksSegmento(siguienteMision)
        : null;

    let alerta = tipoAlerta || 'normal';

    if (tieneVbucks) {
        alerta = 'vbucks';
    } else if (rareza === 'legendary') {
        alerta = 'legendary';
    } else if (rareza === 'epic') {
        alerta = 'epic';
    } else if (pl >= 140) {
        alerta = 'pl-alta';
    }

    let recompensa = '';

    if (tieneVbucks) {
        recompensa = '🪙 ' + cantidadVbucks + ' PaVos';
    } else if (rareza === 'legendary' || rareza === 'epic') {
        const nombre = obtenerNombreRecompensa(siguienteMision);

        if (nombre) {
            recompensa =
                (rareza === 'legendary' ? '🟠 ' : '🟣 ') +
                nombre;
        } else {
            recompensa =
                rareza === 'legendary'
                    ? '🟠 Recompensa legendaria'
                    : '🟣 Recompensa épica';
        }
    } else if (/supercharger/.test(lowerSegmento)) {
        recompensa = '⚡ Supercargador';
    } else if (/re-perk|reperk/.test(lowerSegmento)) {
        recompensa = '🔄 Re-Perk';
    } else if (/perk-up/.test(lowerSegmento)) {
        recompensa = '🟢 Perk-Up';
    } else if (/storm shard/.test(lowerSegmento)) {
        recompensa = '💎 Esquirla de tormenta';
    } else if (/lightning/.test(lowerSegmento)) {
        recompensa = '⚡ Relámpago en botella';
    }

    return {
        id: crypto.createHash('sha1')
            .update([
                zona,
                pl,
                info.mision,
                info.ubicacion,
                recompensa
            ].join('|'))
            .digest('hex')
            .slice(0, 14),

        zona,
        pl,
        mision: info.mision,
        misionOriginal: info.original,
        ubicacion: info.ubicacion,
        categoria: info.categoria,

        tipoAlerta: alerta,

        vbucks: tieneVbucks,
        cantidadVbucks,

        rareza,

        recompensa: recompensa || 'Misión',
        source: 'https://stw-planner.com/mission-alerts',
        extraidoEn: new Date().toISOString()
    };
}

function deduplicarSTW(lista) {
    const mapa = new Map();

    for (const item of lista) {
        if (!item) continue;

        const clave = [
            item.zona || '',
            item.pl || '',
            item.mision || '',
            item.ubicacion || '',
            item.tipoAlerta || '',
            item.recompensa || ''
        ].join('|').toLowerCase();

        if (!mapa.has(clave)) {
            mapa.set(clave, item);
        }
    }

    return Array.from(mapa.values());
}

async function descargarSTW(url) {
    const response = await axios.get(url, {
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
            'Cache-Control': 'no-cache'
        }
    });

    return response.data;
}

function parsearPaginaSTW(html, fuente = 'all') {
    const $ = cheerio.load(html);
    const lineas = obtenerLineasSTW($);

    let zonaActual = '';
    let tipoActual = fuente === 'vbucks' ? 'vbucks' : 'normal';
    const misiones = [];

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i];
        const lower = linea.toLowerCase();

        if (ZONAS_STW.includes(lower)) {
            zonaActual = lower === 'venture'
                ? 'Venture'
                : linea
                    .split(' ')
                    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
                    .join(' ');
            tipoActual = 'normal';
            continue;
        }

        const nuevoTipo = detectarTipoLineaSTW(linea, tipoActual);

        if (nuevoTipo !== tipoActual) {
            tipoActual = nuevoTipo;
            continue;
        }

        const info = extraerMisionDeLinea(linea);

        if (!info) continue;

        const mision = construirMisionSTW(
            lineas,
            i,
            zonaActual || 'Desconocida',
            tipoActual
        );

        if (mision) {
            misiones.push(mision);
        }
    }

    return deduplicarSTW(misiones);
}

function parsearPavosSTW(html) {
    const misiones = parsearPaginaSTW(html, 'vbucks');

    return misiones
        .filter(m => m.vbucks || m.tipoAlerta === 'vbucks')
        .map(m => ({
            pl: m.pl,
            mision: m.mision,
            misionOriginal: m.misionOriginal,
            ubicacion: m.ubicacion,
            zona: m.zona,
            cantidad: m.cantidadVbucks || 50,
            recompensa: 'PaVos',
            tipo: 'STW Planner',
            source: 'https://stw-planner.com/mission-alerts/v-buck-missions',
            extraidoEn: new Date().toISOString()
        }));
}

async function extraerAlertasAPI() {
    try {
        console.log('\n--- 🌐 RASPADO STW PLANNER ---');

        const urlPrincipal = 'https://stw-planner.com/mission-alerts';
        const urlPavos = 'https://stw-planner.com/mission-alerts/v-buck-missions';

        const [htmlPrincipal, htmlPavos] = await Promise.all([
            descargarSTW(urlPrincipal),
            descargarSTW(urlPavos)
        ]);

        const todas = parsearPaginaSTW(htmlPrincipal, 'all');
        const pavosPagina = parsearPavosSTW(htmlPavos);

        const clavesPavos = new Set(
            pavosPagina.map(p =>
                [
                    p.pl,
                    p.mision,
                    p.ubicacion
                ].join('|').toLowerCase()
            )
        );

        const pavosFinal = [];

        for (const pavo of pavosPagina) {
            pavosFinal.push(pavo);
        }

        for (const mision of todas) {
            const clave = [
                mision.pl,
                mision.mision,
                mision.ubicacion
            ].join('|').toLowerCase();

            if (clavesPavos.has(clave)) {
                continue;
            }
        }

        if (todas.length === 0 && pavosFinal.length === 0) {
            console.warn(
                '⚠️ STW Planner devolvió 0 misiones. No se modifican los datos anteriores.'
            );
            return;
        }

        const epicas = todas
            .filter(m => m.rareza === 'epic')
            .map(m => ({
                pl: m.pl,
                mision: m.mision,
                ubicacion: m.ubicacion,
                zona: m.zona,
                recompensa: m.recompensa,
                rareza: 'epic',
                source: m.source
            }));

        const legendarias = todas
            .filter(m => m.rareza === 'legendary')
            .map(m => ({
                pl: m.pl,
                mision: m.mision,
                ubicacion: m.ubicacion,
                zona: m.zona,
                recompensa: m.recompensa,
                rareza: 'legendary',
                source: m.source
            }));

        const plAltas = todas
            .filter(m => Number(m.pl) >= 140)
            .map(m => ({
                pl: m.pl,
                mision: m.mision,
                ubicacion: m.ubicacion,
                zona: m.zona,
                recompensa: m.recompensa,
                source: m.source
            }));

        await Config.findOneAndUpdate(
            { clave: 'stw_pavos_scrapeados' },
            { valor: JSON.stringify(deduplicarSTW(pavosFinal)) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_epicas_scrapeadas' },
            { valor: JSON.stringify(deduplicarSTW(epicas)) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_legendarias_scrapeadas' },
            { valor: JSON.stringify(deduplicarSTW(legendarias)) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_plaltas_scrapeadas' },
            { valor: JSON.stringify(deduplicarSTW(plAltas)) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_plaltas_activas' },
            { valor: JSON.stringify(deduplicarSTW(plAltas)) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_ultima_actualizacion' },
            {
                valor: JSON.stringify({
                    fuente: 'STW Planner',
                    actualizadoEn: new Date().toISOString(),
                    totalMisiones: todas.length,
                    pavos: pavosFinal.length,
                    epicas: epicas.length,
                    legendarias: legendarias.length,
                    plAltas: plAltas.length
                })
            },
            { upsert: true }
        );

        console.log(
            '✅ STW Planner guardado | Total: ' +
            todas.length +
            ' | 🪙 Pavos: ' +
            pavosFinal.length +
            ' | 🟣 Épicas: ' +
            epicas.length +
            ' | 🟠 Legendarias: ' +
            legendarias.length +
            ' | ⚡ PL 140+: ' +
            plAltas.length
        );
    } catch (e) {
        console.error(
            '❌ Error en la extracción STW Planner:',
            e.message
        );
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    extraerAlertasAPI();
    setInterval(extraerAlertasAPI, 10 * 60 * 1000);
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp, extraerAlertasAPI };