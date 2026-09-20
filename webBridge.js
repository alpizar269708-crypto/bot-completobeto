require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirRecompensas(texto) {
    let t = texto;
    const traducciones = {
        'Epic PERK-UP!': 'Perk-Up Épico',
        'Legendary PERK-UP!': 'Perk-Up Legendario',
        'Rare PERK-UP!': 'Perk-Up Raro',
        'Uncommon PERK-UP!': 'Perk-Up Poco común',
        'AMP-UP!': 'Amp-Up',
        'FROST-UP!': 'Frost-Up',
        'FIRE-UP!': 'Fire-Up',
        'RE-PERK!': 'Re-Perk!',
        'Eye of the Storm': 'Ojo de la Tormenta',
        'Pure Drop of Rain': 'Gota de Lluvia Pura',
        'Lightning in a Bottle': 'Relámpago en Botella',
        'Storm Shard': 'Esquirla de Tormenta',
        'Schematic XP': 'XP de Esquema',
        'Hero XP': 'XP de Héroe',
        'Survivor XP': 'XP de Superviviente',
        'Venture XP': 'XP de Aventura',
        'Gold': 'Oro',
        'Tickets': 'Tickets',
        'Legendary Survivor': 'Superviviente Legendario',
        'Epic Survivor': 'Superviviente Épico',
        'Legendary Defender': 'Defensor Legendario',
        'Epic Defender': 'Defensor Épico',
        'Base Reward': 'Recompensa Base'
    };
    for (const [ing, esp] of Object.entries(traducciones)) {
        t = t.replace(new RegExp(ing, 'gi'), esp);
    }
    return t;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 OBTENIENDO ALERTAS ESTRUCTURADAS ---`);
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
            'resupply', 'eliminate and collect', 'rescue the survivors', 'hit the road', 'atlas', 'trap storm'
        ];

        const recompensasValidas = [
            'perk-up', 'amp-up', 'frost-up', 'fire-up', 're-perk', 
            'storm shard', 'eye of the storm', 'pure drop of rain', 
            'lightning in a bottle', 'survivor', 'defender', 'v-buck', 'pavo'
        ];

        $('div, article').each((i, el) => {
            const txt = $(el).text().replace(/\s+/g, ' ').trim();
            const plMatch = txt.match(/\b(140|160)\b/);
            
            if (plMatch && $(el).children().length <= 8) {
                const pl = plMatch[1];
                const kwEncontrada = keywordsMisiones.find(k => txt.toLowerCase().includes(k));
                const tieneRecompensaUtil = recompensasValidas.some(r => txt.toLowerCase().includes(r));

                if (kwEncontrada && tieneRecompensaUtil && txt.length > 20 && txt.length < 300) {
                    let nombreMision = kwEncontrada.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    let textoLimpio = traducirRecompensas(txt);

                    let claveUnica = `${pl}-${nombreMision}-${txt.substring(0, 20)}`;

                    if (!legendariasMap.has(claveUnica)) {
                        let etiqueta = pl === '160' ? '🔴 Nivel 160 (Supercargador)' : '⭐ Nivel 140 (Ventures/Cumbres)';

                        // Guardamos cada propiedad por separado para que index.js las lea correctamente
                        legendariasMap.set(claveUnica, {
                            pl: pl,
                            mision: nombreMision,
                            recompensa: `${etiqueta}\n${textoLimpio}`
                        });
                    }
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        // Guardamos en la base de datos como array de objetos (que es lo que tu index.js espera)
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [ESTRUCTURA CORRECTA] Total de misiones guardadas: ${legendariasList.length}`);

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