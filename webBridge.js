require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

function traducirRecompensa(texto) {
    let t = texto;
    t = t.replace(/\(Legendary\)/gi, '(Legendario)')
         .replace(/\(Epic\)/gi, '(Épico)')
         .replace(/\(Rare\)/gi, '(Raro)')
         .replace(/\(Uncommon\)/gi, '(Poco común)')
         .replace(/\(Common\)/gi, '(Común)')
         .replace(/Survivor/gi, 'Sobreviviente')
         .replace(/Defender/gi, 'Defensor')
         .replace(/Lead/gi, 'Líder')
         .replace(/V-Bucks/gi, 'PaVos');
    return t;
}

async function extraerAlertasAPI() {
    try {
        console.log(`\n--- 🌐 OBTENIENDO ALERTAS (EXTRACCIÓN LIMPIA) ---`);
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
            'resupply', 'eliminate and collect', 'rescue the survivors', 'hit the road'
        ];

        // Buscamos nodos específicos y filtramos por la keyword exacta de la misión
        $('*').each((i, el) => {
            const txt = $(el).text().replace(/\s+/g, ' ').trim();
            const plMatch = txt.match(/\b(140|160)\b/);

            if (plMatch) {
                const pl = plMatch[1];
                const keywordEncontrada = keywordsMisiones.find(k => txt.toLowerCase().includes(k));

                if (keywordEncontrada && txt.length < 200) {
                    // Extraemos limpiamente desde donde empieza la misión para evitar números de recompensas previos
                    const idx = txt.toLowerCase().indexOf(keywordEncontrada);
                    let fragmentoMision = txt.substring(idx);
                    
                    // Cortamos antes de que empiece la sección de recompensas larga
                    const corteRecompensa = fragmentoMision.indexOf('uncommon') !== -1 ? fragmentoMision.indexOf('uncommon') : fragmentoMision.length;
                    let nombreLimpio = fragmentoMision.substring(0, corteRecompensa).trim();
                    
                    // Limpieza adicional de guiones
                    if (nombreLimpio.includes('-')) {
                        const partes = nombreLimpio.split('-');
                        nombreLimpio = `${partes[0].trim()} - ${partes[1].split(' ')[0]}`;
                    }

                    const clave = `${pl}-${nombreLimpio}`;
                    if (!legendariasList.some(item => `${item.pl}-${item.mision}` === clave)) {
                        let etiqueta = pl === '160' ? '🔴 Nivel 160 (Supercargador)' : '⭐ Nivel 140';
                        legendariasList.push({
                            pl,
                            mision: nombreLimpio,
                            recompensa: `${etiqueta} | Recompensas de zona`
                        });
                    }
                }
            }
        });

        // Guardar en MongoDB
        await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
        await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
        
        console.log(`✅ [STW PLANNER LIMPIO] Guardado -> PaVos: ${pavosList.length} | Nivel 140 y 160 exactos: ${legendariasList.length}`);

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