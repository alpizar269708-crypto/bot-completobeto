require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

// Traducción oficial de recompensas al español de Salvar el Mundo
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

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO CON DISEÑO VERTICAL EXACTO ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let legendariasMap = new Map();

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

                    if (!legendariasMap.has(claveUnica) && listaRecompensas.length > 0) {
                        // Formato vertical estricto con saltos de línea (\n)
                        let tarjetaVertical = `⚡ *PL:* ${pl}\n` +
                                              `🎯 *Misión:* ${misionCompletaEsp}\n` +
                                              `🎁 *Recompensa:* ${listaRecompensas.join(' | ')}`;

                        legendariasMap.set(claveUnica, tarjetaVertical);
                    }
                }
            }
        });

        const tarjetasList = Array.from(legendariasMap.values());

        // Generar fecha actual en español
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' };
        const fechaFormateada = new Date().toLocaleDateString('es-MX', options);

        let mensajeCompleto = `📅 _${fechaFormateada}_\n\n🌟 *ALERTAS LEGENDARIAS*\n\n` +
                              tarjetasList.join('\n\n') +
                              `\n\nSupport-a-Creator: *JASC13* ❤️`;

        // Guardamos el mensaje completo preformateado en MongoDB para que index.js lo envíe tal cual
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify([mensajeCompleto]) }, { upsert: true });
        
        console.log(`✅ [MENSAJE VERTICAL OK] Total de misiones únicas guardadas: ${tarjetasList.length}`);

    } catch (e) {
        console.error("❌ Error en la extracción:", e.message);
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    extraerAlertasAPI();
    setInterval(extraerAlertasAPI, 60 * 60 * 1000);
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp, extraerAlertasAPI };