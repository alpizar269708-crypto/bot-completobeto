const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { Config } = require('../database/modelos');

const PAYPAL_FEES_URL = 'https://www.paypal.com/mx/business/paypal-business-fees?locale.x=es_MX';
const CONFIG_KEY = 'paypal_tarifas';
const TIMEZONE = 'America/Mexico_City';

const TARIFAS_POR_DEFECTO = {
    nacional: 0.0395,
    internacionalAdicional: 0.005,
    fijaUsd: 0.30,
    fuente: PAYPAL_FEES_URL,
    verificadaEn: null
};

let cronIniciado = false;

function normalizarNumero(valor) {
    if (typeof valor !== 'string' && typeof valor !== 'number') return null;
    const limpio = String(valor).replace(',', '.').replace(/[^0-9.]/g, '');
    const numero = Number(limpio);
    return Number.isFinite(numero) ? numero : null;
}

function validarTarifas(tarifas) {
    return !!tarifas &&
        Number.isFinite(tarifas.nacional) &&
        Number.isFinite(tarifas.internacionalAdicional) &&
        Number.isFinite(tarifas.fijaUsd) &&
        tarifas.nacional >= 0 && tarifas.nacional <= 0.20 &&
        tarifas.internacionalAdicional >= 0 && tarifas.internacionalAdicional <= 0.10 &&
        tarifas.fijaUsd >= 0 && tarifas.fijaUsd <= 10;
}

async function obtenerTarifasPaypal() {
    try {
        const config = await Config.findOne({ clave: CONFIG_KEY }).lean();
        if (config?.valor) {
            const guardadas = JSON.parse(config.valor);
            if (validarTarifas(guardadas)) return { ...TARIFAS_POR_DEFECTO, ...guardadas };
        }
    } catch (error) {
        console.error('⚠️ No se pudieron leer las tarifas guardadas de PayPal:', error.message);
    }

    return { ...TARIFAS_POR_DEFECTO };
}

function extraerTarifa(texto, expresiones) {
    for (const expresion of expresiones) {
        const match = texto.match(expresion);
        if (match) {
            const numero = normalizarNumero(match[1]);
            if (numero !== null) return numero;
        }
    }
    return null;
}

async function verificarTarifasPaypal() {
    console.log('🔎 Verificando tarifas de PayPal en la página oficial...');

    try {
        const respuesta = await axios.get(PAYPAL_FEES_URL, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BetoBot/1.0; +https://paypal.com/)'
            }
        });

        const $ = cheerio.load(respuesta.data);
        const texto = $('body').text().replace(/\s+/g, ' ').trim();

        const nacional = extraerTarifa(texto, [
            /Comisión estándar por recibir transacciones nacionales.*?Transacciones comerciales\s*([0-9]+(?:[.,][0-9]+)?)%\s*\+\s*comisión fija/i,
            /Standard rate for receiving domestic transactions.*?Commercial Transactions\s*([0-9]+(?:[.,][0-9]+)?)%\s*\+\s*fixed fee/i
        ]);

        const internacionalAdicional = extraerTarifa(texto, [
            /Comisión porcentual adicional por transacciones comerciales internacionales.*?Fuera de México \(MX\)\s*([0-9]+(?:[.,][0-9]+)?)%/i,
            /Additional percentage-based fee for international commercial transactions.*?Outside of Mexico \(MX\)\s*([0-9]+(?:[.,][0-9]+)?)%/i
        ]);

        const fijaUsd = extraerTarifa(texto, [
            /Dólar estadounidense\s*([0-9]+(?:[.,][0-9]+)?)\s*USD/i,
            /US dollar\s*([0-9]+(?:[.,][0-9]+)?)\s*USD/i
        ]);

        if (nacional === null || internacionalAdicional === null || fijaUsd === null) {
            throw new Error('No se pudieron identificar todas las tarifas estándar esperadas en la página oficial.');
        }

        const nuevasTarifas = {
            nacional: nacional / 100,
            internacionalAdicional: internacionalAdicional / 100,
            fijaUsd,
            fuente: PAYPAL_FEES_URL,
            verificadaEn: new Date().toISOString()
        };

        if (!validarTarifas(nuevasTarifas)) {
            throw new Error('Las tarifas obtenidas están fuera de los rangos permitidos.');
        }

        const anteriores = await obtenerTarifasPaypal();
        const cambiaron =
            anteriores.nacional !== nuevasTarifas.nacional ||
            anteriores.internacionalAdicional !== nuevasTarifas.internacionalAdicional ||
            anteriores.fijaUsd !== nuevasTarifas.fijaUsd;

        await Config.findOneAndUpdate(
            { clave: CONFIG_KEY },
            { valor: JSON.stringify(nuevasTarifas) },
            { upsert: true, new: true }
        );

        console.log(
            cambiaron
                ? `🔄 Tarifas de PayPal actualizadas: nacional ${(nuevasTarifas.nacional * 100).toFixed(2)}%, internacional +${(nuevasTarifas.internacionalAdicional * 100).toFixed(2)}%, fija $${nuevasTarifas.fijaUsd.toFixed(2)} USD.`
                : '✅ Tarifas de PayPal verificadas; no hubo cambios.'
        );

        return nuevasTarifas;
    } catch (error) {
        console.error('⚠️ No se actualizaron las tarifas de PayPal. Se conserva la última tarifa válida:', error.message);
        return await obtenerTarifasPaypal();
    }
}

