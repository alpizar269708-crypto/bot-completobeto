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
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function detectarMisionSTW(texto) {
    const limpio = limpiarTextoSTW(texto);
    const nombres = [
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
        'atlas'
    ];

    for (const nombre of nombres) {
        const escaped = nombre.replace(/[.*+?^()|[\]\\]/g, '\\async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO DE PLs ALTAS ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let plAltasMap = new Map();

        const keywordsMisiones = [
            'fight the storm', 'retrieve the data', 'repair the shelter', 
            'ride the lightning', 'evacuate the shelter', 'deliver the bomb', 
            'resupply', 'eliminate and collect', 'rescue the survivors', 'atlas', 'trap storm'
        ];

        $('div, article').each((i, el) => {
            const txt = $(el).text().replace(/\s+/g, ' ').trim();
            const plMatch = txt.match(/\b(140|160)\b/);
            
            if (plMatch && $(el).children().length <= 12) {
                const pl = plMatch[1];
                const kwEncontrada = keywordsMisiones.find(k => txt.toLowerCase().includes(k));

                if (kwEncontrada && txt.length > 15 && txt.length < 400) {
                    let biomaCrudo = "";
                    const partesZona = txt.split('-');
                    if (partesZona.length > 1) {
                        biomaCrudo = partesZona[1].trim();
                    }

                    let misionCompletaEsp = traducirMisionYBioma(kwEncontrada, biomaCrudo);

                    let listaRecompensas = [];
                    $(el).find('.mission-reward-item').each((j, itemEl) => {
                        const title = $(itemEl).attr('title') || '';
                        const innerText = $(itemEl).text().replace(/\s+/g, ' ').trim();
                        const iconClass = $(itemEl).find('.mission-reward-icon').attr('class') || '';

                        const formateado = traducirYFormatearRecompensa(innerText || title, iconClass);
                        if (formateado && !listaRecompensas.includes(formateado)) {
                            listaRecompensas.push(formateado);
                        }
                    });

                    let claveUnica = `${pl}-${misionCompletaEsp}`;

                    if (!plAltasMap.has(claveUnica) && listaRecompensas.length > 0) {
                        plAltasMap.set(claveUnica, {
                            pl: pl,
                            mision: misionCompletaEsp,
                            recompensa: listaRecompensas.join(' | ')
                        });
                    }
                }
            }
        });

        const plAltasList = Array.from(plAltasMap.values());

        // Se guarda estrictamente en stw_plaltas_activas, liberando stw_legendarias_activas para uso manual
        await Config.findOneAndUpdate({ clave: 'stw_plaltas_activas' }, { valor: JSON.stringify(plAltasList) }, { upsert: true });
        
        console.log(`✅ [PL ALTAS EXTRAÍDAS OK] Total de misiones guardadas: ${plAltasList.length}`);

    } catch (e) {
        console.error("❌ Error en la extracción de PL altas:", e.message);
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    extraerAlertasAPI();
    setInterval(extraerAlertasAPI, 60 * 60 * 1000);
}');
        const regex = new RegExp(
            '((?:category\\s+[1-4]\\s+)?' +
            escaped +
            '(?:\\s+group)?\\s*-\\s*)(.{2,90}?)(?=\\s+\\d{1,3}\\b|\\s+(?:common|uncommon|rare|epic|legendary|mythic)\\b|$)',
            'i'
        );

        const match = limpio.match(regex);
        if (!match) continue;

        const misionCompleta = match[1].trim();
        const ubicacion = limpiarTextoSTW(match[2])
            .replace(/\\s+(?:common|uncommon|rare|epic|legendary|mythic)\\b.*$/i, '')
            .trim();

        const categoriaMatch = misionCompleta.match(/^category\\s+([1-4])\\s+/i);
        const base = misionCompleta
            .replace(/^category\\s+[1-4]\\s+/i, '')
            .replace(/\\s+group\\s*$/i, '')
            .replace(/\\s*[-–—]\\s*$/g, '')
            .trim();

        let misionEsp = traducirMisionYBioma(base, ubicacion)
            .replace(/ - Zona desconocida$/i, '')
            .trim();

        if (categoriaMatch) {
            misionEsp = 'Categoría ' + categoriaMatch[1] + ' ' + misionEsp;
        }

        return {
            original: base,
            mision: misionEsp,
            ubicacion: ubicacion
                .replace(/^[-–—\\s]+/, '')
                .replace(/\\s+/g, ' ')
                .trim()
        };
    }

    return null;
}

function extraerPLSTW(texto, misionInfo) {
    const limpio = limpiarTextoSTW(texto);
    if (!misionInfo) return null;

    const idx = limpio.toLowerCase().indexOf(misionInfo.original.toLowerCase());
    if (idx < 0) return null;

    const antes = limpio.slice(0, idx);
    const nums = [...antes.matchAll(/\\b(\\d{1,3})\\b/g)]
        .map(m => Number(m[1]))
        .filter(n => n >= 1 && n <= 160);

    return nums.length ? nums[nums.length - 1] : null;
}

