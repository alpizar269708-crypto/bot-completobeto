const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { Config } = require('../database/modelos');

const PAYPAL_FEES_URL = 'https://www.paypal.com/mx/business/paypal-business-fees?locale.x=es_MX';
const CONFIG_KEY = 'paypal_tarifas';
const TIMEZONE = 'America/Mexico_City';

// Tarifas estándar publicadas por PayPal México.
// PayPal indica que los importes/porcentajes están sujetos a IVA.
const TARIFAS_POR_DEFECTO = {
    nacional: 0.0395,
    internacionalAdicional: 0.005,
    fijaMxn: 4.00,
    fijaUsd: 0.30,
    iva: 0.16,
    fuente: PAYPAL_FEES_URL,
    verificadaEn: null
};

let cronIniciado = false;

function normalizarNumero(valor) {
    if (typeof valor !== 'string' && typeof valor !== 'number') return null;

    let texto = String(valor).trim().replace(/\$/g, '').replace(/\s+/g, '');
    if (!texto) return null;

    if (texto.includes(',') && texto.includes('.')) {
        texto = texto.replace(/,/g, '');
    } else if (texto.includes(',')) {
        texto = texto.replace(',', '.');
    }

    texto = texto.replace(/[^0-9.]/g, '');
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
}

function validarTarifas(tarifas) {
    return !!tarifas &&
        Number.isFinite(tarifas.nacional) &&
        Number.isFinite(tarifas.internacionalAdicional) &&
        Number.isFinite(tarifas.fijaMxn) &&
        Number.isFinite(tarifas.fijaUsd) &&
        Number.isFinite(tarifas.iva) &&
        tarifas.nacional >= 0 && tarifas.nacional <= 0.20 &&
        tarifas.internacionalAdicional >= 0 && tarifas.internacionalAdicional <= 0.10 &&
        tarifas.fijaMxn >= 0 && tarifas.fijaMxn <= 100 &&
        tarifas.fijaUsd >= 0 && tarifas.fijaUsd <= 10 &&
        tarifas.iva >= 0 && tarifas.iva <= 0.30;
}

