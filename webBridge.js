const crypto = require('crypto');
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

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
        'build the radar': 'Construye el radar',
        'build the radar grid': 'Construye la cuadrícula del radar',
        'destroy the encampments': 'Destruye los campamentos',
        'refuel the homebase': 'Reabastece la base',
        'hit the road': 'Hit the Road',
        'atlas': 'Atlas'
    };

    let nombre = limpiarTextoSTW(nombreIngles)
        .replace(/\s+Group$/i, '')
        .trim();

    const categoria = nombre.match(/^category\s+([1-4])\s+/i);
    let base = categoria
        ? nombre.replace(/^category\s+[1-4]\s+/i, '').trim()
        : nombre;

    const misionEsp = misionesMap[base.toLowerCase()] || base;
    const prefijoCategoria = categoria ? 'Categoría ' + categoria[1] + ' ' : '';

    const limpio = limpiarTextoSTW(textoCompletoZona)
        .replace(/\bgroup\b/gi, '')
        .replace(/\bbunker\b/gi, 'Búnker')
        .replace(/\bbunkers\b/gi, 'Búnkeres')
        .trim();

    const biomasMap = {
        'thunder route 99': 'Ruta del Trueno 99',
        'thunder route': 'Ruta del Trueno 99',
        'industrial park': 'Parque industrial',
        'autumn industrial park': 'Parque industrial otoñal',
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

    let biomaEsp = '';
    const lowerLimpio = limpio.toLowerCase();
    for (const [key, val] of Object.entries(biomasMap)) {
        if (lowerLimpio.includes(key)) {
            biomaEsp = val;
            break;
        }
    }

    if (!biomaEsp) biomaEsp = limpio || 'Zona desconocida';
    return prefijoCategoria + misionEsp + ' - ' + biomaEsp;
}
function limpiarTextoSTW(texto) {
    return String(texto || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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
    let limpio = limpiarTextoSTW(nombre);
    if (!limpio) return '';

    if (tipo === 'vbucks') {
        const cantidad = (limpio.match(/\d{1,4}/) || [limpio])[0];
        return '🪙 ' + cantidad + ' PaVos';
    }

    const icono = rareza === 'legendary' ? '🟠' :
        rareza === 'epic' ? '🟣' :
        rareza === 'rare' ? '🔵' :
        rareza === 'uncommon' ? '🟢' : '⚪';

    const rarezaEs = rareza === 'legendary' ? 'legendario' :
        rareza === 'epic' ? 'épico' :
        rareza === 'rare' ? 'raro' :
        rareza === 'uncommon' ? 'poco común' : 'común';

    const tipoEs = {
        hero: 'Héroe',
        survivor: 'Superviviente',
        defender: 'Defensor',
        schematic: 'Esquema',
        supercharger: 'Supercargador',
        x4: 'Recompensa x4',
        evolution: 'Material de evolución',
        perkup: 'Perk-Up',
        elemental: 'Perk-Up elemental',
        reperk: 'Re-Perk',
        ore: 'Mineral/Cristal',
        llama: 'Llama',
        fulfillment: 'Recompensa aleatoria',
        other: 'Recompensa'
    }[tipo] || 'Recompensa';

    limpio = limpio
        .replace(/^(legendary|epic|rare|uncommon|common)\s+/i, '')
        .trim();

    if (tipo === 'hero') limpio = limpio.replace(/^hero\s*:?\s*/i, '').trim();
    if (tipo === 'survivor') limpio = limpio.replace(/^survivor\s*:?\s*/i, '').trim();
    if (tipo === 'defender') limpio = limpio.replace(/^defender\s*:?\s*/i, '').trim();
    if (tipo === 'schematic') limpio = limpio.replace(/^schematic\s*:?\s*/i, '').trim();

    if (!limpio || /^(survivor|defender|hero|schematic)$/i.test(limpio)) {
        return icono + ' ' + tipoEs + ' ' + rarezaEs;
    }

    if (/^\d+$/.test(limpio) && tipo !== 'vbucks') {
        return icono + ' ' + tipoEs + ' ' + rarezaEs + ' x' + limpio;
    }

    return icono + ' ' + tipoEs + ' ' + rarezaEs + ': ' + limpio;
}
function detectarTipoRecompensaSTW(iconClasses, dataFilter, rawName) {
    const icon = String(iconClasses || '').toLowerCase();
    const nombre = String(rawName || '').toLowerCase();

    if (/currency_mtxswap|vbucks|v-bucks|v bucks/.test(icon)) return 'vbucks';
    if (/\bhero\b/.test(icon)) return 'hero';
    if (/survivor|workerbasic|managerengineer/.test(icon)) return 'survivor';
    if (/defender-?|\bdefender\b/.test(icon)) return 'defender';
    if (/schematic/.test(icon)) return 'schematic';
    if (/reagent_alteration_ele_/.test(icon)) return 'elemental';
    if (/reagent_alteration_generic/.test(icon)) return 'reperk';
    if (/perkup/.test(icon)) return 'perkup';
    if (/ore|crystal/.test(icon)) return 'ore';
    if (/llama/.test(icon)) return 'llama';
    if (/fulfillment/.test(icon)) return 'fulfillment';

    if (/supercharger|supercargador/.test(nombre)) return 'supercharger';
    if (/\bhero\b|\bh[eé]roe\b/.test(nombre)) return 'hero';
    if (/survivor|superviviente/.test(nombre)) return 'survivor';
    if (/defender|defensor/.test(nombre)) return 'defender';
    if (/schematic|esquema|plano/.test(nombre)) return 'schematic';
    if (/reperk|re-perk|re-modificaci[oó]n/.test(nombre)) return 'reperk';
    if (/perkup|perk-up/.test(nombre)) return 'perkup';
    if (/llama/.test(nombre)) return 'llama';

    return 'other';
}

function detectarRarezaSTW(iconClasses, rewardTypeTexto) {
    const texto = (String(iconClasses || '') + ' ' + String(rewardTypeTexto || '')).toLowerCase();
    if (/\bmythic\b/.test(texto)) return 'mythic';
    if (/\blegendary\b/.test(texto)) return 'legendary';
    if (/\bepic\b/.test(texto)) return 'epic';
    if (/\brare\b/.test(texto)) return 'rare';
    if (/\buncommon\b/.test(texto)) return 'uncommon';
    if (/\bcommon\b/.test(texto)) return 'common';
    return null;
}
function extraerRecompensasMissionEntrySTW($, missionEntry) {
    const recompensas = [];

    $(missionEntry).find('.mission-rewards > .mission-reward-item').each((index, rewardEl) => {
        if ($(rewardEl).closest('.mission-reward-item--generic').length) return;

        const icon = $(rewardEl).find('.mission-reward-icon').first();
        const iconClasses = icon.attr('class') || '';
        const rewardType = $(rewardEl).find('.reward-type').first();
        const rewardTypeTexto = rewardType.length
            ? rewardType.text().replace(/\s+/g, ' ').trim()
            : '';

        let rewardName = rewardTypeTexto || $(rewardEl).find('.mission-reward-name').first().text().replace(/\s+/g, ' ').trim();
        rewardName = limpiarTextoSTW(rewardName);

        const tipo = detectarTipoRecompensaSTW(iconClasses, '', rewardName);
        const rareza = detectarRarezaSTW(iconClasses, rewardTypeTexto);
        const cantidadMatch = rewardName.match(/\b\d{1,4}\b/);
        const cantidad = cantidadMatch ? Number(cantidadMatch[0]) : null;

        const nombre = normalizarRecompensaSTW(rewardName, rareza, tipo);
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
        const key = [recompensa.nombre, recompensa.rareza || '', recompensa.tipo].join('|').toLowerCase();
        if (vistos.has(key)) continue;
        vistos.add(key);
        unicas.push(recompensa);
    }

    return unicas;
}
function detectarTipoAlertaSTW(valor) {
    const raw = String(valor || '').trim().toLowerCase();
    if (raw === 'elemental-alerts' || raw.includes('elemental-alert')) return 'elemental';
    if (raw.includes('storm_miniboss') || raw.includes('mini-boss')) return 'mini-boss';
    if (raw.startsWith('megaalert') || raw === 'mega-alerts' || raw.includes('mega-alert')) return 'mega';
    if (raw.startsWith('storm_') || raw === 'storm-alerts' || raw.includes('storm-alert')) return 'storm';
    return 'normal';
}

function obtenerNombreTipoAlertaSTW(tipo) {
    return {
        storm: 'Alerta de tormenta',
        'mini-boss': 'Mini-Jefe',
        mega: 'Mega Alerta',
        elemental: 'Alerta elemental',
        normal: 'Normal'
    }[tipo] || 'Normal';
}

function traducirModificadorSTW(nombre) {
    const limpio = limpiarTextoSTW(nombre);
    const mapa = {
        'Powerful Clubs and Hardware': 'Armas contundentes y ferretería poderosas',
        'Powerful Energy Attacks': 'Ataques de energía poderosos',
        'Leaping Ninjas': 'Ninjas saltarines',
        'Epic Mini-Boss': 'Mini-Jefe épico',
        'Adeot Outlanders': 'Forasteros expertos',
        'Well Drileld Soldiers': 'Soldados bien entrenados',
        'Adept Ninjas': 'Ninjas expertos',
        'Adept Constructors': 'Constructores expertos',
        'Ice Storm': 'Tormenta de hielo',
        'Fire Storm': 'Tormenta de fuego',
        'Melee Life Leech': 'Robo de vida cuerpo a cuerpo',
        'Upgraded Outlanders': 'Forasteros mejorados',
        'Powerful Shotguns': 'Escopetas poderosas',
        'Sword Ninjas': 'Ninjas de espada',
        'Powerful Traps': 'Trampas poderosas',
        'Powerful Swords and Spears': 'Espadas y lanzas poderosas',
        'Knockback Melee Attacks': 'Ataques cuerpo a cuerpo con retroceso',
        'Headshot Soldiers': 'Soldados especialistas en disparos a la cabeza',
        'Concussive Shieldbreak': 'Ruptura de escudo por conmoción',
        'Powerful Axes and Scythes': 'Hachas y guadañas poderosas',
        'Powerful Explosives': 'Explosivos poderosos',
        'Lightning Storm': 'Tormenta de relámpagos',
        'Adept Soldiers': 'Soldados expertos',
        'Focused Ninjas': 'Ninjas concentrados',
        'Smoke Screens': 'Cortinas de humo',
        'Life Leech Attacks': 'Ataques con robo de vida',
        'Acid Pools': 'Charcos de ácido',
        'Metal Corrosion': 'Corrosión metálica',
        'Uncharted Enemies': 'Enemigos no detectados',
        'Slowing Attacks': 'Ataques ralentizantes'
    };
    return mapa[limpio] || limpio;
}

function extraerModificadoresMissionEntrySTW($, missionEntry) {
    const modificadores = [];
    $(missionEntry).find('.mission-modifiers .mission-reward-item[title]').each((index, modifierEl) => {
        const titulo = limpiarTextoSTW($(modifierEl).attr('title') || '');
        if (!titulo) return;
        const traducido = traducirModificadorSTW(titulo);
        if (!modificadores.includes(traducido)) modificadores.push(traducido);
    });
    return modificadores;
}

function extraerMisionEntrySTW($, missionEntry, zona, tipoAlerta) {
    const atributos = $(missionEntry).attr('class') || '';
    const dataFilter = $(missionEntry).attr('data-filter') || '';
    const title = $(missionEntry).attr('title') || '';
    const pl = Number($(missionEntry).find('.mission-pl').first().text().trim());
    if (!Number.isInteger(pl) || pl < 1 || pl > 160) return null;

    const missionZone = $(missionEntry).find('.mission-zone').first();
    let partes = [];
    if (missionZone.length) {
        const htmlZone = missionZone.html() || '';
        partes = htmlZone.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').split(/\n+/).map(limpiarTextoSTW).filter(Boolean);
    }

    let textoMision = limpiarTextoSTW(partes.length ? partes[partes.length - 1] : title);
    if (!textoMision) return null;

    const separado = textoMision.match(/^(.+?)\s+-\s+(.+)$/);
    let nombreMision = separado ? separado[1].trim() : textoMision;
    const ubicacion = separado ? separado[2].trim() : '';
    nombreMision = nombreMision.replace(/\s+Group$/i, '').trim();

    const recompensas = extraerRecompensasMissionEntrySTW($, missionEntry);
    const modificadores = extraerModificadoresMissionEntrySTW($, missionEntry);
    const esVbucks = recompensas.some(r => r.tipo === 'vbucks') || /\bvbucks\b|v-bucks|v bucks|currency_mtxswap/i.test(atributos);
    const esX4 = /(?:^|\s)group(?:\s|$)/i.test(dataFilter) || /Group$/i.test(title);
    const tipoAlertaReal = detectarTipoAlertaSTW(tipoAlerta);
    const recompensaVbucks = recompensas.find(r => r.tipo === 'vbucks');
    const recompensaTexto = recompensas.map(r => r.nombre).filter(Boolean).join(' | ');

    const tiposRecompensa = dataFilter.toLowerCase().split(/\s+/).filter(Boolean);
    if (esX4 && !tiposRecompensa.includes('group')) tiposRecompensa.push('group');

    return {
        id: crypto.createHash('sha1').update([zona, pl, nombreMision, ubicacion, recompensaTexto, esX4].join('|')).digest('hex').slice(0, 14),
        zona,
        pl,
        mision: traducirMisionYBioma(nombreMision, ubicacion),
        misionOriginal: nombreMision,
        ubicacion,
        categoria: tiposRecompensa,
        tipoAlerta: tipoAlertaReal,
        tipoAlertaTexto: obtenerNombreTipoAlertaSTW(tipoAlertaReal),
        vbucks: esVbucks,
        cantidadVbucks: esVbucks ? (recompensaVbucks?.cantidad || Number($(missionEntry).find('.mission-reward-name').first().text().trim()) || 50) : null,
        esX4,
        recompensas,
        modificadores,
        rareza: recompensas.find(r => r.rareza === 'mythic')?.rareza || recompensas.find(r => r.rareza === 'legendary')?.rareza || recompensas.find(r => r.rareza === 'epic')?.rareza || recompensas.find(r => r.rareza === 'rare')?.rareza || recompensas.find(r => r.rareza === 'uncommon')?.rareza || recompensas.find(r => r.rareza === 'common')?.rareza || null,
        recompensa: recompensaTexto || 'Misión',
        source: 'https://stw-planner.com/mission-alerts',
        extraidoEn: new Date().toISOString()
    };
}
function deduplicarSTW(lista) {
    const mapa = new Map();

    for (const item of Array.isArray(lista) ? lista : []) {
        if (!item) continue;

        const clave = item.id
            ? String(item.id)
            : [
                item.zona ?? '',
                item.pl ?? '',
                item.mision ?? '',
                item.ubicacion ?? '',
                item.recompensa ?? '',
                item.cantidad ?? '',
                item.rareza ?? '',
                item.tipo ?? '',
                item.esX4 ? 'x4' : ''
            ].join('|').toLowerCase();

        if (!mapa.has(clave)) {
            mapa.set(clave, item);
        }
    }

    return Array.from(mapa.values());
}

function parsearPaginaSTW(html, fuente = 'all') {
    const $ = cheerio.load(html);
    const misiones = [];

    $('.card--container.card--mission').each((cardIndex, card) => {
        const zona = limpiarTextoSTW($(card).find('.mission-title').first().text()) || limpiarTextoSTW($(card).attr('data-filter')) || 'Desconocida';

        $(card).find('.mission-types > div[data-filter-group="alertType"]').each((typeIndex, typeContainer) => {
            const tipoAlertaRaw = $(typeContainer).attr('data-filter') || '';

            $(typeContainer).find('.mission-entry').each((missionIndex, missionEntry) => {
                const mision = extraerMisionEntrySTW(
                    $,
                    missionEntry,
                    zona,
                    fuente === 'vbucks' ? 'vbucks' : tipoAlertaRaw
                );

                if (mision) misiones.push(mision);
            });
        });
    });

    $('.special-reward-entry .mission-entry').each((index, missionEntry) => {
        const special = $(missionEntry).closest('.special-reward-entry');
        const titulo = limpiarTextoSTW(special.find('.special-title').first().text());
        const pl = Number($(missionEntry).find('.mission-pl').first().text().trim());

        const zoneHtml = $(missionEntry).find('.mission-zone').first().html() || '';
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

        if (Number.isInteger(pl) && pl >= 1 && pl <= 160) {
            misiones.push({
                id: crypto.createHash('sha1')
                    .update(['vbucks', zona, pl, nombre, ubicacion, cantidad].join('|'))
                    .digest('hex')
                    .slice(0, 14),
                zona,
                pl,
                mision: traducirMisionYBioma(nombre, ubicacion),
                misionOriginal: nombre,
                ubicacion,
                categoria: ['vbucks'],
                tipoAlerta: 'vbucks',
                tipoAlertaTexto: 'PaVos',
                vbucks: true,
                cantidadVbucks: cantidad,
                esX4: false,
                rareza: null,
                recompensas: [{
                    nombre: '🪙 ' + cantidad + ' PaVos',
                    raw: String(cantidad),
                    rareza: null,
                    tipo: 'vbucks',
                    cantidad,
                    iconClasses: 'currency_mtxswap'
                }],
                modificadores: [],
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
    const mapa = new Map();

    for (const m of misiones) {
        if (!(m.vbucks || m.tipoAlerta === 'vbucks')) continue;

        const clave = [m.pl, m.mision, m.ubicacion].join('|').toLowerCase();

        if (!mapa.has(clave)) {
            mapa.set(clave, {
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
            });
        }
    }

    return Array.from(mapa.values());
}

async function extraerAlertasAPI() {
    try {
        console.log('\n--- 🌐 RASPADO STW PLANNER ---');
        const urlPrincipal = 'https://stw-planner.com/mission-alerts';
        const urlPavos = 'https://stw-planner.com/mission-alerts/v-buck-missions';
        const [htmlPrincipal, htmlPavos] = await Promise.all([descargarSTW(urlPrincipal), descargarSTW(urlPavos)]);

        const todas = parsearPaginaSTW(htmlPrincipal, 'all');
        const pavosPagina = parsearPavosSTW(htmlPavos);

        // STW Planner actualmente muestra la misión de PaVos también en la
        // página principal de Mission Alerts. Conservamos ambas fuentes para
        // evitar que un cambio de estructura en /v-buck-missions deje los
        // PaVos en cero.
        const pavosDesdePrincipal = todas
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
                source: m.source || urlPrincipal,
                extraidoEn: m.extraidoEn || new Date().toISOString()
            }));

        if (todas.length === 0 && pavosPagina.length === 0 && pavosDesdePrincipal.length === 0) {
            console.warn('⚠️ STW Planner devolvió 0 misiones. No se modifican los datos anteriores.');
            return;
        }

        const mapaPavos = new Map();
        for (const p of [...pavosPagina, ...pavosDesdePrincipal]) {
            const clave = [
                p.pl ?? '',
                p.mision ?? '',
                p.ubicacion ?? '',
                p.zona ?? ''
            ].join('|').toLowerCase();

            if (!mapaPavos.has(clave)) {
                mapaPavos.set(clave, p);
                continue;
            }

            // Conserva la versión con cantidad válida y la fuente más directa.
            const anterior = mapaPavos.get(clave);
            if ((!anterior.cantidad || anterior.cantidad <= 0) && p.cantidad > 0) {
                mapaPavos.set(clave, p);
            }
        }

        const pavosFinal = Array.from(mapaPavos.values());

        // Elimina registros de las configuraciones manuales antiguas.
        // STW Planner es ahora la única fuente de alertas de Save the World.
        await Config.deleteMany({
            clave: {
                $in: [
                    'stw_pavos_activos',
                    'stw_epicas_activas',
                    'stw_legendarias_activas',
                    'stw_plaltas_activas'
                ]
            }
        });
        const tiposBuenos = ['hero', 'survivor', 'defender', 'schematic'];

        const epicas = todas
            .filter(m => m.recompensas.some(r => r.rareza === 'epic' && tiposBuenos.includes(r.tipo)))
            .map(m => ({ pl: m.pl, mision: m.mision, ubicacion: m.ubicacion, zona: m.zona, recompensa: m.recompensa, rareza: 'epic', tipoAlerta: m.tipoAlerta, tipoAlertaTexto: m.tipoAlertaTexto, modificadores: m.modificadores, source: m.source }));

        const legendarias = todas
            .filter(m => m.recompensas.some(r => r.rareza === 'legendary' && tiposBuenos.includes(r.tipo)))
            .map(m => ({ pl: m.pl, mision: m.mision, ubicacion: m.ubicacion, zona: m.zona, recompensa: m.recompensa, rareza: 'legendary', tipoAlerta: m.tipoAlerta, tipoAlertaTexto: m.tipoAlertaTexto, modificadores: m.modificadores, source: m.source }));

        function evaluarAlertaChida(mision) {
            // PLaltas SOLO admite recompensas épicas o legendarias de Héroe,
            // Superviviente, Defensor o Esquema. PaVos, x4 y otras recompensas
            // no califican por sí solas.
            const buenas = mision.recompensas.filter(r => tiposBuenos.includes(r.tipo));
            const legendarias = buenas.filter(r => r.rareza === 'legendary');
            const epicas = buenas.filter(r => r.rareza === 'epic');

            if (legendarias.length === 0 && epicas.length === 0) {
                return { mostrar: false, nivel: 0, motivo: '', destacadas: [] };
            }

            const legendariasNoDefensor = legendarias.filter(r => ['hero', 'survivor', 'schematic'].includes(r.tipo));
            if (legendariasNoDefensor.length) {
                return { mostrar: true, nivel: 95, motivo: '🟠 Recompensa legendaria', destacadas: legendariasNoDefensor };
            }

            const defensoresLegendarios = legendarias.filter(r => r.tipo === 'defender');
            if (defensoresLegendarios.length && Number(mision.pl) >= 124) {
                return { mostrar: true, nivel: 92, motivo: '🟠 Defensor legendario', destacadas: defensoresLegendarios };
            }

            const epicasUtiles = epicas.filter(r => ['hero', 'survivor', 'schematic'].includes(r.tipo));
            if (epicasUtiles.length && Number(mision.pl) >= 100) {
                return { mostrar: true, nivel: 85, motivo: '🟣 Recompensa épica', destacadas: epicasUtiles };
            }

            const defensoresEpicos = epicas.filter(r => r.tipo === 'defender');
            if (defensoresEpicos.length && Number(mision.pl) >= 124) {
                return { mostrar: true, nivel: 82, motivo: '🟣 Defensor épico', destacadas: defensoresEpicos };
            }

            return { mostrar: false, nivel: 0, motivo: '', destacadas: [] };
        }

        function prepararAlertaChida(mision) {
            const evaluada = evaluarAlertaChida(mision);
            if (!evaluada.mostrar) return null;
            // La misión se filtra por recompensas épicas/legendarias, pero
            // al mostrarla enseñamos TODAS sus recompensas reales.
            const recompensasTodas = Array.isArray(mision.recompensas) ? mision.recompensas : [];
            const recompensaMostrar = recompensasTodas.length
                ? recompensasTodas.map(r => r.nombre).filter(Boolean).join(' | ')
                : (mision.recompensa && mision.recompensa !== 'Misión' ? mision.recompensa : evaluada.motivo);

            return {
                pl: mision.pl,
                mision: mision.mision,
                ubicacion: mision.ubicacion,
                zona: mision.zona,
                recompensa: recompensaMostrar,
                motivo: evaluada.motivo,
                nivelAlerta: evaluada.nivel,
                tipoAlerta: mision.tipoAlerta,
                tipoAlertaTexto: mision.tipoAlertaTexto,
                esX4: Boolean(mision.esX4),
                modificadores: Array.isArray(mision.modificadores) ? mision.modificadores : [],
                // Guardamos todas las recompensas, no solamente las destacadas.
                recompensas: recompensasTodas,
                source: mision.source || urlPrincipal
            };
        }

        const mapaPlAltas = new Map();
        for (const item of todas.map(prepararAlertaChida).filter(Boolean)) {
            const clave = [item.zona || '', item.pl || '', item.mision || '', item.ubicacion || ''].join('|').toLowerCase();
            const anterior = mapaPlAltas.get(clave);
            if (!anterior || (item.motivo === '🪙 PaVos' && anterior.motivo !== '🪙 PaVos') || (anterior.motivo !== '🪙 PaVos' && item.nivelAlerta > anterior.nivelAlerta)) {
                mapaPlAltas.set(clave, item);
            }
        }

        let plAltas = Array.from(mapaPlAltas.values());
        plAltas.sort((a, b) => b.nivelAlerta - a.nivelAlerta || Number(b.pl) - Number(a.pl) || String(a.zona).localeCompare(String(b.zona)));

        await Config.findOneAndUpdate({ clave: 'stw_pavos_scrapeados' }, { valor: JSON.stringify(pavosFinal) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_scrapeadas' }, { valor: JSON.stringify(deduplicarSTW(epicas)) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_scrapeadas' }, { valor: JSON.stringify(deduplicarSTW(legendarias)) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_plaltas_scrapeadas' }, { valor: JSON.stringify(plAltas) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_ultima_actualizacion' }, { valor: JSON.stringify({ fuente: 'STW Planner', actualizadoEn: new Date().toISOString(), totalMisiones: todas.length, pavos: pavosFinal.length, epicas: epicas.length, legendarias: legendarias.length, plAltas: plAltas.length }) }, { upsert: true });

        console.log('✅ STW Planner guardado | Total: ' + todas.length + ' | 🪙 Pavos: ' + pavosFinal.length + ' | 🟣 Épicas: ' + epicas.length + ' | 🟠 Legendarias: ' + legendarias.length + ' | 🔥 Alertas destacadas: ' + plAltas.length);
    } catch (e) {
        console.error('❌ Error en la extracción STW Planner:', e.message);
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