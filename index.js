require('dotenv').config();
const { default: makeWASocket, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('./mongoAuth');
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
let baseLista = false;
let inicializacionBasePromise = null;
let vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>⏳ Iniciando WhatsApp...</h2><p>Espera unos segundos mientras se genera el método de vinculación.</p></div>';

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

app.post('/iniciar', async (req, res) => {
    if (botArrancado) {
        return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Vincular Bot</title></head><body style="font-family:Arial;text-align:center;padding:30px;">${vinculacionEstado}<script>setTimeout(()=>location.href='/estado-vinculacion',1000);</script></body></html>`);
    }

    const { metodo, numero } = req.body;
    const numeroLimpio = numero ? numero.replace(/[^0-9]/g, '') : '';

    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>⏳ Preparando vinculación...</h2><p>Conectando con MongoDB y WhatsApp...</p><p>No cierres esta página.</p></div>';

    try {
        if (inicializacionBasePromise) await inicializacionBasePromise;
        if (!authState) throw new Error('La conexión con MongoDB todavía no está lista. Recarga la página e inténtalo de nuevo.');
        arrancarSocket(metodo, numeroLimpio, (htmlRespuesta) => {
        vinculacionEstado = htmlRespuesta;
        }).catch((e) => {
            vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ Error al iniciar WhatsApp</h2><p>' + (e.message || 'Error desconocido') + '</p></div>';
        });
    } catch (e) {
        vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ Error al preparar WhatsApp</h2><p>' + (e.message || 'Error desconocido') + '</p></div>';
    }

    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vincular Bot</title></head><body style="font-family:Arial;text-align:center;padding:30px;max-width:700px;margin:auto;"><div id="estado">${vinculacionEstado}</div><script>
async function actualizar(){try{const r=await fetch('/estado-vinculacion?t='+Date.now(),{cache:'no-store'});document.getElementById('estado').innerHTML=await r.text();setTimeout(actualizar,120000)}catch(e){setTimeout(actualizar,2500)}}setTimeout(actualizar,1000);
</script></body></html>`);
});

app.get('/estado-vinculacion', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(vinculacionEstado);
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
    baseLista = true;
    
    if (authState.state.creds.me) {
        console.log('✅ Sesión previa detectada. Arrancando bot automáticamente...');
        arrancarSocket('1', ''); 
    } else {
        console.log('⚠️ No hay sesión. Entra a la página web para vincular el bot.');
    }
}

async function arrancarSocket(metodo, numeroTelefono, onCodeReady = null) {
    if (reconexionProgramada || socketActual) return;
    if (!authState) throw new Error('La autenticación de WhatsApp todavía no está lista.');
    const { state, saveCreds } = authState;

    console.log(`🚀 Creando conexión WhatsApp. Método: ${metodo === '2' ? 'código' : 'QR'}`);
    let waVersion;
    try {
        const latest = await fetchLatestBaileysVersion();
        waVersion = latest?.version;
        console.log('📦 Versión WhatsApp:', waVersion ? waVersion.join('.') : 'predeterminada');
    } catch (e) {
        console.log('⚠️ No se pudo consultar la versión de WhatsApp; usando la predeterminada.');
    }

    const sock = makeWASocket({
        auth: state,
        ...(waVersion ? { version: waVersion } : {}),
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            return { conversation: '' };
        }
    });

    socketActual = sock;
    botArrancado = true;
    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>🔄 Iniciando conexión...</h2><p>Esperando a que WhatsApp entregue el QR o código.</p></div>';
    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>🔄 Conectando con WhatsApp...</h2><p>Esperando respuesta del servidor de WhatsApp.</p></div>';

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
        if (!numeroTelefono) {
            vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ Falta el número</h2><p>Escribe tu número de WhatsApp con código de país.</p></div>';
            return;
        }
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(numeroTelefono);
                const codigoFormat = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n🔢 TU CÓDIGO ES: ${codigoFormat}\n`);
                
                if (onCodeReady) {
                    vinculacionEstado = `
                        <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                            <h2>🔢 Tu código de vinculación es:</h2>
                            <h1 style="font-size: 48px; letter-spacing: 5px; color: #25D366; background: #eee; display: inline-block; padding: 10px 20px; border-radius: 10px;">${codigoFormat}</h1>
                            <p>Abre WhatsApp en tu teléfono, ve a <b>Dispositivos Vinculados > Vincular con número de teléfono</b>, e ingresa este código.</p>
                        </div>
                    `;
                    if (onCodeReady) onCodeReady(vinculacionEstado);
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
        console.log('📡 Estado WhatsApp:', connection || 'actualización', qr ? '(QR recibido)' : '');
        if (connection === 'connecting') {
            vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>🔄 Conectando con WhatsApp...</h2><p>El servidor ya está intentando establecer la conexión.</p></div>';
        }
        
        if (qr && metodo === '1') {
            console.log('📱 QR DE WHATSAPP RECIBIDO. Longitud:', qr.length);
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
            
            if (onCodeReady) {
                vinculacionEstado = `
                    <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                        <h2>📱 Escanea este código QR</h2>
                        <img src="${qrUrl}" alt="QR Code" style="border: 1px solid #ccc; border-radius: 10px; padding: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
                        <p>Abre WhatsApp > Dispositivos Vinculados > Vincular un dispositivo.</p>
                    </div>
                `;
                onCodeReady(vinculacionEstado);
                onCodeReady = null;
            }
        }

        if (connection === 'close') {
            const razon = lastDisconnect?.error?.output?.statusCode;
            console.error('❌ WhatsApp cerró la conexión. Código:', razon, 'Detalle:', lastDisconnect?.error?.message || lastDisconnect?.error || 'sin detalle');
            socketActual = null;

            if (razon === DisconnectReason.loggedOut) {
                botArrancado = false;
                console.log('\\n🔴 WhatsApp reportó SESIÓN CERRADA (loggedOut). Credenciales conservadas en MongoDB; no se borrará la sesión automáticamente.\\n');
                return;
            }

            if (reconexionProgramada) return;
            reconexionProgramada = true;

            setTimeout(async () => {
                reconexionProgramada = false;
                try {
                    await arrancarSocket(metodo, numeroTelefono);
                } catch (e) {
                    console.error('Error al reconectar WhatsApp:', e.message);
                }
            }, 3000);
        } else if (connection === 'open') {
            reconexionProgramada = false;
            console.log('\n🟢 BOT EN LÍNEA Y LISTO PARA TRABAJAR 🟢\n');
            
            if (onCodeReady) {
                vinculacionEstado = `
                    <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                        <h2 style="color: #25D366;">✅ ¡Bot vinculado correctamente!</h2>
                        <p>El bot ya está en línea y listo para trabajar.</p>
                    </div>
                `;
                onCodeReady(vinculacionEstado);
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

inicializacionBasePromise = inicializarBase().catch((e) => {
    console.error('❌ Error inicializando MongoDB:', e);
    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ Error con MongoDB</h2><p>' + (e.message || 'No se pudo inicializar la base de datos.') + '</p></div>';
    throw e;
});