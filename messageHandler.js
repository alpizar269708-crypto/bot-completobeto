const { ejecutarMenu } = require('./comandos/menu');
const { alertasSTW, comandoPreguntarAlerta, comandoSetPavos, comandoResetPavos } = require('./comandos/fortnite');
const { comandoTiendaMenu, comandoTiendaCategoria } = require('./comandos/tienda'); 
const { 
    comandoSticker, comandoTodos, comandoTiktok, comandoTraduce, comandoSkin, comandoStats, comandoContacto 
} = require('./comandos/utilidades');
const { responderConIA } = require('./comandos/ia');
const { 
    verificarAntiLinks, verificarAntiSpam, comandoWarn, comandoVerWarns, comandoBan, 
    comandoUnban, comandoListaNegra, comandoUnbanList, comandoGrupo, comandoMute, 
    comandoUnmute, verificarMute, comandoInactivos 
} = require('./comandos/moderacion');
const { User, Config } = require('./database/modelos');
const { 
    comandoCartera, comandoBanco, comandoPay, comandoTop, comandoDaily, comandoWeekly,
    ejecutarFarmeo, comandoRuleta, comandoCf, comandoSlots, comandoDados, comandoAdivina,
    comandoBuscaminas, comandoRob, comandoPpt, comandoPelea, comandoCarrera, comandoHackear,
    comandoShop, comandoBuy, comandoInventario, comandoVender, comandoUse, comandoRegalarItem 
} = require('./comandos/economia');
const { comandoRifa } = require('./comandos/rifas');
const { comandoCarry } = require('./comandos/carry');

async function procesarMensaje(sock, msg) {
    if (msg.key.fromMe) return;

    const chatJid = msg.key.remoteJid;
    const textoOriginal = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    if (!textoOriginal) return;

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

    let configPavos = await Config.findOne({ clave: 'precio_pavos' });
    let infoPrecioPavos = configPavos ? configPavos.valor : 'Precio no configurado.';

    const textoMinusculas = textoOriginal.toLowerCase();
    const textoLimpio = textoMinusculas.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    if (textoLimpio.startsWith('ia ')) {
        await responderConIA(sock, chatJid, msg, textoOriginal.slice(3).trim());
        return;
    }

    if (textoLimpio.startsWith('menu')) {
        await ejecutarMenu(sock, chatJid, msg, textoLimpio.split(/ +/).slice(1));
        return;
    }

    let args = textoLimpio.split(/ +/);
    let comando = args.shift(); 
    if (['!', '/', '.'].includes(comando[0])) comando = comando.substring(1);

    const comandosValidos = [
        'setprecio', 'ping', 'pavos', 'legendarias', 'setpavos', 'resetpavos', 'alertasstw', 'salvar', 'stw', 'alerta', 
        'setgrupostw', 'grupo', 'mute', 'unmute', 'inactivos', 'tienda', 
        's', 'sticker', 'todos', 'tiktok', 'traduce', 'skin', 'stats', 'contacto',
        'warn', 'advertir', 'verwarns', 'ban', 'unban', 'listanegra', 'banlist', 'unbanlist', 
        'cartera', 'bal', 'banco', 'pay', 'pagar', 'top', 'topdinero', 'daily', 'weekly',
        'farmear', 'work', 'crime', 'mendigar', 'pescar', 'minar', 'cazar', 'explorar',
        'ruleta', 'cf', 'slots', 'dados', 'adivina', 'buscaminas', 'rob', 'ppt', 'pelea',
        'carrera', 'hackear', 'shop', 'buy', 'inventario', 'mochila', 'vender', 'use', 'regalar',
        'rifa', 'carryleader', 'carryjoin', 'carryleave', 'carryclose'
    ];

    if (comandosValidos.includes(comando)) {
        switch (comando) {
            case 'setprecio':
                await Config.findOneAndUpdate({ clave: 'precio_pavos' }, { valor: textoOriginal.trim().split(/ +/).slice(1).join(' ') }, { upsert: true });
                await sock.sendMessage(chatJid, { text: `✅ Precio actualizado.` }, { quoted: msg });
                break;
            case 'ping':
                await sock.sendMessage(chatJid, { text: '¡Pong! 🤖 Activo.' }, { quoted: msg });
                break;
            case 'pavos':
                await alertasSTW(sock, chatJid, msg, 'pavos');
                break;
            case 'legendarias':
                await alertasSTW(sock, chatJid, msg, 'legendarias');
                break;
            case 'setpavos':
                await comandoSetPavos(sock, chatJid, msg, textoOriginal.trim().split(/\s+/).slice(1));
                break;
            case 'resetpavos':
                await comandoResetPavos(sock, chatJid, msg);
                break;
            case 'alertasstw':
                await alertasSTW(sock, chatJid, msg, 'importantes');
                break;
            case 'stw':
            case 'alertas':
                await alertasSTW(sock, chatJid, msg, args.length > 0 ? args[0] : 'todas');
                break;
            case 'salvar':
                if (['al mundo', 'el mundo', 'stw'].includes(args.join(' '))) await alertasSTW(sock, chatJid, msg, 'todas');
                break;
            case 'alerta':
                if (args.length > 0) await alertasSTW(sock, chatJid, msg, args[0]);
                else await comandoPreguntarAlerta(sock, chatJid, msg);
                break;
            case 'setgrupostw':
                await activarAlertasDiarias(sock, chatJid, msg);
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
                await comandoTiktok(sock, chatJid, msg, textoOriginal.trim().split(/ +/).slice(1));
                break;
            case 'traduce':
                await comandoTraduce(sock, chatJid, msg, textoOriginal.trim().split(/ +/).slice(1));
                break;
            case 'skin':
                await comandoSkin(sock, chatJid, msg, textoOriginal.trim().split(/ +/).slice(1));
                break;
            case 'stats':
                await comandoStats(sock, chatJid, msg, textoOriginal.trim().split(/ +/).slice(1));
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
                await comandoTop(sock, chatJid, msg); // Corregido silenciosamente para evitar que truene (decía chatId en lugar de chatJid)
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
            case 'carryleader':
            case 'carryjoin':
            case 'carryleave':
            case 'carryclose':
                await comandoCarry(sock, chatJid, msg, comando, args);
                break;
        }
    }
}

module.exports = { procesarMensaje };