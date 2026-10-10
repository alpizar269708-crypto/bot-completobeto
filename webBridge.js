const crypto = require('crypto');
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirNombreMisionSTW(nombreIngles) {
    let nombre = limpiarTextoSTW(nombreIngles).replace(/\s+Group$/i, '').trim();
    if (!nombre) return '';

    const categoriaTormenta = nombre.match(/^category\s+([1-4])\s+fight the storm$/i);
    if (categoriaTormenta) return 'Lucha contra una tormenta de categoría ' + categoriaTormenta[1];

    const misionesMap = {
        'fight the storm': 'Lucha contra la tormenta',
        'retrieve the data': 'Recupera los datos',
        'repair the shelter': 'Repara el refugio',
        'ride the lightning': 'Monta el rayo',
        'evacuate the shelter': 'Evacúa el refugio',
        'deliver the bomb': 'Entrega la bomba',
        'resupply': 'Reabastecimiento',
        'eliminate and collect': 'Elimina y recoge',
        'rescue the survivors': 'Rescata a los supervivientes',
        'build the radar': 'Construye el radar',
        'build the radar grid': 'Construye la cuadrícula del radar',
        'destroy the encampments': 'Destruye los campamentos',
        'refuel the homebase': 'Reabastece la base',
        'trap the storm': 'Atrapa la tormenta',
        'hit the road': 'En la carretera',
        'atlas': 'Atlas',
        'category 1 fight the storm': 'Lucha contra una tormenta de categoría 1',
        'category 2 fight the storm': 'Lucha contra una tormenta de categoría 2',
        'category 3 fight the storm': 'Lucha contra una tormenta de categoría 3',
        'category 4 fight the storm': 'Lucha contra una tormenta de categoría 4'
    };
    return misionesMap[nombre.toLowerCase()] || nombre;
}

function traducirZonaSTW(zona) {
    const limpio = limpiarTextoSTW(zona);
    const clave = limpio.toLowerCase().replace(/\s+/g, ' ').trim();
    const zonas = {
        'stonewood': 'Bosque Pedregoso',
        'plankerton': 'Ciudad Tablón',
        'canny valley': 'Valle Latoso',
        'twine peaks': 'Cumbres Leñosas',
        'ventures': 'Aventuras',
        'venture zone': 'Zona de Aventuras',
        'hexsylvania venture zone': 'Zona de Aventuras de Hexsylvania',
        'hexsylvania': 'Hexsylvania'
    };
    if (zonas[clave]) return zonas[clave];
    return limpio.replace(/\bStonewood\b/gi, 'Bosque Pedregoso')
        .replace(/\bPlankerton\b/gi, 'Ciudad Tablón')
        .replace(/\bCanny Valley\b/gi, 'Valle Latoso')
        .replace(/\bTwine Peaks\b/gi, 'Cumbres Leñosas')
        .replace(/\bVenture Zone\b/gi, 'Zona de Aventuras')
        .replace(/\bVentures\b/gi, 'Aventuras');
}

function traducirBiomaSTW(bioma) {
    let limpio = limpiarTextoSTW(bioma);
    if (!limpio) return '';
    const mapa = {
        'autumn industrial park': 'Parque industrial otoñal',
        'industrial park': 'Parque industrial',
        'thunder route 99': 'Ruta Trueno 99',
        'thunder route': 'Ruta Trueno 99',
        'ghost town': 'Pueblo fantasma',
        'autumn suburbs': 'Suburbios otoñales',
        'autumn city': 'Ciudad otoñal',
        'autumn foothills': 'Colinas otoñales',
        'autumn hills': 'Colinas otoñales',
        'grasslands': 'Praderas',
        'desert': 'Desierto',
        'city': 'Ciudad',
        'lakeside': 'Ribera del lago',
        'tropical': 'Tropical',
        'forest': 'Bosque',
        'suburbs': 'Suburbios',
        'bunkers': 'Búnkeres',
        'bunker': 'Búnker',
        'the portal': 'El Portal',
        'the crater': 'El Cráter',
        'arid': 'árido',
        'group': ''
    };
    for (const [ingles, espanol] of Object.entries(mapa).sort((x, y) => y[0].length - x[0].length)) {
        limpio = limpio.replace(new RegExp('\\b' + ingles + '\\b', 'i'), espanol);
    }
    return limpio.replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
}

function traducirMisionYBioma(nombreIngles, textoCompletoZona) {
    const mision = traducirNombreMisionSTW(nombreIngles);
    const bioma = traducirBiomaSTW(textoCompletoZona);
    return bioma ? mision + ' - ' + bioma : mision;
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
        timeout: 15000,
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

    const icono = rareza === 'mythic' ? '🟡' :
        rareza === 'legendary' ? '🟠' :
        rareza === 'epic' ? '🟣' :
        rareza === 'rare' ? '🔵' :
        rareza === 'uncommon' ? '🟢' : '⚪';

    const rarezaEs = rareza === 'mythic' ? 'mítico' :
        rareza === 'legendary' ? 'legendario' :
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
    const texto = limpiarTextoSTW(nombre);
    const titulo = texto.split(/[:\n]/)[0].trim();
    const mapa = {
        'Powerful Clubs and Hardware': 'Armas contundentes y ferretería poderosas',
        'Powerful Energy Attacks': 'Ataques de energía poderosos',
        'Leaping Ninjas': 'Ninjas saltarines',
        'Epic Mini-Boss': 'Minijefe épico',
        'Adeot Outlanders': 'Forasteros expertos',
        'Well Drileld Soldiers': 'Soldados bien entrenados',
        'Adept Ninjas': 'Ninjas expertos',
        'Adept Constructors': 'Constructores expertos',
        'Ice Storm': 'Tormenta de hielo',
        'Fire Storm': 'Tormenta de fuego',
        'Nature Storm': 'Tormenta de naturaleza',
        'Water Storm': 'Tormenta de agua',
        'Lightning Storm': 'Tormenta de relámpagos',
        'Melee Life Leech': 'Robo de vida cuerpo a cuerpo',
        'Life Leech Attacks': 'Ataques con robo de vida',
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
        'Adept Soldiers': 'Soldados expertos',
        'Focused Ninjas': 'Ninjas concentrados',
        'Smoke Screens': 'Cortinas de humo',
        'Short Range': 'Alcance corto',
        'Healing Deathburst': 'Estallido curativo al morir',
        'Deathburst': 'Estallido mortal',
        'Exploding Deathburst': 'Estallido mortal explosivo',
        'Acid Pools': 'Charcos de ácido',
        'Metal Corrosion': 'Corrosión metálica',
        'Uncharted Enemies': 'Enemigos no detectados',
        'Slowing Attacks': 'Ataques ralentizantes',
        'Traps Vulnerability': 'Vulnerabilidad a las trampas',
        'Trap Vulnerability': 'Vulnerabilidad a las trampas',
        'Wall Weakening': 'Debilitamiento de muros',
        'Building Health': 'Salud de las estructuras',
        'Building Vulnerability': 'Vulnerabilidad de las estructuras',
        'Ricochet': 'Rebote',
        'Smoke Screen': 'Cortina de humo',
        'Berserker': 'Frenético',
        'Vampiric': 'Vampírico',
        'Mini-Boss': 'Minijefe',
        'Epic Mini Boss': 'Minijefe épico'
    };
    const coincidencia = Object.entries(mapa).find(([ingles]) => ingles.toLowerCase() === titulo.toLowerCase());
    return coincidencia ? coincidencia[1] : titulo;
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

function detectarMultiplicadorRecompensaSTW($, missionEntry, dataFilter, title) {
    const filtro = String(dataFilter || '').toLowerCase();
    const titulo = String(title || '').toLowerCase();

    if (/(^|\s)group(\s|$)/.test(filtro) || /(^|\s)x4(\s|$)/.test(filtro) || /\bx4\b/.test(titulo) || /group$/.test(titulo)) {
        return 4;
    }

    if (/(^|\s)x5(\s|$)/.test(filtro) || /(^|\s)group5(\s|$)/.test(filtro) || /(^|\s)group_5(\s|$)/.test(filtro) || /\bx5\b/.test(titulo)) {
        return 5;
    }

    return null;
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
    const multiplicadorRecompensa = detectarMultiplicadorRecompensaSTW($, missionEntry, dataFilter, title);
    const esX4 = multiplicadorRecompensa === 4;
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
        multiplicadorRecompensa,
        recompensas,
        modificadores,
        rareza: recompensas.find(r => r.rareza === 'mythic')?.rareza || recompensas.find(r => r.rareza === 'legendary')?.rareza || recompensas.find(r => r.rareza === 'epic')?.rareza || recompensas.find(r => r.rareza === 'rare')?.rareza || recompensas.find(r => r.rareza === 'uncommon')?.rareza || recompensas.find(r => r.rareza === 'common')?.rareza || null,
        recompensa: recompensaTexto || 'Misión',
        source: 'https://stw-planner.com/mission-alerts',
        extraidoEn: new Date().toISOString()
    };
}

