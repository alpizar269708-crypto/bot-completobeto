require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

// Diccionario de emojis y traducción exacta para Salvar el Mundo
function obtenerEmojiYTexto(nombreClase, textoOriginal) {
    const txt = (textoOriginal + " " + nombreClase).toLowerCase();

    if (txt.includes('survivor') && txt.includes('legendary')) return '👤 *Superviviente Legendario*';
    if (txt.includes('survivor') && txt.includes('epic')) return '👤 *Superviviente Épico*';
    if (txt.includes('defender') && txt.includes('legendary')) return '🛡️ *Defensor Legendario*';
    if (txt.includes('defender') && txt.includes('epic')) return '🛡️ *Defensor Épico*';
    
    // Perk-ups y materiales
    if (txt.includes('frost-up') || txt.includes('ele_water')) return '❄️ *Frost-Up*';
    if (txt.includes('fire-up') || txt.includes('ele_fire')) return '🔥 *Fire-Up*';
    if (txt.includes('amp-up') || txt.includes('ele_nature')) return '⚡ *Amp-Up*';
    if (txt.includes('epic perk')) return '🟣 *Perk-Up Épico*';
    if (txt.includes('legendary perk')) return '🟠 *Perk-Up Legendario*';
    if (txt.includes('re-perk')) return '🔄 *Re-Perk!*';

    // Evoluciones y materiales de tormenta
    if (txt.includes('storm shard') || txt.includes('high')) return '💎 *Esquirla de Tormenta*';
    if (txt.includes('eye of the storm')) return '🌀 *Ojo de la Tormenta*';
    if (txt.includes('pure drop') || txt.includes('rain')) return '💧 *Gota de Lluvia Pura*';
    if (txt.includes('lightning')) return '⚡ *Relámpago en Botella*';

    // Monedas y Tickets
    if (txt.includes('ticket') || txt.includes('campaign_event_currency')) return '🎫 *Tickets*';
    if (txt.includes('gold')) return '🪙 *Oro*';

    // XP
    if (txt.includes('schematicxp')) return '📘 *XP de Esquema*';
    if (txt.includes('survivorxp')) return '📗 *XP de Superviviente*';
    if (txt.includes('heroxp')) return '📙 *XP de Héroe*';

    return `🎁 *${textoOriginal.trim()}*`;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO CON OBJETOS ESTRUCTURADOS ---`);
        const urlObjetivo = 'https://stw-planner.com/mission-alerts';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let legendariasMap = new Map();

        $('div.mission-entry').each((i, el) => {
            const pl = $(el).find('div.mission-pl').text().trim();
            
            if (pl === '140' || pl === '160') {
                const zonaRaw = $(el).find('div.mission-zone').text().trim();
                
                // Traducción de zonas comunes al español
                let zonaLimpia = zonaRaw
                    .replace(/group/gi, 'Grupo')
                    .replace(/ghost town/gi, 'Pueblo Fantasma')
                    .replace(/grasslands/gi, 'Praderas')
                    .replace(/industrial park/gi, 'Parque Industrial')
                    .replace(/lakeside/gi, 'Orilla del Lago')
                    .replace(/suburbs/gi, 'Suburbios')
                    .replace(/thunder route 99/gi, 'Ruta del Trueno 99')
                    .replace(/tropical/gi, 'Tropical')
                    .replace(/forest/gi, 'Bosque');

                let recompensasPrincipales = [];
                let recompensasBase = [];

                // Extraer recompensas principales
                $(el).find('.mission-rewards > .mission-reward-item').each((j, itemEl) => {
                    const title = $(itemEl).attr('title') || '';
                    const innerText = $(itemEl).text().replace(/\s+/g, ' ').trim();
                    const iconClass = $(itemEl).find('.mission-reward-icon').attr('class') || '';
                    
                    let desc = innerText || title;
                    if (desc || iconClass) {
                        recompensasPrincipales.push(obtenerEmojiYTexto(iconClass, desc));
                    }
                });

                // Extraer recompensas base
                $(el).find('.mission-reward-item--generic .mission-reward-item').each((j, baseEl) => {
                    const title = $(baseEl).attr('title') || '';
                    const innerText = $(baseEl).text().replace(/\s+/g, ' ').trim();
                    const iconClass = $(baseEl).find('.mission-reward-icon').attr('class') || '';

                    let desc = innerText || title;
                    if (desc || iconClass || $(baseEl).hasClass('gold')) {
                        recompensasBase.push(obtenerEmojiYTexto(iconClass, desc || 'Oro'));
                    }
                });

                let claveUnica = `${pl}-${zonaRaw}`;

                if (!legendariasMap.has(claveUnica)) {
                    let etiquetaPl = pl === '160' ? '🔴 *Nivel 160 (Supercargador)*' : '⭐ *Nivel 140 (Ventures/Cumbres)*';

                    // Formateamos las recompensas manteniendo las propiedades que index.js espera
                    let textoRecompensas = `${recompensasPrincipales.join(' | ')}` +
                                          (recompensasBase.length > 0 ? `\n🏛️ *Base:* ${recompensasBase.join(' | ')}` : '');

                    legendariasMap.set(claveUnica, {
                        pl: `${pl} (${etiquetaPl})`,
                        mision: zonaLimpia,
                        recompensa: textoRecompensas
                    });
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        // Guardamos los objetos correctamente estructurados en la base de datos
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [ESTRUCTURA DE OBJETOS OK] Total de misiones guardadas: ${legendariasList.length}`);

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