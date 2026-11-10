// Patch GenieACS UI device page -> tabs dari ui.device.{label,route} + ?tabs= di URL.
// Rerun setelah npm install/upgrade.
const fs = require('fs');

// This function is embedded in the bundle, where these UI helpers are in scope.
function renderUnifiedWan(e, t, pattern, columns) {
  t = t || {};
  const parts = pattern.split('.');
  const parents = Object.keys(t).filter(path => {
    const segments = path.split('.');
    return segments.length === parts.length && t[path] && t[path].object === true &&
      parts.every((part, index) => part === '*' ? /^[0-9]+$/.test(segments[index]) : part === segments[index]);
  }).sort();
  const writable = parents.filter(path => t[path] && t[path].writable === true);
  const rows = [];
  for (const parent of parents) {
    const prefix = parent + '.';
    const instances = Object.keys(t).filter(path => path.startsWith(prefix) &&
      /^[0-9]+$/.test(path.slice(prefix.length)) && t[path] && t[path].object === true).sort();
    for (const path of instances) {
      const relative = expression => ne(expression, node => Array.isArray(node) && node[0] === 'PARAM'
        ? ['PARAM', ['||', path, '.', node[1]]] : node);
      if (!G(relative('filter' in e.attrs ? e.attrs.filter : true), t)) continue;
      const cells = [];
      for (const column of columns) {
        let parameter = relative(column.parameter);
        // COALESCE(ServiceList vendor variants) is read-only as FUNC.
        // Resolve per-row to the concrete vendor PARAM so the cell stays editable.
        const raw = column.parameter;
        if (Array.isArray(raw) && raw[0] === 'FUNC' && String(raw[1]).toUpperCase() === 'COALESCE') {
          const candidates = [];
          for (let i = 2; i < raw.length; i++) {
            const arg = raw[i];
            if (Array.isArray(arg) && arg[0] === 'PARAM' && typeof arg[1] === 'string') candidates.push(arg[1]);
          }
          let chosen = null;
          for (const name of candidates) {
            const abs = path + '.' + name;
            if (t[abs] && t[abs].value != null && t[abs].value[0] != null) { chosen = abs; break; }
          }
          if (!chosen) for (const name of candidates) {
            const abs = path + '.' + name;
            if (t[abs] && t[abs].writable === true) { chosen = abs; break; }
          }
          if (!chosen && candidates.length) chosen = path + '.' + candidates[0];
          if (chosen) parameter = ['PARAM', chosen];
        }
        cells.push(p('td', p.context({device:t, parameter}, column.type || 'parameter',
          Object.assign({}, column, {device:t, parameter, label:null}))));
      }
      const canDelete = t[path] && t[path].writable === true;
      cells.push(p('td', canDelete ? [p('button', {
        title:'Delete this instance',
        onclick:() => Ve({name:'deleteObject', device:t['DeviceID.ID'].value[0], objectName:path})
      }, ve('delete-instance'))] : []));
      rows.push(p('tr', {key:path}, cells));
    }
  }
  const headers = [];
  for (const column of columns) headers.push(p('th', G(column.label, t) ?? ''));
  headers.push(p('th', 'Actions'));
  if (!rows.length) rows.push(p('tr.empty', {key:'empty'}, [p('td', {colspan:headers.length}, 'No instances')]));
  let actions = null;
  if (writable.length) {
    const preferred = parents.find(path => String(path).split('.')[4] === '1' && t[path] && t[path].writable === true)
      || writable[0];
    e.state.wanAddParent = preferred;
    const addBtn = p('button', {
      title:'Create a new instance',
      onclick:() => {
        const parent = e.state.wanAddParent;
        if (writable.includes(parent) && t[parent] && t[parent].object === true && t[parent].writable === true)
          Ve({name:'addObject', device:t['DeviceID.ID'].value[0], objectName:parent});
      }
    }, [ve('add-instance'), p('span', {key:'add-label'}, ' Add')]);
    actions = p('div.actions-bar', [addBtn]);
  }
  const label = G(e.attrs.label, t);
  const queries = [];
  if (e.attrs.deviceQuery) queries.push(e.attrs.deviceQuery);
  const tableNode = p('loading', {queries}, [
    p('div.wan-unified-table', {style:'max-width:100%;overflow-x:auto'},
      [p('table.table', [p('thead', [p('tr', headers)]), p('tbody', rows)])]),
    actions
  ].filter(n => n != null));
  if (label == null || label === '') return tableNode;
  return [p('h2', label), tableNode];
}

