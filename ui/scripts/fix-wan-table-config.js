'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { MongoClient } = require('/usr/local/lib/node_modules/genieacs/node_modules/mongodb');

(async () => {
  const client = await MongoClient.connect('mongodb://127.0.0.1:27017');
  try {
    const config = client.db('genieacs').collection('config');
    const originals = [];
    const changes = [];
    for (const [index, kind] of [[1, 'WANIPConnection'], [3, 'WANPPPConnection']]) {
      const prefix = `ui.device.1.components.${index}.`;
      const records = await config.find({ _id: { $regex: `^ui\\.device\\.1\\.components\\.${index}\\.` } }).toArray();
      assert(records.some(row => row._id === prefix + 'type' && row.value === "'parameter-table'"));
      const root = records.find(row => row._id === prefix + 'parameter');
      const target = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.*.${kind}`;
      assert(root && [target, `InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.${kind}`, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice'].includes(root.value));
      for (const row of records) {
        let value = row.value;
        if (row._id === root._id) value = target;
        else if (row._id === prefix + 'filter' || (row._id.startsWith(prefix + 'childParameters.') && row._id.endsWith('.parameter'))) {
          value = value.split(`${kind}.1.`).join('');
        }
        if (value !== row.value) {
          originals.push(row);
          changes.push({ updateOne: { filter: { _id: row._id, value: row.value }, update: { $set: { value } } } });
        }
      }
    }
    // Keep WAN refresh buttons scoped to the same WAN device as the tables.
    const refresh = await config.find({ _id: /^ui\.device\.1\..*\.parameters\.[0-9]+$/ }).toArray();
    for (const row of refresh) {
      const value = row.value.replaceAll('InternetGatewayDevice.WANDevice.*.', 'InternetGatewayDevice.WANDevice.1.');
      if (value !== row.value) {
        originals.push(row);
        changes.push({ updateOne: { filter: { _id: row._id, value: row.value }, update: { $set: { value } } } });
      }
    }
    if (!changes.length) {
      console.log('WAN table configuration already current');
      return;
    }
    if (!process.argv.includes('--apply')) {
      console.log(`${changes.length} configuration changes ready; use --apply to save`);
      return;
    }
    const backup = `/root/wan-table-config-before-${Date.now()}.json`;
    fs.writeFileSync(backup, JSON.stringify(originals, null, 2), { flag: 'wx', mode: 0o600 });
    const result = await config.bulkWrite(changes, { ordered: true });
    assert.equal(result.matchedCount, changes.length, 'Configuration changed concurrently; inspect backup before retrying');
    console.log(`Updated ${result.modifiedCount} WAN configuration entries; backup: ${backup}`);
  } finally {
    await client.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
