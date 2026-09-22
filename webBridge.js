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

// PLALTAS necesita una deduplicación por misión, no por recompensa.
// STW Planner publica la misión de PaVos dos veces en /mission-alerts:
// una como bloque especial (50 PaVos) y otra como mission-entry normal
// (50 PaVos + materiales). Para PLALTAS deben contarse como UNA sola alerta.
function deduplicarPLAltasSTW(lista) {
    const mapa = new Map();

    for (const item of lista) {
        if (!item) continue;

        const esVbucks = Boolean(
            item.vbucks ||
            item.tipoAlerta === 'vbucks' ||
            /PaVos|vbucks|v-bucks/i.test(String(item.recompensa || ''))
        );

        const claveBase = [
            item.zona || '',
            item.pl || '',
            item.mision || '',
            item.ubicacion || ''
        ].join('|').toLowerCase();

        // Para PaVos, ignoramos la cadena completa de recompensas porque
        // el bloque especial y el normal tienen recompensas distintas.
        const clave = esVbucks
            ? 'vbucks|' + claveBase
            : 'normal|' + claveBase + '|' + String(item.recompensa || '').toLowerCase();

        const anterior = mapa.get(clave);

        if (!anterior) {
            mapa.set(clave, item);
            continue;
        }

        // Si hay dos versiones de la misma alerta de PaVos, preferimos
        // la que muestre menos recompensas: corresponde al bloque especial
        // de 50 PaVos y evita mostrar materiales como si fueran parte de
        // la recompensa destacada.
        if (esVbucks) {
            const anteriorCount = Array.isArray(anterior.recompensas)
                ? anterior.recompensas.length
                : String(anterior.recompensa || '').split('|').length;

            const actualCount = Array.isArray(item.recompensas)
                ? item.recompensas.length
                : String(item.recompensa || '').split('|').length;

            if (actualCount < anteriorCount) {
                mapa.set(clave, item);
            }
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


function normalizarRecompensaSTW(nombre, rareza, tipo) {
    const limpio = limpiarTextoSTW(nombre);
    if (!limpio) return '';

    if (tipo === 'vbucks') {
        return '🪙 ' + limpio + ' PaVos';
    }

    const rarezaTexto =
        rareza === 'legendary' ? '🟠 Legendaria' :
        rareza === 'epic' ? '🟣 Épica' :
        rareza === 'rare' ? '🔵 Rara' :
        rareza === 'uncommon' ? '🟢 Poco común' :
        '⚪ Común';

    const tipoTexto = {
        hero: 'Héroe',
        survivor: 'Superviviente',
        defender: 'Defensor',
        schematic: 'Esquema',
        supercharger: 'Supercargador',
        x4: 'Recompensa x4',
        evolution: 'Material de evolución',
        perkup: 'Perk-Up',
        reperk: 'Re-Perk',
        ore: 'Mineral/Cristal',
        llama: 'Llama',
        other: 'Recompensa'
    }[tipo] || 'Recompensa';

    if (/^\d+$/.test(limpio) && tipo !== 'vbucks') {
        return rarezaTexto + ' ' + tipoTexto + ' x' + limpio;
    }

    return rarezaTexto + ' ' + tipoTexto + ': ' + limpio;
}

function detectarTipoRecompensaSTW(iconClasses, dataFilter, rawName) {
    // IMPORTANTE:
    // data-filter pertenece a TODA la misión y puede contener varios tipos
    // (por ejemplo: "vbucks evolution reperk"). No debe usarse como fuente
    // principal para clasificar cada reward-item, porque podría convertir
    // todas las recompensas de la misión en PaVos.
    const icon = String(iconClasses || '').toLowerCase();
    const nombre = String(rawName || '').toLowerCase();

    // Primero usamos la clase real del icono de ESTA recompensa.
    if (/currency_mtxswap|vbucks|v-bucks|v bucks/.test(icon)) return 'vbucks';
    if (/supercharger|supercargador/.test(icon)) return 'supercharger';
    if (/\bhero\b/.test(icon)) return 'hero';
    if (/survivor|workerbasic|managerengineer/.test(icon)) return 'survivor';
    if (/\bdefender\b/.test(icon)) return 'defender';
    if (/schematic/.test(icon)) return 'schematic';
    if (/reperk|re-perk/.test(icon)) return 'reperk';
    if (/perkup|perk-up/.test(icon)) return 'perkup';
    if (/ore|crystal/.test(icon)) return 'ore';
    if (/reagent_c_|reagent_alteration_|evolution/.test(icon)) return 'evolution';
    if (/llama/.test(icon)) return 'llama';

    // Como respaldo, usamos el nombre textual de esa recompensa.
    if (/supercharger|supercargador/.test(nombre)) return 'supercharger';
    if (/\bhero\b/.test(nombre)) return 'hero';
    if (/survivor|workerbasic|managerengineer/.test(nombre)) return 'survivor';
    if (/\bdefender\b/.test(nombre)) return 'defender';
    if (/schematic/.test(nombre)) return 'schematic';
    if (/reperk|re-perk/.test(nombre)) return 'reperk';
    if (/perkup|perk-up/.test(nombre)) return 'perkup';
    if (/ore|crystal/.test(nombre)) return 'ore';
    if (/llama/.test(nombre)) return 'llama';

    // Solo usamos data-filter como último recurso y para tipos que no puedan
    // confundirse entre varias recompensas del mismo mission-entry.
    const filtro = String(dataFilter || '').toLowerCase();

    if (/supercharger|supercargador/.test(filtro)) return 'supercharger';
    if (/\bschematic\b/.test(filtro)) return 'schematic';
    if (/\breperk\b|re-perk/.test(filtro)) return 'reperk';
    if (/\bperkup\b|perk-up/.test(filtro)) return 'perkup';
    if (/\bllama\b/.test(filtro)) return 'llama';

    return 'other';
}

function detectarRarezaSTW(atributos, rewardTypeTexto) {
    const texto = (
        String(atributos || '') + ' ' +
        String(rewardTypeTexto || '')
    ).toLowerCase();

    if (/\blegendary\b/.test(texto)) return 'legendary';
    if (/\bepic\b/.test(texto)) return 'epic';
    if (/\brare\b/.test(texto)) return 'rare';
    if (/\buncommon\b/.test(texto)) return 'uncommon';
    if (/\bcommon\b/.test(texto)) return 'common';

    return null;
}

function extraerRecompensasMissionEntrySTW($, missionEntry) {
    const recompensas = [];
    const dataFilter = $(missionEntry).attr('data-filter') || '';

    $(missionEntry)
        .find('.mission-rewards > .mission-reward-item')
        .each((index, rewardEl) => {
            if ($(rewardEl).closest('.mission-reward-item--generic').length) {
                return;
            }

            const icon = $(rewardEl).find('.mission-reward-icon').first();
            const iconClasses = icon.attr('class') || '';

            const rewardType = $(rewardEl).find('.reward-type').first();
            const rewardTypeTexto = rewardType.length
                ? rewardType.text().replace(/\s+/g, ' ').trim()
                : '';

            let rewardName = rewardTypeTexto;

            if (!rewardName) {
                rewardName = $(rewardEl)
                    .find('.mission-reward-name')
                    .text()
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            const tipo = detectarTipoRecompensaSTW(
                iconClasses,
                dataFilter,
                rewardName
            );

            let rareza = detectarRarezaSTW(
                '',
                rewardTypeTexto
            );

            if (/^legendary\b/i.test(rewardTypeTexto)) rareza = 'legendary';
            else if (/^epic\b/i.test(rewardTypeTexto)) rareza = 'epic';
            else if (/^rare\b/i.test(rewardTypeTexto)) rareza = 'rare';
            else if (/^uncommon\b/i.test(rewardTypeTexto)) rareza = 'uncommon';
            else if (/^common\b/i.test(rewardTypeTexto)) rareza = 'common';

            const cantidadMatch = rewardName.match(/\b\d{1,4}\b/);
            const cantidad = cantidadMatch ? Number(cantidadMatch[0]) : null;

            const nombre = normalizarRecompensaSTW(
                rewardName,
                rareza,
                tipo
            );

            if (!nombre) return;

            recompensas.push({
                nombre,
                raw: rewardName,
                rareza,
                tipo,
                cantidad,
                iconClasses
            });
        });

    const unicas = [];
    const vistos = new Set();

    for (const recompensa of recompensas) {
        const key = [
            recompensa.nombre,
            recompensa.rareza || '',
            recompensa.tipo
        ].join('|').toLowerCase();

        if (vistos.has(key)) continue;
        vistos.add(key);
        unicas.push(recompensa);
    }

    return unicas;
}

function extraerMisionEntrySTW($, missionEntry, zona, tipoAlerta) {
    const atributos = $(missionEntry).attr('class') || '';
    const dataFilter = $(missionEntry).attr('data-filter') || '';
    const title = $(missionEntry).attr('title') || '';

    const pl = Number(
        $(missionEntry)
            .find('.mission-pl')
            .first()
            .text()
            .trim()
    );

    if (!Number.isInteger(pl) || pl < 1 || pl > 160) {
        return null;
    }

    const missionZone = $(missionEntry).find('.mission-zone').first();

    let partes = [];

    if (missionZone.length) {
        const htmlZone = missionZone.html() || '';

        partes = htmlZone
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .split(/\n+/)
            .map(limpiarTextoSTW)
            .filter(Boolean);
    }

    let textoMision = partes.length
        ? partes[partes.length - 1]
        : title;

    textoMision = limpiarTextoSTW(textoMision);

    if (!textoMision) return null;

    const separado = textoMision.match(/^(.+?)\s+-\s+(.+)$/);

    let nombreMision = separado
        ? separado[1].trim()
        : textoMision;

    const ubicacion = separado
        ? separado[2].trim()
        : '';

    nombreMision = nombreMision
        .replace(/\s+Group$/i, '')
        .trim();

    const recompensas = extraerRecompensasMissionEntrySTW(
        $,
        missionEntry
    );

    const esVbucks =
        /\bvbucks\b|v-bucks|v bucks|currency_mtxswap/i.test(
            atributos + ' ' + dataFilter + ' ' +
            recompensas.map(r => r.iconClasses).join(' ')
        );

    let alerta = tipoAlerta || 'normal';

    if (esVbucks) alerta = 'vbucks';
    else if (/\blegendary\b/i.test(atributos)) alerta = 'legendary';
    else if (/\bepic\b/i.test(atributos)) alerta = 'epic';

    const recompensaVbucks = recompensas.find(
        r => r.tipo === 'vbucks'
    );

    const recompensaTexto = recompensas
        .map(r => r.nombre)
        .filter(Boolean)
        .join(' | ');

    return {
        id: crypto.createHash('sha1')
            .update([
                zona,
                pl,
                nombreMision,
                ubicacion,
                recompensaTexto
            ].join('|'))
            .digest('hex')
            .slice(0, 14),

        zona,
        pl,
        mision: traducirMisionYBioma(
            nombreMision,
            ubicacion
        ),
        misionOriginal: nombreMision,
        ubicacion,

        categoria: dataFilter
            .split(/\s+/)
            .filter(Boolean),

        tipoAlerta: alerta,

        vbucks: esVbucks,
        cantidadVbucks: esVbucks
            ? (
                recompensaVbucks?.cantidad ||
                Number(
                    $(missionEntry)
                        .find('.mission-reward-name')
                        .first()
                        .text()
                        .trim()
                ) ||
                50
            )
            : null,

        rareza: (
            recompensas.find(r => r.rareza === 'mythic')?.rareza ||
            recompensas.find(r => r.rareza === 'legendary')?.rareza ||
            recompensas.find(r => r.rareza === 'epic')?.rareza ||
            recompensas.find(r => r.rareza === 'rare')?.rareza ||
            recompensas.find(r => r.rareza === 'uncommon')?.rareza ||
            recompensas.find(r => r.rareza === 'common')?.rareza ||
            null
        ),

        recompensas,
        recompensa: recompensaTexto || 'Misión',

        source: 'https://stw-planner.com/mission-alerts',
        extraidoEn: new Date().toISOString()
    };
}

function parsearPaginaSTW(html, fuente = 'all') {
    const $ = cheerio.load(html);
    const misiones = [];

    $('.card--container.card--mission').each((cardIndex, card) => {
        const zona =
            limpiarTextoSTW(
                $(card).find('.mission-title').first().text()
            ) ||
            limpiarTextoSTW($(card).attr('data-filter')) ||
            'Desconocida';

        $(card)
            .find('.mission-types > div[data-filter-group="alertType"]')
            .each((typeIndex, typeContainer) => {
                const tipoAlertaRaw =
                    $(typeContainer).attr('data-filter') || '';

                let tipoAlerta = 'normal';

                if (/storm_miniboss/i.test(tipoAlertaRaw)) {
                    tipoAlerta = 'miniboss';
                } else if (/mega/i.test(tipoAlertaRaw)) {
                    tipoAlerta = 'mega';
                } else if (/elemental/i.test(tipoAlertaRaw)) {
                    tipoAlerta = 'elemental';
                } else if (/storm_/i.test(tipoAlertaRaw)) {
                    tipoAlerta = 'storm';
                }

                $(typeContainer)
                    .find('.mission-entry')
                    .each((missionIndex, missionEntry) => {
                        const mision = extraerMisionEntrySTW(
                            $,
                            missionEntry,
                            zona,
                            fuente === 'vbucks'
                                ? 'vbucks'
                                : tipoAlerta
                        );

                        if (mision) {
                            misiones.push(mision);
                        }
                    });
            });
    });

    // Fallback: por si STW Planner cambia la envoltura de los grupos.
    if (!misiones.length) {
        $('.mission-entry').each((index, missionEntry) => {
            const card = $(missionEntry).closest(
                '.card--container.card--mission'
            );

            const zona =
                limpiarTextoSTW(
                    card.find('.mission-title').first().text()
                ) || 'Desconocida';

            const mision = extraerMisionEntrySTW(
                $,
                missionEntry,
                zona,
                fuente === 'vbucks' ? 'vbucks' : 'normal'
            );

            if (mision) {
                misiones.push(mision);
            }
        });
    }

    // Misión especial de V-Bucks de la cabecera.
    $('.special-reward-entry .mission-entry').each((index, missionEntry) => {
        const special = $(missionEntry).closest('.special-reward-entry');

        const titulo = limpiarTextoSTW(
            special.find('.special-title').first().text()
        );

        const pl = Number(
            $(missionEntry)
                .find('.mission-pl')
                .first()
                .text()
                .trim()
        );

        const zoneHtml =
            $(missionEntry).find('.mission-zone').first().html() || '';

        const partes = zoneHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .split(/\n+/)
            .map(limpiarTextoSTW)
            .filter(Boolean);

        const completo = partes[partes.length - 1] || 'Fight the Storm - Desconocida';
        const separada = completo.match(/^(.+?)\s+-\s+(.+)$/);

        const nombre = separada ? separada[1].trim() : completo;
        const ubicacion = separada ? separada[2].trim() : '';
        const zona = partes[0] || 'Desconocida';

        const cantidadMatch = titulo.match(/\d{1,4}/);
        const cantidad = cantidadMatch ? Number(cantidadMatch[0]) : 50;

        if (
            Number.isInteger(pl) &&
            pl >= 1 &&
            pl <= 160
        ) {
            misiones.push({
                id: crypto.createHash('sha1')
                    .update([
                        'vbucks',
                        zona,
                        pl,
                        nombre,
                        ubicacion,
                        cantidad
                    ].join('|'))
                    .digest('hex')
                    .slice(0, 14),

                zona,
                pl,
                mision: traducirMisionYBioma(
                    nombre,
                    ubicacion
                ),
                misionOriginal: nombre,
                ubicacion,
                categoria: ['vbucks'],
                tipoAlerta: 'vbucks',
                vbucks: true,
                cantidadVbucks: cantidad,
                rareza: null,
                recompensas: [{
                    nombre: '🪙 ' + cantidad + ' PaVos',
                    raw: String(cantidad),
                    rareza: null,
                    tipo: 'vbucks',
                    cantidad,
                    iconClasses: 'currency_mtxswap'
                }],
                recompensa: '🪙 ' + cantidad + ' PaVos',
                source: 'https://stw-planner.com/mission-alerts/v-buck-missions',
                extraidoEn: new Date().toISOString()
            });
        }
    });

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

async function extraerPLAltasDOM() {
    try {
        const url = 'https://stw-planner.com/mission-alerts';
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
                'Cache-Control': 'no-cache'
            }
        });

        const $ = cheerio.load(response.data);
        const mapa = new Map();

        $('article, div').each((i, el) => {
            const texto = $(el).text().replace(/\s+/g, ' ').trim();

            if ($(el).children().length > 12) return;
            if (texto.length < 20 || texto.length > 500) return;

            const plMatch = texto.match(/\b(140|160)\b/);
            if (!plMatch) return;

            const lower = texto.toLowerCase();

            const misiones = [
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

            const nombre = misiones.find(m =>
                lower.includes(m)
            );

            if (!nombre) return;

            const idx = lower.indexOf(nombre);
            const desdeMision = texto.slice(idx);

            const partes = desdeMision.split(/\s*-\s*/);
            if (partes.length < 2) return;

            const encabezado = partes[0].trim();
            const ubicacion = partes[1]
                .split(/\b(?:common|uncommon|rare|epic|legendary|mythic)\b/i)[0]
                .trim();

            const misionEsp = traducirMisionYBioma(
                encabezado,
                ubicacion
            );

            const recompensas = [];

            $(el).find(
                '.mission-reward-item, [class*="mission-reward-item"]'
            ).each((j, rewardEl) => {
                const title = $(rewardEl).attr('title') || '';
                const innerText = $(rewardEl)
                    .text()
                    .replace(/\s+/g, ' ')
                    .trim();

                const alt = $(rewardEl)
                    .find('img')
                    .attr('alt') || '';

                const iconClass = $(rewardEl)
                    .find('.mission-reward-icon')
                    .attr('class') || '';

                const bruto = [innerText, title, alt]
                    .filter(Boolean)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (!bruto) return;

                let formateado =
                    traducirYFormatearRecompensa(
                        innerText || title || alt,
                        iconClass
                    );

                if (
                    !formateado &&
                    /v[\s-]?bucks|vbucks|v bucks/i.test(bruto)
                ) {
                    const cantidad =
                        (bruto.match(/\b(\d{1,3})\b/) || [])[1] || '50';

                    formateado = `🪙 *${cantidad}* PaVos`;
                }

                if (!formateado) {
                    const rareza =
                        /\blegendary\b/i.test(bruto)
                            ? 'legendary'
                            : /\bepic\b/i.test(bruto)
                                ? 'epic'
                                : '';

                    if (rareza) {
                        formateado =
                            rareza === 'legendary'
                                ? '🟠 Recompensa legendaria'
                                : '🟣 Recompensa épica';
                    }
                }

                if (
                    formateado &&
                    !recompensas.includes(formateado)
                ) {
                    recompensas.push(formateado);
                }
            });

            if (!recompensas.length) return;

            const pl = Number(plMatch[1]);
            const clave = `${pl}-${misionEsp}`;

            if (!mapa.has(clave)) {
                mapa.set(clave, {
                    pl,
                    mision: misionEsp,
                    recompensa: recompensas.join(' | '),
                    source: url
                });
            }
        });

        return Array.from(mapa.values());
    } catch (error) {
        console.error(
            '❌ Error extrayendo recompensas PL altas:',
            error.message
        );

        return [];
    }
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

        // PLALTAS = únicamente alertas realmente destacables.
        // La página de STW Planner ya etiqueta cada misión con:
        // - rareza (common/uncommon/rare/epic/legendary)
        // - tipo (hero/survivor/defender/schematic)
        // - nombre real de la recompensa
        // Por eso aquí filtramos usando los datos estructurados y no palabras sueltas.

        function evaluarAlertaChida(mision) {
            const recompensas = Array.isArray(mision.recompensas)
                ? mision.recompensas
                : [];

            if (mision.vbucks) {
                return {
                    mostrar: true,
                    nivel: 100,
                    motivo: '🪙 PaVos',
                    destacadas: recompensas.filter(r => r.tipo === 'vbucks')
                };
            }

            const supercargadores = recompensas.filter(
                r => r.tipo === 'supercharger'
            );

            if (supercargadores.length) {
                return {
                    mostrar: true,
                    nivel: 98,
                    motivo: '⚡ Supercargador',
                    destacadas: supercargadores
                };
            }

            const legendarias = recompensas.filter(r =>
                r.rareza === 'legendary' &&
                ['hero', 'survivor', 'schematic'].includes(r.tipo)
            );

            if (legendarias.length) {
                return {
                    mostrar: true,
                    nivel: 95,
                    motivo: '🟠 Recompensa legendaria',
                    destacadas: legendarias
                };
            }

            // Un defensor legendario solo entra cuando la misión ya está
            // en PL realmente alto. Así evitamos llenar PLALTAS con defensores.
            const defensoresLegendarios = recompensas.filter(r =>
                r.rareza === 'legendary' &&
                r.tipo === 'defender'
            );

            if (
                defensoresLegendarios.length &&
                Number(mision.pl) >= 124
            ) {
                return {
                    mostrar: true,
                    nivel: 92,
                    motivo: '🟠 Defensor legendario',
                    destacadas: defensoresLegendarios
                };
            }

            // Épicas: solo héroes, supervivientes o esquemas y desde PL 100.
            const epicas = recompensas.filter(r =>
                r.rareza === 'epic' &&
                ['hero', 'survivor', 'schematic'].includes(r.tipo)
            );

            if (
                epicas.length &&
                Number(mision.pl) >= 100
            ) {
                return {
                    mostrar: true,
                    nivel: 85,
                    motivo: '🟣 Recompensa épica',
                    destacadas: epicas
                };
            }

            // Mythic, si STW Planner llegara a publicarlo en Mission Alerts.
            const miticas = recompensas.filter(r =>
                r.rareza === 'mythic'
            );

            if (miticas.length) {
                return {
                    mostrar: true,
                    nivel: 99,
                    motivo: '🔵 Recompensa mítica',
                    destacadas: miticas
                };
            }

            return {
                mostrar: false,
                nivel: 0,
                motivo: '',
                destacadas: []
            };
        }

        function prepararAlertaChida(mision, fallback = null) {
            const evaluada = evaluarAlertaChida(mision);

            if (!evaluada.mostrar) {
                return null;
            }

            const recompensasDestacadas = Array.isArray(
                evaluada.destacadas
            )
                ? evaluada.destacadas
                : [];

            const recompensaMostrar = recompensasDestacadas.length
                ? recompensasDestacadas
                    .map(r => r.nombre)
                    .filter(Boolean)
                    .join(' | ')
                : (
                    mision.recompensa &&
                    mision.recompensa !== 'Misión'
                        ? mision.recompensa
                        : evaluada.motivo
                );

            return {
                pl: mision.pl,
                mision: mision.mision,
                ubicacion: mision.ubicacion,
                zona: mision.zona,
                recompensa: recompensaMostrar,
                motivo: evaluada.motivo,
                nivelAlerta: evaluada.nivel,
                recompensas: recompensasDestacadas,
                source:
                    mision.source ||
                    fallback ||
                    'https://stw-planner.com/mission-alerts'
            };
        }

        let plAltas = todas
            .map(m => prepararAlertaChida(m))
            .filter(Boolean);

        // Ordenamos lo realmente bueno primero.
        plAltas.sort((a, b) => {
            if (b.nivelAlerta !== a.nivelAlerta) {
                return b.nivelAlerta - a.nivelAlerta;
            }

            if (Number(b.pl) !== Number(a.pl)) {
                return Number(b.pl) - Number(a.pl);
            }

            return String(a.zona).localeCompare(String(b.zona));
        });
        plAltas = deduplicarPLAltasSTW(plAltas);

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