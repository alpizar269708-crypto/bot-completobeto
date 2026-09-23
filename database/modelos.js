const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    numero: { type: String, required: true, unique: true },
    warns: { type: mongoose.Schema.Types.Mixed, default: [] },
    baneado: { type: Boolean, default: false },
    banMotivo: { type: String, default: 'Sin motivo especificado' }, // 👈 Nuevo campo para el motivo del baneo
    saldo: { type: Number, default: 0 },
    // Economía y minijuegos
    cartera: { type: Number, default: 0, min: 0 },
    banco: { type: Number, default: 0, min: 0 },
    inventario: { type: mongoose.Schema.Types.Mixed, default: [] },
    ultimoDaily: { type: Date, default: null },
    ultimoWeekly: { type: Date, default: null },
    ultimoTrabajo: { type: Date, default: null }
});

const configSchema = new mongoose.Schema({
    clave: { type: String, required: true, unique: true },
    valor: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);
const Config = mongoose.model('Config', configSchema);

const conectarDB = async () => {
    try {
        await mongoose.connect('mongodb://localhost:27017/jasc_store');
        console.log('📦 Conectado a MongoDB correctamente');
    } catch (error) {
        console.error('❌ Error al conectar a MongoDB:', error);
    }
};

module.exports = { conectarDB, User, Config };