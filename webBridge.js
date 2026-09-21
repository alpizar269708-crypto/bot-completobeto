require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function formatearRecompensaInteligente(textoTexto) {
    const txt = (textoTexto || "").toLowerCase();
    const matchNum = txt.match(/\d+/);
    const cantidad = matchNum ? matchNum[0] : "";
    const prefix = cantidad ? `*${cantidad}x* ` : "";

    // Supervivientes y Defensores
    if (txt.includes('survivor')) {
        if (txt.includes('legendary')) return '👤 *Superviviente Legendario*';
        if (txt.includes('epic')) return '👤 *Superviviente Épico*';
        return '👤 *Superviviente*';
    }
    if (txt.includes('defender')) {
        if (txt.includes('legendary')) return '🛡️ *Defensor Legendario*';
        if (txt.includes('epic')) return '🛡️ *Defensor Épico*';
        return '🛡️ *Defensor*';
    }

    // Perk-Ups y Elementos
    if (txt.includes('frost-up')) return `❄️ ${prefix}*Frost-Up*`;
    if (txt.includes('fire-up')) return `🔥 ${prefix}*Fire-Up*`;
    if (txt.includes('amp-up')) return `⚡ ${prefix}*Amp-Up*`;
    if (txt.includes('epic perk')) return `🟣 ${prefix}*Perk-Up Épico*`;
    if (txt.includes('legendary perk')) return `🟠 ${prefix}*Perk-Up Legendario*`;
    if (txt.includes('re-perk')) return `🔄 ${prefix}*Re-Perk!*`;

    // Materiales de evolución y tormenta
    if (txt.includes('storm shard')) return `💎 ${prefix}*Esquirla de Tormenta*`;
    if (txt.includes('eye of the storm')) return `🌀 ${prefix}*Ojo de la Tormenta*`;
    if (txt.includes('pure drop of rain') || txt.includes('rain')) return `💧 ${prefix}*Gota de Lluvia Pura*`;
    if (txt.includes('lightning in a bottle')) return `⚡ ${prefix}*Relámpago en Botella*`;

    // Monedas y Tickets
    if (txt.includes('ticket')) return `🎫 ${prefix}*Tickets*`;
    if (txt.includes('gold')) return cantidad ? `🪙 ${prefix}*Oro*` : '🪙 *Oro*';

    // XP
    if (txt.includes('schematic xp')) return `📘 ${cantidad ? prefix : ''}*XP de Esquema*`;
    if (txt.includes('survivor xp')) return `📗 ${cantidad ? prefix : ''}*XP de Superviviente*`;
    if (txt.includes('hero xp')) return `📙 ${cantidad ? prefix : ''}*XP de Héroe*`;
    if (txt.includes('venture xp')) return `🗺️ ${cantidad ? prefix : ''}*XP de Aventura*`;

    return textoTexto ? `🎁 *${textoTexto.trim()}*` : "";
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 RASPADO DESDE FREE THE VBUCKS ---`);
        const urlObjetivo = 'https://freethevbucks.com/extras/current-mission-tracking/';
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let legendariasMap = new Map();

        // Buscamos filas o bloques de misiones en la estructura de Free the Vbucks
        $('tr, div.mission, article, li').each((i, el) => {
            const txtOriginal = $(el).text();
            const txt = txtOriginal.replace(/\s+/g, ' ').trim();
            const plMatch = txt.match(/\b(140|160)\b/);

            if (plMatch) {
                const pl = plMatch[1];
                
                // Palabras clave de misiones comunes en STW
                const keywordsMisiones = [
                    'fight the storm', 'retrieve the data', 'repair the shelter', 
                    'ride the lightning', 'evacuate the shelter', 'deliver the bomb', 
                    'resupply', 'eliminate and collect', 'rescue the survivors', 'atlas'
                ];

                const kwEncontrada = keywordsMisiones.find(k => txt.toLowerCase().includes(k));

                if (kwEncontrada && txt.length > 10 && txt.length < 400) {
                    let nombreMision = kwEncontrada.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    
                    // Extraer fragmentos relevantes como recompensas o zonas del texto
                    let recompensasDetectadas = [];
                    const fragmentos = txt.split(/[-–|]/);
                    
                    fragmentos.forEach(frag => {
                        const fLimpio = frag.trim();
                        const formateado = formatearRecompensaInteligente(fLimpio);
                        if (formateado && !recompensasDetectadas.includes(formateado) && fLimpio.length > 2) {
                            recompensasDetectadas.push(formateado);
                        }
                    });

                    let claveUnica = `${pl}-${nombreMision}-${txt.substring(0, 15)}`;

                    if (!legendariasMap.has(claveUnica)) {
                        let etiquetaPl = pl === '160' ? '🔴 *Nivel 160 (Supercargador)*' : '⭐ *Nivel 140 (Ventures/Cumbres)*';
                        
                        let textoRecompensas = recompensasDetectadas.slice(0, 5).join(' | ');
                        if (!textoRecompensas) {
                            textoRecompensas = `🎁 *Misión de Alerta Activa*`;
                        }

                        legendariasMap.set(claveUnica, {
                            pl: pl,
                            mision: `${nombreMision} (${pl})`,
                            recompensa: `🎁 *Tipo:* ${etiquetaPl}\n${textoRecompensas}`
                        });
                    }
                }
            }
        });

        const legendariasList = Array.from(legendariasMap.values());

        // Guardar estrictamente en MongoDB con los campos limpios
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify([]) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [FREE THE VBUCKS OK] Total de misiones procesadas: ${legendariasList.length}`);

    } catch (e) {
        console.error("❌ Error en el raspado de Free the Vbucks:", e.message);
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