function iniciarVerificacionTarifasPaypal() {
    if (cronIniciado) return;
    cronIniciado = true;

    cron.schedule('0 0 3 * * *', async () => {
        await verificarTarifasPaypal();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });

    console.log('🕒 Verificación automática de tarifas PayPal programada para las 03:00:00 (hora de Ciudad de México).');
}

function calcularComision(montoEnviado, porcentaje, fija) {
    return (montoEnviado * porcentaje) + fija;
}

function calcularParaRecibir(netoDeseado, porcentaje, fija) {
    const montoSinRedondear = (netoDeseado + fija) / (1 - porcentaje);
    let montoEnviado = Math.ceil((montoSinRedondear - 1e-10) * 100) / 100;

    let comision = calcularComision(montoEnviado, porcentaje, fija);
    let neto = montoEnviado - comision;

    // Garantiza que, después de redondear a centavos, no quedemos por debajo del neto solicitado.
    while (neto + 1e-9 < netoDeseado) {
        montoEnviado = Math.round((montoEnviado + 0.01) * 100) / 100;
        comision = calcularComision(montoEnviado, porcentaje, fija);
        neto = montoEnviado - comision;
    }

    return { montoEnviado, comision, neto };
}

function formatearUsd(valor) {
    return `$${Number(valor).toFixed(2)} USD`;
}

async function comandoPaypal(sock, chatJid, msg) {
    const tarifas = await obtenerTarifasPaypal();
    const nacionalPct = (tarifas.nacional * 100).toFixed(2);
    const internacionalPct = ((tarifas.nacional + tarifas.internacionalAdicional) * 100).toFixed(2);

    const texto = `💳 *CALCULADORA DE COMISIÓN PAYPAL*

🇲🇽 *NACIONAL*
• Comisión: *${nacionalPct}%*
• Comisión fija: *$${tarifas.fijaUsd.toFixed(2)} USD*

🌎 *INTERNACIONAL*
• Comisión: *${internacionalPct}%*
• Comisión fija: *$${tarifas.fijaUsd.toFixed(2)} USD*

📌 _Tarifas aplicables a transacciones comerciales recibidas en una cuenta PayPal de México._

⚠️ *Las tarifas de PayPal pueden cambiar*`;

    await sock.sendMessage(chatJid, { text: texto }, { quoted: msg });
}

async function comandoCalculadoraPaypal(sock, chatJid, msg, tipo, args) {
    const valorTexto = Array.isArray(args) ? args[0] : null;
    const netoDeseado = normalizarNumero(valorTexto);

    if (netoDeseado === null || netoDeseado <= 0) {
        await sock.sendMessage(chatJid, {
            text: `❌ Indica una cantidad válida en USD.\n\nEjemplo: *${tipo} 50*`
        }, { quoted: msg });
        return;
    }

    if (netoDeseado > 100000000) {
        await sock.sendMessage(chatJid, {
            text: '❌ La cantidad máxima permitida es de $100,000,000.00 USD.'
        }, { quoted: msg });
        return;
    }

    const tarifas = await obtenerTarifasPaypal();
    const porcentaje = tipo === 'paypaln'
        ? tarifas.nacional
        : tarifas.nacional + tarifas.internacionalAdicional;

    const calculo = calcularParaRecibir(netoDeseado, porcentaje, tarifas.fijaUsd);
    const comision = Math.max(0, calculo.montoEnviado - calculo.neto);

    const bandera = tipo === 'paypaln' ? '🇲🇽' : '🌎';
    const nombre = tipo === 'paypaln' ? 'NACIONAL' : 'INTERNACIONAL';

    const texto = `${bandera} *PAYPAL ${nombre}*

🎯 Quieres recibir: *${formatearUsd(netoDeseado)}*

📥 Deben enviarte: *${formatearUsd(calculo.montoEnviado)}*
💸 Comisión PayPal: *${formatearUsd(comision)}*
✅ Recibes netos: *${formatearUsd(calculo.neto)}*`;

    await sock.sendMessage(chatJid, { text: texto }, { quoted: msg });
}

module.exports = {
    comandoPaypal,
    comandoCalculadoraPaypal,
    verificarTarifasPaypal,
    iniciarVerificacionTarifasPaypal
};
