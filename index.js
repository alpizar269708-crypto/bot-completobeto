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
        return res.send('<h2 style="font-family: Arial;">🤖 Bot de WhatsApp activo y funcionando 24/7</h2>');
    }
    
    const html = `
    <html>
    <head><title>Vincular Bot</title><meta charset="utf-8"></head>
    <body style="font-family: Arial; padding: 20px; max-width: 600px; margin: auto;">
        <h2>🔌 Vincular Bot de WhatsApp</h2>
        <form action="/iniciar" method="POST">
            <p><b>1. Elige el método de inicio de sesión:</b></p>
            <label><input type="radio" name="metodo" value="1" checked> 📱 Código QR</label><br><br>
            <label><input type="radio" name="metodo" value="2"> 🔢 Código de 8 dígitos</label><br><br>
            
            <p><b>2. Si elegiste 8 dígitos, ingresa tu número (código país + número, ej. 525512345678):</b></p>
            <input type="text" name="numero" placeholder="Ej: 525512345678" style="padding: 8px; width: 100%; box-sizing: border-box;"><br><br>
            
            <button type="submit" style="padding: 12px 20px; background: #25D366; color: white; border: none; cursor: pointer; font-size: 16px; border-radius: 5px;">Conectar Bot</button>
        </form>
    </body>
    </html>
    `;
    res.send(html);
});

app.post('/iniciar', (req, res) => {
    if (botArrancado) return res.send('<h2 style="font-family: Arial;">El bot ya está arrancando. Revisa los logs.</h2>');
    
    const { metodo, numero } = req.body;
    const numeroLimpio = numero ? numero.replace(/[^0-9]/g, '') : '';
    
    res.send('<h2 style="font-family: Arial;">⏳ Procesando...</h2><p style="font-family: Arial;">Ve a la pestaña de <b>Logs</b> en Render para ver tu QR o código de 8 dígitos.</p>');
    arrancarSocket(metodo, numeroLimpio);
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
        console.log('⚠️ No hay sesión. Entra a la página web de Render (https://bot-completobeto.onrender.com) para vincular el bot.');
    }
}

async function arrancarSocket(metodo, numeroTelefono) {
    botArrancado = true;
    const { state, saveCreds } = authState;

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
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
                console.log('\n========================================');
                console.log(`🔢 TU CÓDIGO ES: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
                console.log('========================================\n');
            } catch { }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && metodo === '1') {
            const urlLarga = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
            try {
                const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlLarga)}`);
                const urlCorta = await res.text();
                console.log('\n========================================');
                console.log('✅ QR GENERADO CON ÉXITO');
                console.log(`🔗 Abre aquí: ${urlCorta}`);
                console.log('========================================\n');
            } catch {
                console.log(`\n🔗 Abre aquí: ${urlLarga}\n`);
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