require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const { Config } = require('./database/modelos');

const discordClient = new Client({ checkUpdate: false });

let chatWhatsAppActivo = null;
let sockWhatsApp = null;

// Diccionario ampliado y 100% en español para mejor interpretación
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

// Traductor y limpiador de términos al español
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

// Procesar, interpretar y separar Épicas de Legendarias
function procesarTextoMensaje(contenidoCrudo) {
    console.log(`\n--- 🔍 PROCESANDO Y SEPARANDO ALERTAS STW ---\n`);
    
    const contenido = contenidoCrudo.replace(/[_`~]/g, '');
    const lineas = contenido.split('\n');
    let pavosList = [];
    let epicasList = [];
    let legendariasList = [];

    lineas.forEach(linea => {
        const match = linea.match(/(\d+)(?:⚡|:zap:)\s*([A-Za-z0-9]+)\s*-\s*(.+)/);
        if (match) {
            const pl = match[1].trim();
            const acro = match[2].trim().toLowerCase();
            let recompensa = match[3].trim().replace(/\*\*/g, '');
            recompensa = traducirRecompensa(recompensa);
            
            const misionEs = acroMap[acro] || match[2].trim();
            const recLower = recompensa.toLowerCase();

            // 1. Detección de PaVos
            if (recLower.includes('v-buck') || recLower.includes('vbuck') || recLower.includes('pavo')) {
                const cantMatch = recompensa.match(/(\d+)/);
                const cantidad = cantMatch ? parseInt(cantMatch[1]) : 50;
                pavosList.push({ pl, mision: misionEs, cantidad, recompensa: 'PaVos', tipo: 'Discord' });
            } 
            // 2. Detección exclusiva de Épicas
            else if (recLower.includes('epic') || recLower.includes('épico')) {
                epicasList.push({
                    pl,
                    mision: misionEs,
                    recompensa: `🟣 Épico | ${recompensa}`
                });
            }
            // 3. Detección de Legendarias o Míticas
            else if (recLower.includes('legendary') || recLower.includes('legendario') || recLower.includes('mythic') || recLower.includes('mítico')) {
                let colorEmoji = (recLower.includes('mythic') || recLower.includes('mítico')) ? '🟡 Mítico' : '🟠 Legendario';
                legendariasList.push({
                    pl,
                    mision: misionEs,
                    recompensa: `${colorEmoji} | ${recompensa}`
                });
            }
        }
    });

    return { pavosList, epicasList, legendariasList };
}

async function guardarAlertas(pavosList, epicasList, legendariasList) {
    if (pavosList.length > 0 || epicasList.length > 0 || legendariasList.length > 0) {
        try {
            await Config.findOneAndUpdate({ clave: 'stw_pavos_activos' }, { valor: JSON.stringify(pavosList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_epicas_activas' }, { valor: JSON.stringify(epicasList) }, { upsert: true });
            await Config.findOneAndUpdate({ clave: 'stw_legendarias_activas' }, { valor: JSON.stringify(legendariasList) }, { upsert: true });
            console.log(`✅ Guardado en BD -> PaVos: ${pavosList.length} | Épicas: ${epicasList.length} | Legendarias: ${legendariasList.length}`);
        } catch (e) {
            console.error("❌ Error guardando en BD:", e);
        }
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
                    const { pavosList, epicasList, legendariasList } = procesarTextoMensaje(contenidoCompleto);
                    if (pavosList.length > 0 || epicasList.length > 0 || legendariasList.length > 0) {
                        await guardarAlertas(pavosList, epicasList, legendariasList);
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

---

    if (msg.channel.id === targetChannelId) {
        const contenidoCompleto = extraerTextoDeMensaje(msg);
        if (contenidoCompleto) {
            const { pavosList, epicasList, legendariasList } = procesarTextoMensaje(contenidoCompleto);
            await guardarAlertas(pavosList, epicasList, legendariasList);

            if ((pavosList.length > 0 || epicasList.length > 0 || legendariasList.length > 0) && sockWhatsApp && chatWhatsAppActivo) {
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