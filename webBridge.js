require('dotenv').config();
const axios = require('axios');
const { Config } = require('./database/modelos');

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

const acroMap = {
    'ets': 'Evacua el refugio',
    'rtd': 'Recupera los datos',
    'rtl': 'Monta el relámpago',
    'fts': 'Lucha contra la tormenta',
    'c1s': 'Tormenta cat. 1',
    'c2s': 'Tormenta cat. 2',
    'c3s': 'Tormenta cat. 3',
    'c4s': 'Tormenta cat. 4',
    'rts': 'Repara el refugio',
    'dtb': 'Entrega el pedido',
    'etc': 'Elimina y recolecta',
    'res': 'Reabastecimiento'
};

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
        console.log(`\n--- 🌐 BUSCANDO ENDPOINT DE DATOS DE STW ---`);
        
        // Intentamos consultar rutas comunes de API o datos que suelen usar estas webs
        // STW Planner o herramientas similares suelen consumir JSONs públicos de rotación
        const urlsPrueba = [
            'https://stw-planner.com/api/missions', // Posible ruta de API
            'https://freethevbucks.com/wp-json/',   // Ejemplo de estructura JSON si aplica
        ];

        // Usaremos una petición genérica para capturar la respuesta y verla en los logs de Render
        const urlObjetivo = 'https://stw-planner.com/mission-alerts'; // O endpoint JSON si lo detectamos
        
        const response = await axios.get(urlObjetivo, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/json, text/plain, */*'
            }
        });

        console.log(`\n--- 📦 TIPO DE RESPUESTA RECIBIDA ---`);
        console.log(typeof response.data);
        if (typeof response.data === 'object') {
            console.log(JSON.stringify(response.data).substring(0, 1000));
        } else {
            console.log("La respuesta es texto plano o HTML. Buscando patrones de niveles 140/160...");
            // Buscamos si en el texto plano vienen los niveles altos
            const texto = response.data;
            if (texto.includes('140') || texto.includes('160')) {
                console.log("🔥 ¡Se encontraron menciones de nivel 140 o 160 en la respuesta bruta!");
            }
        }

    } catch (e) {
        console.error("❌ Error consultando la fuente:", e.message);
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