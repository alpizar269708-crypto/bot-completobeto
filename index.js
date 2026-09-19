require('dotenv').config();
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('./mongoAuth');
const mongoose = require('mongoose');
const pino = require('pino');
const readline = require('readline');
const { procesarMensaje } = require('./messageHandler');
const { verificarNuevoMiembro } = require('./comandos/moderacion');
const { iniciarCronAlertasDiarias } = require('./comandos/fortnite');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (texto) => new Promise((resolver) => rl.question(texto, resolver));

async function iniciarBot() {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
    }

    const { state, saveCreds } = await useMongoDBAuthState('sesion');
    let metodo = '1';
    let numeroTelefono = '';

    if (!state.creds.me) {
        console.log('\n========================================');
        console.log('        🤖 INICIANDO SISTEMA 🤖        ');
        console.log('========================================\n');
        console.log('🔌 ¿CÓMO DESEAS VINCULAR TU DISPOSITIVO?');
        console.log('  [ 1 ] 📱 Código QR (Enlace corto)');
        console.log('  [ 2 ] 🔢 Código de 8 dígitos');
        console.log('----------------------------------------');
        
        metodo = await question('👉 Tu elección (1 o 2): ');
        
        if (metodo === '2') {
            numeroTelefono = await question('👉 Número (ej. 525512345678): ');
            numeroTelefono = numeroTelefono.replace(/[^0-9]/g, '');
        }
    }

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
    });

    // 🌟 INTERCEPTOR GLOBAL: Añade el código de creador a todos los mensajes de texto del bot
    const originalSendMessage = sock.sendMessage;
    sock.sendMessage = async function(jid, content, options) {
        if (content && typeof content === 'object' && content.text) {
            if (!content.text.includes('JASC13')) {
                content.text += `\n\nApoya a un creador: \*JASC13\*` ;
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
                console.log('\n🔴 SESIÓN CERRADA. Limpiando y reiniciando...\n');
                iniciarBot();
            } else {
                iniciarBot(); 
            }
        } else if (connection === 'open') {
            console.log('\n🟢 BOT EN LÍNEA Y LISTO PARA TRABAJAR 🟢\n');
            iniciarCronAlertasDiarias(sock); // Activa el cron de las 6:05 PM hora México
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const textoCompleto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        console.log('\n👀 --- NUEVO MENSAJE DETECTADO ---');
        console.log(`De: ${msg.key.remoteJid}`);
        console.log(`Dice: "${textoCompleto}"`);
        console.log(`¿Enviado por mi mismo (fromMe)?: ${msg.key.fromMe}`);
        console.log('----------------------------------\n');

        if (msg.key.fromMe && (textoCompleto.includes('¡Pong!') || textoCompleto.includes('🤖'))) return;

        await procesarMensaje(sock, msg);
    });

    sock.ev.on('group-participants.update', async (update) => {
        await verificarNuevoMiembro(sock, update);
    });
}

iniciarBot();