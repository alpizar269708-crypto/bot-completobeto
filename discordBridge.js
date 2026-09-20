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

// Extraer todo el texto de los Embeds y campos de Discord
function extraerTextoDeMensaje(msg) {
    let textoCompleto = msg.content || '';

    if (msg.embeds && msg.embeds.length > 0) {
        msg.embeds.forEach(embed => {
            if (embed.title) textoCompleto += '\n' + embed.title;
            if (embed.description) textoCompleto += '\n' + embed.description;
            if (embed.fields && Array.isArray(embed.fields)) {
                embed.fields.forEach(field => {
                    if (field.name) textoCompleto += '\n' + field.name;
                    if (field.value) textoCompleto += '\n' + field.value;
                });
            }
        });
    }

    return textoCompleto;
}

// Procesar y buscar coincidencias con el formato de misiones adaptado a Discord
function procesarTextoMensaje(contenidoCrudo) {
    console.log(`\n--- 🔍 PROCESANDO TEXTO DE DISCORD ---\n${contenidoCrudo}\n--------------------------------------\n`);
    
    // Limpiar formato markdown excesivo pero conservar estructura de líneas
    const contenido = contenidoCrudo.replace(/[_`~]/g, '');
    const lineas = contenido.split('\n');
    let pavosList = [];
    let legendariasList = [];

    lineas.forEach(linea => {
        // Regex adaptado para leer tanto "⚡" como formato interno de Discord tipo ":zap:"
        const match = linea.match(/(\d+)(?:⚡|:zap:)\s*([A-Za-z0-9]+)\s*-\s*(.+)/);
        if (match) {
            const pl = match[1].trim();
            const acro = match[2].trim().toLowerCase();
            const recompensa = match[3].trim().replace(/\*\*/g, ''); // Limpiar negritas extra
            const misionEs = acroMap[acro] || match[2].trim();
            const recLower = recompensa.toLowerCase();

            // Detección de PaVos
            if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                const cantMatch = recompensa.match(/(\d+)/);
                const cantidad = cantMatch ? parseInt(cantMatch[1]) : 50;
                pavosList.push({ pl, mision: misionEs, cantidad, recompensa: 'V-Bucks', tipo: 'Discord' });
            } 
            // Detección de Épicas, Legendarias o Míticas
            else if (recLower.includes('legendary') || recLower.includes('epic') || recLower.includes('mythic')) {
                let colorEmoji = recLower.includes('mythic') ? '🟡 Mítico' : recLower.includes('legendary') ? '🟠 Legendario' : '🟣 Épico';
                legendariasList.push({
                    pl,
                    mision: misionEs,
                    recompensa: `${colorEmoji} | ${recompensa}`
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
            console.log(`✅ ¡Éxito! Alertas guardadas en BD -> PaVos encontrados: ${pavosList.length}, Legendarias/Épicas encontradas: ${legendariasList.length}`);
        } catch (e) {
            console.error("❌ Error guardando en BD:", e);
        }
    } else {
        console.log(`⚠️ Se leyó el mensaje pero la regex no capturó ninguna misión válida.`);
    }
}

discordClient.on('ready', async () => {
    console.log(`✅ Conectado a Discord correctamente como: ${discordClient.user.tag}`);
    
    try {
        const targetChannelId = process.env.DISCORD_CHANNEL_ID;
        const channel = await discordClient.channels.fetch(targetChannelId);
        if (channel) {
            const messages = await channel.messages.fetch({ limit: 15 });
            for (const [id, msg] of messages) {
                const contenidoCompleto = extraerTextoDeMensaje(msg);
                if (contenidoCompleto && (contenidoCompleto.includes('⚡') || contenidoCompleto.includes('V-Bucks') || contenidoCompleto.includes('Legendary'))) {
                    const { pavosList, legendariasList } = procesarTextoMensaje(contenidoCompleto);
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

discordClient.on('messageCreate', async (msg) => {
    const targetChannelId = process.env.DISCORD_CHANNEL_ID;

    if (msg.channel.id === targetChannelId) {
        const contenidoCompleto = extraerTextoDeMensaje(msg);
        if (contenidoCompleto) {
            const { pavosList, legendariasList } = procesarTextoMensaje(contenidoCompleto);
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