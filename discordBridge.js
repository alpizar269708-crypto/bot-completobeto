require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { Config } = require('./database/modelos');

const discordClient = new Client({ checkUpdate: false });

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

// Diccionario de traducción de siglas de misiones de STW
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

// Función para parsear texto de forma flexible (ignorando asteriscos y formato markdown)
function procesarTextoMensaje(contenidoCrudo) {
    console.log(`\n--- 🔍 TEXTO CRUDO RECIBIDO DE DISCORD ---\n${contenidoCrudo}\n----------------------------------------\n`);
    
    // Limpiar asteriscos y formato markdown de Discord
    const contenido = contenidoCrudo.replace(/[*_`~]/g, '');
    const lineas = contenido.split('\n');
    let pavosList = [];
    let legendariasList = [];

    lineas.forEach(linea => {
        // Regex flexible que busca el poder, la sigla y la recompensa sin importar espacios o formato
        const match = linea.match(/(\d+)\s*⚡\s*([A-Za-z0-9]+)\s*-\s*(.+)/);
        if (match) {
            const pl = match[1].trim();
            const acro = match[2].trim().toLowerCase();
            const recompensa = match[3].trim();
            const misionEs = acroMap[acro] || match[2].trim();

            const recLower = recompensa.toLowerCase();

            // Detección de PaVos
            if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                const cantMatch = recompensa.match(/(\d+)/);
                const cantidad = cantMatch ? parseInt(cantMatch[1]) : 30;
                pavosList.push({ pl, mision: misionEs, cantidad, recompensa, tipo: 'Discord' });
            } 
            // Detección de Épicas, Legendarias o Míticas
            else if (recLower.includes('legendary') || recLower.includes('epic') || recLower.includes('mythic')) {
                let colorEmoji = recLower.includes('mythic') ? '🟡 Mítico' : recLower.includes('legendary') ? '🟠 Legendario' : '🟣 Épico';
                legendariasList.push({
                    pl,
                    mision: misionEs,
                    recompensa: `${colorEmoji} \vert{}${recompensa}`
                });
            }
        }
    });

    return { pavosList, legendariasList };
}

async function guardarAlertas(pavosList, legendariasList) {
    if (pavosList.length > 0 || legendariasList.length > 0) {
        try {
            await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
            console.log(`✅ ¡Éxito! Alertas guardadas en BD -> PaVos: ${pavosList.length}, Legendarias:${legendariasList.length}`);
        } catch (e) {
            console.error("❌ Error guardando alertas en BD:", e);
        }
    } else {
        console.log(`⚠️ Se leyó el mensaje pero no se detectaron líneas válidas con el formato esperado.`);
    }
}

// Sincronizar historial al arrancar
discordClient.on('ready', async () => {
    console.log(`✅ Conectado a Discord correctamente como: ${discordClient.user.tag}`);
    
    try {
        const targetChannelId = process.env.DISCORD_CHANNEL_ID;
        const channel = await discordClient.channels.fetch(targetChannelId);
        if (channel) {
            const messages = await channel.messages.fetch({ limit: 10 });
            for (const [id, msg] of messages) {
                let contenido = msg.content;
                if (!contenido && msg.embeds.length > 0) {
                    contenido = msg.embeds[0].description || msg.embeds[0].title || '';
                }
                if (contenido && contenido.includes('⚡')) {
                    const { pavosList, legendariasList } = procesarTextoMensaje(contenido);
                    if (pavosList.length > 0 || legendariasList.length > 0) {
                        await guardarAlertas(pavosList, legendariasList);
                        break; 
                    }
                }
            }
        }
    } catch (e) {
        console.error("⚠️ Error al obtener historial de Discord:", e);
    }
});

// Escuchar en tiempo real
discordClient.on('messageCreate', async (msg) => {
    const targetChannelId = process.env.DISCORD_CHANNEL_ID;

    if (msg.channel.id === targetChannelId) {
        let contenido = msg.content;
        if (!contenido && msg.embeds.length > 0) {
            contenido = msg.embeds[0].description || msg.embeds[0].title || '';
        }

        if (contenido) {
            const { pavosList, legendariasList } = procesarTextoMensaje(contenido);
            await guardarAlertas(pavosList, legendariasList);

            if ((pavosList.length > 0 || legendariasList.length > 0) && sockWhatsApp && chatWhatsAppActivo) {
                try {
                    await sockWhatsApp.sendMessage(chatWhatsAppActivo, { 
                        text: `🎮 *¡NUEVAS ALERTAS STW DETECTADAS!*\nEscribe *stw* para ver la lista completa.` 
                    });
                } catch (error) {
                    console.error("❌ Error al reenviar a WhatsApp:", error);
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