require('dotenv').config();
const axios = require('axios');
const { Config } = require('./database/modelos');

const USER_TOKEN = process.env.DISCORD_USER_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '400635216978509824';

// Diccionario exacto para expandir todas las abreviaturas de misiones al español oficial
const misionesMap = {
    'rts': 'Repara el refugio',
    'ets': 'Evacúa el refugio',
    'rtd': 'Recupera los datos',
    'rtl': 'Viaja en el rayo',
    'fts': 'Lucha contra la tormenta',
    'c2s': 'Tormenta de categoría 2',
    'c3s': 'Tormenta de categoría 3',
    'c4s': 'Tormenta de categoría 4'
};

// Traducción exhaustiva de recompensas, ventajas y rarezas sin abreviaturas
function traducirRecompensa(txt) {
    let t = txt;

    // Ventajas y recursos
    t = t.replace(/Legendary PERK-UP!/gi, 'Modificación legendaria');
    t = t.replace(/Epic PERK-UP!/gi, 'Modificación épica');
    t = t.replace(/Rare PERK-UP!/gi, 'Modificación rara');
    t = t.replace(/Uncommon PERK-UP!/gi, 'Modificación poco común');
    t = t.replace(/RE-PERK!/gi, 'Re-modificación');
    t = t.replace(/Lightning in a Bottle/gi, 'Relámpago en botella');
    t = t.replace(/Pure Drop of Rain/gi, 'Gota de lluvia pura');
    t = t.replace(/Eye of the Storm/gi, 'Ojo de la tormenta');
    t = t.replace(/Storm Shard/gi, 'Esquirla de tormenta');
    t = t.replace(/Tickets/gi, 'Billetes');
    t = t.replace(/V-Bucks/gi, 'PaVos');

    // Supervivientes, defensores y personajes
    t = t.replace(/Survivor/gi, 'Superviviente');
    t = t.replace(/Defender/gi, 'Defensor');
    t = t.replace(/Sniper Defender/gi, 'Defensor con rifle de precisión');
    t = t.replace(/Shotgun Defender/gi, 'Defensor con escopeta');
    t = t.replace(/Assault Defender/gi, 'Defensor con fusil de asalto');
    t = t.replace(/Pistol Defender/gi, 'Defensor con pistola');
    t = t.replace(/Melee Defender/gi, 'Defensor cuerpo a cuerpo');
    t = t.replace(/Lead Survivor/gi, 'Superviviente líder');
    t = t.replace(/Lead/gi, 'Líder');

    // Rarezas oficiales en español
    t = t.replace(/\(Legendary\)/gi, '(Legendario)');
    t = t.replace(/\(Epic\)/gi, '(Épico)');
    t = t.replace(/\(Rare\)/gi, '(Raro)');
    t = t.replace(/\(Uncommon\)/gi, '(Poco común)');
    t = t.replace(/\(Common\)/gi, '(Común)');

    return t;
}

async function rasparDiscordAlertas() {
    try {
        if (!USER_TOKEN) {
            console.error("❌ [DISCORD ERROR] No se encontró la variable DISCORD_USER_TOKEN en el archivo .env");
            return;
        }

        console.log(`\n--- 🤖 RASPADO PRECISO DE DISCORD (LEGENDARIAS Y ÉPICAS) ---`);
        const url = `https://discord.com/api/v9/channels/${DISCORD_CHANNEL_ID}/messages?limit=15`;
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': USER_TOKEN,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const mensajes = response.data;
        let alertasLegendariasEpicas = [];

        for (const msg of mensajes) {
            let textoCompleto = msg.content || '';
            if (msg.embeds && msg.embeds.length > 0) {
                msg.embeds.forEach(emb => {
                    if (emb.title) textoCompleto += '\n' + emb.title;
                    if (emb.description) textoCompleto += '\n' + emb.description;
                    if (emb.fields) {
                        emb.fields.forEach(f => {
                            textoCompleto += '\n' + (f.name || '') + '\n' + (f.value || '');
                        });
                    }
                });
            }

            // Validar que el mensaje contenga el reporte de misiones de StW
            if (textoCompleto.includes('Twine Peaks') || textoCompleto.includes('Canny Valley') || textoCompleto.includes('Stonewood')) {
                const lineas = textoCompleto.split('\n');
                
                for (const linea of lineas) {
                    const lineaTrim = linea.trim();
                    // Expresión regular exacta para leer: [Poder] [CódigoMisión] - [Recompensa]
                    // Ejemplo: 140 C3S - Epic PERK-UP! (x120)
                    const match = lineaTrim.match(/^(\d+)\s+([A-Za-z0-9]+)\s*-\s*(.*)$/);
                    
                    if (match) {
                        const pl = match[1];
                        const codigo = match[2].toLowerCase();
                        const resto = match[3];
                        const restoLower = resto.toLowerCase();

                        // Filtrar estrictamente solo lo que sea Épico o Legendario
                        if (restoLower.includes('epic') || restoLower.includes('legendary')) {
                            const misionEsp = misionesMap[codigo] || match[2];
                            const recompensaEsp = traducirRecompensa(resto);

                            // Evitar duplicados en la lista
                            if (!alertasLegendariasEpicas.some(a => a.pl === pl && a.mision === misionEsp && a.recompensa === recompensaEsp)) {
                                alertasLegendariasEpicas.push({
                                    pl: pl,
                                    mision: misionEsp,
                                    recompensa: recompensaEsp
                                });
                            }
                        }
                    }
                }
                
                if (alertasLegendariasEpicas.length > 0) break;
            }
        }

        // Guardar EXCLUSIVAMENTE en la base de datos para el comando de legendarias
        await Config.findOneAndUpdate(
            { clave: 'stw_legendarias_activas' }, 
            { valor: JSON.stringify(alertasLegendariasEpicas) }, 
            { upsert: true }
        );

        console.log(`✅ [DISCORD SCRAPER LEGENDARIAS OK] Total guardadas: ${alertasLegendariasEpicas.length}`);

    } catch (error) {
        console.error("❌ Error al raspar Discord:", error.message);
    }
}

function iniciarDiscordScraper(sock) {
    rasparDiscordAlertas();
    setInterval(rasparDiscordAlertas, 60 * 60 * 1000);
}

module.exports = { iniciarDiscordScraper, rasparDiscordAlertas };