async function obtenerTarifasPaypal() {
    try {
        const config = await Config.findOne({ clave: CONFIG_KEY }).lean();
        if (config?.valor) {
            const guardadas = JSON.parse(config.valor);
            const combinadas = { ...TARIFAS_POR_DEFECTO, ...guardadas };
            if (validarTarifas(combinadas)) return combinadas;
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

        const fijaMxn = extraerTarifa(texto, [
            /Peso mexicano\s*([0-9]+(?:[.,][0-9]+)?)\s*MXN/i,
            /Mexican peso\s*([0-9]+(?:[.,][0-9]+)?)\s*MXN/i
        ]);

        const fijaUsd = extraerTarifa(texto, [
            /Dólar estadounidense\s*([0-9]+(?:[.,][0-9]+)?)\s*USD/i,
            /US dollar\s*([0-9]+(?:[.,][0-9]+)?)\s*USD/i
        ]);

        if (nacional === null || internacionalAdicional === null || fijaMxn === null || fijaUsd === null) {
            throw new Error('No se pudieron identificar todas las tarifas estándar esperadas en la página oficial.');
        }

        const nuevasTarifas = {
            nacional: nacional / 100,
            internacionalAdicional: internacionalAdicional / 100,
            fijaMxn,
            fijaUsd,
            iva: TARIFAS_POR_DEFECTO.iva,
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
            anteriores.fijaMxn !== nuevasTarifas.fijaMxn ||
            anteriores.fijaUsd !== nuevasTarifas.fijaUsd;

        await Config.findOneAndUpdate(
            { clave: CONFIG_KEY },
            { valor: JSON.stringify(nuevasTarifas) },
            { upsert: true, new: true }
        );

        console.log(
            cambiaron
                ? `🔄 Tarifas de PayPal actualizadas: nacional ${(nuevasTarifas.nacional * 100).toFixed(2)}% + $${nuevasTarifas.fijaMxn.toFixed(2)} MXN, internacional +${(nuevasTarifas.internacionalAdicional * 100).toFixed(2)}% + $${nuevasTarifas.fijaUsd.toFixed(2)} USD.`
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

function calcularComision(montoEnviado, porcentaje, fija, iva) {
    const comisionBase = (montoEnviado * porcentaje) + fija;
    return comisionBase * (1 + iva);
}

function calcularParaRecibir(netoDeseado, porcentaje, fija, iva) {
    // La comisión publicada está sujeta a IVA, por lo que se calcula:
    // comisión real = (monto * porcentaje + fija) * (1 + IVA).
    const factorComision = porcentaje * (1 + iva);
    const fijaConIva = fija * (1 + iva);

    const montoSinRedondear = (netoDeseado + fijaConIva) / (1 - factorComision);
    let montoEnviado = Math.ceil((montoSinRedondear - 1e-10) * 100) / 100;

    let comision = calcularComision(montoEnviado, porcentaje, fija, iva);
    let neto = montoEnviado - comision;

    while (neto + 1e-9 < netoDeseado) {
        montoEnviado = Math.round((montoEnviado + 0.01) * 100) / 100;
        comision = calcularComision(montoEnviado, porcentaje, fija, iva);
        neto = montoEnviado - comision;
    }

    return { montoEnviado, comision, neto };
}

function formatearMxn(valor) {
    return `$${Number(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

function formatearUsd(valor) {
    return `$${Number(valor).toFixed(2)} USD`;
}

async function comandoPaypal(sock, chatJid, msg) {
    const tarifas = await obtenerTarifasPaypal();
    const nacionalPct = (tarifas.nacional * 100).toFixed(2);
    const internacionalPct = ((tarifas.nacional + tarifas.internacionalAdicional) * 100).toFixed(2);

    const texto = `💳 *CALCULADORA DE COMISIÓN PAYPAL*

🇲🇽 *NACIONAL — PESOS MEXICANOS*
• Comisión estándar: *${nacionalPct}% + ${formatearMxn(tarifas.fijaMxn)}*
• Con IVA sobre la comisión
• Usa: *paypaln [cantidad en MXN]*

🌎 *INTERNACIONAL — DÓLARES*
• Comisión estándar: *${internacionalPct}% + ${formatearUsd(tarifas.fijaUsd)}*
• Con IVA sobre la comisión
• Usa: *paypali [cantidad en USD]*

📌 Las tarifas corresponden a transacciones comerciales recibidas en una cuenta PayPal de México.
📌 *paypal* solo muestra información; no hace conversiones.

⚠️ Las tarifas de PayPal pueden cambiar.`;

    await sock.sendMessage(chatJid, { text: texto }, { quoted: msg });
}

async function comandoCalculadoraPaypal(sock, chatJid, msg, tipo, args) {
    const valorTexto = Array.isArray(args) ? args[0] : null;
    const netoDeseado = normalizarNumero(valorTexto);

    if (netoDeseado === null || netoDeseado <= 0) {
        const ejemplo = tipo === 'paypaln' ? 'paypaln 500' : 'paypali 50';
        const moneda = tipo === 'paypaln' ? 'MXN' : 'USD';

        await sock.sendMessage(chatJid, {
            text: `❌ Indica una cantidad válida en *${moneda}*.

Ejemplo: *${ejemplo}*`
        }, { quoted: msg });
        return;
    }

    if (netoDeseado > 100000000) {
        await sock.sendMessage(chatJid, {
            text: tipo === 'paypaln'
                ? '❌ La cantidad máxima permitida es de $100,000,000.00 MXN.'
                : '❌ La cantidad máxima permitida es de $100,000,000.00 USD.'
        }, { quoted: msg });
        return;
    }

    const tarifas = await obtenerTarifasPaypal();
    const porcentaje = tipo === 'paypaln'
        ? tarifas.nacional
        : tarifas.nacional + tarifas.internacionalAdicional;

    const fija = tipo === 'paypaln'
        ? tarifas.fijaMxn
        : tarifas.fijaUsd;

    const calculo = calcularParaRecibir(netoDeseado, porcentaje, fija, tarifas.iva);

    const bandera = tipo === 'paypaln' ? '🇲🇽' : '🌎';
    const nombre = tipo === 'paypaln' ? 'NACIONAL' : 'INTERNACIONAL';
    const formatear = tipo === 'paypaln' ? formatearMxn : formatearUsd;

    const texto = `${bandera} *PAYPAL ${nombre}*

🎯 Quieres recibir: *${formatear(netoDeseado)}*

📥 Deben enviarte: *${formatear(calculo.montoEnviado)}*
💸 Comisión PayPal: *${formatear(calculo.comision)}*
✅ Recibes netos: *${formatear(calculo.neto)}*

📌 Comisión calculada con las tarifas estándar vigentes y el IVA aplicable.`;

    await sock.sendMessage(chatJid, { text: texto }, { quoted: msg });
}

module.exports = {
    comandoPaypal,
    comandoCalculadoraPaypal,
    verificarTarifasPaypal,
    iniciarVerificacionTarifasPaypal
};