function seleccionarAlertasSTWPorRareza(misiones, rareza) {
    // Un listado representa misiones, no recompensas individuales. Una misión
    // con premio épico y legendario aparece una sola vez en cada categoría y
    // conserva juntas ambas recompensas.
    const tiposPermitidos = new Set(['hero', 'survivor', 'defender', 'schematic', 'perkup']);
    const rarezasVisibles = new Set(['mythic', 'legendary', 'epic']);
    const alertas = [];
    for (const mision of Array.isArray(misiones) ? misiones : []) {
        const todasLasRecompensas = (Array.isArray(mision.recompensas) ? mision.recompensas : []);
        const recompensasVisibles = todasLasRecompensas.filter(r =>
            r && tiposPermitidos.has(r.tipo) && rarezasVisibles.has(r.rareza)
        );
        if (!recompensasVisibles.some(r => r.rareza === rareza)) continue;

        // Mantener las recompensas épicas/legendarias que justifican la alerta
        // y también los PaVos del mismo renglón. Así no desaparecen al filtrar
        // las listas por rareza y siguen visibles en epicasstw/legendariasstw.
        const recompensasDeSalida = todasLasRecompensas.filter(r =>
            r && (
                (tiposPermitidos.has(r.tipo) && rarezasVisibles.has(r.rareza)) ||
                r.tipo === 'vbucks'
            )
        );
        const recompensa = recompensasDeSalida.map(r => r.nombre).filter(Boolean).join(' | ');
        alertas.push({
            ...mision,
            id: crypto.createHash('sha1').update([
                mision.zona || '', mision.pl || '', mision.misionOriginal || mision.mision || '',
                mision.ubicacion || '', rareza
            ].join('|').toLowerCase()).digest('hex').slice(0, 14),
            rareza,
            recompensas: recompensasDeSalida,
            recompensa
        });
    }
    return deduplicarSTW(alertas).sort((a, b) =>
        Number(b.pl || 0) - Number(a.pl || 0) ||
        String(a.zona || '').localeCompare(String(b.zona || '')) ||
        String(a.mision || '').localeCompare(String(b.mision || ''))
    );
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


async function descargarSTWRenderizada(url, selectorEsperado = '#miniRwdTbl tr.missionRow', timeout = 15000) {
    let browser;
    try {
        const puppeteer = require('puppeteer');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(timeout);
        page.setDefaultTimeout(timeout);
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        const status = response ? response.status() : 0;
        if (status >= 400) throw new Error('La página renderizada respondió HTTP ' + status + '.');
        await page.waitForFunction((selector) => {
            const filas = document.querySelectorAll(selector);
            return filas.length > 1;
        }, { timeout }, selectorEsperado);
        const html = await page.content();
        const title = await page.title();
        if (/just a moment|checking your browser|verify you are human|attention required/i.test(title)) {
            throw new Error('El navegador recibió una página de protección o verificación, no una tabla de misiones.');
        }
        return { html, title, status, urlFinal: page.url() };
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

async function descargarVBucksDailyRenderizada(url, timeout = 25000) {
    let browser;
    try {
        const puppeteer = require('puppeteer');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(timeout);
        page.setDefaultTimeout(12000);
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        const status = response ? response.status() : 0;
        if (status >= 400) throw new Error('V-Bucks Daily respondió HTTP ' + status + '.');

        await page.waitForSelector('.mission-row', { timeout: 15000 });
        const filtroPulsado = await page.evaluate(() => {
            const normalizar = valor => String(valor || '')
                .toLowerCase()
                .replace(/\\s+/g, ' ')
                .trim();
            const selectores = 'button, [role="button"], a, label, [data-filter], input[type="radio"], input[type="checkbox"]';
            const elementos = Array.from(document.querySelectorAll(selectores));
            const filtro = elementos.find(el => {
                const texto = normalizar(el.innerText || el.textContent || '');
                const aria = normalizar(el.getAttribute('aria-label'));
                const titulo = normalizar(el.getAttribute('title'));
                const valor = normalizar(el.getAttribute('value'));
                const dataFilter = normalizar(el.getAttribute('data-filter'));
                return texto === 'all rewards' || aria === 'all rewards' || titulo === 'all rewards' ||
                    valor === 'all rewards' || dataFilter === 'all' ||
                    texto.startsWith('all rewards ') || texto === 'all rewards (all)';
            });
            if (!filtro) return false;
            const clicable = filtro.closest('label, button, [role="button"], a, [data-filter]') || filtro;
            clicable.click();
            return true;
        });

        if (!filtroPulsado) throw new Error('No se encontró el filtro “All rewards” en V-Bucks Daily.');
        // El filtro puede actualizar las filas del DOM mediante JavaScript.
        // Esperar a que aparezcan las recompensas que no son solo PaVos.
        await page.waitForFunction(() => {
            const filas = Array.from(document.querySelectorAll('.mission-row'));
            return filas.some(fila => fila.querySelector('.mission-reward.perks')) ||
                document.querySelectorAll('.mission-row .mission-reward').length > 2;
        }, { timeout: 12000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 700));

        const html = await page.content();
        const title = await page.title();
        if (/just a moment|checking your browser|verify you are human|attention required/i.test(title)) {
            throw new Error('V-Bucks Daily mostró una página de protección en lugar de las misiones.');
        }
        return { html, title, status, urlFinal: page.url(), filtroPulsado };
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}
function parsearTablaSeeBotSTW(html) {
    const $ = cheerio.load(String(html || ''));
    const filas = [];
    $('#miniRwdTbl tr.missionRow').each((_, row) => {
        const td = $(row).children('td');
        if (td.length < 6) return;
        const zona = limpiarTextoSTW($(td[0]).text());
        const pl = Number(limpiarTextoSTW($(td[1]).text()));
        const imgMision = $(td[2]).find('img').first();
        const misionOriginal = limpiarTextoSTW(imgMision.attr('title') || imgMision.attr('alt') || $(td[2]).text());
        if (!zona || !Number.isInteger(pl) || pl < 1 || pl > 160 || !misionOriginal) return;

        const modificadores = [];
        $(td[3]).find('img').each((__, img) => {
            const tituloCompleto = limpiarTextoSTW($(img).attr('title') || $(img).attr('alt') || '');
            const titulo = tituloCompleto.split(':')[0].trim();
            if (!titulo) return;
            const traducido = traducirModificadorSTW(titulo);
            if (!modificadores.includes(traducido)) modificadores.push(traducido);
        });

        const recompensas = [];
        let vbucks = false;
        let cantidadVbucks = 50;
        $(td[4]).find('span').each((__, span) => {
            const s = $(span);
            const clases = String(s.attr('class') || '').toLowerCase();
            const texto = limpiarTextoSTW(s.text()).replace(/[,;]+$/g, '').trim();
            if (!texto) return;

            if (/v-bucks|v\s*bucks|v-bucks or x-ray|v-bucks or x ray/i.test(texto)) {
                vbucks = true;
                const cantidad = texto.match(/\bx\s*(\d{1,4})\b/i) || texto.match(/\b(\d{1,4})\s*x?\s*(?:v-?bucks|v\s*bucks)\b/i);
                cantidadVbucks = cantidad ? Number(cantidad[1]) : 50;
                recompensas.push({
                    nombre: '🪙 ' + cantidadVbucks + ' PaVos',
                    raw: texto,
                    rareza: null,
                    tipo: 'vbucks',
                    cantidad: cantidadVbucks,
                    iconClasses: 'currency_mtxswap'
                });
                return;
            }

            const img = s.find('img').first();
            const iconUrl = String(img.attr('src') || '').toLowerCase();
            const tituloImagen = limpiarTextoSTW(img.attr('title') || img.attr('alt') || '');
            const nombreConRareza = tituloImagen || texto;
            const rarezaEnNombre = nombreConRareza.match(/\((Mythic|Legendary|Epic|Rare|Uncommon|Common)\)\s*$/i);
            const rareza = /(^|\s)mythic(\s|$)/.test(clases) ? 'mythic'
                : /(^|\s)legendary(\s|$)/.test(clases) ? 'legendary'
                : /(^|\s)epic(\s|$)/.test(clases) ? 'epic'
                : /(^|\s)rare(\s|$)/.test(clases) ? 'rare'
                : /(^|\s)uncommon(\s|$)/.test(clases) ? 'uncommon'
                : /(^|\s)common(\s|$)/.test(clases) ? 'common'
                : (rarezaEnNombre ? rarezaEnNombre[1].toLowerCase() : null);
            const rawName = nombreConRareza.replace(/\s*\((Mythic|Legendary|Epic|Rare|Uncommon|Common)\)\s*$/i, '').replace(/[,;]+$/g, '').trim();
            const tipo = /\/heroes\//.test(iconUrl) ? 'hero'
                : /\/workers\//.test(iconUrl) ? 'survivor'
                : /\/defenders\//.test(iconUrl) ? 'defender'
                : /\/schematics\//.test(iconUrl) ? 'schematic'
                : 'other';
            const nombre = tipo === 'other'
                ? (rareza === 'legendary' ? '🟠 ' : rareza === 'epic' ? '🟣 ' : '') + rawName
                : normalizarRecompensaSTW(rawName, rareza, tipo);
            recompensas.push({ nombre, raw: rawName, rareza, tipo, cantidad: null, iconClasses: iconUrl });
        });

        const esMiniBoss = modificadores.some(x => /mini-jefe épico/i.test(x));
        const tipoAlerta = esMiniBoss ? 'mini-boss' : 'normal';
        const recompensaTexto = recompensas.map(r => r.nombre).filter(Boolean).join(' | ') || 'Misión';
        filas.push({
            id: crypto.createHash('sha1').update(['seebot', zona, pl, misionOriginal, recompensaTexto].join('|')).digest('hex').slice(0, 14),
            zona, pl, mision: traducirNombreMisionSTW(misionOriginal), misionOriginal, ubicacion: '',
            categoria: /\(Group\)$/i.test(misionOriginal) ? ['group'] : [],
            tipoAlerta, tipoAlertaTexto: obtenerNombreTipoAlertaSTW(tipoAlerta),
            vbucks, cantidadVbucks: vbucks ? cantidadVbucks : null,
            esX4: /\(Group\)$/i.test(misionOriginal) || /(?:\bx4\b|x4\s)/i.test(recompensaTexto),
            multiplicadorRecompensa: /\(Group\)$/i.test(misionOriginal) ? 4 : null,
            recompensas, modificadores,
            rareza: recompensas.find(r => r.rareza === 'mythic')?.rareza
                || recompensas.find(r => r.rareza === 'legendary')?.rareza
                || recompensas.find(r => r.rareza === 'epic')?.rareza
                || null,
            recompensa: recompensaTexto,
            questReqs: limpiarTextoSTW($(td[5]).text()) || 'None',
            source: 'https://seebot.dev/missions.php',
            extraidoEn: new Date().toISOString()
        });
    });
    return deduplicarSTW(filas);
}

function extraerArrayMakeHtmlSTW(html) {
    const coincidencia = /makeHtml\s*\(\s*\[/i.exec(String(html || ''));
    if (!coincidencia) return [];
    const inicioJson = String(html).indexOf('[', coincidencia.index);
    const cierreScript = String(html).indexOf('</script>', inicioJson);
    let profundidad = 0, enString = false, escape = false, finJson = -1;
    for (let i = inicioJson; i < String(html).length; i++) {
        if (cierreScript >= 0 && i >= cierreScript) break;
        const ch = String(html)[i];
        if (enString) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') enString = false;
            continue;
        }
        if (ch === '"') { enString = true; continue; }
        if (ch === '[') profundidad++;
        if (ch === ']') {
            profundidad--;
            if (profundidad === 0) { finJson = i + 1; break; }
        }
    }
    if (inicioJson < 0 || finJson < 0) return [];
    try {
        const parsed = JSON.parse(String(html).slice(inicioJson, finJson));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('SeeBot: el arreglo makeHtml no es JSON válido:', error.message);
        return [];
    }
}

function parsearJSONSeeBotSTW(html) {
    const datos = extraerArrayMakeHtmlSTW(html);
    const misiones = [];
    const rarezas = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    const obtenerRasgo = (valor, claves) => {
        for (const clave of claves) {
            const dato = valor && valor[clave];
            if (dato !== undefined && dato !== null && String(dato).trim()) {
                if (typeof dato === 'object') return limpiarTextoSTW(dato.name || dato.title || dato.value || dato.id || '');
                return limpiarTextoSTW(dato);
            }
        }
        return '';
    };
    const textoDeLista = valor => {
        if (Array.isArray(valor)) return valor.map(x => typeof x === 'string' ? x : (x.name || x.title || x.modifier || x.value || x.id || '')).map(limpiarTextoSTW).filter(Boolean);
        if (typeof valor === 'string' && valor.trim()) return [limpiarTextoSTW(valor)];
        return [];
    };

    for (const m of datos) {
        if (!m || typeof m !== 'object') continue;
        const zona = limpiarTextoSTW(m.zone || m.missionZone || m.zoneName || m.missionZoneName || '');
        const pl = Number(m.powerLevel ?? m.pl ?? m.power ?? m.missionPowerLevel);
        const misionOriginal = limpiarTextoSTW(m.name || m.missionName || m.mission || m.missionType || '');
        if (!zona || !Number.isInteger(pl) || pl < 1 || pl > 160 || !misionOriginal) continue;

        const rewardData = Array.isArray(m.alertRewards) ? m.alertRewards
            : Array.isArray(m.rewards) ? m.rewards
            : Array.isArray(m.missionRewards) ? m.missionRewards : [];
        const recompensas = [];
        for (const reward of rewardData) {
            if (!reward || typeof reward !== 'object') continue;
            const campos = [
                reward.name, reward.itemName, reward.displayName, reward.localizedName, reward.itemType,
                reward.type, reward.id, reward.templateId, reward.itemId
            ].map(x => typeof x === 'string' ? x : '').join(' ');
            const rarezaCampo = obtenerRasgo(reward, ['rarity', 'itemRarity', 'rarityName', 'quality', 'tier', 'rarityType']);
            let rareza = rarezas.find(x => new RegExp('(^|[^a-z])' + x + '([^a-z]|$)', 'i').test(rarezaCampo));
            if (!rareza) rareza = rarezas.find(x => new RegExp('\\(' + x + '\\)', 'i').test(campos)) || null;
            const nombreRaw = obtenerRasgo(reward, ['localizedName', 'displayName', 'name', 'itemName', 'title', 'itemType', 'id', 'templateId', 'itemId']);
            if (!nombreRaw && !campos.trim()) continue;
            const nombreSinRareza = (nombreRaw || campos.trim())
                .replace(/\s*\((Mythic|Legendary|Epic|Rare|Uncommon|Common)\)\s*$/i, '')
                .replace(/[,;]+$/g, '').trim();
            const identidad = [
                reward.itemType, reward.type, reward.id, reward.templateId, reward.itemId,
                reward.name, reward.itemName, reward.displayName
            ].filter(Boolean).join(' ').toLowerCase();
            const vbucks = /v-?bucks|v\s*bucks|currency_mtxswap|mtxswap/.test(identidad);
            const cantidad = Number(reward.quantity ?? reward.count ?? reward.amount ?? 0);
            const tipo = vbucks ? 'vbucks'
                : /hero|character/i.test(identidad) ? 'hero'
                : /survivor|worker/i.test(identidad) ? 'survivor'
                : /defender/i.test(identidad) ? 'defender'
                : /schematic|weapon|trap/i.test(identidad) ? 'schematic'
                : 'other';
            if (vbucks) {
                recompensas.push({
                    nombre: '🪙 ' + (cantidad > 0 ? cantidad : 50) + ' PaVos',
                    raw: nombreSinRareza || 'V-Bucks',
                    rareza: null, tipo: 'vbucks', cantidad: cantidad > 0 ? cantidad : 50,
                    iconClasses: 'currency_mtxswap'
                });
            } else {
                const nombre = tipo === 'other'
                    ? (rareza === 'legendary' ? '🟠 ' : rareza === 'epic' ? '🟣 ' : '') + nombreSinRareza
                    : normalizarRecompensaSTW(nombreSinRareza, rareza, tipo);
                recompensas.push({ nombre, raw: nombreSinRareza, rareza, tipo, cantidad: cantidad || null, iconClasses: identidad });
            }
        }
        const modifiersRaw = m.modifiers || m.missionModifiers || m.missionAlertModifiers || m.modifierNames || m.modifier || [];
        const modifiers = textoDeLista(modifiersRaw).map(x => traducirModificadorSTW(x));
        const questReqs = obtenerRasgo(m, ['missionQuestReqs', 'questReqs', 'questRequirements', 'questRequirement', 'questReq', 'requiredQuest']) || 'None';
        const tienePavos = recompensas.some(r => r.tipo === 'vbucks');
        if (recompensas.length === 0 && Array.isArray(m.alertRewards) && m.alertRewards.length === 0) continue;
        const tipoAlerta = modifiers.some(x => /mini-boss|mini-jefe/i.test(x)) ? 'mini-boss' : 'normal';
        const recompensaTexto = recompensas.map(r => r.nombre).filter(Boolean).join(' | ') || 'Misión';
        misiones.push({
            id: crypto.createHash('sha1').update(['seebot-json', zona, pl, misionOriginal, recompensaTexto].join('|')).digest('hex').slice(0, 14),
            zona, pl, mision: traducirNombreMisionSTW(misionOriginal), misionOriginal,
            ubicacion: traducirBiomaSTW(m.location || m.biome || m.missionLocation || ''),
            categoria: /\bgroup\b/i.test(misionOriginal) ? ['group'] : [],
            tipoAlerta, tipoAlertaTexto: obtenerNombreTipoAlertaSTW(tipoAlerta),
            vbucks: tienePavos,
            cantidadVbucks: tienePavos ? (recompensas.find(r => r.tipo === 'vbucks')?.cantidad || 50) : null,
            esX4: /\bgroup\b|\bx4\b/i.test(misionOriginal + ' ' + recompensaTexto),
            multiplicadorRecompensa: /\bgroup\b/i.test(misionOriginal) ? 4 : null,
            recompensas, modificadores: modifiers, questReqs,
            rareza: recompensas.find(r => r.rareza === 'mythic')?.rareza || recompensas.find(r => r.rareza === 'legendary')?.rareza || recompensas.find(r => r.rareza === 'epic')?.rareza || null,
            recompensa: recompensaTexto,
            source: 'https://seebot.dev/missions.php',
            extraidoEn: new Date().toISOString()
        });
    }
    return deduplicarSTW(misiones);
}

function parsearVBucksDailySTW(html) {
    const $ = cheerio.load(String(html || ''));
    const alertas = [];
    const zonasConocidas = /(Hexsylvania\s+Venture\s+Zone|Canny Valley|Twine Peaks|Plankerton|Stonewood|Ventures?(?:\s+Zone)?|Hexsylvania)/i;
    const rarezas = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    const etiquetasRareza = {
        mythic: 'mítico', legendary: 'legendario', epic: 'épico',
        rare: 'raro', uncommon: 'poco común', common: 'común'
    };
    const iconosRareza = {
        mythic: '🟡', legendary: '🟠', epic: '🟣',
        rare: '🔵', uncommon: '🟢', common: '⚪'
    };

    $('.mission-row').each((_, fila) => {
        const row = $(fila);
        const plMatch = limpiarTextoSTW(row.find('.pl').first().text()).match(/\d{1,3}/);
        const nombre = limpiarTextoSTW(row.find('.mission-name strong').first().text());
        const ubicacionCompleta = limpiarTextoSTW(row.find('.mission-name small').first().text());
        if (!plMatch || !nombre || !ubicacionCompleta) return;

        // V-Bucks Daily identifica la zona y el bioma en el mismo <small>,
        // por ejemplo: "Twine Peaks · Thunder Route 99".
        const partesUbicacion = ubicacionCompleta.split(/\s*(?:·|•|\||—)\s*/).map(limpiarTextoSTW).filter(Boolean);
        let indiceZona = partesUbicacion.findIndex(p => zonasConocidas.test(p));
        const coincidenciaZona = ubicacionCompleta.match(zonasConocidas);
        const zona = indiceZona >= 0 ? partesUbicacion[indiceZona] : (coincidenciaZona ? coincidenciaZona[0] : '');
        if (!zona) return;
        const ubicacionCruda = indiceZona >= 0
            ? partesUbicacion.filter((_, i) => i !== indiceZona).join(' · ')
            : ubicacionCompleta.replace(zona, '');
        const ubicacion = traducirBiomaSTW(ubicacionCruda.replace(/^[-·•|—\s]+|[-·•|—\s]+$/g, '').trim());

        const recompensas = [];
        row.find('.mission-reward').each((__, rewardEl) => {
            const reward = $(rewardEl);
            const icon = reward.find('img').first();
            const iconSrc = String(icon.attr('src') || '').toLowerCase();
            const iconTitle = limpiarTextoSTW(icon.attr('title') || icon.attr('alt') || '');
            const clases = String(reward.attr('class') || '');
            const textoFuerte = limpiarTextoSTW(reward.find('strong').first().text() || reward.text());
            if (!textoFuerte) return;

            const esPavos = /v-?bucks|v\s*bucks|currency_mtxswap/i.test(clases + ' ' + iconSrc + ' ' + textoFuerte);
            const cantidadMatch = textoFuerte.match(/(?:[x×]\s*(\d{1,4})\b|\b(\d{1,4})\s*x\b)/i);
            const cantidadEncontrada = cantidadMatch ? Number(cantidadMatch[1] || cantidadMatch[2]) : null;

            if (esPavos) {
                const cantidad = Number.isFinite(cantidadEncontrada) && cantidadEncontrada > 0 ? cantidadEncontrada : 50;
                recompensas.push({
                    nombre: '🪙 ' + cantidad + ' PaVos',
                    raw: 'V-Bucks',
                    rareza: null,
                    tipo: 'vbucks',
                    cantidad,
                    iconClasses: iconSrc || clases
                });
                return;
            }

            const textoRareza = limpiarTextoSTW(reward.find('small').first().text());
            const matchRareza = (textoRareza + ' ' + textoFuerte + ' ' + iconTitle + ' ' + iconSrc)
                .match(/\b(mythic|legendary|epic|rare|uncommon|common)\b/i);
            const rareza = matchRareza ? matchRareza[1].toLowerCase() : null;
            let nombreRaw = (iconTitle && !/alert reward/i.test(iconTitle)) ? iconTitle : textoFuerte;
            nombreRaw = nombreRaw
                .replace(/^\s*(?:mythic|legendary|epic|rare|uncommon|common)\s+/i, '')
                .replace(/\s*[x×]\s*\d{1,4}\s*$/i, '')
                .replace(/[,;]+$/g, '')
                .trim();
            if (!nombreRaw) return;

            const tipo = detectarTipoRecompensaSTW(iconSrc + ' ' + clases, '', nombreRaw);
            let nombreRecompensa;
            if (tipo === 'perkup') {
                const icono = iconosRareza[rareza] || '⚪';
                const rarezaEs = etiquetasRareza[rareza] || '';
                nombreRecompensa = icono + ' Perk-Up' + (rarezaEs ? ' ' + rarezaEs : '');
                if (cantidadEncontrada && cantidadEncontrada > 1) nombreRecompensa += ' ×' + cantidadEncontrada;
            } else {
                nombreRecompensa = normalizarRecompensaSTW(nombreRaw, rareza, tipo);
                if (cantidadEncontrada && cantidadEncontrada > 1 && tipo !== 'hero' && tipo !== 'survivor' && tipo !== 'defender' && tipo !== 'schematic') {
                    nombreRecompensa += ' ×' + cantidadEncontrada;
                }
            }
            recompensas.push({
                nombre: nombreRecompensa,
                raw: nombreRaw,
                rareza,
                tipo,
                cantidad: cantidadEncontrada,
                iconClasses: iconSrc || clases
            });
        });

        const recompensasUnicas = [];
        const vistosRecompensas = new Set();
        for (const recompensa of recompensas) {
            const clave = [
                recompensa.tipo || '',
                recompensa.rareza || '',
                String(recompensa.raw || recompensa.nombre || '').toLowerCase().replace(/^(mythic|legendary|epic|rare|uncommon|common)\s+/, '').trim(),
                recompensa.cantidad || ''
            ].join('|');
            if (vistosRecompensas.has(clave)) continue;
            vistosRecompensas.add(clave);
            recompensasUnicas.push(recompensa);
        }
        if (!recompensasUnicas.length) return;

        const hayPavos = recompensasUnicas.some(r => r.tipo === 'vbucks');
        const recompensaTexto = recompensasUnicas.map(r => r.nombre).filter(Boolean).join(' | ');
        const tipos = [...new Set(recompensasUnicas.map(r => r.tipo).filter(Boolean))];
        const modificadores = row.find('.mission-modifier, .mission-modifiers .modifier').map((__, el) => traducirModificadorSTW(limpiarTextoSTW($(el).attr('title') || $(el).text()))).get().filter(Boolean);

        alertas.push({
            id: crypto.createHash('sha1').update(['vbucksdaily', zona, plMatch[0], nombre, ubicacion].join('|').toLowerCase()).digest('hex').slice(0, 14),
            zona,
            pl: Number(plMatch[0]),
            mision: traducirMisionYBioma(nombre, ubicacion),
            misionOriginal: nombre,
            ubicacion,
            categoria: tipos,
            tipoAlerta: hayPavos ? 'vbucks' : 'normal',
            tipoAlertaTexto: hayPavos ? 'PaVos' : 'Alerta',
            vbucks: hayPavos,
            cantidadVbucks: hayPavos ? (recompensasUnicas.find(r => r.tipo === 'vbucks')?.cantidad || 50) : null,
            esX4: /\bgroup\b|\bx4\b/i.test(nombre),
            multiplicadorRecompensa: /\bx4\b/i.test(nombre) ? 4 : null,
            recompensas: recompensasUnicas,
            modificadores: [...new Set(modificadores)],
            rareza: recompensasUnicas.find(r => r.rareza === 'mythic')?.rareza
                || recompensasUnicas.find(r => r.rareza === 'legendary')?.rareza
                || recompensasUnicas.find(r => r.rareza === 'epic')?.rareza
                || null,
            recompensa: recompensaTexto || 'Misión',
            source: 'https://vbucksdaily.com/',
            extraidoEn: new Date().toISOString()
        });
    });

    return deduplicarSTW(alertas);
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

    // Respaldo de estructura: si el sitio cambia los contenedores externos,
    // recorrer .mission-entry directamente en vez de depender de .card--mission
    // y .mission-types. Deduplicar al final evita repetir las ya leídas.
    if (misiones.length === 0) {
        $('.mission-entry').each((index, missionEntry) => {
            const plTexto = limpiarTextoSTW($(missionEntry).find('.mission-pl').first().text());
            const pl = Number((plTexto.match(/\d{1,3}/) || [])[0]);
            if (!Number.isInteger(pl) || pl < 1 || pl > 160) return;

            const card = $(missionEntry).closest('.card--mission, [class*="mission-card"], [data-zone]');
            const zona = limpiarTextoSTW(
                card.find('.mission-title, .zone-title, [class*="zone-title"]').first().text()
                || card.attr('data-zone')
                || card.attr('data-filter')
                || ''
            ) || 'Desconocida';

            const contenedorTipo = $(missionEntry).closest('[data-filter-group="alertType"], [data-filter-group*="alert"]');
            const tipo = fuente === 'vbucks' ? 'vbucks' : (contenedorTipo.attr('data-filter') || '');
            const mision = extraerMisionEntrySTW($, missionEntry, zona, tipo);
            if (mision) misiones.push(mision);
        });
    }

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

async function extraerAlertasAPI(progreso = null) {
    const informarDiagnostico = async (texto) => { if (typeof progreso === 'function') { try { await progreso(texto); } catch (e) {} } };
    const tiempoDiagnostico = Date.now();
    const etapaDiagnostico = async (texto) => { await informarDiagnostico('[' + ((Date.now() - tiempoDiagnostico) / 1000).toFixed(2) + ' s] ' + texto); };
    try {
        console.log('\n--- 🌐 RASPADO STW PLANNER ---');
        const urlPrincipal = 'https://stw-planner.com/mission-alerts';
        const urlPavos = 'https://stw-planner.com/mission-alerts/v-buck-missions';
        const urlSeeBot = 'https://seebot.dev/missions.php';
        const urlVBucksDaily = 'https://vbucksdaily.com/';
        let htmlPrincipal = '';
        let htmlPavos = '';
        let htmlSeeBot = '';
        let htmlVBucksDaily = '';

        await etapaDiagnostico('STW ETAPA 1: consultando STW Planner primero, V-Bucks Daily como segunda fuente y SeeBot como tercera fuente de respaldo.');
        const descargarFuente = async (nombre, url) => {
            try {
                const html = await descargarSTW(url);
                await etapaDiagnostico(nombre + ': HTML recibido (' + String(html || '').length + ' caracteres).');
                return html;
            } catch (error) {
                console.warn('No se pudo cargar ' + nombre + ':', error.message);
                await etapaDiagnostico(nombre + ' no disponible: ' + String(error.message || error).slice(0, 160));
                return '';
            }
        };
        [htmlPrincipal, htmlPavos, htmlVBucksDaily, htmlSeeBot] = await Promise.all([
            descargarFuente('STW Planner', urlPrincipal),
            descargarFuente('STW Planner PaVos', urlPavos),
            descargarFuente('V-Bucks Daily', urlVBucksDaily),
            descargarFuente('SeeBot', urlSeeBot)
        ]);

        const todasPlanner = htmlPrincipal ? parsearPaginaSTW(htmlPrincipal, 'all') : [];
        let todasSeeBot = htmlSeeBot ? parsearTablaSeeBotSTW(htmlSeeBot) : [];
        let filasSeeBotHTML = 0;
        try { filasSeeBotHTML = htmlSeeBot ? cheerio.load(htmlSeeBot)('#miniRwdTbl tr.missionRow').length : 0; } catch (_) {}
        let todasSeeBotJSON = [];
        if (todasSeeBot.length === 0 && htmlSeeBot) {
            todasSeeBotJSON = parsearJSONSeeBotSTW(htmlSeeBot);
            if (todasSeeBotJSON.length) {
                todasSeeBot = todasSeeBotJSON;
                console.log('✅ SeeBot JSON makeHtml: misiones extraídas=' + todasSeeBotJSON.length + '.');
            }
        }
        let todasVBucksDaily = htmlVBucksDaily ? parsearVBucksDailySTW(htmlVBucksDaily) : [];
        const vbucksDailyTraeRarezasHTTP = todasVBucksDaily.some(m =>
            (m.recompensas || []).some(r => r.tipo !== 'vbucks' && ['epic', 'legendary', 'mythic'].includes(r.rareza))
        );
        if (htmlVBucksDaily && !vbucksDailyTraeRarezasHTTP) {
            try {
                const renderizadaDaily = await descargarVBucksDailyRenderizada(urlVBucksDaily);
                const htmlRenderizado = cheerio.load(renderizadaDaily.html);
                const filasRenderizadasDaily = htmlRenderizado('.mission-row').length;
                const misionesRenderizadasDaily = parsearVBucksDailySTW(renderizadaDaily.html);
                const traeRecompensasRaras = misionesRenderizadasDaily.some(m =>
                    (m.recompensas || []).some(r => r.tipo !== 'vbucks' && ['epic', 'legendary', 'mythic'].includes(r.rareza))
                );
                console.log('🔎 V-Bucks Daily navegador | HTTP=' + renderizadaDaily.status +
                    ' | filtro All rewards=' + (renderizadaDaily.filtroPulsado ? 'activado' : 'no activado') +
                    ' | filas .mission-row=' + filasRenderizadasDaily +
                    ' | misiones válidas=' + misionesRenderizadasDaily.length +
                    ' | con recompensas épicas/legendarias=' + (misionesRenderizadasDaily.filter(m =>
                        (m.recompensas || []).some(r => r.tipo !== 'vbucks' && ['epic', 'legendary', 'mythic'].includes(r.rareza))
                    ).length) + '.');
                if (traeRecompensasRaras || misionesRenderizadasDaily.length > todasVBucksDaily.length) {
                    todasVBucksDaily = misionesRenderizadasDaily;
                }
            } catch (errorDailyRender) {
                console.warn('⚠️ V-Bucks Daily: no se pudo activar “All rewards” en el navegador:', errorDailyRender.message);
            }
        }
        console.log('🔎 STW fuentes recibidas | Planner HTML=' + String(htmlPrincipal || '').length +
            ' chars / misiones=' + todasPlanner.length +
            ' | V-Bucks Daily HTML=' + String(htmlVBucksDaily || '').length + ' chars / misiones=' + todasVBucksDaily.length +
            ' | SeeBot HTML=' + String(htmlSeeBot || '').length + ' chars / filas #miniRwdTbl=' +
            filasSeeBotHTML + ' / misiones válidas=' + todasSeeBot.length +
            ' / por tabla=' + (todasSeeBot.length - todasSeeBotJSON.length) + ' / por JSON=' + todasSeeBotJSON.length + '.');

        // Si no hay filas ni JSON en la respuesta directa, pedir la página pública
        // en un navegador normal como última alternativa.
        if (todasSeeBot.length === 0) {
            try {
                const renderizada = await descargarSTWRenderizada(urlSeeBot);
                const parseadas = parsearTablaSeeBotSTW(renderizada.html);
                const filasRenderizadas = cheerio.load(renderizada.html)('#miniRwdTbl tr.missionRow').length;
                console.log('🔎 SeeBot navegador | HTTP=' + renderizada.status +
                    ' | título=' + (renderizada.title || '(sin título)') +
                    ' | filas #miniRwdTbl=' + filasRenderizadas +
                    ' | misiones válidas=' + parseadas.length + '.');
                if (parseadas.length > 0) {
                    htmlSeeBot = renderizada.html;
                    todasSeeBot = parseadas;
                }
            } catch (errorRender) {
                console.warn('⚠️ SeeBot no entregó filas válidas por HTTP ni al renderizar:', errorRender.message);
            }
        }
        const mapaTodas = new Map();
        for (const m of [...todasPlanner, ...todasVBucksDaily, ...todasSeeBot]) {
            const nombreMision = String(m.misionOriginal || m.mision || '').toLowerCase().replace(/\s+/g, ' ').trim();
            const clave = [m.zona || '', m.pl || '', nombreMision, m.esX4 ? 'x4' : 'normal'].join('|').toLowerCase();
            if (!mapaTodas.has(clave)) {
                mapaTodas.set(clave, { ...m, recompensas: [...(m.recompensas || [])], modificadores: [...(m.modificadores || [])] });
                continue;
            }
            const anterior = mapaTodas.get(clave);
            const recompensas = [...(anterior.recompensas || [])];
            const normalizarClaveRecompensa = valor => String(valor || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/^\s*(?:mythic|legendary|epic|rare|uncommon|common)\s+/i, '')
                .replace(/\s*\((?:mythic|legendary|epic|rare|uncommon|common)\)\s*$/i, '')
                .replace(/\s*[x×]\s*\d{1,4}\s*$/i, '')
                .replace(/[^a-z0-9]+/g, '')
                .trim();
            const claveRecompensa = r => [
                String(r.tipo || '').toLowerCase(),
                String(r.rareza || '').toLowerCase(),
                normalizarClaveRecompensa(r.raw || r.nombre)
            ].join('|');
            const vistas = new Map(recompensas.map((r, index) => [claveRecompensa(r), index]));
            for (const r of (m.recompensas || [])) {
                const k = claveRecompensa(r);
                if (!vistas.has(k)) {
                    vistas.set(k, recompensas.length);
                    recompensas.push(r);
                    continue;
                }
                // Si una fuente prioritaria no informa la cantidad, completar
                // el dato desde otra sin duplicar visualmente la recompensa.
                const indice = vistas.get(k);
                if (!(Number(recompensas[indice].cantidad) > 0) && Number(r.cantidad) > 0) {
                    recompensas[indice] = { ...r, ...recompensas[indice], cantidad: Number(r.cantidad) };
                }
            }
            const modificadores = [...(anterior.modificadores || [])];
            for (const mod of (m.modificadores || [])) if (!modificadores.includes(mod)) modificadores.push(mod);
            mapaTodas.set(clave, {
                ...m,
                ...anterior,
                ubicacion: anterior.ubicacion || m.ubicacion || '',
                mision: anterior.mision || m.mision,
                misionOriginal: anterior.misionOriginal || m.misionOriginal,
                categoria: [...new Set([...(anterior.categoria || []), ...(m.categoria || [])])],
                tipoAlerta: (anterior.tipoAlerta && anterior.tipoAlerta !== 'normal') ? anterior.tipoAlerta : (m.tipoAlerta || anterior.tipoAlerta),
                tipoAlertaTexto: anterior.tipoAlertaTexto || m.tipoAlertaTexto,
                recompensas,
                modificadores,
                recompensa: recompensas.map(r => r.nombre).filter(Boolean).join(' | ') || anterior.recompensa || m.recompensa,
                vbucks: Boolean(anterior.vbucks || m.vbucks || recompensas.some(r => r.tipo === 'vbucks')),
                cantidadVbucks: anterior.cantidadVbucks || m.cantidadVbucks || recompensas.find(r => r.tipo === 'vbucks')?.cantidad || null,
                questReqs: anterior.questReqs || m.questReqs,
                rareza: recompensas.find(r => r.rareza === 'mythic')?.rareza
                    || recompensas.find(r => r.rareza === 'legendary')?.rareza
                    || recompensas.find(r => r.rareza === 'epic')?.rareza
                    || anterior.rareza || m.rareza,
                source: anterior.source || m.source
            });
        }
        let todas = Array.from(mapaTodas.values());
        const pavosPagina = htmlPavos ? parsearPavosSTW(htmlPavos) : [];
        const pavosDaily = todasVBucksDaily.filter(m => m.vbucks || m.tipoAlerta === 'vbucks');
        await etapaDiagnostico('STW ETAPA 2: resultados: Planner=' + todasPlanner.length + ', V-Bucks Daily=' + todasVBucksDaily.length + ', SeeBot=' + todasSeeBot.length + ', combinadas=' + todas.length + ', PaVos URL secundaria=' + pavosPagina.length + ', PaVos Daily=' + pavosDaily.length + '.');

        // STW Planner actualmente muestra la misión de PaVos también en la
        // página principal de Mission Alerts. Conservamos ambas fuentes para
        // evitar que un cambio de estructura en /v-buck-missions deje los
        // PaVos en cero.
        await etapaDiagnostico('STW ETAPA 7/8: iniciando filtros de recompensas, clasificación de rareza, deduplicación y PL altas.');
        let pavosDesdePrincipal = todas
            .filter(m => m.vbucks || m.tipoAlerta === 'vbucks')
            .map(m => ({
                pl: m.pl,
                mision: m.mision,
                misionOriginal: m.misionOriginal,
                ubicacion: m.ubicacion,
                zona: m.zona,
                cantidad: m.cantidadVbucks || 50,
                recompensa: 'PaVos',
                modificadores: Array.isArray(m.modificadores) ? m.modificadores : [],
                questReqs: m.questReqs || 'None',
                requisitos: m.questReqs || 'None',
                tipo: m.source === 'https://seebot.dev/missions.php' ? 'SeeBot.dev' :
                    m.source === 'https://vbucksdaily.com/' ? 'V-Bucks Daily' : 'STW Planner',
                source: m.source || urlPrincipal,
                extraidoEn: m.extraidoEn || new Date().toISOString()
            }));

        // V-Bucks Daily ya se consultó como segunda fuente y sus misiones
        // completas se incorporaron arriba. Si las otras fuentes no dan datos
        // de PaVos, sus filas sirven igualmente como respaldo.
        if (pavosPagina.length === 0 && pavosDesdePrincipal.length === 0 && pavosDaily.length) {
            pavosDesdePrincipal = pavosDaily.map(m => ({
                pl: m.pl, mision: m.mision, misionOriginal: m.misionOriginal, ubicacion: m.ubicacion,
                zona: m.zona, cantidad: m.cantidadVbucks || 50, recompensa: 'PaVos',
                tipo: 'V-Bucks Daily', source: m.source, extraidoEn: m.extraidoEn
            }));
        }

        if (todas.length === 0 && pavosPagina.length === 0 && pavosDesdePrincipal.length === 0) {
            console.warn('⚠️ STW Planner devolvió 0 misiones incluso con el parser de respaldo. No se modifican los datos anteriores; el comando debe probar la siguiente fuente disponible.');
            return { ok: false, error: 'STW Planner respondió, pero no se pudieron extraer misiones válidas.' };
        }

        const mapaPavos = new Map();
        for (const p of [...pavosPagina, ...pavosDesdePrincipal]) {
            const clave = [
                p.pl ?? '',
                p.misionOriginal ?? p.mision ?? '',
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
        const tiposBuenos = ['hero', 'survivor', 'defender', 'schematic', 'perkup'];
        const plannerTraeRecompensas = todasPlanner.some(m =>
            (m.recompensas || []).some(r => ['epic', 'legendary', 'mythic'].includes(r.rareza))
        );
        // Solo marcamos cobertura completa cuando hay una tabla general con
        // suficientes misiones, no cuando la página está refrescando y solo
        // se pudo recuperar el subconjunto de PaVos.
        const seebotTraeRarezas = todasSeeBot.some(m =>
            (m.recompensas || []).some(r => ['epic', 'legendary', 'mythic'].includes(r.rareza))
        );
        const vbucksDailyTraeRarezas = todasVBucksDaily.some(m =>
            (m.recompensas || []).some(r => ['epic', 'legendary', 'mythic'].includes(r.rareza))
        );
        const coberturaCompleta = (todasPlanner.length >= 5 && plannerTraeRecompensas) ||
            (todasVBucksDaily.length >= 5 && vbucksDailyTraeRarezas) ||
            (todasSeeBot.length >= 5 && seebotTraeRarezas);

        let epicas = seleccionarAlertasSTWPorRareza(todas, 'epic');
        let legendarias = seleccionarAlertasSTWPorRareza(todas, 'legendary');

        // Si solo respondió la fuente exclusiva de PaVos, no borrar las últimas
        // alertas épicas/legendarias/destacadas guardadas desde una fuente completa.
        const leerCacheSTW = async clave => {
            try {
                const doc = await Config.findOne({ clave });
                const parsed = doc?.valor ? JSON.parse(doc.valor) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) { return []; }
        };
        let destacadasCacheAnterior = [];
        if (!coberturaCompleta) {
            const [epicasAnteriores, legendariasAnteriores, destacadasAnteriores] = await Promise.all([
                leerCacheSTW('stw_epicas_scrapeadas'),
                leerCacheSTW('stw_legendarias_scrapeadas'),
                leerCacheSTW('stw_plaltas_scrapeadas')
            ]);
            if (!epicas.length) epicas = epicasAnteriores;
            if (!legendarias.length) legendarias = legendariasAnteriores;
            destacadasCacheAnterior = destacadasAnteriores;
        }

        function evaluarAlertaChida(mision) {
            // Una alerta de PaVos también debe estar disponible en destacadas.
            const contienePavos = Boolean(mision.vbucks || mision.recompensas.some(r => r.tipo === 'vbucks'));
            const buenas = mision.recompensas.filter(r => tiposBuenos.includes(r.tipo));
            const legendarias = buenas.filter(r => r.rareza === 'legendary');
            const epicas = buenas.filter(r => r.rareza === 'epic');

            if (legendarias.length === 0 && epicas.length === 0) {
                if (contienePavos) return { mostrar: true, nivel: 70, motivo: '🪙 Alerta de PaVos', destacadas: mision.recompensas.filter(r => r.tipo === 'vbucks') };
                return { mostrar: false, nivel: 0, motivo: '', destacadas: [] };
            }

            const legendariasNoDefensor = legendarias.filter(r => ['hero', 'survivor', 'schematic', 'perkup'].includes(r.tipo));
            if (legendariasNoDefensor.length) {
                return { mostrar: true, nivel: 95, motivo: '🟠 Recompensa legendaria', destacadas: legendariasNoDefensor };
            }

            const defensoresLegendarios = legendarias.filter(r => r.tipo === 'defender');
            if (defensoresLegendarios.length && Number(mision.pl) >= 124) {
                return { mostrar: true, nivel: 92, motivo: '🟠 Defensor legendario', destacadas: defensoresLegendarios };
            }

            const epicasUtiles = epicas.filter(r => ['hero', 'survivor', 'schematic', 'perkup'].includes(r.tipo));
            if (epicasUtiles.length && Number(mision.pl) >= 100) {
                return { mostrar: true, nivel: 85, motivo: '🟣 Recompensa épica', destacadas: epicasUtiles };
            }

            const defensoresEpicos = epicas.filter(r => r.tipo === 'defender');
            if (defensoresEpicos.length && Number(mision.pl) >= 124) {
                return { mostrar: true, nivel: 82, motivo: '🟣 Defensor épico', destacadas: defensoresEpicos };
            }

            if (contienePavos) return { mostrar: true, nivel: 70, motivo: '🪙 Alerta de PaVos', destacadas: mision.recompensas.filter(r => r.tipo === 'vbucks') };
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
                multiplicadorRecompensa: mision.multiplicadorRecompensa || null,
                modificadores: Array.isArray(mision.modificadores) ? mision.modificadores : [],
                questReqs: mision.questReqs,
                // Guardamos todas las recompensas, no solamente las destacadas.
                recompensas: recompensasTodas,
                source: mision.source || urlPrincipal
            };
        }

        const mapaPlAltas = new Map();
        for (const item of todas.map(prepararAlertaChida).filter(Boolean)) {
            const clave = [item.zona || '', item.pl || '', item.mision || '', item.ubicacion || ''].join('|').toLowerCase();
            const anterior = mapaPlAltas.get(clave);
            if (!anterior || Number(item.nivelAlerta || 0) > Number(anterior.nivelAlerta || 0)) {
                mapaPlAltas.set(clave, item);
            }
        }

        let plAltas = Array.from(mapaPlAltas.values());
        if (!coberturaCompleta && destacadasCacheAnterior.length) {
            const merged = new Map();
            for (const item of [...destacadasCacheAnterior, ...plAltas]) {
                const key = [item.zona || '', item.pl || '', item.mision || '', item.motivo || ''].join('|').toLowerCase();
                const previo = merged.get(key);
                if (!previo || Number(item.nivelAlerta || 0) > Number(previo.nivelAlerta || 0)) merged.set(key, item);
            }
            plAltas = Array.from(merged.values());
        }
        plAltas.sort((a, b) => b.nivelAlerta - a.nivelAlerta || Number(b.pl) - Number(a.pl) || String(a.zona).localeCompare(String(b.zona)));

        await etapaDiagnostico('STW ETAPA 8/8: escribiendo resultados en MongoDB. Si se detiene aquí, revisar permisos/conexión de base de datos.');
        await Config.findOneAndUpdate({ clave: 'stw_pavos_scrapeados' }, { valor: JSON.stringify(pavosFinal) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_scrapeadas' }, { valor: JSON.stringify(deduplicarSTW(epicas)) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_scrapeadas' }, { valor: JSON.stringify(deduplicarSTW(legendarias)) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_plaltas_scrapeadas' }, { valor: JSON.stringify(plAltas) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_ultima_actualizacion' }, { valor: JSON.stringify({
            fuente: coberturaCompleta
                ? (todasPlanner.length >= 5 ? 'STW Planner + V-Bucks Daily + SeeBot' : todasVBucksDaily.length >= 5 ? 'V-Bucks Daily + SeeBot' : 'SeeBot + STW Planner')
                : (todasVBucksDaily.length ? 'V-Bucks Daily (parcial)' : 'Fuentes STW (parcial)'),
            actualizadoEn: new Date().toISOString(),
            totalMisiones: todas.length,
            misionesPlanner: todasPlanner.length,
            misionesVBucksDaily: todasVBucksDaily.length,
            misionesSeeBot: todasSeeBot.length,
            coberturaCompleta,
            pavos: pavosFinal.length,
            epicas: epicas.length,
            legendarias: legendarias.length,
            plAltas: plAltas.length
        }) }, { upsert: true });
        await etapaDiagnostico('STW ETAPA 4/5: guardado MongoDB completado; PaVos=' + pavosFinal.length + ', épicas=' + epicas.length + ', legendarias=' + legendarias.length + ', PL altas=' + plAltas.length + '.');

        console.log((coberturaCompleta ? '✅' : '⚠️') + ' STW guardado | cobertura=' + (coberturaCompleta ? 'COMPLETA' : 'PARCIAL (se conservó caché anterior de épicas/legendarias)') +
            ' | total unificado=' + todas.length +
            ' | Planner=' + todasPlanner.length +
            ' | V-Bucks Daily=' + todasVBucksDaily.length +
            ' | SeeBot=' + todasSeeBot.length +
            ' | PaVos=' + pavosFinal.length +
            ' | épicas=' + epicas.length +
            ' | legendarias=' + legendarias.length +
            ' | destacadas=' + plAltas.length);
        await etapaDiagnostico('STW FINAL: proceso terminado correctamente en ' + ((Date.now() - tiempoDiagnostico) / 1000).toFixed(2) + ' s.');
        return { ok: true, total: todas.length, pavos: pavosFinal.length, epicas: epicas.length, legendarias: legendarias.length, plAltas: plAltas.length };
    } catch (e) {
        console.error('❌ Error en la extracción STW Planner:', e.stack || e.message);
        await etapaDiagnostico('STW FALLÓ: ' + String(e.stack || e.message || e).slice(0, 900));
        return { ok: false, error: e.message || String(e) };
    }
}
function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    // STW Planner se raspa una vez al día, a las 18:02 hora de México,
    // desde el cron de alertas diarias en comandos/fortnite.js.
    // Las consultas manuales hacen raspado en vivo antes de responder.
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp, extraerAlertasAPI, parsearTablaSeeBotSTW, parsearJSONSeeBotSTW, parsearVBucksDailySTW, traducirNombreMisionSTW, traducirZonaSTW, traducirBiomaSTW, traducirModificadorSTW, seleccionarAlertasSTWPorRareza };