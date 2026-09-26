require('dotenv').config();
const { default: makeWASocket, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState, resetMongoDBAuthState } = require('./mongoAuth');
const mongoose = require('mongoose');
const pino = require('pino');
const QRCode = require('qrcode');
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
    if (false && botArrancado) {
        return res.send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px; max-width:600px; margin-left:auto; margin-right:auto;">
                <h2>🤖 Bot de WhatsApp activo</h2>
                <p>El bot ya está vinculado y trabajando en el servidor.</p>
                <form action="/cerrar-sesion" method="POST" onsubmit="return confirm('¿Seguro que quieres cerrar la sesión?');">
                    <button type="submit" style="padding:12px 20px; background:#dc2626; color:white; border:none; cursor:pointer; font-size:16px; border-radius:7px; width:100%;">🚪 Cerrar sesión</button>
                </form>
                <form action="/limpiar-whatsapp" method="POST" onsubmit="return confirm('¿Seguro que quieres borrar toda la vinculación guardada de WhatsApp y dejarlo listo para vincular de nuevo?');" style="margin-top:12px;">
                    <button type="submit" style="padding:12px 20px; background:#111827; color:white; border:none; cursor:pointer; font-size:16px; border-radius:7px; width:100%;">🧹 Limpiar toda la vinculación de WhatsApp</button>
                </form>
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
            
            <div id="telefonoBox" style="display:none;">
                <p><b>Número de WhatsApp para el código de 8 dígitos:</b></p>
                <input id="numero" type="tel" inputmode="numeric" name="numero" placeholder="Ej: 525512345678" style="padding: 10px; width: 100%; box-sizing: border-box; border-radius: 5px; border: 1px solid #ccc;"><br><br>
            </div>
            
            <button id="iniciarBtn" type="submit" style="padding: 12px 20px; background: #25D366; color: white; border: none; cursor: pointer; font-size: 16px; border-radius: 5px; width: 100%;">📱 Generar QR</button>
        </form>
        <div style="margin-top:25px;padding-top:20px;border-top:1px solid #ddd;">
            <form action="/cerrar-sesion" method="POST" onsubmit="return confirm('¿Seguro que quieres cerrar la sesión de WhatsApp?');">
                <button type="submit" style="padding:12px 20px;background:#dc2626;color:white;border:none;cursor:pointer;font-size:16px;border-radius:7px;width:100%;">🚪 Cerrar sesión de WhatsApp</button>
            </form>
            <form action="/limpiar-whatsapp" method="POST" onsubmit="return confirm('¿Seguro que quieres limpiar toda la vinculación de WhatsApp?');" style="margin-top:12px;">
                <button type="submit" style="padding:12px 20px;background:#111827;color:white;border:none;cursor:pointer;font-size:16px;border-radius:7px;width:100%;">🧹 Limpiar toda la vinculación de WhatsApp</button>
            </form>
        </div>
        <script>
        const radios=document.querySelectorAll('input[name="metodo"]');
        const box=document.getElementById('telefonoBox');
        const btn=document.getElementById('iniciarBtn');
        radios.forEach(r=>r.addEventListener('change',()=>{
            const codigo=document.querySelector('input[name="metodo"]:checked').value==='2';
            box.style.display=codigo?'block':'none';
            btn.textContent=codigo?'🔢 Generar código de 8 dígitos':'📱 Generar QR';
        }));
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.post('/iniciar', async (req, res) => {
    // Permite volver a intentar una vinculacion que quedo atascada sin sesion.
    if (botArrancado && socketActual && !authState?.state?.creds?.me) {
        try { socketActual.ev.removeAllListeners(); } catch (e) {}
        try { socketActual.ws?.close(); } catch (e) {}
        socketActual = null;
        botArrancado = false;
        reconexionProgramada = false;
    }
    if (botArrancado) {
        return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Vincular Bot</title></head><body style="font-family:Arial;text-align:center;padding:30px;">${vinculacionEstado}<script>setTimeout(()=>location.href='/estado-vinculacion',1000);</script></body></html>`);
    }

    const metodoSeleccionado = String(req.body.metodo || '1') === '2' ? '2' : '1';
    const numero = req.body.numero;
    const metodo = metodoSeleccionado;
    const numeroLimpio = numero ? numero.replace(/[^0-9]/g, '') : '';

    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>⏳ Preparando vinculación...</h2><p>Conectando con WhatsApp...</p><p>No cierres esta página.</p></div>';

    try {
        if (inicializacionBasePromise) await inicializacionBasePromise;
        if (!authState) throw new Error('El servicio todavía no está listo. Recarga la página e inténtalo de nuevo.');

        if (metodo === '2') {
            if (!numeroLimpio) {
                throw new Error('Escribe tu número de WhatsApp con código de país, por ejemplo 525512345678.');
            }
            // Una vinculación por código siempre comienza con una sesión limpia.
            await resetMongoDBAuthState();
            authState = await useMongoDBAuthState('sesion');
        }

        arrancarSocket(metodo, numeroLimpio, (htmlRespuesta) => {
        vinculacionEstado = htmlRespuesta;
        }).catch((e) => {
            vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ Error al iniciar WhatsApp</h2><p>' + (e.message || 'Error desconocido') + '</p></div>';
        });
    } catch (e) {
        vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ Error al preparar WhatsApp</h2><p>' + (e.message || 'Error desconocido') + '</p></div>';
    }

    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vincular Bot</title></head><body style="font-family:Arial;text-align:center;padding:30px;max-width:700px;margin:auto;"><div id="estado">${vinculacionEstado}</div><script>
async function actualizar(){try{const r=await fetch('/estado-vinculacion?t='+Date.now(),{cache:'no-store'});document.getElementById('estado').innerHTML=await r.text();setTimeout(actualizar,1500)}catch(e){setTimeout(actualizar,2500)}}setTimeout(actualizar,1000);
</script></body></html>`);
});

app.post('/cerrar-sesion', async (req, res) => {
    try {
        reconexionProgramada = false;
        botArrancado = false;

        if (socketActual) {
            try {
                socketActual.ev.removeAllListeners();
            } catch (e) {}
            try {
                await socketActual.logout();
            } catch (e) {
                console.log('⚠️ No se pudo cerrar la sesión desde WhatsApp:', e.message);
            }
            socketActual = null;
        }

        await resetMongoDBAuthState();
        authState = await useMongoDBAuthState('sesion');

        vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>✅ Sesión cerrada</h2><p>La vinculación fue limpiada correctamente.</p><a href="/" style="display:inline-block;margin-top:15px;padding:12px 20px;background:#25D366;color:white;text-decoration:none;border-radius:7px;">🔄 Volver a vincular</a></div>';

        res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sesión cerrada</title></head><body style="font-family:Arial;text-align:center;padding:30px;">${vinculacionEstado}</body></html>`);
    } catch (e) {
        console.error('❌ Error al cerrar sesión:', e);
        res.status(500).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error</title></head><body style="font-family:Arial;text-align:center;padding:30px;color:red;"><h2>❌ No se pudo cerrar la sesión</h2><p>${e.message || 'Error desconocido'}</p><a href="/">Volver</a></body></html>`);
    }
});