function extraerRecompensasSTW($, el, textoCard) {
    const recompensas = [];
    const vistos = new Set();

    const items = $(el).find(
        '.mission-reward-item, [class*="mission-reward-item"], [class*="reward-item"]'
    ).toArray();

    for (const item of items) {
        const title = $(item).attr('title') || '';
        const innerText = $(item).text().replace(/\s+/g, ' ').trim();
        const iconClass = $(item).find('.mission-reward-icon').attr('class') || '';
        const alt = $(item).find('img').attr('alt') || '';

        const bruto = limpiarTextoSTW(
            [title, alt, innerText].filter(Boolean).join(' ')
        );

        if (!bruto) continue;

        const formateado = traducirYFormatearRecompensa(
            innerText || title || alt,
            iconClass
        );

        const rareza = /\blegendary\b/i.test(bruto)
            ? 'legendary'
            : /\bepic\b/i.test(bruto)
                ? 'epic'
                : null;

        const tipo = /v[\s-]?bucks|vbucks|v bucks/i.test(bruto)
            ? 'vbucks'
            : /survivor/i.test(bruto)
                ? 'survivor'
                : /defender/i.test(bruto)
                    ? 'defender'
                    : /hero/i.test(bruto)
                        ? 'hero'
                        : /schematic/i.test(bruto)
                            ? 'schematic'
                            : 'other';

        const cantidadMatch = bruto.match(/\b(\d{1,4})\b/);
        const cantidad = cantidadMatch ? Number(cantidadMatch[1]) : null;

        const key = [formateado, rareza, tipo, bruto].join('|').toLowerCase();
        if (vistos.has(key)) continue;
        vistos.add(key);

        recompensas.push({
            nombre: formateado || bruto,
            raw: bruto,
            rareza,
            tipo,
            cantidad
        });
    }

    if (!recompensas.some(r => r.rareza === 'legendary') && /\blegendary\b/i.test(textoCard)) {
        recompensas.push({
            nombre: '🟠 Recompensa legendaria',
            raw: 'Legendary',
            rareza: 'legendary',
            tipo: 'other',
            cantidad: null
        });
    }

    if (!recompensas.some(r => r.rareza === 'epic') && /\bepic\b/i.test(textoCard)) {
        recompensas.push({
            nombre: '🟣 Recompensa épica',
            raw: 'Epic',
            rareza: 'epic',
            tipo: 'other',
            cantidad: null
        });
    }

    return recompensas;
}

function detectarCardSTW($, el) {
    const texto = limpiarTextoSTW($(el).text());
    if (texto.length < 15 || texto.length > 900) return null;

    const misionInfo = detectarMisionSTW(texto);
    if (!misionInfo) return null;

    const pl = extraerPLSTW(texto, misionInfo);
    if (!pl) return null;

    const recompensas = extraerRecompensasSTW($, el, texto);

    return {
        texto,
        misionInfo,
        pl,
        recompensas
    };
}

function deduplicarSTW(lista) {
    const mapa = new Map();

    for (const item of lista) {
        const key = [
            item.zona,
            item.pl,
            item.mision,
            item.ubicacion,
            item.tipoAlerta,
            item.recompensa
        ].join('|').toLowerCase();

        if (!mapa.has(key)) {
            mapa.set(key, item);
        }
    }

    return Array.from(mapa.values());
}

async function rasparPaginaZonaSTW(url, zona) {
    const response = await axios.get(url, {
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
            'Cache-Control': 'no-cache'
        }
    });

    const $ = cheerio.load(response.data);
    const misiones = [];

    $('article, div').each((i, el) => {
        const hijos = $(el).children().length;
        if (hijos > 35) return;

        const card = detectarCardSTW($, el);
        if (!card) return;

        const texto = card.texto;
        const recompensas = card.recompensas;

        let tipoAlerta = 'normal';

        if (/storm_miniboss|miniboss/i.test(texto)) {
            tipoAlerta = 'miniboss';
        } else if (/megaalert|mega alerts/i.test(texto)) {
            tipoAlerta = 'mega';
        } else if (/elemental alerts/i.test(texto)) {
            tipoAlerta = 'elemental';
        } else if (recompensas.some(r => r.tipo === 'vbucks')) {
            tipoAlerta = 'vbucks';
        } else if (recompensas.some(r => r.rareza === 'legendary')) {
            tipoAlerta = 'legendary';
        } else if (recompensas.some(r => r.rareza === 'epic')) {
            tipoAlerta = 'epic';
        } else if (card.pl >= 140) {
            tipoAlerta = 'pl-alta';
        }

        const recompensaTexto = recompensas
            .map(r => r.nombre)
            .filter(Boolean)
            .slice(0, 8)
            .join(' | ');

        misiones.push({
            id: crypto.createHash('sha1')
                .update([
                    zona,
                    card.pl,
                    card.misionInfo.mision,
                    card.misionInfo.ubicacion,
                    recompensaTexto
                ].join('|'))
                .digest('hex')
                .slice(0, 14),
            zona,
            pl: card.pl,
            mision: card.misionInfo.mision,
            misionOriginal: card.misionInfo.original,
            ubicacion: card.misionInfo.ubicacion,
            tipoAlerta,
            recompensa: recompensaTexto || 'Misión',
            recompensas,
            source: url,
            extraidoEn: new Date().toISOString()
        });
    });

    return deduplicarSTW(misiones);
}

