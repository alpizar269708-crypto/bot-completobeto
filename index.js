require('dotenv').config();
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('./mongoAuth');
const mongoose = require('mongoose');
const pino = require('pino');
const { procesarMensaje } = require('./messageHandler');
const { verificarNuevoMiembro } = require('./comandos/moderacion');
const { iniciarCronAlertasDiarias } = require('./comandos/fortnite');
const express = require('express');

const app = express();
app.use(express.urlencoded({ extended: true }));

let botArrancado = false;
let authState = null;

app.get('/', async (req, res) => {
    if (botArrancado) {
        return res.send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2>🤖 Bot de WhatsApp activo</h2>
                <p>El bot ya está vinculado y trabajando en el servidor.</p>
            </div>
        `);
    }
    
    const html = `
    <html>
    <head><title>Vincular Bot</title><meta charset="utf-8"></head>
    <body style="font-family: Arial; padding: 20px; max-width: 600px; margin: auto; text-align: center;">
        <h2>🔌 Vincular Bot de WhatsApp</h2>
        <form action="/iniciar" method="POST" style="text-align: left; background: #f9f9f9; padding: 20px; border-radius: 10px; border: 1px solid #ddd;">
            <p><b>1. Elige el método de inicio de sesión:</b></p>
            <label><input type="radio" name="metodo" value="1" checked> 📱 Código QR</label><br><br>
            <label><input type="radio" name="metodo" value="2"> 🔢 Código de 8 dígitos</label><br><br>
            
            <p><b>2. Si elegiste 8 dígitos, ingresa tu número (código país + número, ej. 525512345678):</b></p>
            <input type="text" name="numero" placeholder="Ej: 525512345678" style="padding: 10px; width: 100%; box-sizing: border-box; border-radius: 5px; border: 1px solid #ccc;"><br><br>
            
            <button type="submit" style="padding: 12px 20px; background: #25D366; color: white; border: none; cursor: pointer; font-size: 16px; border-radius: 5px; width: 100%;">Generar Código</button>
        </form>
    </body>
    </html>
    `;
    res.send(html);
});

app.post('/iniciar', (req, res) => {
    if (botArrancado) {
        return res.send('<h2 style="font-family: Arial; text-align: center; margin-top: 50px;">El bot ya está arrancando.</h2>');
    }
    
    const { metodo, numero } = req.body;
    const numeroLimpio = numero ? numero.replace(/[^0-9]/g, '') : '';
    
    arrancarSocket(metodo, numeroLimpio, (htmlRespuesta) => {
        res.send(htmlRespuesta);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor Web interactivo escuchando en el puerto ${PORT}`);
});

async function inicializarBase() {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
    }
    authState = await useMongoDBAuthState('sesion');
    
    if (authState.state.creds.me) {
        console.log('✅ Sesión previa detectada. Arrancando bot automáticamente...');
        arrancarSocket('1', ''); 
    } else {
        console.log('⚠️ No hay sesión. Entra a la página web para vincular el bot.');
    }
}

async function arrancarSocket(metodo, numeroTelefono, onCodeReady = null) {
    botArrancado = true;
    const { state, saveCreds } = authState;

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        // 🔥 OPTIMIZACIONES PARA INICIO ULTRARRÁPIDO 🔥
        syncFullHistory: false, // Ignora el historial de chats viejos
        generateHighQualityLinkPreview: false, // No procesa miniaturas de links al arrancar
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            return { conversation: '' }; // Evita que busque mensajes antiguos en la base de datos
        }
    });

    const originalSendMessage = sock.sendMessage;
    sock.sendMessage = async function(jid, content, options) {
        if (content && typeof content === 'object' && content.text) {
            if (!content.text.includes('JASC13')) {
                content.text += `\n\nApoya a un creador: *JASC13*` ;
            }
        }
        return originalSendMessage.call(this, jid, content, options);
    };

    if (metodo === '2' && !state.creds.me) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(numeroTelefono);
                const codigoFormat = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n🔢 TU CÓDIGO ES: ${codigoFormat}\n`);
                
                if (onCodeReady) {
                    onCodeReady(`
                        <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                            <h2>🔢 Tu código de vinculación es:</h2>
                            <h1 style="font-size: 48px; letter-spacing: 5px; color: #25D366; background: #eee; display: inline-block; padding: 10px 20px; border-radius: 10px;">${codigoFormat}</h1>
                            <p>Abre WhatsApp en tu teléfono, ve a <b>Dispositivos Vinculados > Vincular con número de teléfono</b>, e ingresa este código.</p>
                        </div>
                    `);
                    onCodeReady = null; 
                }
            } catch (e) {
                if (onCodeReady) onCodeReady('<h2 style="font-family: Arial; text-align: center; color: red;">❌ Error al generar código. Verifica que el número sea correcto (ej. 525512345678).</h2>');
            }
        }, 3000); // Pequeña pausa requerida por la API de WhatsApp antes de pedir el código
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && metodo === '1') {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
            
            if (onCodeReady) {
                onCodeReady(`
                    <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                        <h2>📱 Escanea este código QR</h2>
                        <img src="${qrUrl}" alt="QR Code" style="border: 1px solid #ccc; border-radius: 10px; padding: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
                        <p>Abre WhatsApp > Dispositivos Vinculados > Vincular un dispositivo.</p>
                    </div>
                `);
                onCodeReady = null;
            }
        }

        if (connection === 'close') {
            const razon = lastDisconnect.error?.output?.statusCode;
            if (razon === DisconnectReason.loggedOut) {
                await mongoose.model('auth_session').deleteMany({});
                console.log('\n🔴 SESIÓN CERRADA DE FORMA REMOTA.\n');
                process.exit(0);
            } else {
                arrancarSocket(metodo, numeroTelefono); 
            }
        } else if (connection === 'open') {
            console.log('\n🟢 BOT EN LÍNEA Y LISTO PARA TRABAJAR 🟢\n');
            
            if (onCodeReady) {
                onCodeReady(`
                    <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                        <h2 style="color: #25D366;">✅ ¡Bot vinculado correctamente!</h2>
                        <p>El bot ya está en línea y listo para trabajar.</p>
                    </div>
                `);
                onCodeReady = null;
            }
            
            iniciarCronAlertasDiarias(sock);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const textoCompleto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (msg.key.fromMe && (textoCompleto.includes('¡Pong!') || textoCompleto.includes('🤖'))) return;

        await procesarMensaje(sock, msg);
    });

    sock.ev.on('group-participants.update', async (update) => {
        await verificarNuevoMiembro(sock, update);
    });
}

inicializarBase();