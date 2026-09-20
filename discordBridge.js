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

// Procesar y buscar coincidencias con el formato de misiones
function procesarTextoMensaje(contenidoCrudo) {
    console.log(`\n--- 🔍 TEXTO EXTRAÍDO DE DISCORD ---\n${contenidoCrudo}\n-----------------------------------\n`);
    
    const contenido = contenidoCrudo.replace(/[*_`~]/g, '');
    const lineas = contenido.split('\n');
    let pavosList = [];
    let legendariasList = [];

    lineas.forEach(linea => {
        const match = linea.match(/(\d+)\s*⚡\s*([A-Za-z0-9]+)\s*-\s*(.+)/);
        if (match) {
            const pl = match[1].trim();
            const acro = match[2].trim().toLowerCase();
            const recompensa = match[3].trim();
            const misionEs = acroMap[acro] || match[2].trim();
            const recLower = recompensa.toLowerCase();

            if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                const cantMatch = recompensa.match(/(\d+)/);
                const cantidad = cantMatch ? parseInt(cantMatch[1]) : 30;
                pavosList.push({ pl, mision: misionEs, cantidad, recompensa, tipo: 'Discord' });
            } else if (recLower.includes('legendary') || recLower.includes('epic') || recLower.includes('mythic')) {
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
            console.log(`✅ Alertas guardadas en BD -> PaVos: ${pavosList.length}, Legendarias: ${legendariasList.length}`);
        } catch (e) {
            console.error("❌ Error guardando en BD:", e);
        }
    } else {
        console.log(`⚠️ Mensaje leído pero sin coincidencias con el formato de misiones.`);
    }
}

discordClient.on('ready', async () => {
    console.log(`✅ Conectado a Discord correctamente como: ${discordClient.user.tag}`);
    
    try {
        const targetChannelId = process.env.DISCORD_CHANNEL_ID;
        console.log(`🔍 Intentando buscar el canal ID: ${targetChannelId}`);
        
        const channel = await discordClient.channels.fetch(targetChannelId);
        if (!channel) {
            console.log(`❌ No se encontró el canal con ID ${targetChannelId}`);
            return;
        }
        console.log(`✅ Canal encontrado: ${channel.name || 'Canal sin nombre'} (Tipo: ${channel.type})`);

        const messages = await channel.messages.fetch({ limit: 10 });
        console.log(`📥 Se obtuvieron ${messages.size} mensajes recientes del canal.`);

        for (const [id, msg] of messages) {
            const contenidoCompleto = extraerTextoDeMensaje(msg);
            if (contenidoCompleto) {
                const { pavosList, legendariasList } = procesarTextoMensaje(contenidoCompleto);
                if (pavosList.length > 0 || legendariasList.length > 0) {
                    await guardarAlertas(pavosList, legendariasList);
                    break;
                }
            }
        }
    } catch (e) {
        console.error("⚠️ ERROR CRÍTICO AL LEER EL HISTORIAL DE DISCORD:", e);
    }
});

discordClient.on('messageCreate', async (msg) => {
    const targetChannelId = process.env.DISCORD_CHANNEL_ID;

    if (msg.channel.id === targetChannelId) {
        console.log(`📩 ¡Nuevo mensaje detectado en tiempo real en el canal de alertas!`);
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