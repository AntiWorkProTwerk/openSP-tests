// Definitions only. Inject the complete reviewed emulator.json as __COPY__.
if (penpot.currentFile?.id !== '24d9d841-759d-81bc-8008-b518bc70d8b3') throw Error('OpenSP only');
const d = storage.emulatorDesign;
if (!d || !['guard', 'put', 'rect', 'text', 'height', 'instance', 'button', 'find'].every(k => typeof d[k] === 'function'))
  throw Error('Load the existing emulator-library.js definitions first');
if (storage.emulatorUpdateDesign) throw Error('Update helper already loaded; inspect its recorded stages');
const copy = JSON.parse(JSON.stringify(__COPY__));
const keys = ['updateHeading', 'updateNote', 'updateImage', 'updateManifest', 'updateNoCandidate', 'updateStart',
  'updateCancel', 'updateWaiting', 'updateReceipt', 'advancedReports', 'updateCancelNote', 'updateNoReceipt'];
if (!keys.every(k => typeof copy[k] === 'string' && copy[k].length) || !copy.stateLabels?.empty ||
    !['image', 'upload', 'preflight', 'boot-verified'].every(k => typeof copy.updatePhaseLabels?.[k] === 'string'))
  throw Error('Inject the complete reviewed shared copy');
Object.freeze(copy.updatePhaseLabels); Object.freeze(copy.stateLabels); Object.freeze(copy);
if (!['Paper', 'Ink', 'Muted', 'Line', 'Surface', 'Dark paper', 'Dark ink', 'Dark muted', 'Dark line', 'Dark surface'].every(k => d.colors[k]) ||
    !['Caption', 'Navigation', 'Code'].every(k => d.types[k])) throw Error('Existing semantic assets are incomplete');
const prefix = '6bf32eef-e7db-8057-8008-';
const variants = [
  {mobile: false, width: 1312, height: 386, usb: prefix + 'bb2a4e693e0c', main: prefix + 'bb2a4df2ff3e',
    session: prefix + 'bb2ab43f8748', sessionMain: prefix + 'bb2ab0ccd675', status: prefix + 'bb2ca11c67fd'},
  {mobile: true, width: 342, height: 510, usb: prefix + 'bb2a618ef1e2', main: prefix + 'bb2a610cd766',
    session: prefix + 'bb2b648a42db', sessionMain: prefix + 'bb2b617f1d5b', status: prefix + 'bb2ca3b42d19'}
];
const layouts = [
  {id: prefix + 'bb2c53c5a8c8', mobile: false, dark: false},
  {id: prefix + 'bb2c56a00a8b', mobile: false, dark: true},
  {id: prefix + 'bb2c69d49d80', mobile: true, dark: false},
  {id: prefix + 'bb2c6cd5e371', mobile: true, dark: true}
];
const tag = 'opensp-virtual-app1-update';
const errorText = 'The candidate bytes differ from the pinned SHA256.';
const u = storage.emulatorUpdateDesign = {copy, beforeMains: null, beforeLayouts: null, results: {}};
const name = (kind, mobile) => `Emulator ${kind} (${mobile ? 'Mobile' : 'Desktop'})`;
const variant = mobile => {if (typeof mobile !== 'boolean') throw Error('Choose a boolean variant'); return variants[Number(mobile)];};
const guard = page => d.guard(page);
const normalized = s => s.name.replace(/\s*\/\s*/g, '/');
const one = (parent, predicate) => {const found = parent.children.filter(predicate); if (found.length !== 1) throw Error('Unexpected child structure'); return found[0];};
const linked = (parent, componentId) => one(parent, s => s.component()?.id === componentId);
const component = (componentName, id) => {
  const c = d.components[componentName];
  if (!c || c.id !== id || c.path !== 'OpenSP / Emulator') throw Error('Component identity changed: ' + componentName);
  return c;
};
const main = v => {
  const s = component(name('USB', v.mobile), v.usb).mainInstance();
  if (s.id !== v.main || s.width !== v.width || s.flex || s.grid) throw Error('USB main changed');
  return s;
};
const sessionMain = v => {
  const s = component(name('session', v.mobile), v.session).mainInstance();
  if (s.id !== v.sessionMain || s.width !== v.width || s.flex || s.grid) throw Error('Session main changed');
  return s;
};
const row = (s, p) => ({id: s.id, parent: s.parent?.id, name: s.name, type: s.type,
  x: s.x - p.x, y: s.y - p.y, width: s.width, height: s.height, hidden: !!s.hidden,
  text: s.type === 'text' ? s.characters : null, font: s.type === 'text' ? [s.fontFamily, s.fontSize, s.lineHeight] : null,
  fills: s.fills, strokes: s.strokes, component: s.component()?.id ?? null});
