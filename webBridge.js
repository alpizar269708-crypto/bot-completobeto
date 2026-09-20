require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirTexto(texto) {
    let t = texto;
    const traducciones = {
        'ride the lightning': 'Ride The Lightning',
        'evacuate the shelter': 'Evacuate The Shelter',
        'deliver the bomb': 'Deliver The Bomb',
        'fight the storm': 'Fight The Storm',
        'repair the shelter': 'Repair The Shelter',
        'resupply': 'Resupply',
        'rescue the survivors': 'Rescue The Survivors',
        'retrieve the data': 'Retrieve The Data',
        'group': 'Group',
        'ghost town': 'Pueblo Fantasma',
        'grasslands': 'Praderas',
        'industrial park': 'Parque Industrial',
        'lakeside': 'Orilla del Lago',
        'suburbs': 'Suburbios',
        'thunder route 99': 'Ruta del Trueno 99',
        'tropical': 'Tropical',
        'legendary survivor': 'Superviviente Legendario',
        'epic survivor': 'Superviviente Épico',
        'legendary defender': 'Defensor Legendario',
        'epic defender': 'Defensor Épico',
        'uncommon': 'Poco común',
        'rare': 'Raro',
        'epic': 'Épico',
        'legendary': 'Legendario',
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
        'Tickets': 'Tickets'
    };
    
    // Reemplazo inservible a mayúsculas/minúsculas de manera segura
    for (const [ing, esp] of Object.entries(traducciones)) {
        const regex = new RegExp(ing, 'gi');
        t = t.replace(regex, esp);
    }
    return t;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO QUIRÚRGICO BASADO EN DOM ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let legendariasMap = new Map();

        // Atacamos directamente el contenedor exacto de cada misión en la web
        $('div.mission-entry').each((i, el) => {
            const pl = $(el).find('div.mission-pl').text().trim();
            
            // Solo nos interesan las de nivel 140 y 160
            if (pl === '140' || pl === '160') {
                const zonaTextoRaw = $(el).find('div.mission-zone').text().trim();
                const zonaTexto = traducirTexto(zonaTextoRaw);

                // Extraemos todo el texto interno de los elementos de recompensa de la tarjeta
                let recompensaItems = [];
                $(el).find('.mission-reward-item, .mission-reward-name').each((j, itemEl) => {
                    const txtItem = $(itemEl).text().replace(/\s+/g, ' ').trim();
                    if (txtItem && !recompensaItems.includes(txtItem) && txtItem.length < 30) {
                        recompensaItems.push(txtItem);
                    }
                });

                // Limpiamos y traducimos los textos recolectados
                const recompensaUnida = recompensaItems.map(t => traducirTexto(t)).join(' ');
                
                // Extraer el nombre principal de la misión para el título
                let nombreMisionLimpio = zonaTexto.split('-')[0].replace(/Group/gi, '').trim();

                let claveUnica = `${pl}-${zonaTexto}`;

                if (!legendariasMap.has(claveUnica)) {
                    let etiqueta = pl === '160' ? '🔴 Nivel 160 (Supercargador)' : '⭐ Nivel 140 (Ventures/Cumbres)';

                    // Formato idéntico al solicitado
                    let tarjetaFormateada = `⚡ *PL:* ${pl} | 🎯 *Misión:* ${nombreMisionLimpio}\n` +
                                            `🎁 *Recompensa:* ${etiqueta}\n` +
                                            `${pl} ${zonaTexto} ${recompensaUnida}`;

                    legendariasMap.set(claveUnica, {
                        pl: pl,
                        mision: nombreMisionLimpio,
                        recompensa: tarjetaFormateada
                    });
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        // Guardar en MongoDB
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [EXTRACCIÓN DOM EXITOSA] Total de misiones de nivel alto procesadas: ${legendariasList.length}`);

    } catch (e) {
        console.error("❌ Error en la extracción por DOM:", e.message);
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