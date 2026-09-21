require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

// Relaciona la clase del icono y el texto para devolver el emoji, cantidad y nombre exacto en español
function formatearRecompensaInteligente(iconClass, textoTexto) {
    const cls = (iconClass || "").toLowerCase();
    const txt = (textoTexto || "").toLowerCase();
    const combinada = cls + " " + txt;

    // Extraer número si existe en el texto
    const matchNum = txt.match(/\d+/);
    const cantidad = matchNum ? matchNum[0] : "";
    const prefix = cantidad ? `*${cantidad}x* ` : "";

    // Supervivientes y Defensores
    if (combinada.includes('workerbasic') || combinada.includes('survivor')) {
        if (combinada.includes('legendary') || combinada.includes('sr_t01')) return '👤 *Superviviente Legendario*';
        if (combinada.includes('epic')) return '👤 *Superviviente Épico*';
        return '👤 *Superviviente*';
    }
    if (combinada.includes('defender')) {
        if (combinada.includes('legendary')) return '🛡️ *Defensor Legendario*';
        if (combinada.includes('epic')) return '🛡️ *Defensor Épico*';
        return '🛡️ *Defensor*';
    }

    // Perk-Ups y Elementos
    if (combinada.includes('ele_water') || combinada.includes('frost-up')) return `❄️ ${prefix}*Frost-Up*`;
    if (combinada.includes('ele_fire') || combinada.includes('fire-up')) return `🔥 ${prefix}*Fire-Up*`;
    if (combinada.includes('ele_nature') || combinada.includes('amp-up')) return `⚡ ${prefix}*Amp-Up*`;
    if (combinada.includes('epic perk') || combinada.includes('t03_high')) return `🟣 ${prefix}*Perk-Up Épico*`;
    if (combinada.includes('legendary perk') || combinada.includes('t04_high')) return `🟠 ${prefix}*Perk-Up Legendario*`;
    if (combinada.includes('re-perk') || combinada.includes('alteration')) return `🔄 ${prefix}*Re-Perk!*`;

    // Materiales de evolución y tormenta (mapeados por sus clases reales de STW Planner)
    if (combinada.includes('reagent_c') || combinada.includes('t04_high')) return `💎 ${prefix}*Esquirla de Tormenta*`;
    if (combinada.includes('reagent_t03') || combinada.includes('eye')) return `🌀 ${prefix}*Ojo de la Tormenta*`;
    if (combinada.includes('reagent_t01') || combinada.includes('rain')) return `💧 ${prefix}*Gota de Lluvia Pura*`;
    if (combinada.includes('reagent_t02') || combinada.includes('bottle') || combinada.includes('lightning')) return `⚡ ${prefix}*Relámpago en Botella*`;

    // Monedas y Tickets
    if (combinada.includes('ticket') || combinada.includes('campaign_event_currency')) return `🎫 ${prefix}*Tickets*`;
    if (combinada.includes('gold') || combinada.includes('eventscaling')) return cantidad ? `🪙 ${prefix}*Oro*` : '🪙 *Oro*';

    // XP
    if (combinada.includes('schematicxp')) return `📘 ${cantidad ? prefix : 'x5 '}*XP de Esquema*`;
    if (combinada.includes('survivorxp')) return `📗 ${cantidad ? prefix : 'x4 '}*XP de Superviviente*`;
    if (combinada.includes('heroxp')) return `📙 ${cantidad ? prefix : ''}*XP de Héroe*`;

    // Genéricos con cantidad (como x4 o números sueltos)
    if (cantidad && !txt.includes('mission')) {
        return `🎁 *${cantidad}*`;
    }

    return textoTexto ? `🎁 *${textoTexto.trim()}*` : "";
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO INTELIGENTE Y LIMPIO ---`);
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
                
                // Traducción limpia de zonas al español
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

                // Extraer recompensas principales vinculando icono y texto
                $(el).find('.mission-rewards > .mission-reward-item').each((j, itemEl) => {
                    const title = $(itemEl).attr('title') || '';
                    const innerText = $(itemEl).text().replace(/\s+/g, ' ').trim();
                    const iconClass = $(itemEl).find('.mission-reward-icon').attr('class') || '';
                    
                    const resultadoFormateado = formatearRecompensaInteligente(iconClass, innerText || title);
                    if (resultadoFormateado && !recompensasPrincipales.includes(resultadoFormateado)) {
                        recompensasPrincipales.push(resultadoFormateado);
                    }
                });

                // Extraer recompensas base
                $(el).find('.mission-reward-item--generic .mission-reward-item').each((j, baseEl) => {
                    const title = $(baseEl).attr('title') || '';
                    const innerText = $(baseEl).text().replace(/\s+/g, ' ').trim();
                    const iconClass = $(baseEl).find('.mission-reward-icon').attr('class') || '';

                    const resultadoFormateado = formatearRecompensaInteligente(iconClass, innerText || title || 'Oro');
                    if (resultadoFormateado) {
                        recompensasBase.push(resultadoFormateado);
                    }
                });

                let claveUnica = `${pl}-${zonaRaw}`;

                if (!legendariasMap.has(claveUnica)) {
                    // Estructura limpia y directa sin duplicados molestos
                    let tarjetaVisual = `⚡ *PL:* ${pl} | 🎯 *Misión:* ${zonaLimpia}\n` +
                                        `🎁 *Recompensas:* ${recompensasPrincipales.join(' | ')}` +
                                        (recompensasBase.length > 0 ? `\n🏛️ *Base:* ${recompensasBase.join(' | ')}` : '');

                    legendariasMap.set(claveUnica, {
                        pl: pl,
                        mision: zonaLimpia,
                        recompensa: tarjetaVisual
                    });
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        // Generar fecha actual en español
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' };
        const fechaFormateada = new Date().toLocaleDateString('es-MX', options);

        let mensajeCompleto = `📅 _${fechaFormateada}_\n\n🌟 *ALERTAS LEGENDARIAS*\n\n` +
                              legendariasList.map(item => item.recompensa).join('\n\n') +
                              `\n\nSupport-a-Creator: *JASC13* ❤️`;

        // Guardar en MongoDB
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify([mensajeCompleto]) }, { upsert: true });
        
        console.log(`✅ [EXTRACCIÓN INTELIGENTE OK] Total de misiones procesadas: ${legendariasList.length}`);

    } catch (e) {
        console.error("❌ Error en la extracción inteligente:", e.message);
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