function testUnifiedWan() {
  const assert = require('node:assert/strict');
  const vm = require('node:vm');
  const tasks = [];
  function p(tag, attrs, ...children) {
    if (!attrs || Array.isArray(attrs) || typeof attrs !== 'object' || attrs.tag) {
      children.unshift(attrs); attrs = {};
    }
    return {tag, attrs, children};
  }
  p.context = (_context, ...args) => p(...args);
  function ne(value, visit) {
    return visit(Array.isArray(value) ? value.map(child => ne(child, visit)) : value);
  }
  function G(value, device) {
    if (!Array.isArray(value)) return value;
    if (value[0] === 'PARAM') return device[G(value[1], device)]?.value?.[0] ?? null;
    if (value[0] === '||') return value.slice(1).map(part => G(part, device)).join('');
    if (value[0] === 'FUNC' && value[1] === 'COALESCE')
      return value.slice(2).map(part => G(part, device)).find(part => part != null) ?? null;
    throw new Error('Unexpected test expression');
  }
  const context = {p, ne, G, Ve:task => tasks.push(task), ve:name => name};
  let render = vm.runInNewContext('(' + renderUnifiedWan.toString() + ')', context);
  if (process.argv.includes('--test-installed')) {
    const directory = '/usr/local/lib/node_modules/genieacs/public';
    const bundle = fs.readdirSync(directory).find(name => /^app-.*\.js$/.test(name));
    const source = fs.readFileSync(directory + '/' + bundle, 'utf8');
    const start = source.indexOf('var ou=');
    const end = source.indexOf(',Wo=ou;', start);
    assert(start >= 0 && end > start, 'Installed parameter-table component must be identifiable');
    const factory = vm.runInNewContext(source.slice(start + 7, end), context);
    render = (vnode, device, pattern, columns) => {
      vnode.attrs = Object.assign({}, vnode.attrs, {device, parameter:['PARAM',pattern], childParameters:columns});
      const component = factory();
      component.oninit(vnode);
      return component.view(vnode);
    };
  }
  function nodes(tree, tag) {
    const found = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      if (node.tag === tag) found.push(node);
      walk(node.children);
    }
    walk(tree); return found;
  }
  for (const kind of ['WANIPConnection', 'WANPPPConnection']) {
    tasks.length = 0;
    const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.';
    const parents = [1,2,3,4,5].map(index => base + index + '.' + kind);
    const device = {'DeviceID.ID':{value:['test']}};
    for (const parent of parents) device[parent] = {object:true, writable:true};
    const vendors = ['X_ZTE-COM_ServiceList', 'X_HW_SERVICELIST', 'X_FH_ServiceList'];
    for (let index = 0; index < vendors.length; index++) {
      const path = parents[index] + '.1';
      device[path] = {object:true, writable:index !== 2};
      device[path + '.' + vendors[index]] = {object:false, value:['INTERNET_' + index]};
    }
    const excluded = parents[0].replace('WANDevice.1.', 'WANDevice.2.');
    device[excluded] = device[excluded + '.1'] = {object:true, writable:true};
    const columns = [{label:'ServiceLists', parameter:['FUNC','COALESCE', ...vendors.map(name => ['PARAM',name])]}];
    const vnode = {attrs:{device}, state:{}};
    const pattern = base + '*.' + kind;
    let tree = render(vnode, device, pattern, columns);
    assert.equal(nodes(tree, 'table.table').length, 1);
    assert.equal(nodes(tree, 'thead').length, 1);
    assert.equal(nodes(tree, 'tr.empty').length, 0);
    assert.equal(nodes(tree, 'h2').length, 0);
    const cells = nodes(tree, 'parameter');
    assert.equal(cells.length, 3);
    assert.deepEqual(cells.map(cell => G(cell.attrs.parameter, device)), ['INTERNET_0','INTERNET_1','INTERNET_2']);
    let buttons = nodes(tree, 'button');
    const add = buttons.filter(button => button.attrs.title === 'Create a new instance');
    assert.equal(add.length, 1);
    assert.equal(nodes(tree, 'select').length, 0);
    assert.equal(nodes(tree, 'option').length, 0);
    add[0].attrs.onclick();
    assert.equal(tasks[tasks.length - 1].objectName, parents[0]);
    render(vnode, device, pattern, columns);
    assert.equal(vnode.state.wanAddParent, parents[0], 'Add targets Connection device 1');
    const deletes = buttons.filter(button => button.attrs.title === 'Delete this instance');
    assert.equal(deletes.length, 2);
    deletes.forEach(button => button.attrs.onclick());
    assert.deepEqual(tasks.slice(-2).map(task => task.objectName), parents.slice(0,2).map(parent => parent + '.1'));
    tree = render({attrs:{device, filter:false}, state:{}}, device, pattern, columns);
    assert.equal(nodes(tree, 'tr.empty').length, 1);
    assert.equal(nodes(tree, 'button').length, 1);
    for (const parent of parents) device[parent].writable = false;
    tree = render(vnode, device, pattern, columns);
    assert.equal(nodes(tree, 'select').length, 0);
    assert.equal(nodes(tree, 'button').filter(button => button.attrs.title === 'Create a new instance').length, 0);
    device[parents[4]].writable = true;
    tree = render({attrs:{device, filter:false}, state:{}}, device, pattern, columns);
    assert.equal(nodes(tree, 'select').length, 0, 'No selector is needed for a single writable parent');
    nodes(tree, 'button')[0].attrs.onclick();
    assert.equal(tasks[tasks.length - 1].objectName, parents[4]);
    tree = render({attrs:{}, state:{}}, {'DeviceID.ID':{value:['empty']}}, pattern, columns);
    assert.equal(nodes(tree, 'thead').length, 1);
    assert.equal(nodes(tree, 'tr.empty').length, 1);
    assert.equal(nodes(tree, 'button').length, 0);
    console.log(kind + ': unified header/rows, vendor values, empty state, permissions, and concrete actions PASS');
  }
  console.log('No browser, database writes, or device tasks used.');
}
if (process.argv.includes('--test') || process.argv.includes('--test-installed')) { testUnifiedWan(); process.exit(0); }
const dir = '/usr/local/lib/node_modules/genieacs/public';
const f = fs.readdirSync(dir).filter(x => /^app-.*\.js$/.test(x))[0];
const p = dir + '/' + f;
let s = fs.readFileSync(p, 'utf8');
// Resolve wildcard tables to concrete objects before rendering task buttons.
const tableFixes = [
  ['n=G(e.state.object,t),r=e.state.parameters;if(typeof n!="string"||!t[n])return null;',
   'n=G(e.state.object,t),r=e.state.parameters;if(typeof n!=="string")return null;if(n.split(".").includes("*")){let parts=n.split(".");return Object.keys(t).filter(path=>{let segments=path.split(".");return segments.length===parts.length&&parts.every((part,index)=>part==="*"?/^[0-9]+$/.test(segments[index]):part===segments[index])&&t[path].object===!0}).sort().map(path=>p("parameter-table",Object.assign({},e.attrs,{key:path,parameter:["PARAM",path]})))}if(!t[n])return null;'],
  ['t[g].writable===!0&&c.push',
   't[g]?.object===!0&&t[g].writable===!0&&/\\.[0-9]+$/.test(g)&&c.push'],
  ['t[n].writable===!0&&l.push',
   't[n].object===!0&&t[n].writable===!0&&!/\\.[0-9]+$/.test(n)&&l.push']
];
const legacyTable = tableFixes[0][1];
const unifiedBranch = 'if(/^InternetGatewayDevice\\.WANDevice\\.1\\.WANConnectionDevice\\.\\*\\.WAN(?:IP|PPP)Connection$/.test(n))return (' + renderUnifiedWan.toString() + ')(e,t,n,r);';
tableFixes[0][1] = legacyTable.replace('if(n.split(".").includes("*"))', unifiedBranch + 'if(n.split(".").includes("*"))');
let fixed = s.replace('{key:path,label:e.attrs.label||path,parameter:["PARAM",path]}', '{key:path,parameter:["PARAM",path]}');
if (!fixed.includes(tableFixes[0][1])) fixed = fixed.replace(legacyTable, tableFixes[0][1]);
for (const [before, after] of tableFixes) {
  if (fixed.includes(after)) continue;
  if (fixed.split(before).length !== 2) throw new Error('Unrecognized parameter-table implementation');
  fixed = fixed.replace(before, after);
}
if (fixed !== s) {
  if (!fs.existsSync(p + '.before-unified-wan-fix')) fs.copyFileSync(p, p + '.before-unified-wan-fix');
  if (!fs.existsSync(p + '.before-object-actions-fix')) fs.copyFileSync(p, p + '.before-object-actions-fix');
  fs.writeFileSync(p, fixed);
  s = fixed;
  console.log('fixed parameter-table object actions: ' + f);
}
const BAR = 'display:flex;gap:2px;margin:16px 0 16px;border-bottom:1px solid #d0d7de;flex-wrap:wrap';
const ACT = 'padding:8px 20px;border:1px solid #d0d7de;border-bottom:1px solid #fff;border-radius:6px 6px 0 0;background:#fff;cursor:pointer;font-weight:600;margin-bottom:-1px;font-size:14px';
const INA = 'padding:8px 20px;border:1px solid transparent;background:transparent;cursor:pointer;color:#555;font-size:14px';
const anchor = 'let n=me.ui.device,r=[];for(let s of Object.values(n))r.push(p.context({device:t.value[0],deviceQuery:t},G(s.type,null),s));return[p("h1",e.attrs.deviceId),r]';
const repl = 'let n=me.ui.device,r=[],o=[],a=e.state.gt;for(let s of Object.values(n)){if(s.route&&s.label)o.push(s);else r.push(p.context({device:t.value[0],deviceQuery:t},G(s.type,null),s))}if(a==null){a=0;try{let m=/[?&]tabs=([^&#]+)/.exec(location.hash||"");if(m){let q=decodeURIComponent(m[1]),j=o.findIndex(s=>G(s.route,null)===q);if(j>=0)a=j}}catch(_){}}if(a>=o.length)a=0;let l=o.map((s,i)=>p("button",{style:i===a?"' + ACT + '":"' + INA + '",onclick:()=>{e.state.gt=i;try{history.replaceState(null,"",location.hash.split("?")[0]+"?tabs="+G(s.route,null))}catch(_){}}},G(s.label,null)));if(o.length){r.push(p("div",{style:"' + BAR + '"},l));if(o[a])r.push(p("div.device-tab-content",[p("div",{key:JSON.stringify([e.attrs.deviceId,G(o[a].route,null),a])},p.context({device:t.value[0],deviceQuery:t},G(o[a].type,null),o[a]))]))}return[p("h1",e.attrs.deviceId),r]';
const oldPanel = 'if(o[a])r.push(p.context({device:t.value[0],deviceQuery:t},G(o[a].type,null),o[a]))';
const newPanel = 'if(o[a])r.push(p("div.device-tab-content",[p("div",{key:JSON.stringify([e.attrs.deviceId,G(o[a].route,null),a])},p.context({device:t.value[0],deviceQuery:t},G(o[a].type,null),o[a]))]))';
if (s.includes(newPanel)) { console.log('already current: ' + f); process.exit(0); }
if (s.includes(oldPanel)) {
  if (s.split(oldPanel).length !== 2) throw new Error('ambiguous tab panel');
  fs.copyFileSync(p, p + '.before-tab-identity-fix');
  fs.writeFileSync(p, s.replace(oldPanel, newPanel));
  console.log('fixed tab component identity: ' + f);
  process.exit(0);
}
if (s.includes('tabs=([^&#')) throw new Error('unrecognized tab patch; refusing to overwrite');
if (!s.includes(anchor)) throw new Error('anchor not found in ' + f);
if (!fs.existsSync(p + '.orig')) fs.copyFileSync(p, p + '.orig');
s = s.replace(anchor, repl);
fs.writeFileSync(p, s);
console.log('patched: ' + f);
