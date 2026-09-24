require('dotenv').config();
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState, resetMongoDBAuthState } = require('./mongoAuth');
const mongoose = require('mongoose');
const pino = require('pino');
const { procesarMensaje } = require('./messageHandler');
const { verificarNuevoMiembro } = require('./comandos/moderacion');
const { iniciarCronAlertasDiarias } = require('./comandos/fortnite');
const { limpiarEconomiaAlSalir } = require('./comandos/economia');
const { iniciarPuenteDiscord, vincularChatWhatsApp } = require('./webBridge');
const express = require('express');

const app = express();
app.use(express.urlencoded({ extended: true }));

let botArrancado = false;
let authState = null;
let socketActual = null;
let reconexionProgramada = false;
let reconexionIntento = 0;
let sesionRevocada = false;

const RETRASOS_RECONEXION_MS = [3000, 5000, 10000, 20000, 30000, 60000];
const CLAVE_PANEL_REINICIO = String(process.env.BOT_RESET_KEY || '').trim();

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
        ${CLAVE_PANEL_REINICIO ? '<details style="margin:20px 0; text-align:left;"><summary style="cursor:pointer; font-weight:bold;">⚙️ Opciones de mantenimiento</summary><form action="/reiniciar-vinculacion" method="POST" style="margin-top:12px; padding:15px; background:#fff3cd; border:1px solid #ffe69c; border-radius:8px;"><p><b>🔄 Reiniciar vinculación de WhatsApp</b></p><p style="font-size:14px;">Úsalo si el bot aparece vinculado pero WhatsApp realmente no está conectado. Borra únicamente la sesión de WhatsApp y permite vincularla otra vez.</p><input type="password" name="clave" placeholder="Clave de mantenimiento" required style="padding:10px; width:100%; box-sizing:border-box; border-radius:5px; border:1px solid #ccc;"><button type="submit" style="margin-top:10px; padding:10px 15px; background:#dc3545; color:white; border:none; cursor:pointer; border-radius:5px;">🔄 Reiniciar sesión</button></form></details>' : ''}
        ${sesionRevocada ? '<p style="color:#b00020; background:#ffe6e6; padding:12px; border-radius:8px;"><b>⚠️ La sesión anterior fue cerrada por WhatsApp.</b><br>La sesión inválida ya fue limpiada. Vincula nuevamente el bot desde aquí.</p>' : ''}
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

app.post('/reiniciar-vinculacion', async (req, res) => {
    if (!CLAVE_PANEL_REINICIO || req.body.clave !== CLAVE_PANEL_REINICIO) {
        return res.status(403).send('<h2 style="font-family: Arial; text-align: center; margin-top: 50px;">⛔ Clave incorrecta o panel de reinicio no configurado.</h2>');
    }

    try {
        if (socketActual) {
            try { socketActual.end(undefined); } catch (e) {}
        }
        socketActual = null;
        botArrancado = false;
        reconexionProgramada = false;
        reconexionIntento = 0;
        sesionRevocada = false;
        await resetMongoDBAuthState('sesion');
        authState = await useMongoDBAuthState('sesion');
        console.log('🔄 Reinicio manual solicitado desde el panel. Sesión de WhatsApp eliminada; esperando nueva vinculación.');
        res.send('<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2 style="color:#25D366;">✅ Sesión reiniciada</h2><p>La sesión anterior de WhatsApp fue eliminada.</p><p>Regresa a la página principal y vincula el bot nuevamente mediante QR o código de 8 dígitos.</p><p><a href="/">🔌 Volver a vincular</a></p></div>');
    } catch (e) {
        console.error('❌ Error en reinicio manual de vinculación:', e.message);
        res.status(500).send('<h2 style="font-family: Arial; text-align: center; margin-top: 50px; color:red;">❌ No se pudo reiniciar la sesión.</h2>');
    }
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
    if (reconexionProgramada || socketActual) return;
    botArrancado = true;
    const { state, saveCreds } = authState;

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            return { conversation: '' };
        }
    });

    socketActual = sock;

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
        }, 3000);
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
            const razon = lastDisconnect?.error?.output?.statusCode;
            socketActual = null;

            if (razon === DisconnectReason.loggedOut) {
                botArrancado = false;
                reconexionProgramada = false;
                reconexionIntento = 0;
                sesionRevocada = true;

                console.log('\\n🔴 WhatsApp reportó SESIÓN CERRADA (loggedOut). La sesión anterior fue revocada y no puede recuperarse reutilizando las mismas credenciales.\\n');
                console.log('🧹 Limpiando la sesión inválida de MongoDB para dejar disponible una nueva vinculación...');

                try {
                    await resetMongoDBAuthState('sesion');
                    authState = await useMongoDBAuthState('sesion');
                    console.log('✅ Sesión inválida eliminada de MongoDB. Abre la página web y vincula nuevamente el bot.');
                } catch (e) {
                    console.error('❌ No se pudo limpiar la sesión inválida:', e.message);
                }
                return;
            }

            if (reconexionProgramada) return;
            reconexionProgramada = true;

            const retraso = RETRASOS_RECONEXION_MS[Math.min(reconexionIntento, RETRASOS_RECONEXION_MS.length - 1)];
            reconexionIntento++;

            console.log(`⚠️ WhatsApp cerró la conexión (código ${razon ?? 'desconocido'}). Reintentando en ${Math.round(retraso / 1000)} segundos...`);

            setTimeout(async () => {
                reconexionProgramada = false;
                try {
                    await arrancarSocket(metodo, numeroTelefono);
                } catch (e) {
                    console.error('❌ Error al reconectar WhatsApp:', e.message);
                    socketActual = null;
                    botArrancado = false;
                }
            }, retraso);
        } else if (connection === 'open') {
            reconexionProgramada = false;
            reconexionIntento = 0;
            sesionRevocada = false;
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
            
            // 🚀 Única fuente automática de alertas Fortnite: STW Planner
            iniciarPuenteDiscord(sock);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        // Guardamos también el pushName que WhatsApp entrega en el mensaje.
        // Sirve para diagnóstico y para conservar el nombre visible aunque
        // el usuario no esté guardado en la agenda local.
        if (msg?.pushName && msg?.key) {
            const pushName = String(msg.pushName).trim();
            if (pushName) {
                if (!sock.jasc13PushNameCache) sock.jasc13PushNameCache = new Map();
                for (const key of [msg.key.participant, msg.key.participantAlt, msg.key.senderPn, msg.key.participantPn, msg.key.senderLid].filter(Boolean)) {
                    sock.jasc13PushNameCache.set(String(key), pushName);
                }
            }
        }
        const textoCompleto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (msg.key.fromMe && (textoCompleto.includes('¡Pong!') || textoCompleto.includes('🤖'))) return;

        if (textoCompleto.startsWith('setgrupostw') || textoCompleto.startsWith('!setgrupostw')) {
            vincularChatWhatsApp(msg.key.remoteJid);
        }

        await procesarMensaje(sock, msg);
    });

    sock.ev.on('group-participants.update', async (update) => {
        await verificarNuevoMiembro(sock, update);

        // La economía por grupo se limpia únicamente cuando WhatsApp informa
        // que alguien salió/ fue expulsado. No se consulta la membresía en cada comando.
        if (update?.action === 'remove' && update?.id && Array.isArray(update?.participants)) {
            try {
                await limpiarEconomiaAlSalir(update.id, update.participants);
            } catch (e) {
                console.error('⚠️ Error limpiando economía de integrantes salientes:', e.message);
            }
        }
    });
}

inicializarBase();