async function rasparPavosSTW() {
    const url = 'https://stw-planner.com/mission-alerts/v-buck-missions';

    const response = await axios.get(url, {
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
            'Cache-Control': 'no-cache'
        }
    });

    const $ = cheerio.load(response.data);
    const resultado = [];

    $('article, div').each((i, el) => {
        const hijos = $(el).children().length;
        if (hijos > 35) return;

        const texto = limpiarTextoSTW($(el).text());
        const misionInfo = detectarMisionSTW(texto);
        if (!misionInfo) return;

        const pl = extraerPLSTW(texto, misionInfo);
        if (!pl) return;

        const idx = texto.toLowerCase().indexOf(misionInfo.original.toLowerCase());
        const despues = idx >= 0 ? texto.slice(idx + misionInfo.original.length) : '';
        const cantidades = [...despues.matchAll(/\b(\d{1,3})\b/g)]
            .map(m => Number(m[1]))
            .filter(n => n > 0 && n <= 1000);

        const cantidad = cantidades.length ? cantidades[0] : 50;

        resultado.push({
            pl,
            mision: misionInfo.mision,
            misionOriginal: misionInfo.original,
            ubicacion: misionInfo.ubicacion,
            zona: 'Desconocida',
            cantidad,
            recompensa: 'PaVos',
            tipo: 'STW Planner',
            source: url,
            extraidoEn: new Date().toISOString()
        });
    });

    const unicos = new Map();

    for (const item of resultado) {
        const key = [item.pl, item.mision, item.ubicacion].join('|').toLowerCase();
        if (!unicos.has(key)) unicos.set(key, item);
    }

    return Array.from(unicos.values());
}

async function extraerAlertasAPI() {
    try {
        console.log('\n--- 🌐 RASPADO COMPLETO STW PLANNER ---');

        const zonas = [
            ['Stonewood', 'https://stw-planner.com/mission-alerts/stonewood'],
            ['Plankerton', 'https://stw-planner.com/mission-alerts/plankerton'],
            ['Canny Valley', 'https://stw-planner.com/mission-alerts/canny-valley'],
            ['Twine Peaks', 'https://stw-planner.com/mission-alerts/twine-peaks'],
            ['Venture', 'https://stw-planner.com/mission-alerts/venture']
        ];

        const resultados = [];

        for (const [zona, url] of zonas) {
            try {
                const lista = await rasparPaginaZonaSTW(url, zona);
                console.log('✅ ' + zona + ': ' + lista.length + ' misiones');
                resultados.push(...lista);
            } catch (error) {
                console.error('❌ ' + zona + ': ' + error.message);
            }
        }

        let pavos = [];

        try {
            pavos = await rasparPavosSTW();
            console.log('🪙 Pavos: ' + pavos.length + ' misiones');
        } catch (error) {
            console.error('❌ V-Bucks: ' + error.message);
        }

        if (resultados.length === 0 && pavos.length === 0) {
            console.warn('⚠️ STW Planner no devolvió misiones. Se conservan los datos anteriores.');
            return;
        }

        const todas = deduplicarSTW(resultados);

        const pavosFinal = deduplicarSTW(
            pavos.map(p => Object.assign({}, p, {
                zona: p.zona || 'Desconocida',
                pl: Number(p.pl),
                tipoAlerta: 'vbucks'
            }))
        );

        const epicas = todas
            .filter(m => m.recompensas.some(r => r.rareza === 'epic'))
            .map(m => ({
                pl: m.pl,
                mision: m.mision,
                ubicacion: m.ubicacion,
                zona: m.zona,
                recompensa: m.recompensa || 'Recompensa épica',
                rareza: 'epic',
                source: m.source
            }));

        const legendarias = todas
            .filter(m => m.recompensas.some(r => r.rareza === 'legendary'))
            .map(m => ({
                pl: m.pl,
                mision: m.mision,
                ubicacion: m.ubicacion,
                zona: m.zona,
                recompensa: m.recompensa || 'Recompensa legendaria',
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
                recompensa: m.recompensa || 'Misión',
                source: m.source
            }));

        await Config.findOneAndUpdate(
            { clave: 'stw_pavos_scrapeados' },
            { valor: JSON.stringify(pavosFinal) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_epicas_scrapeadas' },
            { valor: JSON.stringify(epicas) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_legendarias_scrapeadas' },
            { valor: JSON.stringify(legendarias) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_plaltas_scrapeadas' },
            { valor: JSON.stringify(plAltas) },
            { upsert: true }
        );

        await Config.findOneAndUpdate(
            { clave: 'stw_plaltas_activas' },
            { valor: JSON.stringify(plAltas) },
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