const snapshot = s => ({...row(s, s.parent || s), children: s.children.map(c => row(c, s))});
const shell = (s, omit) => ({id: s.id, width: s.width,
  children: s.children.filter(c => c.id !== omit).map(c => row(c, s))});
const equal = (a, b, message) => {if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(message);};
const detached = value => JSON.parse(JSON.stringify(value));
const text = (p, key, x, y, w, size = 16, color = 'Ink', role = 'Caption') =>
  d.text(p, 'copy/' + key, copy[key], x, y, w, size, role, color);
const marker = s => JSON.parse(s.getPluginData(tag) || 'null');
const visible = s => {for (let p = s; p; p = p.parent) if (p.hidden) return false; return true;};
const status = (p, v, y, phase, message, messageKey = null) => {
  const s = d.instance(name('status', v.mobile), p, 0, y);
  if (s.component()?.id !== v.status || !s.isComponentCopyInstance()) throw Error('Status link changed');
  const label = d.find(s, 'State label'), value = d.find(s, 'State message'), surface = d.find(s, 'State message surface');
  value.characters = message; value.name = messageKey ? 'copy/' + messageKey : 'Update status message';
  if (phase === null) {
    label.hidden = true; surface.hidden = true; value.applyTypography(d.types.Caption);
    value.fontSize = '16'; value.lineHeight = '1.5'; value.letterSpacing = '0';
    const mh = d.height(message, v.width, 16, 1.5); d.put(value, s, 0, 0, v.width, mh); s.resize(v.width, mh);
  } else {
    label.name = 'Update phase'; label.characters = phase;
    const lh = d.height(phase, v.width * .52 / .6, 14, 1.5), mh = d.height(message, v.width - 32, 16, 1.5);
    d.put(label, s, 0, 0, v.width, lh);
    d.put(surface, s, 0, lh + 12, v.width, mh + 32); d.put(value, s, 16, lh + 28, v.width - 32, mh);
    s.resize(v.width, lh + mh + 44);
  }
  d.find(s, 'State rule').hidden = true;
  for (const action of s.children.filter(c => c.component()?.name === 'Emulator action')) action.hidden = true;
  return s;
};

