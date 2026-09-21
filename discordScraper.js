require('dotenv').config();
const axios = require('axios');
const { Config } = require('./database/modelos');

// Credenciales
const USER_TOKEN = process.env.DISCORD_USER_TOKEN || 'NzUyMzE2MjQ0Nzg2NDEzNjEw.GNUSl8.r4v3lo_gzSxXiQ1QV8TuLyhxFzAhhRNfLEN0pc';
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '400635216978509824';

// Traductor completo e integral sin ninguna abreviatura
function expandirYTraducirLinea(lineaTexto) {
    let t = lineaTexto;

    // Expandir códigos de misiones y zonas recopilados de los reportes
    t = t.replace(/\bRtS\b/g, 'Repara el refugio');
    t = t.replace(/\bEtS\b/g, 'Evacúa el refugio');
    t = t.replace(/\bRtD\b/g, 'Recupera los datos');
    t = t.replace(/\bRtL\b/g, 'Viaja en el rayo');
    t = t.replace(/\bFtS\b/g, 'Lucha contra la tormenta');
    t = t.replace(/\bC2S\b/g, 'Tormenta de categoría 2');
    t = t.replace(/\bC3S\b/g, 'Tormenta de categoría 3');
    t = t.replace(/\bC4S\b/g, 'Tormenta de categoría 4');

    // Traducir materiales, perks y recursos comunes
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

    // Traducir Supervivientes, Defensores y Héroes frecuentes
    t = t.replace(/Survivor/gi, 'Superviviente');
    t = t.replace(/Defender/gi, 'Defensor');
    t = t.replace(/Sniper Defender/gi, 'Defensor con rifle de precisión');
    t = t.replace(/Shotgun Defender/gi, 'Defensor con escopeta');
    t = t.replace(/Assault Defender/gi, 'Defensor con fusil de asalto');
    t = t.replace(/Pistol Defender/gi, 'Defensor con pistola');
    t = t.replace(/Melee Defender/gi, 'Defensor cuerpo a cuerpo');
    t = t.replace(/Lead Survivor/gi, 'Superviviente líder');
    t = t.replace(/Lead/gi, 'Líder');

    // Traducir rarezas entre paréntesis al español oficial
    t = t.replace(/\(Legendary\)/gi, '(Legendario)');
    t = t.replace(/\(Epic\)/gi, '(Épico)');
    t = t.replace(/\(Rare\)/gi, '(Raro)');
    t = t.replace(/\(Uncommon\)/gi, '(Poco común)');
    t = t.replace(/\(Common\)/gi, '(Común)');

    return t;
}

async function rasparDiscordAlertas() {
    try {
        console.log(`\n--- 🤖 RASPADO Y TRADUCCIÓN PROFUNDA DESDE DISCORD ---`);
        const url = `https://discord.com/api/v9/channels/${DISCORD_CHANNEL_ID}/messages?limit=15`;
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': USER_TOKEN,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const mensajes = response.data;
        let alertasLegendariasEpicas = [];

        // Identificar el mensaje correcto del ciclo de las 6:00 PM (actual o del día anterior)
        for (const msg of mensajes) {
            const contenido = msg.content || '';
            // Validar que pertenezca al bloque de Twine Peaks / Canny Valley o contenga recompensas de nivel alto
            if (contenido.includes('Twine Peaks') || contenido.includes('Canny Valley') || contenido.includes('⚡')) {
                const lineas = contenido.split('\n');
                
                for (const linea of lineas) {
                    const lineaLower = linea.toLowerCase();
                    
                    // Filtrar estrictamente solo lo que sea Legendario o Épico
                    if (lineaLower.includes('legendary') || lineaLower.includes('epic')) {
                        
                        // Extraer el Poder (PL)
                        const matchPl = linea.match(/^(\d+)\s*⚡/);
                        const pl = matchPl ? matchPl[1] : '140';
                        
                        // Limpiar y traducir el contenido de la línea
                        const textoLimpio = linea.replace(/^\d+\s*⚡\s*/, '');
                        const textoExpandido = expandirYTraducirLinea(textoLimpio);

                        let etiquetaTipo = lineaLower.includes('legendary') ? '🌟 *Legendario*' : '🟣 *Épico*';

                        let tarjeta = `⚡ *PL:* ${pl}\n` +
                                      `🎯 *Misión/Recompensa:* ${textoExpandido}\n` +
                                      `🎁 *Categoría:* ${etiquetaTipo}`;

                        alertasLegendariasEpicas.push({
                            pl: pl,
                            mision: textoExpandido,
                            recompensa: tarjeta
                        });
                    }
                }
                
                // Si encontramos un bloque con datos procesados, terminamos la búsqueda del mensaje activo
                if (alertasLegendariasEpicas.length > 0) break;
            }
        }

        // Guardar en MongoDB bajo la clave que alimenta el comando de legendarias
        await Config.findOneAndUpdate(
            { clave: 'stw_legendarias_activas' }, 
            { valor: JSON.stringify(alertasLegendariasEpicas) }, 
            { upsert: true }
        );

        console.log(`✅ [DISCORD SCRAPER OK] Total de alertas épicas y legendarias traducidas: ${alertasLegendariasEpicas.length}`);

    } catch (error) {
        console.error("❌ Error al raspar Discord:", error.message);
    }
}

function iniciarDiscordScraper(sock) {
    rasparDiscordAlertas();
    // Actualizar automáticamente cada hora
    setInterval(rasparDiscordAlertas, 60 * 60 * 1000);
}

module.exports = { iniciarDiscordScraper, rasparDiscordAlertas };