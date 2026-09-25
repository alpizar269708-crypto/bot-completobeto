# Bot de Servicios para WhatsApp — 1 grupo

Bot para llevar la cuenta de servicios dentro de un solo grupo de WhatsApp.

## Comandos

- activarbotservicios: activa el bot y reserva el grupo. Sólo el dueño puede hacerlo.
- vercuenta: muestra saldo inicial, suma de servicios y el recuento de los importes 250 y 35 multiplicados por 20.
- cuentanueva 5000: inicia una cuenta nueva con saldo inicial de 5,000. La cuenta anterior queda archivada en MongoDB.
- pag: respondiendo a un servicio marca un solo servicio como pagado. Sin respuesta pregunta quién pagó y cuánto.
- transferencia: respondiendo a un servicio marca un solo servicio como pagado por transferencia.
- verdeudores: muestra servicios pendientes, agrupados por nombre.
- verpagados: muestra pagos y fecha.
- listaservicios: muestra todos los servicios de la cuenta activa.
- menu: muestra comandos numerados. Responder al mensaje del menú con un número ejecuta automáticamente el comando.
- desactivarbotservicios: libera el grupo para poder activar el bot en otro lugar. Los datos permanecen en MongoDB.

Los nombres toleran mayúsculas, acentos y pequeños errores de escritura. Los importes pueden ser positivos o negativos y aceptar comas de miles, por ejemplo 1,250 o -2,000.

## Diferenciar tus mensajes de los del bot

Esto es especialmente importante en este bot. En WhatsApp, un mensaje que tú escribes desde el teléfono del mismo número puede llegar marcado como fromMe=true, igual que un mensaje enviado por el bot. Por eso el proyecto guarda en MongoDB los identificadores de los mensajes enviados por el bot y sólo ignora esos mensajes; tus mensajes manuales siguen siendo procesados.

## MongoDB

La cuenta, los servicios, pagos, ciclos anteriores, estados interactivos y la sesión de WhatsApp se guardan en MongoDB. Cuando ejecutas cuentanueva no se eliminan físicamente los datos anteriores: se cierra el ciclo activo y se crea otro. Así la cuenta empieza desde cero sin perder el historial almacenado.

## Render

Usa un Background Worker, no un Cron Job. Render define los Cron Jobs para procesos programados que terminan y limita una ejecución continua a 12 horas; un Background Worker está pensado para procesos que permanecen ejecutándose.

Configuración del Worker:

- Root Directory: bot-servicios (porque la carpeta está dentro del repositorio existente).
- Build Command: npm install
- Start Command: node index.js
- Node.js: 20 o superior.

## Variables de entorno

MONGO_URI=tu cadena mongodb+srv://...
OWNER_PHONE=tu numero con codigo de pais, solo digitos
PAIRING_PHONE=tu numero con codigo de pais, solo digitos
MULTIPLIER_250=20
MULTIPLIER_35=20
LOG_LEVEL=info

## Primer enlace

1. Crea el Worker en Render.
2. Configura las variables de entorno.
3. Despliega.
4. Revisa Logs en Render.
5. El bot mostrará un código de vinculación de 8 dígitos.
6. En WhatsApp abre Dispositivos vinculados > Vincular con número de teléfono e introduce el código.
7. La sesión queda guardada en MongoDB y las siguientes reiniciadas pueden reconectar sin QR mientras la sesión siga válida.

## MongoDB Atlas

Crea un proyecto/cluster, un Database User y una regla de Network Access que permita que Render llegue al cluster. Después copia la cadena de conexión del driver Node.js y úsala como MONGO_URI. No publiques esa cadena en GitHub y no subas un archivo .env.

## Formatos de servicio

250 dany
220 tal
100 fulano

También:

250 dany, 220 tal, 100 fulano

Y negativos:

-250 dany
-1,500 ajuste

## Pago por respuesta

Responde al mensaje del servicio y escribe pag. El bot marca sólo un servicio asociado a ese mensaje.

También puedes responder con transferencia para que quede registrado como transferencia.

Para el pago desde el menú, responde al mensaje del menú con el número 4. El bot preguntará quién pagó y cuánto. Puedes contestar Dany 250 o 250 Dany. Si existen varios servicios de Dany, sólo se marca uno.
