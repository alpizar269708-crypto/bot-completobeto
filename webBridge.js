require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirYFormatearRecompensas(texto) {
    let t = texto;
    const traducciones = {
        'Epic Perk-up': 'Perk-Up Épico',
        'Legendary Perk-up': 'Perk-Up Legendario',
        'Rare Perk-up': 'Perk-Up Raro',
        'Uncommon Perk-up': 'Perk-Up Poco común',
        'AMP-UP': 'Amp-Up',
        'FROST-UP': 'Frost-Up',
        'FIRE-UP': 'Fire-Up',
        'RE-PERK!': 'Re-Perk!',
        'Eye of the Storm': 'Ojo de la Tormenta',
        'Pure Drop of Rain': 'Gota de Lluvia Pura',
        'Lightning in a Bottle': 'Relámpago en Botella',
        'Storm Shard': 'Esquirla de Tormenta',
        'Schematic XP': 'XP de Esquema',
        'Hero XP': 'XP de Héroe',
        'Survivor XP': 'XP de Superviviente',
        'Gold': 'Oro',
        'Tickets': 'Tickets',
        'Legendary Survivor': 'Superviviente Legendario',
        'Epic Survivor': 'Superviviente Épico',
        'Legendary Defender': 'Defensor Legendario',
        'Epic Defender': 'Defensor Épico'
    };
    for (const [ing, esp] of Object.entries(traducciones)) {
        t = t.replace(new RegExp(ing, 'gi'), esp);
    }
    return t;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO ESTRICTO (SOLO INICIO 140/160) ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        let legendariasMap = new Map();

        const keywordsMisiones = [
            'fight the storm', 'retrieve the data', 'repair the shelter', 
            'ride the lightning', 'evacuate the shelter', 'deliver the bomb', 
            'resupply', 'eliminate and collect', 'rescue the survivors', 'hit the road', 'atlas'
        ];

        // Analizamos contenedores individuales
        $('div, article, li, tr').each((i, el) => {
            if ($(el).children().length > 15) return; 

            const txt = $(el).text().replace(/\s+/g, ' ').trim();
            
            // 🎯 CAMBIO CLAVE: El texto DEBE COMENZAR exactamente con 140 o 160 (con o sin rayo ⚡)
            const plMatch = txt.match(/^\s*(?:⚡\s*)?(140|160)\b/);

            if (plMatch) {
                const pl = plMatch[1];
                const kwEncontrada = keywordsMisiones.find(k => txt.toLowerCase().includes(k));

                if (kwEncontrada && txt.length < 300 && txt.length > 10) {
                    let nombreMision = kwEncontrada.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    let textoTraducido = traducirYFormatearRecompensas(txt);

                    let claveUnica = `${pl}-${txt.substring(0, 35).trim()}`;

                    if (!legendariasMap.has(claveUnica)) {
                        let etiqueta = pl === '160' ? '🔴 Nivel 160 (Supercargador)' : '⭐ Nivel 140';
                        legendariasMap.set(claveUnica, {
                            pl,
                            mision: nombreMision,
                            recompensa: `${etiqueta}\n🎯 Misión: ${nombreMision}\n🎁 Recompensas:\n${textoTraducido}`
                        });
                    }
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        // Guardar en MongoDB de forma limpia
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [STW ESTRICTO] Total exacto guardado -> Nivel 140 y 160: ${legendariasList.length}`);

    } catch (e) {
        console.error("❌ Error procesando STW Planner:", e.message);
    }
}

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    extraerAlertasAPI();
    setInterval(extraerAlertasAPI, 60 * 60 * 1000);
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
    console.log(`🔗 Chat vinculado: ${chatId}`);
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp };