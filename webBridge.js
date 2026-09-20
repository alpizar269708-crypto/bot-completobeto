require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirYFormatearRecompensas(texto) {
    let t = texto;
    // Diccionario de traducción de recompensas y términos de STW
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
        'Epic Defender': 'Defensor Épico',
        'Base Reward': 'Recompensa Base',
        'Survivor': 'Sobreviviente',
        'Defender': 'Defensor',
        'Lead': 'Líder'
    };

    for (const [ing, esp] of Object.entries(traducciones)) {
        const regex = new RegExp(ing, 'gi');
        t = t.replace(regex, esp);
    }
    return t;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 OBTENIENDO ALERTAS COMPLETAS Y TRADUCIDAS ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        let pavosList = [];
        let epicasList = [];
        let legendariasList = [];

        const keywordsMisiones = [
            'fight the storm', 'retrieve the data', 'repair the shelter', 
            'ride the lightning', 'evacuate the shelter', 'deliver the bomb', 
            'resupply', 'eliminate and collect', 'rescue the survivors', 'hit the road', 'atlas'
        ];

        // Buscamos bloques de misiones individuales en la página
        $('*').each((i, el) => {
            const txt = $(el).text().replace(/\s+/g, ' ').trim();
            const plMatch = txt.match(/\b(140|160)\b/);

            if (plMatch && keywordsMisiones.some(k => txt.toLowerCase().includes(k))) {
                const pl = plMatch[1];

                if (txt.length > 20 && txt.length < 400) {
                    let textoTraducido = traducirYFormatearRecompensas(txt);

                    // Identificar el nombre de la misión
                    let nombreMision = "Misión";
                    for (let kw of keywordsMisiones) {
                        if (txt.toLowerCase().includes(kw)) {
                            nombreMision = kw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            break;
                        }
                    }

                    let claveUnica = `${pl}-${txt.substring(0, 30)}`;
                    if (!legendariasList.some(item => `${item.pl}-${item.mision.substring(0, 30)}` === claveUnica)) {
                        let etiqueta = pl === '160' ? '🔴 Nivel 160 (Supercargador)' : '⭐ Nivel 140';
                        
                        legendariasList.push({
                            pl,
                            mision: `${nombreMision} (Cumbres)`,
                            recompensa: `${etiqueta}\n🎯 Misión: ${nombreMision}\n🎁 Recompensas:\n${textoTraducido}`
                        });
                    }
                }
            }
        });

        // Guardar en MongoDB
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [STW TRADUCIDO] Guardado exitoso -> PaVos: ${pavosList.length} | Nivel 140 y 160: ${legendariasList.length}`);

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