app.post('/limpiar-whatsapp', async (req, res) => {
    try {
        reconexionProgramada = false;
        botArrancado = false;

        if (socketActual) {
            try {
                await socketActual.logout();
            } catch (e) {
                console.log('⚠️ No se pudo cerrar la sesión de WhatsApp:', e.message);
            }
            try {
                socketActual.ev.removeAllListeners();
            } catch (e) {}
            socketActual = null;
        }

        // IMPORTANTE: esto solo elimina la autenticación de WhatsApp.
        // No toca ninguna otra colección ni ningún otro dato del bot.
        await resetMongoDBAuthState();
        authState = await useMongoDBAuthState('sesion');

        vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>🧹 Vinculación de WhatsApp limpiada</h2><p>Se eliminó únicamente la información necesaria para volver a vincular WhatsApp.</p><a href="/" style="display:inline-block;margin-top:15px;padding:12px 20px;background:#25D366;color:white;text-decoration:none;border-radius:7px;">🔄 Volver</a></div>';

        res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp limpiado</title></head><body style="font-family:Arial;text-align:center;padding:30px;">${vinculacionEstado}</body></html>`);
    } catch (e) {
        console.error('❌ Error limpiando la vinculación de WhatsApp:', e);
        res.status(500).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error</title></head><body style="font-family:Arial;text-align:center;padding:30px;color:red;"><h2>❌ No se pudo limpiar la vinculación</h2><p>${e.message || 'Error desconocido'}</p><a href="/">Volver</a></body></html>`);
    }
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

    metodo = String(metodo) === '2' ? '2' : '1';
    console.log(`🚀 Creando conexión WhatsApp. Método: ${metodo === '2' ? 'código de 8 dígitos' : 'QR'}`);
    // No consultamos la versión por Internet al arrancar: esa petición añade
    // una espera innecesaria antes de crear el socket. Baileys usa la versión
    // compatible instalada en package.json.
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: metodo === '2' ? Browsers.macOS('Chrome') : Browsers.macOS('Desktop'),
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

    let pairingSolicitado = false;

    const solicitarCodigo = async () => {
        if (metodo !== '2' || pairingSolicitado || state.creds.me) return;
        pairingSolicitado = true;

        try {
            const code = await sock.requestPairingCode(numeroTelefono);
            const codigoFormat = code?.match(/.{1,4}/g)?.join('-') || code;
            console.log(`\n🔢 TU CÓDIGO ES: ${codigoFormat}\n`);

            if (onCodeReady) {
                vinculacionEstado = `
                    <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                        <h2>🔢 Tu código de vinculación es:</h2>
                        <h1 style="font-size: 48px; letter-spacing: 5px; color: #25D366; background: #eee; display: inline-block; padding: 10px 20px; border-radius: 10px;">${codigoFormat}</h1>
                        <p>Abre WhatsApp en tu teléfono, ve a <b>Dispositivos Vinculados &gt; Vincular con número de teléfono</b>, e ingresa este código.</p>
                    </div>
                `;
                onCodeReady(vinculacionEstado);
                onCodeReady = null;
            }
        } catch (e) {
            pairingSolicitado = false;
            console.error('❌ Error generando código de vinculación:', e.message);
            if (onCodeReady) onCodeReady('<h2 style="font-family: Arial; text-align: center; color: red;">❌ No se pudo generar el código. Verifica el número e inténtalo de nuevo.</h2>');
        }
    };

    sock.ev.on('creds.update', async (creds) => {
        try {
            await saveCreds();
            if (metodo === '2') {
                console.log('🔐 Credenciales actualizadas. registered:', !!state.creds.registered, 'me:', !!state.creds.me);
            }
        } catch (e) {
            console.error('❌ Error guardando credenciales de WhatsApp:', e.message);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log('📡 Estado WhatsApp:', connection || 'actualización', qr ? '(QR recibido)' : '');
        if (connection === 'connecting') {
            vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2>🔄 Conectando con WhatsApp...</h2><p>El servidor ya está intentando establecer la conexión.</p></div>';

            // Para pairing code, Baileys recomienda solicitar el código cuando el
            // socket ya está en estado "connecting". Pedirlo demasiado pronto puede
            // generar el código pero dejar el socket sin completar el enlace.
            if (metodo === '2' && !pairingSolicitado && !state.creds.registered) {
                setTimeout(() => solicitarCodigo(), 1500);
            }
        }
        
        // WhatsApp puede emitir un QR incluso cuando estamos usando código de 8 dígitos.
        // En ese modo NUNCA debemos mostrarlo ni usarlo para la vinculación.
        if (qr && metodo === '2') {
            console.log('ℹ️ QR recibido pero ignorado porque la vinculación seleccionada es por código de 8 dígitos.');
        }

        if (qr && metodo === '1') {
            console.log('📱 QR DE WHATSAPP RECIBIDO. Longitud:', qr.length);
            const qrUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
            
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
            if (metodo === '2' && razon === 515) {
                console.log('🔁 Código 515 detectado: WhatsApp indica que el enlace fue aceptado y requiere reiniciar el socket con las credenciales nuevas.');
            }
            socketActual = null;

            if (razon === DisconnectReason.loggedOut) {
                botArrancado = false;
                socketActual = null;

                // La sesión guardada ya fue invalidada por WhatsApp. Si la conservamos,
                // cada intento volverá a cerrarse antes de entregar QR/código. Limpiamos
                // únicamente esta autenticación para permitir una vinculación nueva.
                try {
                    await resetMongoDBAuthState();
                    authState = await useMongoDBAuthState('sesion');
                    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:#b45309;"><h2>🔄 Sesión anterior reiniciada</h2><p>La sesión guardada ya no era válida. Regresa a la página principal y genera un nuevo QR o código de vinculación.</p></div>';
                    console.log('🧹 Sesión de WhatsApp invalidada eliminada de MongoDB. Lista para una nueva vinculación.');
                } catch (e) {
                    console.error('❌ No se pudo reiniciar la sesión de WhatsApp:', e.message);
                    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ No se pudo reiniciar la sesión</h2><p>' + (e.message || 'Error desconocido') + '</p></div>';
                }
                return;
            }

            if (reconexionProgramada) return;
            reconexionProgramada = true;

            setTimeout(async () => {
                reconexionProgramada = false;
                try {
                    // En el pairing por código, WhatsApp puede cerrar el socket con
                    // 515 después de aceptar el código. Ese cierre significa
                    // "reinicia usando las credenciales nuevas", no "volver a pedir código".
                    if (metodo === '2' && razon !== DisconnectReason.loggedOut) {
                        try {
                            authState = await useMongoDBAuthState('sesion');
                            console.log('🔄 Auth de MongoDB recargada antes de continuar el enlace. registered:', !!authState.state.creds.registered, 'me:', !!authState.state.creds.me);
                        } catch (e) {
                            console.error('❌ No se pudo recargar la autenticación antes de reconectar:', e.message);
                        }
                    }

                    await arrancarSocket(metodo, numeroTelefono);
                } catch (e) {
                    console.error('Error al reconectar WhatsApp:', e.message);
                }
            }, razon === 515 ? 500 : 1500);
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
        // Solo procesamos mensajes que llegan en tiempo real.
        // Los eventos "append" son historial/sincronización de chats anteriores
        // y se ignoran completamente para que el bot empiece desde este instante.
        if (m.type !== 'notify') return;

        for (const msg of (m.messages || [])) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

            const textoCompleto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (msg.key.fromMe && (textoCompleto.includes('¡Pong!') || textoCompleto.includes('🤖'))) return;

        if (textoCompleto.startsWith('setgrupostw') || textoCompleto.startsWith('!setgrupostw')) {
            vincularChatWhatsApp(msg.key.remoteJid);
        }

            await procesarMensaje(sock, msg);
        }
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
    vinculacionEstado = '<div style="font-family: Arial; text-align: center; margin-top: 50px; color:red;"><h2>❌ Error al iniciar el servicio</h2><p>' + (e.message || 'No se pudo iniciar el servicio.') + '</p></div>';
    throw e;
});