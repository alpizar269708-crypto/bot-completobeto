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

    // Superchargers (Recompensas clave de nivel 160)
    if (combinada.includes('supercharger')) {
        if (combinada.includes('survivor')) return '⚡ *Supercargador de Superviviente*';
        if (combinada.includes('hero')) return '⚡ *Supercargador de Héroe*';
        if (combinada.includes('weapon')) return '⚡ *Supercargador de Arma*';
        if (combinada.includes('trap')) return '⚡ *Supercargador de Trampa*';
        return '⚡ *Supercargador*';
    }

    if (combinada.includes('workerbasic') || combinada.includes('survivor')) {
        if (combinada.includes('legendary')) return '👤 *Superviviente Legendario*';
        if (combinada.includes('epic')) return '👤 *Superviviente Épico*';
        return '👤 *Superviviente*';
    }
    if (combinada.includes('defender')) {
        if (combinada.includes('legendary')) return '🛡️ *Defensor Legendario*';
        if (combinada.includes('epic')) return '🛡️ *Defensor Épico*';
        return '🛡️ *Defensor*';
    }

    if (combinada.includes('frost-up') || combinada.includes('ele_water')) return `❄️ ${prefix}*Frost-Up*`;
    if (combinada.includes('fire-up') || combinada.includes('ele_fire')) return `🔥 ${prefix}*Fire-Up*`;
    if (combinada.includes('amp-up') || combinada.includes('ele_nature')) return `⚡ ${prefix}*Amp-Up*`;
    if (combinada.includes('epic perk') || combinada.includes('t03_high')) return `🟣 ${prefix}*Perk-Up Épico*`;
    if (combinada.includes('legendary perk') || combinada.includes('t04_high')) return `🟠 ${prefix}*Perk-Up Legendario*`;
    if (combinada.includes('re-perk') || combinada.includes('alteration')) return `🔄 ${prefix}*Re-Perk!*`;

    if (combinada.includes('reagent_c') || combinada.includes('storm shard')) return `💎 ${prefix}*Esquirla de Tormenta*`;
    if (combinada.includes('reagent_t03') || combinada.includes('eye')) return `🌀 ${prefix}*Ojo de la Tormenta*`;
    if (combinada.includes('reagent_t01') || combinada.includes('rain')) return `💧 ${prefix}*Gota de Lluvia Pura*`;
    if (combinada.includes('reagent_t02') || combinada.includes('lightning')) return `⚡ ${prefix}*Relámpago en Botella*`;

    if (combinada.includes('ticket') || combinada.includes('campaign_event_currency')) return `🎫 ${prefix}*Tickets*`;
    if (combinada.includes('gold') || combinada.includes('eventscaling')) return cantidad ? `🪙 ${prefix}*Oro*` : '🪙 *Oro*';

    if (combinada.includes('schematicxp')) return `📘 ${cantidad ? prefix : 'x5 '}*XP de Esquema*`;
    if (combinada.includes('survivorxp')) return `📗 ${cantidad ? prefix : 'x4 '}*XP de Superviviente*`;
    if (combinada.includes('heroxp')) return `📙 ${cantidad ? prefix : ''}*XP de Héroe*`;
    if (combinada.includes('venturexp')) return `🗺️ ${cantidad ? prefix : ''}*XP de Aventura*`;

    if (cantidad) {
        return `🎁 *${cantidad}*`;
    }

    return texto ? `🎁 *${texto.trim()}*` : "";
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO TOTAL (TODAS LAS 140 Y 160) ---`);
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

                // Al estar en la página de alertas, cualquier coincidencia de 140 o 160 es válida
                if (kwEncontrada && txt.length > 15 && txt.length < 400) {
                    let nombreMision = kwEncontrada.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    
                    let bioma = "";
                    const partesZona = txt.split('-');
                    if (partesZona.length > 1) {
                        bioma = partesZona[1].replace(/\d+/g, '').trim();
                        bioma = bioma.charAt(0).toUpperCase() + bioma.slice(1);
                    }

                    let misionCompleta = bioma ? `${nombreMision} - ${bioma}` : nombreMision;

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

                    let claveUnica = `${pl}-${misionCompleta}`;

                    if (!legendariasMap.has(claveUnica)) {
                        legendariasMap.set(claveUnica, {
                            pl: pl,
                            mision: misionCompleta,
                            recompensa: listaRecompensas.length > 0 ? listaRecompensas.join(' | ') : '🎁 *Recompensa de Alerta*'
                        });
                    }
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [EXTRACCIÓN EXITOSA] Total de misiones 140 y 160 guardadas: ${legendariasList.length}`);

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