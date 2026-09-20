require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { Config } = require('./database/modelos');

const discordClient = new Client({ checkUpdate: false });

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

// Diccionario de traducción e interpretación de siglas de misiones de STW
const acroMap = {
    'ets': 'Evacua el refugio (Evacuate the Shelter)',
    'rtd': 'Recupera los datos (Retrieve the Data)',
    'rtl': 'Monta el relámpago (Ride the Lightning)',
    'fts': 'Lucha contra la tormenta (Fight the Storm)',
    'c1s': 'Tormenta cat. 1',
    'c2s': 'Tormenta cat. 2',
    'c3s': 'Tormenta cat. 3',
    'c4s': 'Tormenta cat. 4',
    'rts': 'Repara el refugio (Repair the Shelter)',
    'dtb': 'Entrega el pedido (Deliver the Bomb)',
    'etc': 'Elimina y recolecta (Eliminate and Collect)'
};

discordClient.on('ready', () => {
    console.log(`✅ Conectado a Discord correctamente como: ${discordClient.user.tag}`);
});

// Escuchar mensajes del canal de Discord en tiempo real
discordClient.on('messageCreate', async (msg) => {
    const targetChannelId = process.env.DISCORD_CHANNEL_ID;

    if (msg.channel.id === targetChannelId) {
        let contenido = msg.content;

        if (!contenido && msg.embeds.length > 0) {
            contenido = msg.embeds[0].description || msg.embeds[0].title || '';
        }

        if (contenido) {
            console.log(`📥 Alerta detectada en Discord, procesando líneas...`);
            
            const lineas = contenido.split('\n');
            let pavosList = [];
            let legendariasList = [];

            lineas.forEach(linea => {
                // Formato esperado: "76⚡ EtS - Lead Explorer (Legendary)" o similar con V-Bucks
                const match = linea.match(/^(\d+)⚡\s*([A-Za-z0-9]+)\s*-\s*(.+)$/);
                if (match) {
                    const pl = match[1];
                    const acro = match[2].trim().toLowerCase();
                    const recompensa = match[3].trim();
                    
                    const misionEs = acroMap[acro] || match[2].trim();

                    // Detección de PaVos
                    if (recompensa.toLowerCase().includes('v-buck') || recompensa.toLowerCase().includes('vbuck') || recompensa.toLowerCase().includes('pavo')) {
                        const cantMatch = recompensa.match(/(\d+)/);
                        const cantidad = cantMatch ? parseInt(cantMatch[1]) : 30;
                        pavosList.push({ pl, mision: misionEs, cantidad, recompensa, tipo: 'Discord' });
                    }
                    // Detección de Épicas, Legendarias o Míticas
                    else if (recompensa.toLowerCase().includes('legendary') || recompensa.toLowerCase().includes('epic') || recompensa.toLowerCase().includes('mythic')) {
                        let colorEmoji = recompensa.toLowerCase().includes('mythic') ? '🟡 Mítico' : recompensa.toLowerCase().includes('legendary') ? '🟠 Legendario' : '🟣 Épico';
                        legendariasList.push({
                            pl,
                            mision: misionEs,
                            recompensa: `${colorEmoji} | ${recompensa}`
                        });
                    }
                }
            });

            // Guardar automáticamente en MongoDB para las consultas de WhatsApp
            if (pavosList.length > 0 || legendariasList.length > 0) {
                try {
                    await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
                    await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
                    console.log(`✅ Alertas de Discord parseadas y guardadas correctamente.`);

                    // Si hay un chat de WhatsApp vinculado, reenviar la notificación limpia opcionalmente
                    if (sockWhatsApp && chatWhatsAppActivo) {
                        await sockWhatsApp.sendMessage(chatWhatsAppActivo, { 
                            text: `🎮 *¡NUEVAS ALERTAS STW DETECTADAS!*\nEscribe *!stw* para ver la lista completa.` 
                        });
                    }
                } catch (e) {
                    console.error("❌ Error guardando alertas de Discord en BD:", e);
                }
            }
        }
    }
});

function iniciarPuenteDiscord(sock) {
    sockWhatsApp = sock;
    if (!discordClient.isReady()) {
        discordClient.login(process.env.USER_TOKEN);
    }
}

function vincularChatWhatsApp(chatId) {
    chatWhatsAppActivo = chatId;
    console.log(`🔗 Chat de WhatsApp vinculado para avisos: ${chatId}`);
}

module.exports = { iniciarPuenteDiscord, vincularChatWhatsApp };