const mongoose = require('mongoose'); 
const { ejecutarMenu } = require('./comandos/menu');
const { alertasSTW, comandoDestacadasSTW, comandoPreguntarAlerta, activarAlertasDiarias, desactivarAlertasDiarias } = require('./comandos/fortnite');
const { comandoTiendaMenu, comandoTiendaCategoria } = require('./comandos/tienda'); 
const { 
    comandoSticker, comandoTodos, comandoTiktok, comandoTraduce, comandoSkin, comandoStats, comandoContacto 
} = require('./comandos/utilidades');
const { responderConIA } = require('./comandos/ia');
const { 
    verificarAntiLinks, verificarAntiSpam, comandoListaBlancaLinks, comandoWarn, comandoLimpiarWarns, comandoVerWarns, comandoBan, 
    comandoUnban, comandoListaNegra, comandoUnbanList, comandoGrupo, comandoMute, 
    comandoUnmute, verificarMute, comandoInactivos, comandoDesactivarBienvenida, comandoActivarBienvenida, comandoPersonalizarBienvenida, comandoRestaurarBienvenida 
} = require('./comandos/moderacion');
const { User, Config } = require('./database/modelos');
const { 
    comandoCartera, comandoBanco, comandoPay, comandoTop, comandoDaily, comandoWeekly,
    ejecutarFarmeo, comandoRuleta, comandoCf, comandoSlots, comandoDados, comandoAdivina,
    comandoBuscaminas, comandoRob, comandoPpt, comandoPelea, comandoCarrera, comandoHackear,
    comandoShop, comandoBuy, comandoInventario, comandoVender, comandoUse, comandoRegalarItem 
} = require('./comandos/economia');
const { comandoRifa, comandoRifaInscripcion, comandoRifaJasc13, comandoMenuRifaJasc13, comandoAbrirRifa, comandoActivarRifaAqui } = require('./comandos/rifas');
const { comandoCarry } = require('./comandos/carry');

