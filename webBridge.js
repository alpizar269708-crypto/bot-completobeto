require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirYFormatear(texto) {
    let t = texto;
    const traducciones = {
        'Deliver the Bomb': 'Deliver The Bomb',
        'Ride the Lightning': 'Ride The Lightning',
        'Evacuate the Shelter': 'Evacuate The Shelter',
        'Fight the Storm': 'Fight The Storm',
        'Repair the Shelter': 'Repair The Shelter',
        'Retrieve the Data': 'Retrieve The Data',
        'Rescue the Survivors': 'Rescue the Survivors',
        'Resupply': 'Resupply',
        '(Group)': 'Grupo',
        'Lakeside': 'Orilla del Lago',
        'Ghost Town': 'Pueblo Fantasma',
        'Grasslands': 'Praderas',
        'Industrial Park': 'Parque Industrial',
        'Suburbs': 'Suburbios',
        'Thunder Route 99': 'Ruta del Trueno 99',
        'Tropical': 'Tropical',
        'Forest': 'Bosque',
        'Storm Shard': 'Esquirla de Tormenta',
        'AMP-UP!': 'Amp-Up',
        'FROST-UP!': 'Frost-Up',
        'FIRE-UP!': 'Fire-Up',
        'RE-PERK!': 'Re-Perk!',
        'Candy': 'Tickets',
        'Gold': 'Oro',
        'Schematic XP': 'XP de Esquema',
        'Survivor XP': 'XP de Superviviente',
        'Hero XP': 'XP de Héroe',
        'Epic Survivor': 'Superviviente Épico',
        'Legendary Survivor': 'Superviviente Legendario',
        'Epic Defender': 'Defensor Épico',
        'Legendary Defender': 'Defensor Legendario'
    };
    for (const [ing, esp] of Object.entries(traducciones)) {
        t = t.replace(new RegExp(ing, 'gi'), esp);
    }
    return t;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO DESDE SEEBOT.DEV ---`);
        const urlObjetivo = 'https://seebot.dev/missions.php';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let legendariasMap = new Map();

        // Recorremos cada fila de misión basándonos en tu estructura HTML exacta
        $('tr.missionRow').each((i, el) => {
            const pl = $(el).find('.missionPl').text().trim();
            
            // Filtramos únicamente niveles altos de interés (140 y 160)
            if (pl === '140' || pl === '160') {
                const missionRaw = $(el).find('.missionName img').attr('title') || 'Mission';
                const biomeRaw = $(el).find('.missionBiome').text().trim();
                
                let misionLimpia = traducirYFormatear(missionRaw.replace(' (Group)', ' Grupo'));
                let biomeLimpio = traducirYFormatear(biomeRaw);

                // Extracción de Alertas
                let alertas = [];
                $(el).find('.missionAlerts span').each((j, span) => {
                    const title = $(span).find('img').attr('title') || '';
                    const qty = $(span).text().trim(); // Ej. "x38"
                    let cleanTitle = title.split(' (')[0]; // Limpia sufijos como (Epic)
                    cleanTitle = traducirYFormatear(cleanTitle);
                    alertas.push(`${qty ? '*' + qty + '*' : ''} ${cleanTitle}`.trim());
                });

                // Extracción de Recompensas Base
                let recompensas = [];
                $(el).find('.missionRewards span').each((j, span) => {
                    const title = $(span).find('img').attr('title') || 'Gold';
                    const qty = $(span).text().trim();
                    let cleanTitle = title.split(' (')[0];
                    cleanTitle = traducirYFormatear(cleanTitle);
                    recompensas.push(`${qty ? '*' + qty + '*' : ''} ${cleanTitle}`.trim());
                });

                let claveUnica = `${pl}-${misionLimpia}-${biomeLimpio}`;

                if (!legendariasMap.has(claveUnica)) {
                    let etiquetaPl = pl === '160' ? '🔴 *Nivel 160 (Supercargador)*' : '⭐ *Nivel 140 (Ventures/Cumbres)*';
                    
                    let tarjeta = `⚡ *PL:* ${pl} | 🎯 *Misión:* ${misionLimpia} - ${biomeLimpio}\n` +
                                  `🎁 *Tipo:* ${etiquetaPl}\n` +
                                  `✨ *Alertas:* ${alertas.join(' | ')}` +
                                  (recompensas.length > 0 ? `\n🏛️ *Base:* ${recompensas.join(' | ')}` : '');

                    legendariasMap.set(claveUnica, {
                        pl: pl,
                        mision: `${misionLimpia} - ${biomeLimpio}`,
                        recompensa: tarjeta
                    });
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' };
        const fechaFormateada = new Date().toLocaleDateString('es-MX', options);

        let mensajeCompleto = `📅 _${fechaFormateada}_\n\n🌟 *ALERTAS LEGENDARIAS*\n\n` +
                              legendariasList.map(item => item.recompensa).join('\n\n') +
                              `\n\nSupport-a-Creator: *JASC13* ❤️`;

        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify([mensajeCompleto]) }, { upsert: true });
        
        console.log(`✅ [SEEBOT EXTRACTION OK] Total de misiones procesadas: ${legendariasList.length}`);

    } catch (e) {
        console.error("❌ Error en el raspado de SeeBot:", e.message);
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