// These two stages read shapes and store receipts only; root preserves the returned records.
u.inspectMains = () => {
  guard('Emulator components'); if (u.beforeMains) throw Error('Main inspection already recorded');
  if (component('Emulator action', prefix + 'bb287d8e3cdc').mainInstance().height !== 44) throw Error('Action primitive changed');
  const result = variants.map(v => {
    const usb = main(v), session = sessionMain(v), child = linked(session, v.usb);
    component(name('status', v.mobile), v.status);
    equal(usb.children.map(normalized), ['USB rule', 'copy/virtualUsb', 'copy/usbNote', 'copy/outputReport',
      'Output report field', 'Hex placeholder', 'Emulator action', 'Emulator action', 'copy/inputReport',
      'Input report surface', 'copy/noReport'], 'Original USB structure changed');
    if (marker(usb) || marker(session) || usb.height !== v.height || usb.children.length !== 11 ||
        usb.children.some(s => s.hidden) ||
        usb.children.some(s => normalized(s).startsWith('Update ') || normalized(s).startsWith('copy/update')) ||
        normalized(one(usb, s => normalized(s) === 'copy/virtualUsb')) !== 'copy/virtualUsb') throw Error('Existing or partial update main');
    return {mobile: v.mobile, usb: snapshot(usb), session: snapshot(session),
      sessionShell: shell(session, child.id), usbChild: row(child, session)};
  });
  u.beforeMains = detached(result); return {sourceOnly: true, file: penpot.currentFile.id, page: penpot.currentPage.id, mains: result};
};
u.inspectLayouts = () => {
  guard('Emulator'); if (u.beforeLayouts) throw Error('Layout inspection already recorded');
  const result = layouts.map(entry => {
    const b = one(penpot.root, s => s.id === entry.id), v = variant(entry.mobile), session = linked(b, v.session);
    const usb = linked(session, v.usb), footer = one(b, s => s.component()?.name === 'Footer');
    const metadata = JSON.parse(b.getPluginData('opensp-emulator') || 'null');
    if (marker(b) || b.flex || b.grid || metadata?.mobile !== entry.mobile || metadata?.dark !== entry.dark ||
        b.width !== (entry.mobile ? 390 : 1440) || usb.height !== v.height) throw Error('Existing or unexpected layout');
    return {...entry, board: snapshot(b), metadata, sessionShell: shell(session, usb.id), usbChild: row(usb, session),
      footer: snapshot(footer), unaffected: shell(b, session.id).children.filter(s => s.id !== footer.id)};
  });
  u.beforeLayouts = detached(result); return {sourceOnly: true, file: penpot.currentFile.id, page: penpot.currentPage.id, layouts: result};
};
u.extendMain = mobile => {
  guard('Emulator components'); const v = variant(mobile), b = main(v);
  if (!u.beforeMains || !u.beforeLayouts || marker(b)) throw Error('Inspect both pages first; refuse a repeated or partial stage');
  const before = u.beforeMains[Number(mobile)]; equal(snapshot(b), before.usb, 'USB main drift since inspection');
  equal(snapshot(sessionMain(v)), before.session, 'Session drift since inspection');
  const archived = b.children.filter(s => !['USB rule', 'copy/virtualUsb'].includes(normalized(s))).map(s => s.id);
  b.setPluginData(tag, JSON.stringify({stage: 'editing', mobile, beforeHeight: v.height, archived, illustrative: false}));
  for (const s of b.children) if (archived.includes(s.id)) s.hidden = true;
  let y = 64, t = text(b, 'updateHeading', 0, y, v.width, 18); y += t.height + 16;
  t = text(b, 'updateNote', 0, y, mobile ? v.width : 1032, 16, 'Muted'); y += t.height + 24;
  const fieldWidth = mobile ? v.width : (v.width - 24) / 2, fieldY = y;
  for (const [index, key] of ['updateImage', 'updateManifest'].entries()) {
    const x = mobile ? 0 : index * (fieldWidth + 24), sy = fieldY + (mobile ? index * 92 : 0);
    text(b, key, x, sy, fieldWidth); d.rect(b, 'Update file field / ' + key, x, sy + 32, fieldWidth, 44, 'Paper', 'Line');
    d.text(b, 'Update file placeholder / ' + key, 'Choose file  /  No file chosen', x + 12, sy + 42, fieldWidth - 24, 16);
  }
  y += mobile ? 184 : 92; t = text(b, 'updateNoCandidate', 0, y, v.width, 14, 'Muted', 'Code'); y += t.height + 16;
  d.button(b, 'updateStart', 0, y, mobile ? v.width : 224, true, true, copy.updateStart);
  d.button(b, 'updateCancel', mobile ? 0 : 240, y + (mobile ? 52 : 0), mobile ? v.width : 160, false, true, copy.updateCancel);
  y += mobile ? 112 : 60;
  const state = status(b, v, y, null, copy.updateWaiting, 'updateWaiting'); y += state.height + 16;
  d.rect(b, 'Update progress rail', 0, y, v.width, 1, 'Line').hidden = true;
  d.rect(b, 'Update progress fill', 0, y - 1, v.width, 3, 'Ink').hidden = true;
  d.text(b, 'Update progress value', '0 / 0 bytes', 0, y + 12, v.width, 14, 'Code').hidden = true;
  const error = d.text(b, 'Update error', errorText, 0, y, v.width, 16); error.hidden = true;
  t = text(b, 'updateNoReceipt', 0, y, v.width, 14, 'Muted', 'Code'); y += t.height + 8;
  t = text(b, 'updateReceipt', 0, y, mobile ? v.width : 1032, 14, 'Muted'); y += t.height + 24;
  t = text(b, 'updateCancelNote', 0, y, v.width, 14, 'Muted'); y += t.height + 24;
  const advanced = d.button(b, 'advancedReports', 0, y, v.width, false, false, copy.advancedReports);
  advanced.fills = []; advanced.strokes = []; d.find(advanced, 'Button border').hidden = true;
  const advancedLabel = d.find(advanced, 'copy/advancedReports'); advancedLabel.align = 'left';
  d.put(advancedLabel, advanced, 0, 10, v.width - 48, 24);
  d.rect(b, 'Advanced reports / top rule', 0, y, v.width, 1, 'Line');
  d.rect(b, 'Advanced reports / plus horizontal', v.width - 24, y + 21, 16, 1, 'Ink');
  d.rect(b, 'Advanced reports / plus vertical', v.width - 16.5, y + 13.5, 1, 16, 'Ink'); y += 44;
  b.resize(v.width, y);
  const result = {stage: 'main-complete', mobile, component: v.usb, main: b.id, beforeHeight: v.height,
    height: b.height, archived, status: state.id, initiallyDisabled: true, advancedClosed: true, firmwareProvided: false};
  b.setPluginData(tag, JSON.stringify(result)); u.results['usb-' + mobile] = result; return result;
};
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
u.fitSessionMain = mobile => {
  guard('Emulator components'); const v = variant(mobile), s = sessionMain(v), b = main(v), result = marker(b);
  if (!u.beforeMains || !u.beforeLayouts || result?.stage !== 'main-complete' || marker(s)) throw Error('USB main incomplete or session stage already started');
  const child = linked(s, v.usb), before = u.beforeMains[Number(mobile)];
  equal(shell(s, child.id), before.sessionShell, 'Unrelated session structure changed');
  if (!child.isComponentCopyInstance() || child.children.filter(c => normalized(c) === 'copy/updateHeading').length !== 1 ||
      !near(child.height, b.height) || !near(child.width, b.width)) throw Error('Wait for the linked USB main to propagate');
  if (s.children.some(c => c.id !== child.id && visible(c) && c.y >= child.y + before.usbChild.height)) throw Error('Unexpected content after USB');
  s.setPluginData(tag, JSON.stringify({stage: 'fitting', mobile})); s.resize(s.width, child.y - s.y + child.height + 32);
  const fitted = {stage: 'session-complete', mobile, main: s.id, usb: child.id, height: s.height, linked: true};
  s.setPluginData(tag, JSON.stringify(fitted)); u.results['session-' + mobile] = fitted; return fitted;
};
u.fitLayout = id => {
  guard('Emulator'); const before = u.beforeLayouts?.find(s => s.id === id); if (!before) throw Error('Inspect the exact layout first');
  const v = variant(before.mobile), b = one(penpot.root, s => s.id === id), s = linked(b, v.session), usb = linked(s, v.usb);
  const footer = one(b, c => c.component()?.name === 'Footer'), fitted = marker(sessionMain(v));
  if (marker(b) || fitted?.stage !== 'session-complete' || !s.isComponentCopyInstance() || !usb.isComponentCopyInstance() ||
      !near(s.height, fitted.height) || !near(usb.height, marker(main(v))?.height) ||
      usb.children.filter(c => normalized(c) === 'copy/updateHeading').length !== 1) throw Error('Layout already started or linked mains have not propagated');
  equal(shell(s, usb.id), before.sessionShell, 'Unrelated session layout changed');
  equal(shell(b, s.id).children.filter(c => c.id !== footer.id), before.unaffected, 'Unrelated board content changed');
  equal(snapshot(footer), before.footer, 'Footer changed since inspection');
  if (s.x - b.x !== before.board.children.find(c => c.id === s.id).x || s.y - b.y !== before.board.children.find(c => c.id === s.id).y)
    throw Error('Session placement changed');
  b.setPluginData(tag, JSON.stringify({stage: 'fitting', mobile: before.mobile, dark: before.dark}));
  if (before.dark) {
    const map = {Paper: 'Dark paper', Ink: 'Dark ink', Muted: 'Dark muted', Line: 'Dark line', Surface: 'Dark surface'};
    for (const shape of [usb, ...penpotUtils.findShapes(c => visible(c), usb)]) {
      if (shape.fills?.length) shape.fills = shape.fills.map(f => {const k = Object.keys(map).find(n => f.fillColorRefId === d.colors[n].id); return k ? {...f, ...d.colors[map[k]].asFill()} : f;});
      if (shape.strokes?.length) shape.strokes = shape.strokes.map(f => {const k = Object.keys(map).find(n => f.strokeColorRefId === d.colors[n].id); return k ? {...f, ...d.colors[map[k]].asStroke(), strokeWidth: f.strokeWidth} : f;});
    }
  }
  footer.y = s.y + s.height + 32; b.resize(b.width, footer.y - b.y + footer.height + (before.mobile ? 40 : 64));
  const result = {stage: 'layout-complete', board: id, mobile: before.mobile, dark: before.dark, height: b.height,
    session: s.id, usb: usb.id, footer: footer.id, linked: true, firmwareProvided: false};
  b.setPluginData(tag, JSON.stringify(result)); u.results[id] = result; return result;
};
// Example strings are shared copy or the actual updater error; they carry no completed receipt.
u.exampleStatus = (parentId, mobile, key, x, y) => {
  guard('Emulator'); const v = variant(mobile), parent = one(penpot.root, s => s.id === parentId);
  if (parent.name !== 'Emulator interaction states' || marker(parent) || !['image', 'upload', 'error', 'boot-verified'].includes(key))
    throw Error('Use the preserved state sheet and one named illustrative state');
  const exampleName = 'Illustrative APP1 update / ' + mobile + ' / ' + key;
  if (parent.children.some(s => s.name === exampleName)) throw Error('Example exists; inspect before repeating');
  if (![x, y].every(Number.isFinite) || x < 0 || y < parent.height || x + v.width > parent.width) throw Error('Append examples below the preserved state sheet');
  const message = key === 'error' ? errorText : key === 'boot-verified' ? copy.updateReceipt : copy.updateNoReceipt;
  const heading = d.text(parent, exampleName, 'Illustrative update state', x, y, v.width, 14, 'Caption', 'Muted');
  const phase = key === 'error' ? 'Update stopped.' : copy.updatePhaseLabels[key], s = status(parent, v, y + heading.height + 8, phase, message);
  d.put(s, parent, x, y + heading.height + 8); s.name = exampleName + ' / linked status';
  s.setPluginData(tag, JSON.stringify({illustrative: true, key, mobile, completedReceipt: false, firmwareProvided: false}));
  parent.resize(parent.width, s.y - parent.y + s.height + 32);
  return {id: s.id, linked: s.isComponentCopyInstance(), component: s.component()?.id, illustrative: true, key};
};
u.inspectResult = () => {
  guard('Emulator');
  return layouts.map(entry => {
    const b = one(penpot.root, s => s.id === entry.id), v = variant(entry.mobile), s = linked(b, v.session), usb = linked(s, v.usb);
    return {board: b.id, stage: marker(b), usb: row(usb, s),
      linkedHeads: penpotUtils.findShapes(c => visible(c) && c.isComponentHead(), b).map(c => ({id: c.id, component: c.component()?.id, copy: c.isComponentCopyInstance()})),
      text: penpotUtils.findShapes(c => visible(c) && c.type === 'text', usb).map(c => ({...row(c, usb), ink: c.textBounds || null}))};
  });
};
return {loaded: true, sourceOnly: true, page: penpot.currentPage.name,
  stages: ['inspectMains', 'inspectLayouts', 'extendMain', 'fitSessionMain', 'fitLayout', 'exampleStatus', 'inspectResult']};