const categoriasMap = {
    'fortnite': ['pavos', 'destacadasstw', 'legendariasstw', 'epicasstw', 'alertasstw', 'stw', 'alerta', 'setgrupostw', 'unsetgrupostw', 'setprecio'],
    'economia': ['cartera', 'bal', 'banco', 'pay', 'pagar', 'top', 'topdinero', 'daily', 'weekly', 'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar', 'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt', 'pelea', 'carrera', 'hackear', 'shop', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar'],
    'utilidades': ['s', 'sticker', 'todos', 'tiktok', 'traduce', 'skin', 'stats', 'contacto'],
    'ia': ['ia'],
    'moderacion': ['warn', 'advertir', 'verwarns', 'limpiarwarns', 'ban', 'unban', 'listanegra', 'banlist', 'unbanlist', 'grupo', 'mute', 'unmute', 'inactivos', 'listablanca'],
    'tienda': ['tienda'],
    'carry': ['carryleader', 'carryjoin', 'carryleave', 'carryclose', 'blcarry', 'unblcarry', 'listcarrybl'],
    'rifas': ['rifa', 'rifainscripcion'],
    'menu': ['menu', 'menusecreto']
};

async function procesarMensaje(sock, msg) {
    if (msg.key.fromMe) return;

    const chatJid = msg.key.remoteJid;
    const textoOriginal = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';
    if (!textoOriginal) return;

    const normalizarComando = (texto) => (texto || '')
        .trim()
        .split(/\s+/)[0]
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^[!/.]/, '');

    if (normalizarComando(textoOriginal) === 'cerrarsesionauth') {
        if (msg.key.fromMe || true) { 
            console.log('🔴 Comando de cierre de sesión recibido...');
            try {
                await sock.sendMessage(chatJid, { text: `🔴 Sesión cerrada.

Para volver a iniciar sesion, ingresa a: 
bot-completobeto.onrender.com

*Espere 1 minuto antes de ingresar al link de inicio de sesion*

Apoya a un creador: JASC13` });
                await mongoose.model('auth_session').deleteMany({});
            } catch (err) {}
            setTimeout(() => { process.exit(0); }, 2000);
            return;
        }
    }

    const textoComandoPrevio = normalizarComando(textoOriginal);
    // La lista blanca se procesa antes del anti-links para permitir agregar cualquier URL.
    if (textoComandoPrevio === 'listablanca') {
        const partesListaBlanca = textoOriginal.trim().split(/\s+/);
        await comandoListaBlancaLinks(sock, chatJid, msg, partesListaBlanca.slice(1));
        return;
    }

    if (await verificarAntiLinks(sock, msg)) return;

    const remitenteReal = msg.key.participant || chatJid;
    if (verificarMute(chatJid, remitenteReal)) {
        try { await sock.sendMessage(chatJid, { delete: msg.key }); } catch (e) {}
        return;
    }

    if (await verificarAntiSpam(sock, msg)) return;

    let usuarioBD = await User.findOne({ numero: remitenteReal });
    if (!usuarioBD) usuarioBD = await User.create({ numero: remitenteReal }); 
    if (usuarioBD.baneado) return;

    const textoMinusculas = textoOriginal.toLowerCase();
    const textoLimpio = textoMinusculas.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    let args = textoLimpio.split(/ +/);
    let comandoRaw = args.shift();
    let comando = normalizarComando(comandoRaw);

    let configGrupo = await Config.findOne({ clave: `comandos_${chatJid}` });
    if (configGrupo && !msg.key.fromMe && chatJid.endsWith('@g.us')) {
        let permitidos = JSON.parse(configGrupo.valor);
        let comandoPermitido = false;
        
        if (permitidos.includes(comando)) comandoPermitido = true;
        
        for (let cat of permitidos) {
            if (categoriasMap[cat] && categoriasMap[cat].includes(comando)) {
                comandoPermitido = true; break;
            }
        }
        
        if (!comandoPermitido && comando !== 'activarcomandos') return; 
    }

    const comandosValidos = [
        'activarcomandos', 'setprecio', 'ping', 'pavos', 'destacadasstw', 'legendariasstw', 'epicasstw', 'alertasstw', 'stw', 'alerta', 
        'setgrupostw', 'unsetgrupostw', 'grupo', 'mute', 'unmute', 'inactivos', 'tienda', 'ia', 'menu', 'menusecreto',
        's', 'sticker', 'todos', 'tiktok', 'traduce', 'skin', 'stats', 'contacto',
        'warn', 'advertir', 'verwarns', 'limpiarwarns', 'ban', 'unban', 'listanegra', 'banlist', 'unbanlist', 
        'cartera', 'bal', 'banco', 'pay', 'pagar', 'top', 'topdinero', 'daily', 'weekly',
        'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar',
        'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt', 'pelea',
        'carrera', 'hackear', 'shop', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar',
        'rifa', 'rifainscripcion', 'rifajasc13', 'abrirrifa', 'activarrifaaqui', 'menurifajasc13', 'carryleader', 'carryjoin', 'carryleave', 'carryclose', 'blcarry', 'unblcarry', 'listcarrybl',
        'vertodosconandos', 'vertodoscomandos', 'listablanca', 'desactivarbienvenida', 'activarbienvenida', 'personalizarbienvenida', 'restaurarbienvenida', 'salvar'
    ];

    if (comando === 'desactivarbienvenida') {
        await comandoDesactivarBienvenida(sock, chatJid, msg);
        return;
    }

    if (comando === 'activarbienvenida') {
        await comandoActivarBienvenida(sock, chatJid, msg);
        return;
    }

    if (comando === 'personalizarbienvenida') {
        await comandoPersonalizarBienvenida(sock, chatJid, msg, args.join(' '));
        return;
    }

    if (comando === 'restaurarbienvenida') {
        await comandoRestaurarBienvenida(sock, chatJid, msg);
        return;
    }

    if (comando === 'abrirrifa') {
        await comandoAbrirRifa(sock, chatJid, msg);
        return;
    }

    if (comando === 'activarrifaaqui') {
        await comandoActivarRifaAqui(sock, chatJid, msg);
        return;
    }

    if (comando === 'vertodosconandos' || comando === 'vertodoscomandos') {
        const comandosInfo = [
            ['activarcomandos', 'Activa todos los comandos o restringe el grupo a categorías concretas.'],
            ['listablanca', 'Administra la lista blanca de links permitidos. Estructura: links_lista_blanca = ["https://ejemplo.com", "https://otro.com/ruta"].'],
            ['setprecio', 'Configura el precio de los pavos.'],
            ['ping', 'Comprueba que el bot esté activo.'],
            ['pavos', 'Muestra las misiones actuales que dan paVos en Salvar el Mundo.'],
            ['destacadasstw', 'Muestra las alertas destacadas de Salvar el Mundo.'],
            ['legendariasstw', 'Muestra misiones con recompensas legendarias.'],
            ['epicasstw', 'Muestra misiones con recompensas épicas.'],
            ['alertasstw', 'Muestra el resumen general de alertas de Salvar el Mundo.'],
            ['stw', 'Alias de alertasstw.'],
            ['salvar', 'Alias de alertasstw.'],
            ['alerta', 'Busca una recompensa específica en las alertas de Salvar el Mundo.'],
            ['setgrupostw', 'Activa los reportes diarios de Salvar el Mundo en el grupo.'],
            ['unsetgrupostw', 'Desactiva los reportes diarios de Salvar el Mundo.'],
            ['grupo', 'Abre o cierra el chat del grupo.'],
            ['mute', 'Silencia a un usuario del grupo.'],
            ['unmute', 'Quita el silencio a un usuario.'],
            ['inactivos', 'Muestra quiénes llevan tiempo sin participar en el grupo.'],
            ['tienda', 'Muestra la tienda diaria de Fortnite o una categoría concreta.'],
            ['ia', 'Permite conversar con la inteligencia artificial del bot.'],
            ['menu', 'Muestra el menú principal o una categoría específica.'],
            ['menusecreto', 'Muestra el menú secreto del bot.'],
            ['s', 'Convierte una imagen o video en sticker.'],
            ['sticker', 'Alias de s para crear stickers.'],
            ['todos', 'Menciona a todos los participantes del grupo.'],
            ['tiktok', 'Descarga un video de TikTok.'],
            ['traduce', 'Traduce un texto al español.'],
            ['skin', 'Busca información de una skin de Fortnite.'],
            ['stats', 'Consulta estadísticas de un usuario de Fortnite.'],
            ['contacto', 'Muestra la información de contacto del creador.'],
            ['warn', 'Advierte a un usuario del grupo.'],
            ['advertir', 'Alias de warn.'],
            ['verwarns', 'Consulta las advertencias de un usuario.'],
            ['limpiarwarns', 'Borra todos los warns del usuario indicado y lo deja en 0/3.'],
            ['ban', 'Expulsa a un usuario del grupo.'],
            ['unban', 'Permite readmitir a un usuario expulsado.'],
            ['listanegra', 'Gestiona o consulta la lista negra.'],
            ['banlist', 'Alias de listanegra.'],
            ['unbanlist', 'Gestiona la lista de usuarios bloqueados.'],
            ['cartera', 'Consulta tu dinero disponible.'],
            ['bal', 'Alias de cartera.'],
            ['banco', 'Consulta o gestiona el dinero guardado en el banco.'],
            ['pay', 'Transfiere dinero a otro usuario.'],
            ['pagar', 'Alias de pay.'],
            ['top', 'Muestra la clasificación de usuarios con más dinero.'],
            ['topdinero', 'Alias de top.'],
            ['daily', 'Obtén la recompensa diaria.'],
            ['weekly', 'Obtén la recompensa semanal.'],
            ['shop', 'Muestra los objetos disponibles en la tienda del sistema.'],
            ['buy', 'Compra un objeto de la tienda del sistema.'],
            ['inventario', 'Muestra tus objetos disponibles.'],
            ['mochila', 'Alias de inventario.'],
            ['vender', 'Vende un objeto de tu inventario.'],
            ['use', 'Usa un objeto de tu inventario.'],
            ['regalar', 'Regala un objeto a otro usuario.'],
            ['rifa', 'Administra la rifa: ver, quitar, vaciar o sortear.'],
            ['rifainscripcion', 'Permite inscribirse en la rifa activa.'],
            ['rifajasc13', 'Gestiona la rifa especial de JASC13.'],
            ['menurifajasc13', 'Muestra el menú de la rifa JASC13.'],
            ['abrirrifa', 'Inicia una rifa; en grupos la puede iniciar un administrador.'],
            ['activarrifaaqui', 'Activa la rifa en el grupo para permitir inscripciones.'],
            ['carryleader', 'Crea un escuadrón de carry y define sus espacios.'],
            ['carryjoin', 'Se une al escuadrón de carry activo.'],
            ['carryleave', 'Sale del escuadrón de carry actual.'],
            ['carryclose', 'Cierra el escuadrón de carry.'],
            ['blcarry', 'Añade a un usuario a la lista negra de carry.'],
            ['unblcarry', 'Quita a un usuario de la lista negra de carry.'],
            ['listcarrybl', 'Muestra la lista negra de carry.'],
            ['vertodoscomandos', 'Muestra esta lista de comandos y para qué sirve cada uno.'],
            ['desactivarbienvenida', 'Desactiva la bienvenida automática en este grupo.'],
            ['activarbienvenida', 'Vuelve a activar la bienvenida automática en este grupo.'],
            ['personalizarbienvenida', 'Cambia el mensaje de bienvenida; usa {usuario} para mencionar al nuevo integrante.'],
            ['restaurarbienvenida', 'Restaura el mensaje de bienvenida predeterminado.'],
            ['cerrarsesionauth', 'Cierra la sesión de WhatsApp del bot para volver a vincularla.']
        ];

        const texto = [
            '🕵️‍♂️ *COMANDOS DEL BOT* 🕵️‍♂️',
            '',
            'Lista de comandos útiles, administrativos, de Fortnite, rifas, carry y utilidades.',
            'Se excluyeron los comandos de minijuegos, apuestas y acciones tipo RPG.',
            '',
            ...comandosInfo.map(([cmd, descripcion], i) => `${i + 1}. *${cmd}* — ${descripcion}`),
            '',
            'Apoya a un creador: *JASC13* ❤️'
        ].join('\n');

        await sock.sendMessage(chatJid, { text: texto }, { quoted: msg });
        return;
    }

    if (comandosValidos.includes(comando)) {
        switch (comando) {
            case 'menusecreto':
                if (!msg.key.fromMe) return; 
                await ejecutarMenu(sock, chatJid, msg, ['secreto']);
                break;
            case 'activarcomandos':
                if (chatJid.endsWith('@g.us')) {
                    const remitente = msg.key.participant || chatJid;
                    let esAdmin = msg.key.fromMe;
                    if (!esAdmin) {
                        try {
                            const groupMeta = await sock.groupMetadata(chatJid);
                            const part = groupMeta.participants.find(p => p.id === remitente);
                            esAdmin = part && (part.admin === 'admin' || part.admin === 'superadmin');
                        } catch (e) {}
                    }
                    if (!esAdmin) {
                        await sock.sendMessage(chatJid, { text: `❌ Solo los administradores del grupo pueden configurar los comandos.` }, { quoted: msg });
                        return;
                    }
                } else if (!msg.key.fromMe) {
                    return; 
                }
                
                if (args.length === 0 || args[0] === 'todos') {
                    await Config.deleteOne({ clave: `comandos_${chatJid}` });
                    await sock.sendMessage(chatJid, { text: '✅ Todos los comandos han sido activados en este grupo.' }, { quoted: msg });
                } else {
                    await Config.findOneAndUpdate({ clave: `comandos_${chatJid}` }, { valor: JSON.stringify(args) }, { upsert: true });
                    await sock.sendMessage(chatJid, { text: `✅ Se han restringido los comandos en este grupo.\nCategorías activas: ${args.join(', ')}` }, { quoted: msg });
                }
                break;
            case 'ia':
                await responderConIA(sock, chatJid, msg, args.join(' '));
                break;
            case 'menu':
                await ejecutarMenu(sock, chatJid, msg, args);
                break;
            case 'setprecio':
                await Config.findOneAndUpdate({ clave: 'precio_pavos' }, { valor: args.join(' ') }, { upsert: true });
                await sock.sendMessage(chatJid, { text: `✅ Precio actualizado.` }, { quoted: msg });
                break;
            case 'ping':
                await sock.sendMessage(chatJid, { text: '¡Pong! 🤖 Activo.' }, { quoted: msg });
                break;
            case 'pavos':
                await alertasSTW(sock, chatJid, msg, 'pavos');
                break;
            case 'destacadasstw':
                await comandoDestacadasSTW(sock, chatJid, msg);
                break;
            case 'legendariasstw':
                await alertasSTW(sock, chatJid, msg, 'legendarias');
                break;
            case 'epicasstw':
                await alertasSTW(sock, chatJid, msg, 'epicas');
                break;
            case 'alertasstw':
            case 'salvar':
            case 'stw':
                await alertasSTW(sock, chatJid, msg, 'todas');
                break;
            case 'alerta':
                if (args.length > 0) await alertasSTW(sock, chatJid, msg, args[0]);
                else await comandoPreguntarAlerta(sock, chatJid, msg);
                break;
            case 'setgrupostw':
                await activarAlertasDiarias(sock, chatJid, msg);
                break;
            case 'unsetgrupostw':
                await desactivarAlertasDiarias(sock, chatJid, msg);
                break;
            case 'tienda':
                if (args.length === 0) await comandoTiendaMenu(sock, chatJid, msg);
                else await comandoTiendaCategoria(sock, chatJid, msg, args.join(' '));
                break;
            case 's':
            case 'sticker':
                await comandoSticker(sock, msg);
                break;
            case 'todos':
                await comandoTodos(sock, chatJid, msg);
                break;
            case 'tiktok':
                await comandoTiktok(sock, chatJid, msg, args);
                break;
            case 'traduce':
                await comandoTraduce(sock, chatJid, msg, args);
                break;
            case 'skin':
                await comandoSkin(sock, chatJid, msg, args);
                break;
            case 'stats':
                await comandoStats(sock, chatJid, msg, args);
                break;
            case 'contacto':
                await comandoContacto(sock, chatJid, msg);
                break;
            case 'warn':
            case 'advertir':
                await comandoWarn(sock, chatJid, msg, args);
                break;
            case 'verwarns':
                await comandoVerWarns(sock, chatJid, msg, args);
                break;
            case 'limpiarwarns':
                await comandoLimpiarWarns(sock, chatJid, msg, args);
                break;
            case 'ban':
                await comandoBan(sock, chatJid, msg, args);
                break;
            case 'unban':
                await comandoUnban(sock, chatJid, msg, args);
                break;
            case 'listanegra':
            case 'banlist':
                await comandoListaNegra(sock, chatJid, msg);
                break;
            case 'unbanlist':
                await comandoUnbanList(sock, chatJid, msg, args);
                break;
            case 'grupo':
                await comandoGrupo(sock, chatJid, msg, args);
                break;
            case 'mute':
                await comandoMute(sock, chatJid, msg, args);
                break;
            case 'unmute':
                await comandoUnmute(sock, chatJid, msg, args);
                break;
            case 'inactivos':
                await comandoInactivos(sock, chatJid, msg);
                break;
            case 'cartera':
            case 'bal':
                await comandoCartera(sock, chatJid, msg, usuarioBD); 
                break;
            case 'banco':
                await comandoBanco(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'pay':
            case 'pagar':
                await comandoPay(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'top':
            case 'topdinero':
                await comandoTop(sock, chatJid, msg); 
                break;
            case 'daily':
                await comandoDaily(sock, chatJid, msg, usuarioBD);
                break;
            case 'weekly':
                await comandoWeekly(sock, chatJid, msg, usuarioBD);
                break;
            case 'farmear':
            case 'work':
                await ejecutarFarmeo(sock, chatJid, msg, usuarioBD, 'work');
                break;
            case 'crime':
                await ejecutarFarmeo(sock, chatJid, msg, usuarioBD, 'crime');
                break;
            case 'mendigar':
                await ejecutarFarmeo(sock, chatJid, msg, usuarioBD, 'mendigar');
                break;
            case 'pescar':
            case 'minar':
            case 'cazar':
            case 'explorar':
                await ejecutarFarmeo(sock, chatJid, msg, usuarioBD, comando);
                break;
            case 'ruleta':
                await comandoRuleta(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'cf':
                await comandoCf(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'slots':
                await comandoSlots(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'dados':
                await comandoDados(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'adivina':
                await comandoAdivina(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'buscaminas':
                await comandoBuscaminas(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'rob':
                await comandoRob(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'ppt':
                await comandoPpt(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'pelea':
                await comandoPelea(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'carrera':
                await comandoCarrera(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'hackear':
                await comandoHackear(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'shop':
                await comandoShop(sock, chatJid, msg);
                break;
            case 'buy':
                await comandoBuy(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'inventario':
            case 'mochila':
                await comandoInventario(sock, chatJid, msg, usuarioBD);
                break;
            case 'vender':
                await comandoVender(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'use':
                await comandoUse(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'regalar':
                await comandoRegalarItem(sock, chatJid, msg, args, usuarioBD);
                break;
            case 'rifa':
                await comandoRifa(sock, chatJid, msg, args);
                break;
            case 'rifainscripcion':
                await comandoRifaInscripcion(sock, chatJid, msg);
                break;
            case 'rifajasc13':
                await comandoRifaJasc13(sock, chatJid, msg, args);
                break;
            case 'menurifajasc13':
                await comandoMenuRifaJasc13(sock, chatJid, msg);
                break;
            case 'carryleader':
            case 'carryjoin':
            case 'carryleave':
            case 'carryclose':
            case 'blcarry':
            case 'unblcarry':
            case 'listcarrybl':
                await comandoCarry(sock, chatJid, msg, comando, args);
                break;
        }
    }
}

module.exports = { procesarMensaje };
