const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Execute the original function declarations without booting the DOM/auth UI.
// Explicit boundaries fail loudly if the source is reorganized; no copied logic.
function functionSource(name, nextName) {
  const startPattern = new RegExp(`(?:async )?function ${name}\\(`);
  const start = source.search(startPattern);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Cannot locate app function ${name}`);
  // The next declaration may itself be async.
  return source.slice(start, end).replace(/async\s*$/, '');
}

function appHarness(overrides = {}) {
  let id = 0;
  const storage = new Map();
  const context = {
    transactions: [], feePayments: [], mutations: [], revisions: [], activities: [],
    currentUser: { id: 'test-user', email: 'accountant@example.test' },
    getNextId: () => ++id,
    showToast() {}, extractMonthFromParticulars: () => '',
    ...overrides
  };
  context.trackRevision = (action, old, tx) => {
    const rev = { action, old, tx: structuredClone(tx) };
    context.revisions.push(rev);
    return rev;
  };
  context.pushOrQueueMutation ||= async (action, tx) => {
    context.mutations.push({ action, tx: structuredClone(tx) });
  };
  context.saveData = () => storage.set('ledger', structuredClone(context.transactions));
  context.logActivity = (...args) => context.activities.push(args);
  vm.createContext(context);
  for (const [name, next] of [
    ['getCurrentAcademicYear', 'extractMonthFromParticulars'],
    ['calcDashboard', 'refreshDashboard'],
    ['addTransaction', 'deleteTransaction'],
    ['deleteTransaction', 'updateTransaction']
  ]) vm.runInContext(functionSource(name, next), context);
  context.persisted = () => storage.get('ledger');
  return context;
}

function facultyHarness({ online = false, rpc } = {}) {
  const storage = new Map();
  const calls = [];
  const window = {
    currentUser: online ? { id: 'test-user', email: 'accountant@example.test' } : null,
    supabaseClient: online ? {
      rpc: async (name, payload) => {
        calls.push({ name, payload });
        return rpc ? rpc(name, payload) : { data: { success: true }, error: null };
      }
    } : null
  };
  const context = { window, console, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'dataService.js'), 'utf8'), context);
  return { service: window.DataService, calls, storage };
}

module.exports = { appHarness, facultyHarness };
