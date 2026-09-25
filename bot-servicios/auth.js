const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { Auth } = require('./mongo');

async function useMongoDBAuthState() {
  const writeData = async (data, id) => {
    const serialized = JSON.stringify(data, BufferJSON.replacer);
    await Auth.findOneAndUpdate(
      { _id: id },
      { data: serialized, updatedAt: new Date() },
      { upsert: true }
    );
  };

  const readData = async (id) => {
    try {
      const doc = await Auth.findById(id).lean();
      return doc ? JSON.parse(doc.data, BufferJSON.reviver) : null;
    } catch {
      return null;
    }
  };

  const removeData = async (id) => {
    await Auth.deleteOne({ _id: id });
  };

  const creds = (await readData('creds')) || initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        await Promise.all(ids.map(async (id) => {
          let value = await readData(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[id] = value;
        }));
        return data;
      },
      set: async (data) => {
        const tasks = [];
        for (const category of Object.keys(data)) {
          for (const id of Object.keys(data[category])) {
            const value = data[category][id];
            const key = `${category}-${id}`;
            tasks.push(value ? writeData(value, key) : removeData(key));
          }
        }
        await Promise.all(tasks);
      }
    }
  };

  return {
    state,
    saveCreds: () => writeData(creds, 'creds')
  };
}

module.exports = { useMongoDBAuthState };
